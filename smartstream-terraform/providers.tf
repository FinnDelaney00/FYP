provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.env
      ManagedBy   = "Terraform"
      Pipeline    = "SmartStream"
    }
  }
}

provider "archive" {}

provider "random" {}
