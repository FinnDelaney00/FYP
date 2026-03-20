data "archive_file" "ops_api_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/ops_api"
  output_path = "${path.module}/lambdas/ops_api.zip"
}

resource "aws_iam_role" "lambda_ops_api" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "${local.legacy_prefix}-lambda-ops-api-"

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
    Name = "${local.legacy_prefix}-lambda-ops-api-role"
  })
}

resource "aws_iam_role_policy" "lambda_ops_api_readonly" {
  count       = var.create_shared_iam ? 1 : 0
  name_prefix = "ops-readonly-"
  role        = aws_iam_role.lambda_ops_api[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:DescribeAlarms",
          "cloudwatch:GetMetricStatistics"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:FilterLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "dms:DescribeReplicationTasks"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetBucketLocation",
          "s3:ListBucket"
        ]
        Resource = concat(local.data_lake_bucket_arn_patterns, ["arn:aws:s3:::${local.live_api_data_lake_bucket}"])
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem"
        ]
        Resource = [
          "arn:aws:dynamodb:${var.region}:${local.account_id}:table/*-accounts",
          "arn:aws:dynamodb:${var.region}:${local.account_id}:table/*-companies"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_ops_api_basic" {
  count      = var.create_shared_iam ? 1 : 0
  role       = aws_iam_role.lambda_ops_api[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "ops_api" {
  filename         = data.archive_file.ops_api_lambda.output_path
  function_name    = "${local.name_prefix}-ops-api"
  role             = local.lambda_ops_api_role_arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.ops_api_lambda.output_base64sha256
  runtime          = "python3.12"
  timeout          = 30
  memory_size      = 512

  environment {
    variables = {
      DATA_LAKE_BUCKET                   = local.live_api_data_lake_bucket
      NAME_PREFIX                        = local.name_prefix
      OPS_ALARM_NAME_PREFIX              = local.name_prefix
      ALLOWED_ORIGIN                     = var.allowed_origin
      TRUSTED_ROOT_PREFIX                = local.s3_trusted_prefix
      TRUSTED_ANALYTICS_ROOT_PREFIX      = local.s3_trusted_analytics_prefix
      EMPLOYEE_TRUSTED_PREFIX            = "${local.s3_trusted_prefix}${local.name_prefix}/employees/"
      FINANCE_TRUSTED_PREFIX             = "${local.s3_trusted_prefix}${local.name_prefix}/finance/transactions/"
      PREDICTIONS_PREFIX                 = "${local.s3_trusted_analytics_prefix}${local.name_prefix}/predictions/"
      ANOMALIES_PREFIX                   = "${local.s3_trusted_analytics_prefix}${local.name_prefix}/anomalies/"
      KINESIS_STREAM_NAME                = aws_kinesis_stream.cdc_stream.name
      FIREHOSE_DELIVERY_STREAM_NAME      = aws_kinesis_firehose_delivery_stream.s3_delivery.name
      DMS_PUBLIC_TASK_ID                 = aws_dms_replication_task.cdc_task.replication_task_id
      DMS_FINANCE_TASK_ID                = aws_dms_replication_task.finance_cdc_task.replication_task_id
      TRANSFORM_LAMBDA_NAME              = aws_lambda_function.transform.function_name
      ML_LAMBDA_NAME                     = aws_lambda_function.ml_inference.function_name
      ANOMALY_LAMBDA_NAME                = aws_lambda_function.anomaly.function_name
      LIVE_API_LAMBDA_NAME               = aws_lambda_function.live_api.function_name
      TRANSFORM_TIMEOUT_MS               = tostring(aws_lambda_function.transform.timeout * 1000)
      ML_TIMEOUT_MS                      = tostring(aws_lambda_function.ml_inference.timeout * 1000)
      ANOMALY_TIMEOUT_MS                 = tostring(aws_lambda_function.anomaly.timeout * 1000)
      LIVE_API_TIMEOUT_MS                = tostring(aws_lambda_function.live_api.timeout * 1000)
      INGESTION_FRESHNESS_TARGET_MINUTES = "15"
      ML_SCHEDULE_EXPRESSION             = var.ml_schedule_expression
      ANOMALY_SCHEDULE_EXPRESSION        = var.anomaly_schedule_expression
      OPS_API_REQUIRE_AUTH               = tostring(var.ops_api_require_auth)
      OPS_API_REQUIRED_ROLE              = var.ops_api_required_role
      ACCOUNTS_TABLE                     = aws_dynamodb_table.accounts.name
      COMPANIES_TABLE                    = aws_dynamodb_table.companies.name
      AUTH_TOKEN_SECRET                  = random_password.auth_token_secret.result
      DEFAULT_ACCOUNT_ROLE               = "member"
    }
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-ops-api"
    Purpose = "OpsMonitoringAPI"
  })
}

resource "aws_cloudwatch_log_group" "lambda_ops_api" {
  name              = "/aws/lambda/${aws_lambda_function.ops_api.function_name}"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ops-api-logs"
  })
}

resource "aws_apigatewayv2_api" "ops_api" {
  name          = "${local.name_prefix}-ops-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.allowed_origin]
    allow_methods = ["GET", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-ops-api"
    Purpose = "OpsMonitoringAPI"
  })
}

resource "aws_apigatewayv2_integration" "ops_api_lambda" {
  api_id                 = aws_apigatewayv2_api.ops_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ops_api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "ops_api_overview" {
  api_id    = aws_apigatewayv2_api.ops_api.id
  route_key = "GET /ops/overview"
  target    = "integrations/${aws_apigatewayv2_integration.ops_api_lambda.id}"
}

resource "aws_apigatewayv2_route" "ops_api_pipelines" {
  api_id    = aws_apigatewayv2_api.ops_api.id
  route_key = "GET /ops/pipelines"
  target    = "integrations/${aws_apigatewayv2_integration.ops_api_lambda.id}"
}

resource "aws_apigatewayv2_route" "ops_api_pipeline_detail" {
  api_id    = aws_apigatewayv2_api.ops_api.id
  route_key = "GET /ops/pipelines/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.ops_api_lambda.id}"
}

resource "aws_apigatewayv2_route" "ops_api_alarms" {
  api_id    = aws_apigatewayv2_api.ops_api.id
  route_key = "GET /ops/alarms"
  target    = "integrations/${aws_apigatewayv2_integration.ops_api_lambda.id}"
}

resource "aws_apigatewayv2_route" "ops_api_log_summary" {
  api_id    = aws_apigatewayv2_api.ops_api.id
  route_key = "GET /ops/log-summary"
  target    = "integrations/${aws_apigatewayv2_integration.ops_api_lambda.id}"
}

resource "aws_apigatewayv2_stage" "ops_api" {
  api_id      = aws_apigatewayv2_api.ops_api.id
  name        = "$default"
  auto_deploy = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ops-api-stage"
  })
}

resource "aws_lambda_permission" "allow_apigw_ops_api" {
  statement_id  = "AllowExecutionFromAPIGatewayOpsAPI"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ops_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ops_api.execution_arn}/*/*"
}
