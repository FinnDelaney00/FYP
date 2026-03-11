# Archive anomaly Lambda code
data "archive_file" "anomaly_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/anomaly"
  output_path = "${path.module}/lambdas/anomaly.zip"
}

# Anomaly Detection Lambda Function
resource "aws_lambda_function" "anomaly" {
  filename         = data.archive_file.anomaly_lambda.output_path
  function_name    = "${local.name_prefix}-anomaly-detection"
  role             = local.lambda_anomaly_role_arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.anomaly_lambda.output_base64sha256
  runtime          = "python3.11"
  timeout          = 900 # 15 minutes
  memory_size      = 1024

  environment {
    variables = {
      DATA_LAKE_BUCKET                     = aws_s3_bucket.data_lake.id
      TRUSTED_PREFIX                       = "${local.s3_trusted_prefix}${local.name_prefix}/"
      EMPLOYEES_PREFIX                     = "${local.s3_trusted_prefix}${local.name_prefix}/employees/"
      TRANSACTIONS_PREFIX                  = "${local.s3_trusted_prefix}${local.name_prefix}/finance/transactions/"
      ANALYTICS_PREFIX                     = "${local.s3_trusted_analytics_prefix}${local.name_prefix}/anomalies/"
      MAX_INPUT_FILES                      = tostring(var.anomaly_max_input_files)
      SALARY_OUTLIER_ZSCORE_THRESHOLD      = tostring(var.salary_outlier_zscore_threshold)
      DUPLICATE_TRANSACTION_WINDOW_MINUTES = tostring(var.duplicate_transaction_window_minutes)
      LARGE_TRANSACTION_MULTIPLIER         = tostring(var.large_transaction_multiplier)
      SMALL_TRANSACTION_FLOOR_RATIO        = tostring(var.small_transaction_floor_ratio)
      LOG_LEVEL                            = "INFO"
    }
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-anomaly-lambda"
    Purpose = "AnomalyDetection"
  })
}

# CloudWatch Log Group for Anomaly Lambda
resource "aws_cloudwatch_log_group" "lambda_anomaly" {
  name              = "/aws/lambda/${aws_lambda_function.anomaly.function_name}"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-anomaly-lambda-logs"
  })
}

# EventBridge rule for scheduled anomaly detection
resource "aws_cloudwatch_event_rule" "anomaly_schedule" {
  name                = "${local.name_prefix}-anomaly-detection-schedule"
  description         = "Trigger anomaly detection Lambda on schedule"
  schedule_expression = var.anomaly_schedule_expression

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-anomaly-schedule"
  })
}

# EventBridge target: anomaly Lambda
resource "aws_cloudwatch_event_target" "anomaly" {
  rule      = aws_cloudwatch_event_rule.anomaly_schedule.name
  target_id = "AnomalyDetectionLambda"
  arn       = aws_lambda_function.anomaly.arn
}

# Lambda permission to allow EventBridge to invoke the function
resource "aws_lambda_permission" "allow_eventbridge_anomaly" {
  statement_id  = "AllowExecutionFromEventBridgeAnomaly"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.anomaly.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.anomaly_schedule.arn
}

# CloudWatch alarm for anomaly Lambda errors
resource "aws_cloudwatch_metric_alarm" "anomaly_lambda_errors" {
  alarm_name          = "${local.name_prefix}-anomaly-lambda-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 3
  alarm_description   = "Anomaly Lambda is experiencing errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.anomaly.function_name
  }

  tags = local.common_tags
}

# CloudWatch alarm for anomaly Lambda duration
resource "aws_cloudwatch_metric_alarm" "anomaly_lambda_duration" {
  alarm_name          = "${local.name_prefix}-anomaly-lambda-duration"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Average"
  threshold           = 780000 # 13 minutes (close to 15 minute timeout)
  alarm_description   = "Anomaly Lambda duration is approaching timeout"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.anomaly.function_name
  }

  tags = local.common_tags
}
