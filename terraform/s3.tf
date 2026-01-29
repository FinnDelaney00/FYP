resource "aws_s3_bucket" "this" {
  bucket = var.first_bucket_name
}
