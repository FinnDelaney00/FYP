variable "aws_region" {
  type        = string
  description = "AWS region to deploy into"
  default     = "eu-west-1"
}

variable "project" {
  type        = string
  description = "Project name (used for naming)"
}

variable "env" {
  type        = string
  description = "Environment name (e.g., dev, prod)"
  default     = "dev"
}

variable "owner" {
  type        = string
  description = "Owner tag value"
  default     = "finn"
}

variable "first_bucket_name" {
  type        = string
  description = "Name of the S3 bucket"
  default     = "FirstTFbucketTest"
}
