# Kinesis Firehose Delivery Stream (reads from Kinesis Data Stream, delivers to S3 raw zone)
resource "aws_kinesis_firehose_delivery_stream" "s3_delivery" {
  name        = local.firehose_stream_name
  destination = "extended_s3"

  # Source: Kinesis Data Stream
  kinesis_source_configuration {
    kinesis_stream_arn = aws_kinesis_stream.cdc_stream.arn
    role_arn           = aws_iam_role.firehose.arn
  }

  # Destination: S3 (raw zone)
  extended_s3_configuration {
    role_arn   = aws_iam_role.firehose.arn
    bucket_arn = aws_s3_bucket.data_lake.arn
    prefix     = "${local.s3_raw_prefix}year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/"
    error_output_prefix = "errors/firehose/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/"

    # Buffering configuration (low-latency defaults)
    buffering_interval = var.firehose_buffer_interval_seconds
    buffering_size     = var.firehose_buffer_size_mb

    # Compression (use GZIP for storage savings)
    compression_format = "GZIP"

    # CloudWatch logging
    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.firehose.name
      log_stream_name = "S3Delivery"
    }

    # Data format conversion (optional - convert to Parquet for better query performance)
    # Disabled by default - can be enabled for production
    # data_format_conversion_configuration {
    #   enabled = false
    # }

    # S3 backup mode for failed records
    s3_backup_mode = "Enabled"

    s3_backup_configuration {
      role_arn   = aws_iam_role.firehose.arn
      bucket_arn = aws_s3_bucket.data_lake.arn
      prefix     = "backup/firehose/"

      buffering_interval = 300
      buffering_size     = 5

      compression_format = "GZIP"

      cloudwatch_logging_options {
        enabled         = true
        log_group_name  = aws_cloudwatch_log_group.firehose.name
        log_stream_name = "S3Backup"
      }
    }
  }

  tags = merge(local.common_tags, {
    Name    = local.firehose_stream_name
    Purpose = "S3DataDelivery"
  })

  depends_on = [
    aws_kinesis_stream.cdc_stream,
    aws_iam_role_policy_attachment.firehose_kinesis,
    aws_iam_role_policy_attachment.firehose_s3
  ]
}

# CloudWatch Log Group for Firehose
resource "aws_cloudwatch_log_group" "firehose" {
  name              = "/aws/kinesisfirehose/${local.firehose_stream_name}"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-firehose-logs"
  })
}

# CloudWatch Log Stream for S3 Delivery
resource "aws_cloudwatch_log_stream" "firehose_s3_delivery" {
  name           = "S3Delivery"
  log_group_name = aws_cloudwatch_log_group.firehose.name
}

# CloudWatch Log Stream for S3 Backup
resource "aws_cloudwatch_log_stream" "firehose_s3_backup" {
  name           = "S3Backup"
  log_group_name = aws_cloudwatch_log_group.firehose.name
}

# CloudWatch alarm for Firehose delivery failures
resource "aws_cloudwatch_metric_alarm" "firehose_delivery_failed" {
  alarm_name          = "${local.name_prefix}-firehose-delivery-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "DeliveryToS3.DataFreshness"
  namespace           = "AWS/Firehose"
  period              = 300
  statistic           = "Maximum"
  threshold           = 900 # Alert if data is older than 15 minutes
  alarm_description   = "Firehose is not delivering data to S3 in a timely manner"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DeliveryStreamName = aws_kinesis_firehose_delivery_stream.s3_delivery.name
  }

  tags = local.common_tags
}
