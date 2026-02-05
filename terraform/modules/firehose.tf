resource "aws_kinesis_firehose_delivery_stream" "to_s3_raw" {
  name        = "${local.name_prefix}-firehose-raw"
  destination = "extended_s3"

  kinesis_source_configuration {
    kinesis_stream_arn = aws_kinesis_stream.cdc_stream.arn
    role_arn           = aws_iam_role.firehose_role.arn
  }

  extended_s3_configuration {
    role_arn   = aws_iam_role.firehose_role.arn
    bucket_arn = aws_s3_bucket.data_lake.arn

    prefix              = "raw/!{timestamp:yyyy}/!{timestamp:MM}/!{timestamp:dd}/"
    error_output_prefix = "raw-errors/!{timestamp:yyyy}/!{timestamp:MM}/!{timestamp:dd}/"

    buffering_size     = 5   # MB
    buffering_interval = 60  # seconds
    compression_format = "GZIP"

    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = "/aws/kinesisfirehose/${local.name_prefix}-raw"
      log_stream_name = "S3Delivery"
    }
  }
}
