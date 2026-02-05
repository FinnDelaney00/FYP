# Data Lake S3 bucket with structured prefixes
resource "aws_s3_bucket" "data_lake" {
  bucket = local.data_lake_bucket

  tags = merge(local.common_tags, {
    Name    = local.data_lake_bucket
    Purpose = "DataLake"
  })
}

# Enable versioning for data lake
resource "aws_s3_bucket_versioning" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption for data lake (SSE-S3)
resource "aws_s3_bucket_server_side_encryption_configuration" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block public access for data lake
resource "aws_s3_bucket_public_access_block" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle policy to transition older data to Glacier (cost optimization)
resource "aws_s3_bucket_lifecycle_configuration" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id

  rule {
    id     = "archive-old-raw-data"
    status = "Enabled"

    filter {
      prefix = local.s3_raw_prefix
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }
  }

  rule {
    id     = "archive-old-trusted-data"
    status = "Enabled"

    filter {
      prefix = local.s3_trusted_prefix
    }

    transition {
      days          = 180
      storage_class = "GLACIER"
    }
  }
}

# Athena query results bucket
resource "aws_s3_bucket" "athena_results" {
  bucket = local.athena_results_bucket

  tags = merge(local.common_tags, {
    Name    = local.athena_results_bucket
    Purpose = "AthenaQueryResults"
  })
}

# Enable versioning for Athena results
resource "aws_s3_bucket_versioning" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption for Athena results
resource "aws_s3_bucket_server_side_encryption_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block public access for Athena results
resource "aws_s3_bucket_public_access_block" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle policy for Athena results (cleanup old queries)
resource "aws_s3_bucket_lifecycle_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  rule {
    id     = "cleanup-old-results"
    status = "Enabled"

    filter {}  # Empty filter applies to all objects

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

# S3 bucket notification for Lambda transform trigger
resource "aws_s3_bucket_notification" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.transform.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = local.s3_raw_prefix
  }

  depends_on = [aws_lambda_permission.allow_s3_transform]
}
