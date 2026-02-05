# Generate random password if not provided
resource "random_password" "db_password" {
  count   = var.db_password == null ? 1 : 0
  length  = 32
  special = true
  # Exclude characters that may cause issues in connection strings
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# Secrets Manager secret for RDS credentials
resource "aws_secretsmanager_secret" "rds_credentials" {
  name_prefix             = "${local.name_prefix}-rds-credentials-"
  description             = "RDS PostgreSQL credentials for ${var.db_name}"
  recovery_window_in_days = 7

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-rds-credentials"
  })
}

# Store RDS credentials in Secrets Manager
resource "aws_secretsmanager_secret_version" "rds_credentials" {
  secret_id = aws_secretsmanager_secret.rds_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = var.db_password != null ? var.db_password : random_password.db_password[0].result
    engine   = "postgres"
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = var.db_name
  })

  depends_on = [aws_db_instance.main]
}

# IAM policy for DMS to read credentials from Secrets Manager
data "aws_iam_policy_document" "dms_secrets_access" {
  statement {
    sid    = "AllowDMSToReadRDSCredentials"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]
    resources = [aws_secretsmanager_secret.rds_credentials.arn]
  }
}
