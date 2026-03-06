provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "smartstream"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Company     = var.enable_tenant_prefix ? var.company_name : "legacy"
      Pipeline    = "SmartStream"
    }
  }
}

provider "archive" {}

provider "random" {}
