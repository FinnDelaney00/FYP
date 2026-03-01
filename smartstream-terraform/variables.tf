variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "smartstream"
}

variable "env" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "region" {
  description = "AWS region for deployment"
  type        = string
  default     = "eu-north-1"
}

variable "db_name" {
  description = "RDS PostgreSQL database name"
  type        = string
  default     = "employees"
}

variable "db_username" {
  description = "RDS master username"
  type        = string
  default     = "dbadmin"
  sensitive   = true
}

variable "db_password" {
  description = "RDS master password (will be stored in Secrets Manager)"
  type        = string
  sensitive   = true
  default     = "Cooperdel1234{}" #SmartstreamDev_2026!
}

variable "finance_schema_name" {
  description = "Schema name for finance tables replicated by the finance DMS task"
  type        = string
  default     = "finance"
}

variable "finance_table_list" {
  description = "Finance tables to replicate from the finance schema"
  type        = list(string)
  default     = ["transactions", "accounts"]
}

variable "kinesis_shards" {
  description = "Number of shards for Kinesis Data Stream"
  type        = number
  default     = 2
}

variable "firehose_buffer_interval_seconds" {
  description = "Firehose buffering interval in seconds (60-900)"
  type        = number
  default     = 60 # Low-latency default
}

variable "firehose_buffer_size_mb" {
  description = "Firehose buffering size in MB (1-128)"
  type        = number
  default     = 5 # Low-latency default
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 7
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro" # Cost-conscious default
}

variable "rds_allocated_storage" {
  description = "RDS allocated storage in GB"
  type        = number
  default     = 80
}

variable "ml_schedule_expression" {
  description = "EventBridge schedule expression for ML inference"
  type        = string
  default     = "rate(1 hour)" # Run ML inference hourly
}

variable "ml_max_input_files" {
  description = "Maximum number of recent trusted files to read per dataset (employees/finance)"
  type        = number
  default     = 20

  validation {
    condition     = var.ml_max_input_files >= 1
    error_message = "ml_max_input_files must be at least 1."
  }
}

variable "ml_forecast_days" {
  description = "Forecast horizon in days for ML predictions"
  type        = number
  default     = 60

  validation {
    condition     = var.ml_forecast_days >= 30 && var.ml_forecast_days <= 90
    error_message = "ml_forecast_days must be between 30 and 90."
  }
}

variable "glue_crawler_schedule" {
  description = "Cron expression for Glue crawler (UTC)"
  type        = string
  default     = "cron(0 2 * * ? *)" # Run daily at 2 AM UTC
}

variable "web_bucket_name" {
  description = "Globally unique S3 bucket name for SmartStream frontend hosting"
  type        = string
  default     = "smartstream-dev-web"
}

variable "data_lake_bucket_name" {
  description = "Existing S3 data lake bucket name used by the live API (defaults to Terraform-managed data lake bucket)"
  type        = string
  default     = null
}

variable "trusted_prefix_finance_transactions" {
  description = "Trusted prefix for finance transactions consumed by the live API"
  type        = string
  default     = "trusted/finance/transactions/"
}

variable "trusted_prefix_employees" {
  description = "Trusted prefix for employee records consumed by the live API"
  type        = string
  default     = "trusted/employees/"
}

variable "trusted_prefix_predictions" {
  description = "Trusted analytics prefix for ML prediction outputs consumed by the live API"
  type        = string
  default     = "trusted-analytics/predictions/"
}

variable "allowed_origin" {
  description = "Allowed CORS origin for the live API (set to CloudFront domain or * for demo)"
  type        = string
  default     = "*"
}

variable "poll_interval_ms" {
  description = "Frontend polling interval in milliseconds"
  type        = number
  default     = 3000
}

variable "max_items" {
  description = "Maximum number of items returned by the live API"
  type        = number
  default     = 200
}

variable "query_max_rows" {
  description = "Maximum number of rows returned for live API SQL query endpoint"
  type        = number
  default     = 200

  validation {
    condition     = var.query_max_rows >= 1 && var.query_max_rows <= 1000
    error_message = "query_max_rows must be between 1 and 1000."
  }
}

variable "auth_token_ttl_seconds" {
  description = "Authentication token time-to-live in seconds for live API login tokens"
  type        = number
  default     = 604800

  validation {
    condition     = var.auth_token_ttl_seconds >= 3600 && var.auth_token_ttl_seconds <= 2592000
    error_message = "auth_token_ttl_seconds must be between 3600 and 2592000."
  }
}
