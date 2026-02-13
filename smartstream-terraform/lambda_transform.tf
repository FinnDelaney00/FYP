# Archive transform Lambda code
data "archive_file" "transform_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/transform"
  output_path = "${path.module}/lambdas/transform.zip"
}

# Transform Lambda Function
resource "aws_lambda_function" "transform" {
  filename         = data.archive_file.transform_lambda.output_path
  function_name    = "${local.name_prefix}-data-transform"
  role             = aws_iam_role.lambda_transform.arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.transform_lambda.output_base64sha256
  runtime          = "python3.11"
  timeout          = 300 # 5 minutes
  memory_size      = 512

  environment {
    variables = {
      DATA_LAKE_BUCKET    = aws_s3_bucket.data_lake.id
      RAW_PREFIX          = local.s3_raw_prefix
      TRUSTED_PREFIX      = local.s3_trusted_prefix
      FINANCE_SCHEMA_NAME = var.finance_schema_name
      FINANCE_TABLE_LIST  = join(",", var.finance_table_list)
      LOG_LEVEL           = "INFO"
    }
  }

  # VPC configuration (optional - only if Lambda needs VPC access)
  # vpc_config {
  #   subnet_ids         = aws_subnet.private[*].id
  #   security_group_ids = [aws_security_group.lambda.id]
  # }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-transform-lambda"
    Purpose = "DataTransformation"
  })
}

# CloudWatch Log Group for Transform Lambda
resource "aws_cloudwatch_log_group" "lambda_transform" {
  name              = "/aws/lambda/${aws_lambda_function.transform.function_name}"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-transform-lambda-logs"
  })
}

# Lambda permission to allow S3 to invoke the function
resource "aws_lambda_permission" "allow_s3_transform" {
  statement_id  = "AllowExecutionFromS3"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.transform.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.data_lake.arn
}

# CloudWatch alarm for Transform Lambda errors
resource "aws_cloudwatch_metric_alarm" "transform_lambda_errors" {
  alarm_name          = "${local.name_prefix}-transform-lambda-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Transform Lambda is experiencing errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.transform.function_name
  }

  tags = local.common_tags
}

# CloudWatch alarm for Transform Lambda duration
resource "aws_cloudwatch_metric_alarm" "transform_lambda_duration" {
  alarm_name          = "${local.name_prefix}-transform-lambda-duration"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Average"
  threshold           = 240000 # 4 minutes (close to 5 minute timeout)
  alarm_description   = "Transform Lambda is approaching timeout"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.transform.function_name
  }

  tags = local.common_tags
}
