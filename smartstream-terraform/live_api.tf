locals {
  live_api_data_lake_bucket = coalesce(var.data_lake_bucket_name, aws_s3_bucket.data_lake.id)
}

data "archive_file" "live_api_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/live_api"
  output_path = "${path.module}/lambdas/live_api.zip"
}

resource "random_password" "auth_token_secret" {
  length  = 48
  special = false
}

resource "aws_dynamodb_table" "accounts" {
  name         = "${local.name_prefix}-accounts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"

  attribute {
    name = "email"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-accounts"
    Purpose = "UserAuth"
  })
}

resource "aws_iam_role" "lambda_live_api" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-lambda-live-api-"

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
    Name = "${local.legacy_prefix}-lambda-live-api-role"
  })
}

resource "aws_iam_role_policy" "lambda_live_api_s3" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "s3-read-trusted-"
  role        = aws_iam_role.lambda_live_api[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetBucketLocation",
          "s3:ListBucket"
        ]
        Resource = concat(
          local.data_lake_bucket_arn_patterns,
          ["arn:aws:s3:::${local.live_api_data_lake_bucket}"]
        )
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = concat(
          flatten([
            for bucket_arn in local.data_lake_bucket_arn_patterns : [
              "${bucket_arn}/${var.trusted_prefix_finance_transactions}*",
              "${bucket_arn}/${var.trusted_prefix_employees}*",
              "${bucket_arn}/${var.trusted_prefix_predictions}*"
            ]
          ]),
          [
            "arn:aws:s3:::${local.live_api_data_lake_bucket}/${var.trusted_prefix_finance_transactions}*",
            "arn:aws:s3:::${local.live_api_data_lake_bucket}/${var.trusted_prefix_employees}*",
            "arn:aws:s3:::${local.live_api_data_lake_bucket}/${var.trusted_prefix_predictions}*"
          ]
        )
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetBucketLocation",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads"
        ]
        Resource = local.athena_results_bucket_arn_patterns
      },
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetObject",
          "s3:ListMultipartUploadParts",
          "s3:PutObject"
        ]
        Resource = [for bucket_arn in local.athena_results_bucket_arn_patterns : "${bucket_arn}/results/*"]
      },
      {
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetPartitions"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem"
        ]
        Resource = "arn:aws:dynamodb:${var.region}:${local.account_id}:table/*-accounts"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_live_api_basic" {
  count      = var.create_shared_iam ? 1 : 0
  role       = aws_iam_role.lambda_live_api[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "live_api" {
  filename         = data.archive_file.live_api_lambda.output_path
  function_name    = "${local.name_prefix}-s3-live-api"
  role             = local.lambda_live_api_role_arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.live_api_lambda.output_base64sha256
  runtime          = "python3.12"
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      DATA_LAKE_BUCKET       = local.live_api_data_lake_bucket
      TRUSTED_PREFIX         = var.trusted_prefix_finance_transactions
      EMPLOYEES_PREFIX       = var.trusted_prefix_employees
      PREDICTIONS_PREFIX     = var.trusted_prefix_predictions
      MAX_ITEMS_DEFAULT      = tostring(var.max_items)
      QUERY_MAX_ROWS         = tostring(var.query_max_rows)
      ALLOWED_ORIGIN         = var.allowed_origin
      POLL_INTERVAL_MS       = tostring(var.poll_interval_ms)
      ATHENA_WORKGROUP       = aws_athena_workgroup.main.name
      ATHENA_DATABASE        = aws_glue_catalog_database.main.name
      ATHENA_OUTPUT_LOCATION = "s3://${aws_s3_bucket.athena_results.id}/results/"
      ACCOUNTS_TABLE         = aws_dynamodb_table.accounts.name
      AUTH_TOKEN_SECRET      = random_password.auth_token_secret.result
      AUTH_TOKEN_TTL_SECONDS = tostring(var.auth_token_ttl_seconds)
    }
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-s3-live-api"
    Purpose = "FrontendLiveAPI"
  })
}

resource "aws_cloudwatch_log_group" "lambda_live_api" {
  name              = "/aws/lambda/${aws_lambda_function.live_api.function_name}"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-s3-live-api-logs"
  })
}

resource "aws_apigatewayv2_api" "live_api" {
  name          = "${local.name_prefix}-live-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.allowed_origin]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-live-api"
    Purpose = "FrontendLiveAPI"
  })
}

resource "aws_apigatewayv2_integration" "live_api_lambda" {
  api_id                 = aws_apigatewayv2_api.live_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.live_api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "live_api_latest" {
  api_id    = aws_apigatewayv2_api.live_api.id
  route_key = "GET /latest"
  target    = "integrations/${aws_apigatewayv2_integration.live_api_lambda.id}"
}

resource "aws_apigatewayv2_route" "live_api_dashboard" {
  api_id    = aws_apigatewayv2_api.live_api.id
  route_key = "GET /dashboard"
  target    = "integrations/${aws_apigatewayv2_integration.live_api_lambda.id}"
}

resource "aws_apigatewayv2_route" "live_api_forecasts" {
  api_id    = aws_apigatewayv2_api.live_api.id
  route_key = "GET /forecasts"
  target    = "integrations/${aws_apigatewayv2_integration.live_api_lambda.id}"
}

resource "aws_apigatewayv2_route" "live_api_query" {
  api_id    = aws_apigatewayv2_api.live_api.id
  route_key = "POST /query"
  target    = "integrations/${aws_apigatewayv2_integration.live_api_lambda.id}"
}

resource "aws_apigatewayv2_route" "live_api_auth_signup" {
  api_id    = aws_apigatewayv2_api.live_api.id
  route_key = "POST /auth/signup"
  target    = "integrations/${aws_apigatewayv2_integration.live_api_lambda.id}"
}

resource "aws_apigatewayv2_route" "live_api_auth_login" {
  api_id    = aws_apigatewayv2_api.live_api.id
  route_key = "POST /auth/login"
  target    = "integrations/${aws_apigatewayv2_integration.live_api_lambda.id}"
}

resource "aws_apigatewayv2_route" "live_api_auth_me" {
  api_id    = aws_apigatewayv2_api.live_api.id
  route_key = "GET /auth/me"
  target    = "integrations/${aws_apigatewayv2_integration.live_api_lambda.id}"
}

resource "aws_apigatewayv2_stage" "live_api" {
  api_id      = aws_apigatewayv2_api.live_api.id
  name        = "$default"
  auto_deploy = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-live-api-stage"
  })
}

resource "aws_lambda_permission" "allow_apigw_live_api" {
  statement_id  = "AllowExecutionFromAPIGatewayLiveAPI"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.live_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.live_api.execution_arn}/*/*"
}
