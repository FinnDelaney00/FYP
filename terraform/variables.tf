variable "aws_region" {
  type        = string
  description = "AWS region to deploy into"
  default     = "eu-west-1"
}

variable "project" {
  type        = string
  description = "Project name (used for naming)"
  default     = "SmartStream"
}

variable "env" {
  type        = string
  description = "Environment name (e.g., dev, prod)"
  default     = "dev"
}

variable "owner" {
  type        = string
  description = "Owner tag value"
  default     = "C22392083"
}

variable "rds_endpoint" {
  description = "The endpoint of the RDS instance"
  type        = string
}

variable "db_name" {
  description = "The name of the database"
  type        = string
}

variable "db_user" {
  description = "The database username"
  type        = string
}

variable "kinesis_stream_arn" {
  description = "The ARN of the Kinesis stream"
  type        = string
}

variable "dms_subnet_ids" {
  description = "List of subnet IDs for DMS"
  type        = list(string)
}

variable "dms_security_group_id" {
  description = "Security group ID for DMS"
  type        = string
}

variable "db_password" {
  description = "The database password"
  type        = string
  sensitive   = true
}