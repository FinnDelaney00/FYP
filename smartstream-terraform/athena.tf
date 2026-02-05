# Athena Workgroup for querying data lake
resource "aws_athena_workgroup" "main" {
  name        = "${local.name_prefix}-workgroup"
  description = "Athena workgroup for ${var.project_name} ${var.env}"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.athena_results.id}/results/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }

    engine_version {
      selected_engine_version = "AUTO"
    }
  }

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-athena-workgroup"
    Purpose = "DataQuerying"
  })
}

# Named query example for querying trusted data
resource "aws_athena_named_query" "sample_trusted_query" {
  name      = "${local.name_prefix}-sample-trusted-query"
  workgroup = aws_athena_workgroup.main.id
  database  = aws_glue_catalog_database.main.name
  query     = <<-EOT
    -- Sample query to explore trusted data
    -- Replace 'your_table_name' with actual table name created by Glue Crawler
    
    SELECT *
    FROM your_table_name
    LIMIT 10;
  EOT

  description = "Sample query template for trusted zone data"
}

# Named query example for analytics data
resource "aws_athena_named_query" "sample_analytics_query" {
  name      = "${local.name_prefix}-sample-analytics-query"
  workgroup = aws_athena_workgroup.main.id
  database  = aws_glue_catalog_database.main.name
  query     = <<-EOT
    -- Sample query to explore ML analytics results
    -- Replace 'your_analytics_table' with actual table name created by Glue Crawler
    
    SELECT 
      metadata,
      COUNT(*) as prediction_count
    FROM your_analytics_table
    GROUP BY metadata
    LIMIT 10;
  EOT

  description = "Sample query template for analytics zone data"
}

# CloudWatch Log Group for Athena queries
resource "aws_cloudwatch_log_group" "athena" {
  name              = "/aws/athena/${local.name_prefix}"
  retention_in_days = var.log_retention_days

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-athena-logs"
  })
}
