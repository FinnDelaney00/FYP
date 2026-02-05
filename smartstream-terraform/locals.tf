# Get current AWS account ID and region
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  
  # Naming convention: {project}-{env}-{resource}-{account_id}
  name_prefix = "${var.project_name}-${var.env}"
  
  # S3 bucket names (must be globally unique)
  data_lake_bucket = "${local.name_prefix}-datalake-${local.account_id}"
  athena_results_bucket = "${local.name_prefix}-athena-results-${local.account_id}"
  
  # S3 prefixes
  s3_raw_prefix               = "raw/"
  s3_trusted_prefix           = "trusted/"
  s3_trusted_analytics_prefix = "trusted-analytics/"
  
  # Kinesis stream name
  kinesis_stream_name = "${local.name_prefix}-cdc-stream"
  
  # Firehose delivery stream name
  firehose_stream_name = "${local.name_prefix}-s3-delivery"
  
  # Glue database name
  glue_database_name = "${var.project_name}_${var.env}_catalog"
  
  # Common tags
  common_tags = {
    Project     = var.project_name
    Environment = var.env
    ManagedBy   = "Terraform"
  }
}
