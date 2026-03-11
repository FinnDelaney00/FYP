# IAM Permissions for SmartStream Terraform

This file describes the deployer permissions needed for the current Terraform stack.

## Deployment Profiles

There are two practical permission profiles.

### 1. Legacy bootstrap deployment (shared IAM creation)

Use when running with:

- `enable_tenant_prefix=false`
- `create_shared_iam=true`

You need full create/update/delete permissions for:

- EC2/VPC
- RDS
- DMS
- Kinesis and Firehose
- S3
- Lambda
- IAM (roles, policies, policy attachments, pass role)
- Glue
- Athena
- CloudWatch + Logs
- SNS
- EventBridge
- Secrets Manager
- DynamoDB
- CloudFront

### 2. Tenant deployment (shared IAM reuse)

Use when running with:

- `enable_tenant_prefix=true`
- `create_shared_iam=false`

Required differences:

- IAM role/policy creation is not required.
- You still need IAM discovery and pass-role capabilities:
  - `iam:ListRoles`
  - `iam:GetRole`
  - `iam:PassRole`

Plus create/update/delete permissions for tenant resources across the non-IAM services listed above.

## Recommended Managed Policy Approach

For development and initial setup, the quickest path is:

- `AdministratorAccess`

If tighter controls are required, use:

- `PowerUserAccess`
- plus explicit IAM permissions for the required IAM actions (`CreateRole`, `PutRolePolicy`, `AttachRolePolicy`, `PassRole`, `ListRoles`, `GetRole`, etc.)

## Service-Level Action Checklist

Minimum action families needed by Terraform across this codebase:

- EC2/VPC: `Create*`, `Delete*`, `Describe*`, `Modify*`, route table/security group/tag operations
- RDS: `CreateDBInstance`, `ModifyDBInstance`, `DeleteDBInstance`, subnet/parameter group actions, tagging
- DMS: replication instance/endpoint/task create-modify-delete-start-stop-describe actions
- Kinesis: stream create-update-delete-describe/list/tag actions
- Firehose: delivery stream create-update-delete-describe/tag actions
- S3: bucket create/delete/configuration actions, object list/get/put/delete
- Lambda: create/update/delete/get/invoke and permission management
- IAM (legacy mode): role/policy create/update/delete/get/attach/detach/pass/list
- Glue: database/crawler create-update-delete/get/start/stop/list/tag actions
- Athena: workgroup and named query create-update-delete/get actions
- CloudWatch/Logs: dashboard/alarm/log-group/log-stream/metric-filter actions
- EventBridge: rule/target create-update-delete/list/tag actions
- Secrets Manager: secret create/update/delete/get/describe/tag
- SNS: topic create/update/delete/get/subscribe/unsubscribe
- DynamoDB: table create/update/delete/describe/tag and item operations used by runtime
- CloudFront: distribution/OAC create-update-delete/get/tag actions

## Runtime vs Deployer Permissions

Terraform creates runtime IAM roles for DMS, Firehose, Lambda, and Glue in legacy mode.

- Deployer permissions are for provisioning infrastructure.
- Runtime permissions are encoded in Terraform IAM policies attached to service roles.

In tenant mode, runtime roles are expected to exist already and are discovered/reused.

## Region Notes

- Networking currently hardcodes availability zones for `eu-north-1` in `networking.tf`.
- This avoids requiring `ec2:DescribeAvailabilityZones` in this specific region setup.
- If you change region and move back to dynamic AZ discovery, `DescribeAvailabilityZones` may be needed.

## Permission Validation Commands

```bash
aws sts get-caller-identity
aws iam list-roles --max-items 5
aws ec2 describe-vpcs --region eu-north-1
aws lambda list-functions --region eu-north-1
aws dms describe-replication-instances --region eu-north-1
aws cloudfront list-distributions
```

## Common Failure Patterns

- `AccessDenied` on IAM role lookup in tenant mode:
  - missing `iam:ListRoles` or `iam:GetRole`
- `iam:PassRole` denied when creating Lambda/DMS/Firehose resources
- CloudFront permission gaps during web distribution creation/update
- DMS endpoint/task creation denied due missing DMS API permissions
