resource "aws_kinesis_stream" "cdc_stream" {
  name        = "${local.name_prefix}-cdc"
  shard_count = 1
  retention_period = 24
}
