# RDS PostgreSQL instance (source database)
resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-postgres"
  engine     = "postgres"

  # Let AWS pick a supported engine version in the region.
  # This avoids errors like "Cannot find version 15.4" and keeps things portable.
  # The parameter group family below is set to postgres17 to match the default you’re seeing.
  # If your account/region later defaults to a different major version, update the family to match.
  # engine_version = "17.x" # Optional: pin AFTER verifying availability

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

  # Required for DMS CDC (logical replication)
  parameter_group_name = aws_db_parameter_group.postgres_cdc.name

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-postgres"
  })
}

# Parameter group for PostgreSQL with CDC enabled
resource "aws_db_parameter_group" "postgres_cdc" {
  name_prefix = "${local.name_prefix}-postgres-cdc-"

  # MUST match the major version of the DB instance.
  # Your error indicates the instance is running Postgres 17, so the family must be postgres17.
  family      = "postgres17"
  description = "PostgreSQL parameter group with logical replication enabled for DMS CDC"

  # Enable logical replication for DMS CDC (RDS parameter)
  parameter {
    name         = "rds.logical_replication"
    value        = "1"
    apply_method = "pending-reboot"
  }

  # Disable timeout for CDC connections
  parameter {
    name         = "wal_sender_timeout"
    value        = "0"
    apply_method = "pending-reboot"
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-postgres-cdc-params"
  })

  lifecycle {
    create_before_destroy = true
  }
}
