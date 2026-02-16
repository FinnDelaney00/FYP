locals {
  live_api_data_lake_bucket = coalesce(var.data_lake_bucket_name, aws_s3_bucket.data_lake.id)
}

data "archive_file" "live_api_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/live_api"
  output_path = "${path.module}/lambdas/live_api.zip"
}

resource "aws_iam_role" "lambda_live_api" {
  name_prefix = "${local.name_prefix}-lambda-live-api-"

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
    Name = "${local.name_prefix}-lambda-live-api-role"
  })
}

resource "aws_iam_role_policy" "lambda_live_api_s3" {
  name_prefix = "s3-read-trusted-"
  role        = aws_iam_role.lambda_live_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = "arn:aws:s3:::${local.live_api_data_lake_bucket}"
        Condition = {
          StringLike = {
            "s3:prefix" = [
              var.trusted_prefix_finance_transactions,
              "${var.trusted_prefix_finance_transactions}*"
            ]
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "arn:aws:s3:::${local.live_api_data_lake_bucket}/${var.trusted_prefix_finance_transactions}*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_live_api_basic" {
  role       = aws_iam_role.lambda_live_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "live_api" {
  filename         = data.archive_file.live_api_lambda.output_path
  function_name    = "${local.name_prefix}-s3-live-api"
  role             = aws_iam_role.lambda_live_api.arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.live_api_lambda.output_base64sha256
  runtime          = "python3.12"
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      DATA_LAKE_BUCKET  = local.live_api_data_lake_bucket
      TRUSTED_PREFIX    = var.trusted_prefix_finance_transactions
      MAX_ITEMS_DEFAULT = tostring(var.max_items)
      ALLOWED_ORIGIN    = var.allowed_origin
      POLL_INTERVAL_MS  = tostring(var.poll_interval_ms)
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
    allow_methods = ["GET", "OPTIONS"]
    allow_headers = ["Content-Type"]
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
