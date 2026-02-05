# RDS PostgreSQL instance (source database)
resource "aws_db_instance" "main" {
  identifier     = "${local.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = "15.4"

  instance_class    = var.rds_instance_class
  allocated_storage = var.rds_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password != null ? var.db_password : random_password.db_password[0].result

  # Networking
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  # Backup configuration
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:00-mon:05:00"

  # Enable automated backups for point-in-time recovery
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Performance insights
  performance_insights_enabled = false # Disabled for cost savings

  # Deletion protection (disable for dev/testing)
  deletion_protection = false
  skip_final_snapshot = true

  # Required for DMS CDC
  # Enable logical replication for change data capture
  parameter_group_name = aws_db_parameter_group.postgres_cdc.name

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-postgres"
  })
}

# Parameter group for PostgreSQL with CDC enabled
resource "aws_db_parameter_group" "postgres_cdc" {
  name_prefix = "${local.name_prefix}-postgres-cdc-"
  family      = "postgres15"
  description = "PostgreSQL parameter group with logical replication enabled for DMS CDC"

  # Enable logical replication for DMS CDC
  parameter {
    name  = "rds.logical_replication"
    value = "1"
  }

  parameter {
    name  = "wal_sender_timeout"
    value = "0" # Disable timeout for CDC connections
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-postgres-cdc-params"
  })

  lifecycle {
    create_before_destroy = true
  }
}
