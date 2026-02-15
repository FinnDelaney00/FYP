# =============================================================================
# Network Outputs
# =============================================================================

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

# =============================================================================
# S3 Outputs
# =============================================================================

output "data_lake_bucket_name" {
  description = "Data Lake S3 bucket name"
  value       = aws_s3_bucket.data_lake.id
}

output "data_lake_bucket_arn" {
  description = "Data Lake S3 bucket ARN"
  value       = aws_s3_bucket.data_lake.arn
}

output "athena_results_bucket_name" {
  description = "Athena query results S3 bucket name"
  value       = aws_s3_bucket.athena_results.id
}

output "s3_raw_prefix" {
  description = "S3 prefix for raw data zone"
  value       = local.s3_raw_prefix
}

output "s3_trusted_prefix" {
  description = "S3 prefix for trusted data zone"
  value       = local.s3_trusted_prefix
}

output "s3_analytics_prefix" {
  description = "S3 prefix for trusted-analytics data zone"
  value       = local.s3_trusted_analytics_prefix
}

output "web_bucket_name" {
  description = "Frontend S3 bucket name"
  value       = aws_s3_bucket.web.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID for frontend hosting"
  value       = aws_cloudfront_distribution.web.id
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name for frontend hosting"
  value       = aws_cloudfront_distribution.web.domain_name
}

# =============================================================================
# RDS Outputs
# =============================================================================

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = aws_db_instance.main.endpoint
}

output "rds_database_name" {
  description = "RDS database name"
  value       = aws_db_instance.main.db_name
}

output "rds_secret_arn" {
  description = "ARN of Secrets Manager secret containing RDS credentials"
  value       = aws_secretsmanager_secret.rds_credentials.arn
}

# =============================================================================
# Kinesis Outputs
# =============================================================================

output "kinesis_stream_name" {
  description = "Kinesis Data Stream name"
  value       = aws_kinesis_stream.cdc_stream.name
}

output "kinesis_stream_arn" {
  description = "Kinesis Data Stream ARN"
  value       = aws_kinesis_stream.cdc_stream.arn
}

output "kinesis_shard_count" {
  description = "Number of shards in Kinesis Data Stream"
  value       = aws_kinesis_stream.cdc_stream.shard_count
}

# =============================================================================
# Firehose Outputs
# =============================================================================

output "firehose_delivery_stream_name" {
  description = "Kinesis Firehose delivery stream name"
  value       = aws_kinesis_firehose_delivery_stream.s3_delivery.name
}

output "firehose_delivery_stream_arn" {
  description = "Kinesis Firehose delivery stream ARN"
  value       = aws_kinesis_firehose_delivery_stream.s3_delivery.arn
}

# =============================================================================
# DMS Outputs
# =============================================================================

output "dms_replication_instance_id" {
  description = "DMS replication instance ID"
  value       = aws_dms_replication_instance.main.replication_instance_id
}

output "dms_replication_instance_arn" {
  description = "DMS replication instance ARN"
  value       = aws_dms_replication_instance.main.replication_instance_arn
}

output "dms_source_endpoint_arn" {
  description = "DMS source endpoint ARN (PostgreSQL)"
  value       = aws_dms_endpoint.source.endpoint_arn
}

output "dms_target_endpoint_arn" {
  description = "DMS target endpoint ARN (Kinesis)"
  value       = aws_dms_endpoint.target_kinesis.endpoint_arn
}

output "dms_replication_task_arn" {
  description = "DMS replication task ARN"
  value       = aws_dms_replication_task.cdc_task.replication_task_arn
}

output "dms_finance_replication_task_arn" {
  description = "DMS finance replication task ARN"
  value       = aws_dms_replication_task.finance_cdc_task.replication_task_arn
}

# =============================================================================
# Lambda Outputs
# =============================================================================

output "lambda_transform_function_name" {
  description = "Transform Lambda function name"
  value       = aws_lambda_function.transform.function_name
}

output "lambda_transform_arn" {
  description = "Transform Lambda function ARN"
  value       = aws_lambda_function.transform.arn
}

output "lambda_ml_function_name" {
  description = "ML inference Lambda function name"
  value       = aws_lambda_function.ml_inference.function_name
}

output "lambda_ml_arn" {
  description = "ML inference Lambda function ARN"
  value       = aws_lambda_function.ml_inference.arn
}

# =============================================================================
# Glue Outputs
# =============================================================================

output "glue_database_name" {
  description = "Glue Data Catalog database name"
  value       = aws_glue_catalog_database.main.name
}

output "glue_trusted_crawler_name" {
  description = "Glue crawler name for trusted zone"
  value       = aws_glue_crawler.trusted.name
}

output "glue_analytics_crawler_name" {
  description = "Glue crawler name for analytics zone"
  value       = aws_glue_crawler.analytics.name
}

# =============================================================================
# Athena Outputs
# =============================================================================

output "athena_workgroup_name" {
  description = "Athena workgroup name"
  value       = aws_athena_workgroup.main.name
}

output "athena_workgroup_id" {
  description = "Athena workgroup ID"
  value       = aws_athena_workgroup.main.id
}

# =============================================================================
# CloudWatch Outputs
# =============================================================================

output "cloudwatch_dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = aws_cloudwatch_dashboard.main.dashboard_name
}

output "sns_alerts_topic_arn" {
  description = "SNS topic ARN for pipeline alerts"
  value       = aws_sns_topic.alerts.arn
}

# =============================================================================
# Quick Start Commands
# =============================================================================

output "quick_start_commands" {
  description = "Quick start commands for common operations"
  value = {
    start_dms_task = "aws dms start-replication-task --replication-task-arn ${aws_dms_replication_task.cdc_task.replication_task_arn} --start-replication-task-type start-replication"

    start_finance_dms_task = "aws dms start-replication-task --replication-task-arn ${aws_dms_replication_task.finance_cdc_task.replication_task_arn} --start-replication-task-type start-replication"

    stop_dms_task = "aws dms stop-replication-task --replication-task-arn ${aws_dms_replication_task.cdc_task.replication_task_arn}"

    stop_finance_dms_task = "aws dms stop-replication-task --replication-task-arn ${aws_dms_replication_task.finance_cdc_task.replication_task_arn}"

    run_glue_crawler_trusted = "aws glue start-crawler --name ${aws_glue_crawler.trusted.name}"

    run_glue_crawler_analytics = "aws glue start-crawler --name ${aws_glue_crawler.analytics.name}"

    invoke_ml_lambda = "aws lambda invoke --function-name ${aws_lambda_function.ml_inference.function_name} /tmp/response.json"

    view_cloudwatch_dashboard = "https://console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"

    athena_console = "https://console.aws.amazon.com/athena/home?region=${var.region}#/query-editor"
  }
}

output "frontend_deploy_commands" {
  description = "Commands to build, upload, and invalidate frontend assets"
  value = {
    build      = "npm ci && npm run build"
    sync       = "aws s3 sync dist s3://${aws_s3_bucket.web.id} --delete"
    invalidate = "aws cloudfront create-invalidation --distribution-id ${aws_cloudfront_distribution.web.id} --paths \"/*\""
  }
}

# =============================================================================
# Connection Information
# =============================================================================

output "connection_info" {
  description = "Connection information for various services"
  value = {
    rds_connection_string = "postgresql://${var.db_username}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
    rds_secret_command    = "aws secretsmanager get-secret-value --secret-id ${aws_secretsmanager_secret.rds_credentials.id} --query SecretString --output text"
    s3_data_lake_uri      = "s3://${aws_s3_bucket.data_lake.id}/"
    glue_database         = aws_glue_catalog_database.main.name
  }
  sensitive = true
}
