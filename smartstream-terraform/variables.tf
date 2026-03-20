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

variable "company_name" {
  description = "Company name used for tenant-prefixed deployments"
  type        = string
  default     = ""
}

variable "environment" {
  description = "Deployment environment used by tenant and tag naming (dev, test, prod)"
  type        = string
  default     = "dev"
}

variable "enable_tenant_prefix" {
  description = "When true, resource names use tenant prefixing; when false, legacy naming is preserved"
  type        = bool
  default     = false
}

variable "legacy_name_prefix" {
  description = "Legacy resource name prefix used by the current pipeline deployment"
  type        = string
  default     = "smartstream-dev"
}

variable "name_prefix_override" {
  description = "Optional explicit override for tenant name prefix"
  type        = string
  default     = ""
}

variable "create_shared_iam" {
  description = "Create shared IAM resources in this workspace. Must be false for tenant deployments."
  type        = bool
  default     = true
}

variable "legacy_workspace_name" {
  description = "Workspace designated for legacy/shared IAM resources"
  type        = string
  default     = "newaccount"
}

variable "shared_dms_secrets_role_name" {
  description = "Optional override for shared DMS secrets access role name"
  type        = string
  default     = ""
}

variable "shared_dms_kinesis_role_name" {
  description = "Optional override for shared DMS Kinesis target role name"
  type        = string
  default     = ""
}

variable "shared_dms_vpc_role_name" {
  description = "Optional override for shared DMS VPC role name"
  type        = string
  default     = ""
}

variable "shared_firehose_role_name" {
  description = "Optional override for shared Firehose role name"
  type        = string
  default     = ""
}

variable "shared_lambda_transform_role_name" {
  description = "Optional override for shared transform Lambda role name"
  type        = string
  default     = ""
}

variable "shared_lambda_ml_role_name" {
  description = "Optional override for shared ML Lambda role name"
  type        = string
  default     = ""
}

variable "shared_lambda_live_api_role_name" {
  description = "Optional override for shared live API Lambda role name"
  type        = string
  default     = ""
}

variable "shared_lambda_ops_api_role_name" {
  description = "Optional override for shared ops API Lambda role name"
  type        = string
  default     = ""
}

variable "shared_lambda_anomaly_role_name" {
  description = "Optional override for shared anomaly Lambda role name"
  type        = string
  default     = ""
}

variable "shared_glue_crawler_role_name" {
  description = "Optional override for shared Glue crawler role name"
  type        = string
  default     = ""
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
  default     = null
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

variable "anomaly_schedule_expression" {
  description = "EventBridge schedule expression for anomaly detection"
  type        = string
  default     = "rate(2 hours)" # Run anomaly detection every 2 hours
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

variable "anomaly_max_input_files" {
  description = "Maximum number of recent trusted files the anomaly Lambda reads per dataset"
  type        = number
  default     = 20

  validation {
    condition     = var.anomaly_max_input_files >= 1
    error_message = "anomaly_max_input_files must be at least 1."
  }
}

variable "salary_outlier_zscore_threshold" {
  description = "Z-score threshold used by salary outlier detection"
  type        = number
  default     = 2.5

  validation {
    condition     = var.salary_outlier_zscore_threshold >= 1.0 && var.salary_outlier_zscore_threshold <= 6.0
    error_message = "salary_outlier_zscore_threshold must be between 1.0 and 6.0."
  }
}

variable "duplicate_transaction_window_minutes" {
  description = "Time window in minutes for duplicate transaction detection"
  type        = number
  default     = 10

  validation {
    condition     = var.duplicate_transaction_window_minutes >= 1 && var.duplicate_transaction_window_minutes <= 180
    error_message = "duplicate_transaction_window_minutes must be between 1 and 180."
  }
}

variable "large_transaction_multiplier" {
  description = "Multiplier over baseline median used to detect unusually large transactions"
  type        = number
  default     = 3.0

  validation {
    condition     = var.large_transaction_multiplier >= 1.1 && var.large_transaction_multiplier <= 20
    error_message = "large_transaction_multiplier must be between 1.1 and 20."
  }
}

variable "small_transaction_floor_ratio" {
  description = "Ratio under baseline median used to detect suspiciously small transactions"
  type        = number
  default     = 0.25

  validation {
    condition     = var.small_transaction_floor_ratio > 0 && var.small_transaction_floor_ratio < 1
    error_message = "small_transaction_floor_ratio must be between 0 and 1."
  }
}

variable "glue_crawler_schedule" {
  description = "Cron expression for Glue crawler (UTC)"
  type        = string
  default     = "cron(0 2 * * ? *)" # Run daily at 2 AM UTC
}

variable "web_bucket_name" {
  description = "Optional override for frontend hosting bucket name. If null, a globally unique name using account ID is generated."
  type        = string
  default     = null
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

variable "trusted_prefix_anomalies" {
  description = "Trusted analytics prefix for anomaly outputs consumed by the live API"
  type        = string
  default     = "trusted-analytics/anomalies/"
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

variable "ops_api_require_auth" {
  description = "When true, the ops API requires a valid bearer token and the configured role."
  type        = bool
  default     = false
}

variable "ops_api_required_role" {
  description = "Minimum account role allowed to access the ops API when auth is enabled."
  type        = string
  default     = "admin"
}

