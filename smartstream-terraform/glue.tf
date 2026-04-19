# Glue Data Catalog Database
resource "aws_glue_catalog_database" "main" {
  name        = local.glue_database_name
  description = "Data catalog for smartstream ${var.environment} environment"

  tags = merge(local.common_tags, {
    Name = local.glue_database_name
  })
}

# Glue Crawler for Trusted Zone
resource "aws_glue_crawler" "trusted" {
  name          = "${local.name_prefix}-trusted-crawler"
  role          = local.glue_crawler_role_arn
  database_name = aws_glue_catalog_database.main.name

  schedule = var.glue_crawler_schedule

  s3_target {
    path = "s3://${aws_s3_bucket.data_lake.id}/${local.s3_trusted_prefix}"
  }

  schema_change_policy {
    delete_behavior = "LOG"
    update_behavior = "UPDATE_IN_DATABASE"
  }

  configuration = jsonencode({
    Version = 1.0
    CrawlerOutput = {
      Partitions = {
        AddOrUpdateBehavior = "InheritFromTable"
      }
    }
    Grouping = {
      TableGroupingPolicy = "CombineCompatibleSchemas"
    }
  })

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-trusted-crawler"
    Purpose = "CatalogTrustedData"
  })
}

# Glue Crawler for Trusted-Analytics Zone
resource "aws_glue_crawler" "analytics" {
  name          = "${local.name_prefix}-analytics-crawler"
  role          = local.glue_crawler_role_arn
  database_name = aws_glue_catalog_database.main.name

  schedule = var.glue_crawler_schedule

  s3_target {
    path = "s3://${aws_s3_bucket.data_lake.id}/${local.s3_trusted_analytics_prefix}"
  }

  schema_change_policy {
    delete_behavior = "LOG"
    update_behavior = "UPDATE_IN_DATABASE"
  }

  configuration = jsonencode({
    Version = 1.0
    CrawlerOutput = {
      Partitions = {
        AddOrUpdateBehavior = "InheritFromTable"
      }
    }
    Grouping = {
      TableGroupingPolicy = "CombineCompatibleSchemas"
    }
  })

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-analytics-crawler"
    Purpose = "CatalogAnalyticsData"
  })
}

# /aws-glue/crawlers is account-wide and created automatically by AWS Glue
data "aws_cloudwatch_log_group" "glue_crawlers" {
  name = "/aws-glue/crawlers"
}
