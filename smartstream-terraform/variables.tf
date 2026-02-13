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
  default     = 20
}

variable "ml_schedule_expression" {
  description = "EventBridge schedule expression for ML inference"
  type        = string
  default     = "rate(1 hour)" # Run ML inference hourly
}

variable "glue_crawler_schedule" {
  description = "Cron expression for Glue crawler (UTC)"
  type        = string
  default     = "cron(0 2 * * ? *)" # Run daily at 2 AM UTC
}
