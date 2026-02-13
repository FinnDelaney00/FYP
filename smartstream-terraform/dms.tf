# DMS Replication Instance
resource "aws_dms_replication_instance" "main" {
  replication_instance_id    = "${local.name_prefix}-replication-instance"
  replication_instance_class = "dms.t3.small" # Cost-conscious default

  allocated_storage = 20

  # Networking
  replication_subnet_group_id = aws_dms_replication_subnet_group.main.id
  vpc_security_group_ids      = [aws_security_group.dms.id]
  publicly_accessible         = false

  # Enable Multi-AZ for production (disabled for cost savings in dev)
  multi_az = false

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dms-replication-instance"
  })
}

# DMS Source Endpoint (RDS PostgreSQL)
resource "aws_dms_endpoint" "source" {
  endpoint_id   = "${local.name_prefix}-source-postgres"
  endpoint_type = "source"
  engine_name   = "postgres"

  database_name = var.db_name

  # Use Secrets Manager for credentials
  secrets_manager_access_role_arn = aws_iam_role.dms_secrets_access.arn
  secrets_manager_arn             = aws_secretsmanager_secret.rds_credentials.arn

  # SSL configuration
  ssl_mode = "require"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-source-endpoint"
  })

  depends_on = [
    aws_db_instance.main,
    aws_secretsmanager_secret_version.rds_credentials
  ]
}

# DMS Target Endpoint (Kinesis Data Stream)
resource "aws_dms_endpoint" "target_kinesis" {
  endpoint_id   = "${local.name_prefix}-target-kinesis"
  endpoint_type = "target"
  engine_name   = "kinesis"

  kinesis_settings {
    stream_arn              = aws_kinesis_stream.cdc_stream.arn
    service_access_role_arn = aws_iam_role.dms_kinesis_target.arn
    message_format          = "json-unformatted"

    # Include transaction details in messages
    include_transaction_details    = false
    include_partition_value        = false
    include_table_alter_operations = false
    include_control_details        = false
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-kinesis-target-endpoint"
  })

  depends_on = [aws_kinesis_stream.cdc_stream]
}

# DMS Replication Task (Full Load + CDC)
resource "aws_dms_replication_task" "cdc_task" {
  replication_task_id      = "${local.name_prefix}-cdc-task"
  replication_instance_arn = aws_dms_replication_instance.main.replication_instance_arn
  source_endpoint_arn      = aws_dms_endpoint.source.endpoint_arn
  target_endpoint_arn      = aws_dms_endpoint.target_kinesis.endpoint_arn

  migration_type = "full-load-and-cdc"

  # Table mappings - replicate all tables from the source database
  table_mappings = jsonencode({
    rules = [
      {
        rule-type = "selection"
        rule-id   = "1"
        rule-name = "select-all-tables"
        object-locator = {
          schema-name = "public"
          table-name  = "%"
        }
        rule-action = "include"
      },
      {
        rule-type = "selection"
        rule-id   = "2"
        rule-name = "exclude-dms-status-table"
        object-locator = {
          schema-name = "public"
          table-name  = "awsdms_status"
        }
        rule-action = "exclude"
      },
      {
        rule-type = "selection"
        rule-id   = "3"
        rule-name = "exclude-dms-history-table"
        object-locator = {
          schema-name = "public"
          table-name  = "awsdms_history"
        }
        rule-action = "exclude"
      },
      {
        rule-type = "selection"
        rule-id   = "4"
        rule-name = "exclude-dms-apply-exceptions"
        object-locator = {
          schema-name = "public"
          table-name  = "awsdms_apply_exceptions"
        }
        rule-action = "exclude"
      },
      {
        rule-type = "selection"
        rule-id   = "5"
        rule-name = "exclude-dms-suspended-tables"
        object-locator = {
          schema-name = "public"
          table-name  = "awsdms_suspended_tables"
        }
        rule-action = "exclude"
      }
    ]
  })

  # Replication task settings
  replication_task_settings = jsonencode({
    TargetMetadata = {
      SupportLobs = true
      LobMaxSize  = 32
    }
    FullLoadSettings = {
      TargetTablePrepMode = "DO_NOTHING"
      MaxFullLoadSubTasks = 8
    }
    Logging = {
      EnableLogging = true
      LogComponents = [
        {
          Id       = "TRANSFORMATION"
          Severity = "LOGGER_SEVERITY_DEFAULT"
        },
        {
          Id       = "SOURCE_UNLOAD"
          Severity = "LOGGER_SEVERITY_DEFAULT"
        },
        {
          Id       = "TARGET_LOAD"
          Severity = "LOGGER_SEVERITY_INFO"
        }
      ]
    }
    ControlTablesSettings = {
      ControlSchema               = ""
      HistoryTimeslotInMinutes    = 5
      HistoryTableEnabled         = false
      SuspendedTablesTableEnabled = false
      StatusTableEnabled          = false
    }
    ChangeProcessingDdlHandlingPolicy = {
      HandleSourceTableDropped   = true
      HandleSourceTableTruncated = true
      HandleSourceTableAltered   = true
    }
    ChangeProcessingTuning = {
      BatchApplyPreserveTransaction = true
      BatchApplyTimeoutMin          = 1
      BatchApplyTimeoutMax          = 30
      BatchSplitSize                = 0
      MinTransactionSize            = 1000
      CommitTimeout                 = 1
      MemoryLimitTotal              = 1024
      MemoryKeepTime                = 60
      StatementCacheSize            = 50
    }
  })

  # Start replication task automatically
  start_replication_task = true # Set to true to auto-start after apply

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-cdc-replication-task"
  })

  depends_on = [
    aws_dms_endpoint.source,
    aws_dms_endpoint.target_kinesis
  ]
}

# DMS Replication Task (Finance Full Load + CDC)
resource "aws_dms_replication_task" "finance_cdc_task" {
  replication_task_id      = "${local.name_prefix}-finance"
  replication_instance_arn = aws_dms_replication_instance.main.replication_instance_arn
  source_endpoint_arn      = aws_dms_endpoint.source.endpoint_arn
  target_endpoint_arn      = aws_dms_endpoint.target_kinesis.endpoint_arn

  migration_type = "full-load-and-cdc"

  # Table mappings - replicate selected finance tables only
  table_mappings = jsonencode({
    rules = concat(
      [
        for idx, table_name in var.finance_table_list : {
          rule-type = "selection"
          rule-id   = tostring(idx + 1)
          rule-name = "include-finance-${table_name}"
          object-locator = {
            schema-name = var.finance_schema_name
            table-name  = table_name
          }
          rule-action = "include"
        }
      ],
      [
        {
          rule-type = "selection"
          rule-id   = "900"
          rule-name = "exclude-dms-internal-finance"
          object-locator = {
            schema-name = var.finance_schema_name
            table-name  = "awsdms_%"
          }
          rule-action = "exclude"
        }
      ]
    )
  })

  # Keep settings aligned with primary CDC task
  replication_task_settings = jsonencode({
    TargetMetadata = {
      SupportLobs = true
      LobMaxSize  = 32
    }
    FullLoadSettings = {
      TargetTablePrepMode = "DO_NOTHING"
      MaxFullLoadSubTasks = 8
    }
    Logging = {
      EnableLogging = true
      LogComponents = [
        {
          Id       = "TRANSFORMATION"
          Severity = "LOGGER_SEVERITY_DEFAULT"
        },
        {
          Id       = "SOURCE_UNLOAD"
          Severity = "LOGGER_SEVERITY_DEFAULT"
        },
        {
          Id       = "TARGET_LOAD"
          Severity = "LOGGER_SEVERITY_INFO"
        }
      ]
    }
    ControlTablesSettings = {
      ControlSchema               = ""
      HistoryTimeslotInMinutes    = 5
      HistoryTableEnabled         = false
      SuspendedTablesTableEnabled = false
      StatusTableEnabled          = false
    }
    ChangeProcessingDdlHandlingPolicy = {
      HandleSourceTableDropped   = true
      HandleSourceTableTruncated = true
      HandleSourceTableAltered   = true
    }
    ChangeProcessingTuning = {
      BatchApplyPreserveTransaction = true
      BatchApplyTimeoutMin          = 1
      BatchApplyTimeoutMax          = 30
      BatchSplitSize                = 0
      MinTransactionSize            = 1000
      CommitTimeout                 = 1
      MemoryLimitTotal              = 1024
      MemoryKeepTime                = 60
      StatementCacheSize            = 50
    }
  })

  start_replication_task = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-finance-cdc-replication-task"
  })

  depends_on = [
    aws_dms_endpoint.source,
    aws_dms_endpoint.target_kinesis
  ]
}
