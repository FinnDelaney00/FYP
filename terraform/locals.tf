locals {
  name_prefix = "${var.project}-${var.env}"

  common_tags = {
    Project     = var.project
    Environment = var.env
    ManagedBy   = "Terraform"
    Owner       = var.owner
  }
}
