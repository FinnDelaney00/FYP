check "tenant_requires_company_name" {
  assert {
    condition     = !var.enable_tenant_prefix || trimspace(var.company_name) != ""
    error_message = "Tenant mode requires company_name to be set."
  }
}

check "tenant_requires_short_company_name" {
  assert {
    condition     = !var.enable_tenant_prefix || length(local.company_name_normalized_raw) <= 30
    error_message = "Normalized company_name must be 30 characters or fewer for tenant deployments."
  }
}

check "tenant_workspace_matches_company" {
  assert {
    condition     = !var.enable_tenant_prefix || terraform.workspace == local.company_name_normalized
    error_message = "Tenant workspace must match normalized company_name."
  }
}

check "tenant_cannot_create_shared_iam" {
  assert {
    condition     = !var.enable_tenant_prefix || !var.create_shared_iam
    error_message = "Tenant mode requires create_shared_iam=false to prevent per-tenant IAM creation."
  }
}

check "shared_iam_workspace_restriction" {
  assert {
    condition     = !var.create_shared_iam || terraform.workspace == var.legacy_workspace_name
    error_message = "create_shared_iam=true is restricted to the legacy workspace."
  }
}

check "tenant_bucket_name_constraints" {
  assert {
    condition = !var.enable_tenant_prefix || alltrue([
      for bucket_name in [local.data_lake_bucket, local.athena_results_bucket, local.web_bucket_name] :
      length(bucket_name) <= 63 && can(regex("^[a-z0-9][a-z0-9-]*[a-z0-9]$", bucket_name))
    ])
    error_message = "Tenant bucket names must be lowercase, use only [a-z0-9-], and be <= 63 characters."
  }
}

check "shared_iam_role_lookup_is_unique" {
  assert {
    condition = var.create_shared_iam ? true : alltrue([
      for role_key, resolved_count in local.shared_iam_discovery_counts :
      resolved_count == 1
    ])
    error_message = "Unable to resolve a unique shared IAM role for tenant mode. Set the shared_*_role_name overrides explicitly."
  }
}

check "shared_iam_roles_resolved" {
  assert {
    condition = var.create_shared_iam ? true : alltrue([
      for _, role_name in local.shared_iam_role_names :
      trimspace(role_name) != ""
    ])
    error_message = "create_shared_iam=false requires all shared IAM roles to be discoverable or explicitly configured."
  }
}
