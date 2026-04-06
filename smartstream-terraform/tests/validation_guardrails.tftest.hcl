mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
      arn        = "arn:aws:iam::123456789012:user/terraform-test"
      id         = "123456789012"
      user_id    = "AIDATERRAFORMTEST123"
    }
  }

  mock_data "aws_region" {
    defaults = {
      name = "eu-north-1"
      id   = "eu-north-1"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = <<JSON
{"Version":"2012-10-17","Statement":[]}
JSON
    }
  }

  mock_data "aws_iam_role" {
    defaults = {
      arn  = "arn:aws:iam::123456789012:role/mock-shared-role"
      id   = "mock-shared-role"
      name = "mock-shared-role"
    }
  }
}

mock_provider "archive" {
  mock_data "archive_file" {
    defaults = {
      output_path         = "mock.zip"
      output_base64sha256 = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
    }
  }
}

mock_provider "random" {
  mock_resource "random_password" {
    defaults = {
      result = "UnitTestPassword123!"
    }
  }
}

run "query_max_rows_validation" {
  command = plan

  variables {
    db_password    = "UnitTestPassword123!"
    query_max_rows = 1001
  }

  expect_failures = [var.query_max_rows]
}

run "ml_forecast_days_validation" {
  command = plan

  variables {
    db_password      = "UnitTestPassword123!"
    ml_forecast_days = 10
  }

  expect_failures = [var.ml_forecast_days]
}

run "auth_token_ttl_validation" {
  command = plan

  variables {
    db_password            = "UnitTestPassword123!"
    auth_token_ttl_seconds = 120
  }

  expect_failures = [var.auth_token_ttl_seconds]
}
