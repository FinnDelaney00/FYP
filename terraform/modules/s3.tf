resource "aws_s3_bucket" "data_lake" {
  bucket = "${local.name_prefix}-datalake"
}

resource "aws_s3_bucket_versioning" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket" "athena_results" {
  bucket = "${local.name_prefix}-athena-results"
}
