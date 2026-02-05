# Kinesis Data Stream (streaming backbone for CDC data)
resource "aws_kinesis_stream" "cdc_stream" {
  name             = local.kinesis_stream_name
  shard_count      = var.kinesis_shards
  retention_period = 24 # hours (minimum 24, maximum 8760)

  # Enable encryption at rest
  encryption_type = "KMS"
  kms_key_id      = "alias/aws/kinesis"

  # Enhanced monitoring
  shard_level_metrics = [
    "IncomingBytes",
    "IncomingRecords",
    "OutgoingBytes",
    "OutgoingRecords",
    "WriteProvisionedThroughputExceeded",
    "ReadProvisionedThroughputExceeded",
    "IteratorAgeMilliseconds"
  ]

  tags = merge(local.common_tags, {
    Name    = local.kinesis_stream_name
    Purpose = "CDCStreaming"
  })
}

# CloudWatch alarm for high iterator age (indicates consumer lag)
resource "aws_cloudwatch_metric_alarm" "kinesis_iterator_age" {
  alarm_name          = "${local.name_prefix}-kinesis-high-iterator-age"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "GetRecords.IteratorAgeMilliseconds"
  namespace           = "AWS/Kinesis"
  period              = 300
  statistic           = "Maximum"
  threshold           = 60000 # 1 minute in milliseconds
  alarm_description   = "Kinesis stream consumer is falling behind"
  treat_missing_data  = "notBreaching"

  dimensions = {
    StreamName = aws_kinesis_stream.cdc_stream.name
  }

  tags = local.common_tags
}

# CloudWatch alarm for write throughput exceeded
resource "aws_cloudwatch_metric_alarm" "kinesis_write_throttle" {
  alarm_name          = "${local.name_prefix}-kinesis-write-throttled"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "WriteProvisionedThroughputExceeded"
  namespace           = "AWS/Kinesis"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Kinesis stream is being write-throttled"
  treat_missing_data  = "notBreaching"

  dimensions = {
    StreamName = aws_kinesis_stream.cdc_stream.name
  }

  tags = local.common_tags
}
