# Get current AWS account ID and region
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  s3_suffix  = data.aws_caller_identity.current.account_id

  company_name_normalized_raw = trim(
    replace(
      replace(
        replace(lower(trimspace(var.company_name)), "/[ _]+/", "-"),
        "/[^a-z0-9-]/",
        ""
      ),
      "/-+/",
      "-"
    ),
    "-"
  )
  company_name_normalized = substr(local.company_name_normalized_raw, 0, 30)

  legacy_prefix = var.legacy_name_prefix
  tenant_prefix = var.name_prefix_override != "" ? var.name_prefix_override : "${var.company_name}-${var.environment}"
  name_prefix   = var.enable_tenant_prefix ? local.tenant_prefix : local.legacy_prefix
  bucket_prefix = "${local.name_prefix}-${local.s3_suffix}"

  data_lake_bucket_legacy      = "${local.name_prefix}-datalake-${local.account_id}"
  athena_results_bucket_legacy = "${local.name_prefix}-athena-results-${local.account_id}"
  web_bucket_name_legacy       = "${local.name_prefix}-web-${local.account_id}"

  data_lake_bucket_tenant      = lower("${local.bucket_prefix}-datalake")
  athena_results_bucket_tenant = lower("${local.bucket_prefix}-athena-results")
  web_bucket_name_tenant       = lower("${local.bucket_prefix}-web")

  data_lake_bucket      = var.enable_tenant_prefix ? local.data_lake_bucket_tenant : local.data_lake_bucket_legacy
  athena_results_bucket = var.enable_tenant_prefix ? local.athena_results_bucket_tenant : local.athena_results_bucket_legacy
  web_bucket_name       = coalesce(var.web_bucket_name, var.enable_tenant_prefix ? local.web_bucket_name_tenant : local.web_bucket_name_legacy)

  data_lake_bucket_arn_patterns = [
    "arn:aws:s3:::*-datalake-${local.account_id}",
    "arn:aws:s3:::*-${local.account_id}-datalake"
  ]
  data_lake_bucket_object_arn_patterns = [
    for arn in local.data_lake_bucket_arn_patterns : "${arn}/*"
  ]

  athena_results_bucket_arn_patterns = [
    "arn:aws:s3:::*-athena-results-${local.account_id}",
    "arn:aws:s3:::*-${local.account_id}-athena-results"
  ]
  athena_results_bucket_object_arn_patterns = [
    for arn in local.athena_results_bucket_arn_patterns : "${arn}/*"
  ]

  # S3 prefixes
  s3_raw_prefix               = "raw/"
  s3_trusted_prefix           = "trusted/"
  s3_trusted_analytics_prefix = "trusted-analytics/"

  # Kinesis stream name
  kinesis_stream_name = "${local.name_prefix}-cdc-stream"

  # Firehose delivery stream name
  firehose_stream_name = "${local.name_prefix}-s3-delivery"

  # Glue database name
  glue_database_name = "${replace(local.name_prefix, "-", "_")}_catalog"

  shared_iam_role_name_overrides = {
    dms_secrets_access = var.shared_dms_secrets_role_name
    dms_kinesis_target = var.shared_dms_kinesis_role_name
    dms_vpc            = var.shared_dms_vpc_role_name
    firehose           = var.shared_firehose_role_name
    lambda_transform   = var.shared_lambda_transform_role_name
    lambda_ml          = var.shared_lambda_ml_role_name
    lambda_live_api    = var.shared_lambda_live_api_role_name
    glue_crawler       = var.shared_glue_crawler_role_name
  }

  shared_iam_role_name_patterns = {
    dms_secrets_access = "^${var.legacy_name_prefix}-dms-secrets-.*$"
    dms_kinesis_target = "^${var.legacy_name_prefix}-dms-kinesis-.*$"
    dms_vpc            = "^dms-vpc-role$"
    firehose           = "^${var.legacy_name_prefix}-firehose-.*$"
    lambda_transform   = "^${var.legacy_name_prefix}-lambda-transform-.*$"
    lambda_ml          = "^${var.legacy_name_prefix}-lambda-ml-.*$"
    lambda_live_api    = "^${var.legacy_name_prefix}-lambda-live-api-.*$"
    glue_crawler       = "^${var.legacy_name_prefix}-glue-crawler-.*$"
  }

  # Common tags
  common_tags = {
    Project     = "smartstream"
    Environment = var.environment
    ManagedBy   = "Terraform"
    Company     = var.enable_tenant_prefix ? var.company_name : "legacy"
  }
}
