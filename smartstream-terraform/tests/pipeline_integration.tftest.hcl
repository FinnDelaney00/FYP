mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
      arn        = "arn:aws:iam::123456789012:user/terraform-test"
      id         = "123456789012"
      user_id    = "AIDATERRAFORMTEST123"
    }
  }

  mock_data "aws_region" {
    defaults = {
      name = "eu-north-1"
      id   = "eu-north-1"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = <<JSON
{"Version":"2012-10-17","Statement":[]}
JSON
    }
  }

  mock_data "aws_iam_role" {
    defaults = {
      arn  = "arn:aws:iam::123456789012:role/mock-shared-role"
      id   = "mock-shared-role"
      name = "mock-shared-role"
    }
  }
}

mock_provider "archive" {
  mock_data "archive_file" {
    defaults = {
      output_path         = "mock.zip"
      output_base64sha256 = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
    }
  }
}

mock_provider "random" {
  mock_resource "random_password" {
    defaults = {
      result = "UnitTestPassword123!"
    }
  }
}

run "default_pipeline_wiring" {
  command = plan

  variables {
    db_password = "UnitTestPassword123!"
  }

  assert {
    condition     = aws_dms_endpoint.source.endpoint_type == "source" && aws_dms_endpoint.source.engine_name == "postgres"
    error_message = "DMS source endpoint should be PostgreSQL."
  }

  assert {
    condition     = aws_dms_endpoint.target_kinesis.engine_name == "kinesis"
    error_message = "DMS target endpoint should be Kinesis."
  }

  assert {
    condition     = aws_kinesis_firehose_delivery_stream.s3_delivery.destination == "extended_s3"
    error_message = "Firehose must deliver to extended S3."
  }

  assert {
    condition     = aws_kinesis_firehose_delivery_stream.s3_delivery.extended_s3_configuration[0].prefix == "raw/!{timestamp:yyyy/MM/dd/HH}/"
    error_message = "Firehose raw prefix should target raw zone partitions."
  }

  assert {
    condition     = aws_s3_bucket_notification.data_lake.lambda_function[0].filter_prefix == aws_lambda_function.transform.environment[0].variables.RAW_PREFIX
    error_message = "S3 notification raw prefix must match transform lambda RAW_PREFIX."
  }

  assert {
    condition     = aws_lambda_function.transform.environment[0].variables.TRUSTED_PREFIX == local.s3_trusted_prefix
    error_message = "Transform lambda TRUSTED_PREFIX must stay aligned with locals."
  }

  assert {
    condition     = aws_glue_crawler.trusted.database_name == aws_glue_crawler.analytics.database_name
    error_message = "Glue crawlers should share the same Glue database."
  }

  assert {
    condition     = aws_lambda_function.ml_inference.environment[0].variables.ANALYTICS_PREFIX == "${local.s3_trusted_analytics_prefix}${local.name_prefix}/predictions/"
    error_message = "ML lambda analytics prefix must target trusted-analytics predictions."
  }

  assert {
    condition     = aws_lambda_function.live_api.environment[0].variables.ATHENA_WORKGROUP == aws_athena_workgroup.main.name
    error_message = "Live API lambda ATHENA_WORKGROUP should be wired to Terraform Athena workgroup."
  }

  assert {
    condition     = aws_lambda_function.live_api.environment[0].variables.ATHENA_DATABASE == aws_glue_catalog_database.main.name
    error_message = "Live API lambda ATHENA_DATABASE should be wired to Terraform Glue database."
  }

  assert {
    condition     = aws_lambda_function.ops_api.environment[0].variables.KINESIS_STREAM_NAME == aws_kinesis_stream.cdc_stream.name
    error_message = "Ops API should be wired to the deployed Kinesis stream."
  }

  assert {
    condition     = aws_lambda_function.ops_api.environment[0].variables.DMS_PUBLIC_TASK_ID == aws_dms_replication_task.cdc_task.replication_task_id
    error_message = "Ops API should receive the primary DMS task identifier."
  }

  assert {
    condition     = length([for r in jsondecode(aws_dms_replication_task.finance_cdc_task.table_mappings).rules : r if r["rule-action"] == "include"]) == 2
    error_message = "Finance DMS task should include the two default finance tables."
  }

  assert {
    condition     = length([for r in jsondecode(aws_dms_replication_task.finance_cdc_task.table_mappings).rules : r if r["rule-name"] == "exclude-dms-internal-finance" && r["object-locator"]["table-name"] == "awsdms_%"]) == 1
    error_message = "Finance DMS task should exclude AWS DMS internal tables."
  }
}

run "override_pipeline_wiring" {
  command = plan

  variables {
    db_password                = "UnitTestPassword123!"
    finance_schema_name        = "ledger"
    finance_table_list         = ["transactions", "accounts", "balances"]
    data_lake_bucket_name      = "external-live-api-bucket"
    trusted_prefix_predictions = "trusted-analytics/ml/predictions/"
    max_items                  = 321
    query_max_rows             = 777
    auth_token_ttl_seconds     = 7200
  }

  assert {
    condition     = aws_lambda_function.live_api.environment[0].variables.DATA_LAKE_BUCKET == "external-live-api-bucket"
    error_message = "Live API should honor overridden data_lake_bucket_name."
  }

  assert {
    condition     = aws_lambda_function.live_api.environment[0].variables.TRUSTED_ROOT_PREFIX == local.s3_trusted_prefix
    error_message = "Live API TRUSTED_ROOT_PREFIX should stay aligned with the trusted root prefix."
  }

  assert {
    condition     = aws_lambda_function.live_api.environment[0].variables.TRUSTED_ANALYTICS_ROOT_PREFIX == local.s3_trusted_analytics_prefix
    error_message = "Live API TRUSTED_ANALYTICS_ROOT_PREFIX should stay aligned with the analytics root prefix."
  }

  assert {
    condition = contains(
      flatten([
        for statement in jsondecode(aws_iam_role_policy.lambda_live_api_s3[0].policy).Statement :
        try(statement.Resource, [])
      ]),
      "arn:aws:s3:::external-live-api-bucket/trusted-analytics/ml/predictions/*"
    )
    error_message = "Live API IAM policy should honor the overridden predictions prefix."
  }

  assert {
    condition     = aws_lambda_function.live_api.environment[0].variables.MAX_ITEMS_DEFAULT == "321" && aws_lambda_function.live_api.environment[0].variables.QUERY_MAX_ROWS == "777"
    error_message = "Live API query limits should honor overridden variables."
  }

  assert {
    condition     = aws_lambda_function.transform.environment[0].variables.FINANCE_SCHEMA_NAME == "ledger" && aws_lambda_function.transform.environment[0].variables.FINANCE_TABLE_LIST == "transactions,accounts,balances"
    error_message = "Transform lambda finance env vars should track finance overrides."
  }

  assert {
    condition = alltrue([
      for r in [for rule in jsondecode(aws_dms_replication_task.finance_cdc_task.table_mappings).rules : rule if rule["rule-action"] == "include"] :
      r["object-locator"]["schema-name"] == "ledger"
    ])
    error_message = "All finance include rules must use the overridden schema."
  }

  assert {
    condition     = length([for r in jsondecode(aws_dms_replication_task.finance_cdc_task.table_mappings).rules : r if r["rule-action"] == "include"]) == 3
    error_message = "Finance DMS include rule count should match overridden finance_table_list."
  }
}

run "tenant_mode_shared_iam_reuse" {
  command = plan

  variables {
    db_password                       = "UnitTestPassword123!"
    enable_tenant_prefix              = true
    company_name                      = "newaccount"
    environment                       = "dev"
    create_shared_iam                 = false
    shared_dms_secrets_role_name      = "shared-dms-secrets-role"
    shared_dms_kinesis_role_name      = "shared-dms-kinesis-role"
    shared_dms_vpc_role_name          = "dms-vpc-role"
    shared_firehose_role_name         = "shared-firehose-role"
    shared_lambda_transform_role_name = "shared-lambda-transform-role"
    shared_lambda_ml_role_name        = "shared-lambda-ml-role"
    shared_lambda_live_api_role_name  = "shared-lambda-live-api-role"
    shared_lambda_ops_api_role_name   = "shared-lambda-ops-api-role"
    shared_lambda_anomaly_role_name   = "shared-lambda-anomaly-role"
    shared_glue_crawler_role_name     = "shared-glue-crawler-role"
  }

  assert {
    condition     = local.name_prefix == "newaccount-dev"
    error_message = "Tenant mode must derive the resource prefix from company_name and environment."
  }

  assert {
    condition     = aws_s3_bucket.data_lake.bucket == "newaccount-dev-123456789012-datalake"
    error_message = "Tenant data lake bucket must use tenant bucket-prefix naming."
  }

  assert {
    condition     = local.lambda_transform_role_arn != "" && local.lambda_ml_role_arn != "" && local.lambda_live_api_role_arn != "" && local.lambda_ops_api_role_arn != "" && local.lambda_anomaly_role_arn != ""
    error_message = "Tenant mode must resolve shared IAM role ARNs instead of creating tenant IAM roles."
  }

  assert {
    condition     = local.common_tags["Company"] == "newaccount"
    error_message = "Tenant resources must include Company tag using company_name."
  }
}
