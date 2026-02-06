# =============================================================================
# DMS IAM Roles and Policies
# =============================================================================

# IAM role for DMS to access Secrets Manager
resource "aws_iam_role" "dms_secrets_access" {
  name_prefix = "${local.name_prefix}-dms-secrets-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "dms.eu-north-1.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dms-secrets-role"
  })
}

# Policy for DMS to read RDS credentials from Secrets Manager
resource "aws_iam_role_policy" "dms_secrets_access" {
  name_prefix = "secrets-access-"
  role        = aws_iam_role.dms_secrets_access.id
  policy      = data.aws_iam_policy_document.dms_secrets_access.json
}

# IAM role for DMS to write to Kinesis
resource "aws_iam_role" "dms_kinesis_target" {
  name_prefix = "${local.name_prefix}-dms-kinesis-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "dms.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dms-kinesis-role"
  })
}

# Policy for DMS to write to Kinesis Data Stream
resource "aws_iam_role_policy" "dms_kinesis_target" {
  name_prefix = "kinesis-write-"
  role        = aws_iam_role.dms_kinesis_target.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "kinesis:PutRecord",
          "kinesis:PutRecords",
          "kinesis:DescribeStream"
        ]
        Resource = aws_kinesis_stream.cdc_stream.arn
      }
    ]
  })
}

# Attach VPC management policy to DMS (required for VPC-enabled replication instances)
resource "aws_iam_role_policy_attachment" "dms_vpc_management" {
  role       = aws_iam_role.dms_kinesis_target.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonDMSVPCManagementRole"
}

# =============================================================================
# Kinesis Firehose IAM Roles and Policies
# =============================================================================

# IAM role for Firehose
resource "aws_iam_role" "firehose" {
  name_prefix = "${local.name_prefix}-firehose-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "firehose.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-firehose-role"
  })
}

# Policy for Firehose to read from Kinesis Data Stream
resource "aws_iam_role_policy" "firehose_kinesis" {
  name_prefix = "kinesis-read-"
  role        = aws_iam_role.firehose.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "kinesis:DescribeStream",
          "kinesis:GetShardIterator",
          "kinesis:GetRecords",
          "kinesis:ListShards"
        ]
        Resource = aws_kinesis_stream.cdc_stream.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "firehose_kinesis" {
  role       = aws_iam_role.firehose.name
  policy_arn = aws_iam_policy.firehose_kinesis.arn
}

resource "aws_iam_policy" "firehose_kinesis" {
  name_prefix = "${local.name_prefix}-firehose-kinesis-"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "kinesis:DescribeStream",
          "kinesis:GetShardIterator",
          "kinesis:GetRecords",
          "kinesis:ListShards"
        ]
        Resource = aws_kinesis_stream.cdc_stream.arn
      }
    ]
  })
}

# Policy for Firehose to write to S3
resource "aws_iam_role_policy" "firehose_s3" {
  name_prefix = "s3-write-"
  role        = aws_iam_role.firehose.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject"
        ]
        Resource = [
          aws_s3_bucket.data_lake.arn,
          "${aws_s3_bucket.data_lake.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "firehose_s3" {
  role       = aws_iam_role.firehose.name
  policy_arn = aws_iam_policy.firehose_s3.arn
}

resource "aws_iam_policy" "firehose_s3" {
  name_prefix = "${local.name_prefix}-firehose-s3-"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject"
        ]
        Resource = [
          aws_s3_bucket.data_lake.arn,
          "${aws_s3_bucket.data_lake.arn}/*"
        ]
      }
    ]
  })
}

# Policy for Firehose CloudWatch Logs
resource "aws_iam_role_policy" "firehose_cloudwatch" {
  name_prefix = "cloudwatch-"
  role        = aws_iam_role.firehose.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.firehose.arn}:*"
      }
    ]
  })
}

# =============================================================================
# Lambda Transform IAM Roles and Policies
# =============================================================================

# IAM role for Transform Lambda
resource "aws_iam_role" "lambda_transform" {
  name_prefix = "${local.name_prefix}-lambda-transform-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-lambda-transform-role"
  })
}

# Policy for Transform Lambda to read from raw and write to trusted
resource "aws_iam_role_policy" "lambda_transform_s3" {
  name_prefix = "s3-access-"
  role        = aws_iam_role.lambda_transform.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.data_lake.arn}/${local.s3_raw_prefix}*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.data_lake.arn}/${local.s3_trusted_prefix}*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.data_lake.arn
      }
    ]
  })
}

# Attach basic Lambda execution role for CloudWatch Logs
resource "aws_iam_role_policy_attachment" "lambda_transform_basic" {
  role       = aws_iam_role.lambda_transform.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Optional: VPC execution role (if Lambda is in VPC)
# resource "aws_iam_role_policy_attachment" "lambda_transform_vpc" {
#   role       = aws_iam_role.lambda_transform.name
#   policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
# }

# =============================================================================
# Lambda ML IAM Roles and Policies
# =============================================================================

# IAM role for ML Lambda
resource "aws_iam_role" "lambda_ml" {
  name_prefix = "${local.name_prefix}-lambda-ml-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-lambda-ml-role"
  })
}

# Policy for ML Lambda to read from trusted and write to analytics
resource "aws_iam_role_policy" "lambda_ml_s3" {
  name_prefix = "s3-access-"
  role        = aws_iam_role.lambda_ml.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.data_lake.arn,
          "${aws_s3_bucket.data_lake.arn}/${local.s3_trusted_prefix}*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.data_lake.arn}/${local.s3_trusted_analytics_prefix}*"
      }
    ]
  })
}

# Attach basic Lambda execution role for CloudWatch Logs
resource "aws_iam_role_policy_attachment" "lambda_ml_basic" {
  role       = aws_iam_role.lambda_ml.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# =============================================================================
# Glue Crawler IAM Roles and Policies
# =============================================================================

# IAM role for Glue Crawler
resource "aws_iam_role" "glue_crawler" {
  name_prefix = "${local.name_prefix}-glue-crawler-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "glue.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-glue-crawler-role"
  })
}

# Attach AWS managed Glue service role
resource "aws_iam_role_policy_attachment" "glue_service" {
  role       = aws_iam_role.glue_crawler.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole"
}

# Policy for Glue Crawler to read S3 data lake
resource "aws_iam_role_policy" "glue_crawler_s3" {
  name_prefix = "s3-read-"
  role        = aws_iam_role.glue_crawler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.data_lake.arn,
          "${aws_s3_bucket.data_lake.arn}/*"
        ]
      }
    ]
  })
}

# =============================================================================
# Athena IAM (uses existing S3 bucket policies)
# Athena queries run with user credentials, so no separate role needed
# =============================================================================
