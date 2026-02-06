# CloudWatch Dashboard for SmartStream Pipeline
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.name_prefix}-pipeline-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Kinesis", "IncomingRecords", { stat = "Sum", label = "Kinesis Incoming Records" }],
            [".", "IncomingBytes", { stat = "Sum", label = "Kinesis Incoming Bytes" }]
          ]
          period = 300
          region = var.region
          title  = "Kinesis Data Stream - Ingestion"
          yAxis = {
            left = {
              label = "Count/Bytes"
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Firehose", "DeliveryToS3.Success", { stat = "Sum", label = "Firehose Success" }],
            [".", "DeliveryToS3.DataFreshness", { stat = "Average", label = "Data Freshness (ms)" }]
          ]
          period = 300
          region = var.region
          title  = "Firehose - S3 Delivery"
          yAxis = {
            left = {
              label = "Count/Milliseconds"
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Lambda", "Invocations", { stat = "Sum", label = "Transform Invocations" }],
            [".", "Errors", { stat = "Sum", label = "Transform Errors" }],
            [".", "Duration", { stat = "Average", label = "Avg Duration (ms)" }]
          ]
          period = 300
          region = var.region
          title  = "Lambda Transform Function"
          yAxis = {
            left = {
              label = "Count/Milliseconds"
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Lambda", "Invocations", { stat = "Sum", label = "ML Invocations" }],
            [".", "Errors", { stat = "Sum", label = "ML Errors" }]
          ]
          period = 300
          region = var.region
          title  = "Lambda ML Function"
          yAxis = {
            left = {
              label = "Count"
            }
          }
        }
      },
      {
        type = "log"
        properties = {
          query   = "SOURCE '/aws/lambda/${aws_lambda_function.transform.function_name}' | fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20"
          region  = var.region
          title   = "Recent Transform Lambda Errors"
        }
      }
    ]
  })
}

# SNS Topic for critical alerts (optional - can be configured for email/SMS notifications)
resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-pipeline-alerts"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-alerts-topic"
  })
}

# CloudWatch Composite Alarm for Pipeline Health
resource "aws_cloudwatch_composite_alarm" "pipeline_health" {
  alarm_name          = "${local.name_prefix}-pipeline-health"
  alarm_description   = "Composite alarm for overall pipeline health"
  actions_enabled     = true
  alarm_actions       = [aws_sns_topic.alerts.arn]

  alarm_rule = join(" OR ", [
    "ALARM(${aws_cloudwatch_metric_alarm.kinesis_write_throttle.alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.firehose_delivery_failed.alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.transform_lambda_errors.alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.ml_lambda_errors.alarm_name})"
  ])

  tags = local.common_tags
}

# Create the DMS task log group explicitly so metric filters can be created reliably
resource "aws_cloudwatch_log_group" "dms_task" {
  name              = "/aws/dms/tasks/${aws_dms_replication_task.cdc_task.replication_task_id}"
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dms-task-log-group"
  })
}

# Metric filter for DMS task errors
resource "aws_cloudwatch_log_metric_filter" "dms_task_errors" {
  name           = "${local.name_prefix}-dms-task-errors"
  log_group_name = aws_cloudwatch_log_group.dms_task.name

  # Use a generic pattern unless you know the exact DMS log format.
  # This triggers on any line containing ERROR, Error, or FATAL.
  pattern = "?ERROR ?Error ?FATAL"

  metric_transformation {
    name      = "DMSTaskErrors"
    namespace = "${var.project_name}/${var.env}"
    value     = "1"
    unit      = "Count"
  }

  depends_on = [aws_cloudwatch_log_group.dms_task]
}


# Additional log groups for DMS
resource "aws_cloudwatch_log_group" "dms_tasks" {
  name              = "/aws/dms/tasks/${aws_dms_replication_task.cdc_task.replication_task_id}"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dms-task-logs"
  })
}
