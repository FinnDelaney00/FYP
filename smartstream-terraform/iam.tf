# -----------------------------------------------------------------------------
# Shared IAM discovery and effective role locals
# -----------------------------------------------------------------------------

data "aws_iam_roles" "shared_role_candidates" {
  for_each = var.create_shared_iam ? {} : {
    for role_key, role_pattern in local.shared_iam_role_name_patterns :
    role_key => role_pattern
    if local.shared_iam_role_name_overrides[role_key] == ""
  }

  name_regex = each.value
}

locals {
  shared_iam_discovery_counts = var.create_shared_iam ? {
    for role_key in keys(local.shared_iam_role_name_overrides) :
    role_key => 1
    } : {
    for role_key, override_name in local.shared_iam_role_name_overrides :
    role_key => (
      override_name != "" ? 1 : length(try(data.aws_iam_roles.shared_role_candidates[role_key].names, []))
    )
  }

  shared_iam_role_names = var.create_shared_iam ? {
    dms_secrets_access = aws_iam_role.dms_secrets_access[0].name
    dms_kinesis_target = aws_iam_role.dms_kinesis_target[0].name
    dms_vpc            = aws_iam_role.dms_vpc[0].name
    firehose           = aws_iam_role.firehose[0].name
    lambda_transform   = aws_iam_role.lambda_transform[0].name
    lambda_ml          = aws_iam_role.lambda_ml[0].name
    lambda_live_api    = aws_iam_role.lambda_live_api[0].name
    lambda_anomaly     = aws_iam_role.lambda_anomaly[0].name
    glue_crawler       = aws_iam_role.glue_crawler[0].name
    } : {
    for role_key, override_name in local.shared_iam_role_name_overrides :
    role_key => (
      override_name != "" ? override_name : try(one(data.aws_iam_roles.shared_role_candidates[role_key].names), "")
    )
  }
}

data "aws_iam_role" "shared" {
  for_each = var.create_shared_iam ? {} : {
    for role_key, role_name in local.shared_iam_role_names :
    role_key => role_name
    if role_name != ""
  }

  name = each.value
}

locals {
  dms_secrets_access_role_arn = var.create_shared_iam ? aws_iam_role.dms_secrets_access[0].arn : try(data.aws_iam_role.shared["dms_secrets_access"].arn, "")
  dms_kinesis_target_role_arn = var.create_shared_iam ? aws_iam_role.dms_kinesis_target[0].arn : try(data.aws_iam_role.shared["dms_kinesis_target"].arn, "")
  dms_vpc_role_name           = var.create_shared_iam ? aws_iam_role.dms_vpc[0].name : try(data.aws_iam_role.shared["dms_vpc"].name, "")
  firehose_role_arn           = var.create_shared_iam ? aws_iam_role.firehose[0].arn : try(data.aws_iam_role.shared["firehose"].arn, "")
  lambda_transform_role_arn   = var.create_shared_iam ? aws_iam_role.lambda_transform[0].arn : try(data.aws_iam_role.shared["lambda_transform"].arn, "")
  lambda_ml_role_arn          = var.create_shared_iam ? aws_iam_role.lambda_ml[0].arn : try(data.aws_iam_role.shared["lambda_ml"].arn, "")
  lambda_live_api_role_arn    = var.create_shared_iam ? aws_iam_role.lambda_live_api[0].arn : try(data.aws_iam_role.shared["lambda_live_api"].arn, "")
  lambda_anomaly_role_arn     = var.create_shared_iam ? aws_iam_role.lambda_anomaly[0].arn : try(data.aws_iam_role.shared["lambda_anomaly"].arn, "")
  glue_crawler_role_arn       = var.create_shared_iam ? aws_iam_role.glue_crawler[0].arn : try(data.aws_iam_role.shared["glue_crawler"].arn, "")
}

# =============================================================================
# DMS IAM Roles and Policies
# =============================================================================

resource "aws_iam_role" "dms_secrets_access" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-dms-secrets-"

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
    Name = "${local.legacy_prefix}-dms-secrets-role"
  })
}

resource "aws_iam_role_policy" "dms_secrets_access" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "secrets-access-"
  role        = aws_iam_role.dms_secrets_access[0].id
  policy      = data.aws_iam_policy_document.dms_secrets_access.json
}

resource "aws_iam_role" "dms_kinesis_target" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-dms-kinesis-"

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
    Name = "${local.legacy_prefix}-dms-kinesis-role"
  })
}

resource "aws_iam_role_policy" "dms_kinesis_target" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "kinesis-write-"
  role        = aws_iam_role.dms_kinesis_target[0].id

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
        Resource = "arn:aws:kinesis:${var.region}:${local.account_id}:stream/*-cdc-stream"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "dms_vpc_management" {
  count      = var.create_shared_iam ? 1 : 0
  role       = aws_iam_role.dms_kinesis_target[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonDMSVPCManagementRole"
}

resource "aws_iam_role" "dms_vpc" {
  count = var.create_shared_iam ? 1 : 0
  name  = "dms-vpc-role"

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
}

resource "aws_iam_role_policy_attachment" "dms_vpc_role_management" {
  count      = var.create_shared_iam ? 1 : 0
  role       = aws_iam_role.dms_vpc[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonDMSVPCManagementRole"
}

# =============================================================================
# Kinesis Firehose IAM Roles and Policies
# =============================================================================

resource "aws_iam_role" "firehose" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-firehose-"

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
    Name = "${local.legacy_prefix}-firehose-role"
  })
}

resource "aws_iam_role_policy" "firehose_kinesis" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "kinesis-read-"
  role        = aws_iam_role.firehose[0].id

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
        Resource = "arn:aws:kinesis:${var.region}:${local.account_id}:stream/*-cdc-stream"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "firehose_kinesis" {
  count      = var.create_shared_iam ? 1 : 0
  role       = aws_iam_role.firehose[0].name
  policy_arn = aws_iam_policy.firehose_kinesis[0].arn
}

resource "aws_iam_policy" "firehose_kinesis" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-firehose-kinesis-"

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
        Resource = "arn:aws:kinesis:${var.region}:${local.account_id}:stream/*-cdc-stream"
      }
    ]
  })
}

resource "aws_iam_role_policy" "firehose_s3" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "s3-write-"
  role        = aws_iam_role.firehose[0].id

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
        Resource = concat(local.data_lake_bucket_arn_patterns, local.data_lake_bucket_object_arn_patterns)
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "firehose_s3" {
  count      = var.create_shared_iam ? 1 : 0
  role       = aws_iam_role.firehose[0].name
  policy_arn = aws_iam_policy.firehose_s3[0].arn
}

resource "aws_iam_policy" "firehose_s3" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-firehose-s3-"

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
        Resource = concat(local.data_lake_bucket_arn_patterns, local.data_lake_bucket_object_arn_patterns)
      }
    ]
  })
}

resource "aws_iam_role_policy" "firehose_cloudwatch" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "cloudwatch-"
  role        = aws_iam_role.firehose[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/kinesisfirehose/*:log-stream:*"
      }
    ]
  })
}

# =============================================================================
# Lambda Transform IAM Roles and Policies
# =============================================================================

resource "aws_iam_role" "lambda_transform" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-lambda-transform-"

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
    Name = "${local.legacy_prefix}-lambda-transform-role"
  })
}

resource "aws_iam_role_policy" "lambda_transform_s3" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "s3-access-"
  role        = aws_iam_role.lambda_transform[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = [for bucket_arn in local.data_lake_bucket_arn_patterns : "${bucket_arn}/${local.s3_raw_prefix}*"]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = [for bucket_arn in local.data_lake_bucket_arn_patterns : "${bucket_arn}/${local.s3_trusted_prefix}*"]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = local.data_lake_bucket_arn_patterns
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_transform_basic" {
  count      = var.create_shared_iam ? 1 : 0
  role       = aws_iam_role.lambda_transform[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# =============================================================================
# Lambda ML IAM Roles and Policies
# =============================================================================

resource "aws_iam_role" "lambda_ml" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-lambda-ml-"

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
    Name = "${local.legacy_prefix}-lambda-ml-role"
  })
}

resource "aws_iam_role_policy" "lambda_ml_s3" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "s3-access-"
  role        = aws_iam_role.lambda_ml[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ListTrustedPrefixes"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = local.data_lake_bucket_arn_patterns
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "${local.s3_trusted_prefix}*",
              "${local.s3_trusted_analytics_prefix}predictions/*"
            ]
          }
        }
      },
      {
        Sid    = "ReadTrustedObjects"
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = [for bucket_arn in local.data_lake_bucket_arn_patterns : "${bucket_arn}/${local.s3_trusted_prefix}*"]
      },
      {
        Sid    = "WritePredictionObjects"
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = [for bucket_arn in local.data_lake_bucket_arn_patterns : "${bucket_arn}/${local.s3_trusted_analytics_prefix}predictions/*"]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_ml_basic" {
  count      = var.create_shared_iam ? 1 : 0
  role       = aws_iam_role.lambda_ml[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# =============================================================================
# Lambda Anomaly IAM Roles and Policies
# =============================================================================

resource "aws_iam_role" "lambda_anomaly" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-lambda-anomaly-"

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
    Name = "${local.legacy_prefix}-lambda-anomaly-role"
  })
}

resource "aws_iam_role_policy" "lambda_anomaly_s3" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "s3-access-"
  role        = aws_iam_role.lambda_anomaly[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ListTrustedAndAnomalyPrefixes"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = local.data_lake_bucket_arn_patterns
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "${local.s3_trusted_prefix}*",
              "${var.trusted_prefix_anomalies}*"
            ]
          }
        }
      },
      {
        Sid    = "ReadTrustedObjects"
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = [for bucket_arn in local.data_lake_bucket_arn_patterns : "${bucket_arn}/${local.s3_trusted_prefix}*"]
      },
      {
        Sid    = "WriteAnomalyObjects"
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = [for bucket_arn in local.data_lake_bucket_arn_patterns : "${bucket_arn}/${var.trusted_prefix_anomalies}*"]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_anomaly_basic" {
  count      = var.create_shared_iam ? 1 : 0
  role       = aws_iam_role.lambda_anomaly[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# =============================================================================
# Glue Crawler IAM Roles and Policies
# =============================================================================

resource "aws_iam_role" "glue_crawler" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-glue-crawler-"

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
    Name = "${local.legacy_prefix}-glue-crawler-role"
  })
}

resource "aws_iam_role_policy_attachment" "glue_service" {
  count      = var.create_shared_iam ? 1 : 0
  role       = aws_iam_role.glue_crawler[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole"
}

resource "aws_iam_role_policy" "glue_crawler_s3" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "s3-read-"
  role        = aws_iam_role.glue_crawler[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = concat(local.data_lake_bucket_arn_patterns, local.data_lake_bucket_object_arn_patterns)
      }
    ]
  })
}
