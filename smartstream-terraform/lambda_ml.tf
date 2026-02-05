# Archive ML Lambda code
data "archive_file" "ml_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/ml"
  output_path = "${path.module}/lambdas/ml.zip"
}

# ML Inference Lambda Function
resource "aws_lambda_function" "ml_inference" {
  filename         = data.archive_file.ml_lambda.output_path
  function_name    = "${local.name_prefix}-ml-inference"
  role            = aws_iam_role.lambda_ml.arn
  handler         = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.ml_lambda.output_base64sha256
  runtime         = "python3.11"
  timeout         = 900 # 15 minutes (for ML processing)
  memory_size     = 1024

  environment {
    variables = {
      DATA_LAKE_BUCKET = aws_s3_bucket.data_lake.id
      TRUSTED_PREFIX   = local.s3_trusted_prefix
      ANALYTICS_PREFIX = local.s3_trusted_analytics_prefix
      LOG_LEVEL        = "INFO"
    }
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-ml-lambda"
    Purpose = "MLInference"
  })
}

# CloudWatch Log Group for ML Lambda
resource "aws_cloudwatch_log_group" "lambda_ml" {
  name              = "/aws/lambda/${aws_lambda_function.ml_inference.function_name}"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ml-lambda-logs"
  })
}

# EventBridge rule for scheduled ML inference
resource "aws_cloudwatch_event_rule" "ml_inference_schedule" {
  name                = "${local.name_prefix}-ml-inference-schedule"
  description         = "Trigger ML inference Lambda on schedule"
  schedule_expression = var.ml_schedule_expression

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ml-schedule"
  })
}

# EventBridge target: ML Lambda
resource "aws_cloudwatch_event_target" "ml_inference" {
  rule      = aws_cloudwatch_event_rule.ml_inference_schedule.name
  target_id = "MLInferenceLambda"
  arn       = aws_lambda_function.ml_inference.arn
}

# Lambda permission to allow EventBridge to invoke the function
resource "aws_lambda_permission" "allow_eventbridge_ml" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ml_inference.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ml_inference_schedule.arn
}

# CloudWatch alarm for ML Lambda errors
resource "aws_cloudwatch_metric_alarm" "ml_lambda_errors" {
  alarm_name          = "${local.name_prefix}-ml-lambda-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 3
  alarm_description   = "ML Lambda is experiencing errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.ml_inference.function_name
  }

  tags = local.common_tags
}
