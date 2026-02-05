############################################
# dms.tf — DMS (Full load + CDC) -> Kinesis
############################################

########################
# Inputs (in this file)
########################
variable "project" {
  type    = string
  default = "smartstream"
}

variable "env" {
  type    = string
  default = "dev"
}

# Networking for the DMS replication instance
variable "dms_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for DMS replication instance."
}

variable "dms_security_group_id" {
  type        = string
  description = "Security group ID attached to the DMS replication instance (must allow outbound to RDS + Kinesis endpoints as required)."
}

# RDS Postgres connection
variable "rds_endpoint" {
  type        = string
  description = "RDS hostname (no port). Example: mydb.abc123.eu-west-1.rds.amazonaws.com"
}

variable "rds_port" {
  type        = number
  default     = 5432
  description = "Postgres port."
}

variable "db_name" {
  type        = string
  description = "Database name."
}

variable "db_user" {
  type        = string
  sensitive   = true
  description = "Database username."
}

variable "db_password" {
  type        = string
  sensitive   = true
  description = "Database password."
}

# Kinesis target
variable "kinesis_stream_arn" {
  type        = string
  description = "ARN of the Kinesis Data Stream that DMS will write to."
}

# DMS sizing
variable "dms_instance_class" {
  type    = string
  default = "dms.t3.micro"
}

variable "dms_allocated_storage" {
  type    = number
  default = 50
}

# What tables to replicate (defaults to public.%)
variable "source_schema_name" {
  type    = string
  default = "public"
}

variable "source_table_name" {
  type    = string
  default = "%"
}

# DMS task type
variable "migration_type" {
  type        = string
  default     = "full-load-and-cdc"
  description = "One of: full-load | cdc | full-load-and-cdc"
}

locals {
  name_prefix = "${var.project}-${var.env}"

  # Table mappings: include schema/table pattern
  table_mappings = {
    rules = [
      {
        "rule-type" : "selection",
        "rule-id"   : "1",
        "rule-name" : "include-tables",
        "object-locator" : {
          "schema-name" : var.source_schema_name,
          "table-name"  : var.source_table_name
        },
        "rule-action" : "include"
      }
    ]
  }

  # Task settings (minimal + logging on)
  task_settings = {
    Logging = {
      EnableLogging = true
    }
  }

  common_tags = {
    Project = var.project
    Env     = var.env
  }
}

########################
# IAM: DMS -> Kinesis
########################
data "aws_iam_policy_document" "dms_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dms.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dms_kinesis_role" {
  name               = "${local.name_prefix}-dms-kinesis-role"
  assume_role_policy = data.aws_iam_policy_document.dms_assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "dms_kinesis_policy" {
  # Allow DMS to write to Kinesis
  statement {
    actions = [
      "kinesis:DescribeStream",
      "kinesis:PutRecord",
      "kinesis:PutRecords"
    ]
    resources = [var.kinesis_stream_arn]
  }

  # Allow logs (DMS task logging)
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "dms_kinesis_role_policy" {
  name   = "${local.name_prefix}-dms-kinesis-policy"
  role   = aws_iam_role.dms_kinesis_role.id
  policy = data.aws_iam_policy_document.dms_kinesis_policy.json
}

########################################
# DMS Subnet group + Replication instance
########################################
resource "aws_dms_replication_subnet_group" "this" {
  replication_subnet_group_id          = "${local.name_prefix}-dms-subnets"
  replication_subnet_group_description = "DMS subnet group for ${local.name_prefix}"
  subnet_ids                           = var.dms_subnet_ids
  tags                                 = local.common_tags
}

resource "aws_dms_replication_instance" "this" {
  replication_instance_id    = "${local.name_prefix}-dms"
  replication_instance_class = var.dms_instance_class
  allocated_storage          = var.dms_allocated_storage

  publicly_accessible           = false
  replication_subnet_group_id   = aws_dms_replication_subnet_group.this.id
  vpc_security_group_ids        = [var.dms_security_group_id]
  auto_minor_version_upgrade    = true
  multi_az                       = false
  apply_immediately              = true

  tags = local.common_tags
}

########################
# DMS Endpoints
########################
resource "aws_dms_endpoint" "source_postgres" {
  endpoint_id   = "${local.name_prefix}-src-pg"
  endpoint_type = "source"
  engine_name   = "postgres"

  server_name   = var.rds_endpoint
  port          = var.rds_port
  database_name = var.db_name
  username      = var.db_user
  password      = var.db_password

  ssl_mode = "require"

  tags = local.common_tags
}

resource "aws_dms_endpoint" "target_kinesis" {
  endpoint_id   = "${local.name_prefix}-tgt-kinesis"
  endpoint_type = "target"
  engine_name   = "kinesis"

  kinesis_settings {
    stream_arn              = var.kinesis_stream_arn
    service_access_role_arn = aws_iam_role.dms_kinesis_role.arn
    message_format          = "json"
  }

  tags = local.common_tags
}

########################
# Replication Task
########################
resource "aws_dms_replication_task" "this" {
  replication_task_id      = "${local.name_prefix}-full-load-cdc"
  migration_type           = var.migration_type

  replication_instance_arn = aws_dms_replication_instance.this.replication_instance_arn
  source_endpoint_arn      = aws_dms_endpoint.source_postgres.endpoint_arn
  target_endpoint_arn      = aws_dms_endpoint.target_kinesis.endpoint_arn

  table_mappings             = jsonencode(local.table_mappings)
  replication_task_settings  = jsonencode(local.task_settings)

  tags = local.common_tags

  depends_on = [aws_iam_role_policy.dms_kinesis_role_policy]
}

########################
# Outputs (useful later)
########################
output "dms_replication_instance_arn" {
  value = aws_dms_replication_instance.this.replication_instance_arn
}

output "dms_task_arn" {
  value = aws_dms_replication_task.this.replication_task_arn
}

output "dms_source_endpoint_arn" {
  value = aws_dms_endpoint.source_postgres.endpoint_arn
}

output "dms_target_endpoint_arn" {
  value = aws_dms_endpoint.target_kinesis.endpoint_arn
}
