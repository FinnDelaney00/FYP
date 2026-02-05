# Required IAM Permissions for SmartStream Deployment

## Current Issue

Your AWS user (`arn:aws:iam::378192010843:user/C22392083`) is missing the `ec2:DescribeAvailabilityZones` permission.

## Workaround Applied

I've **hardcoded the availability zones** for `eu-north-1` in the Terraform code, so you no longer need the `ec2:DescribeAvailabilityZones` permission for this specific deployment.

**If you deploy to a different region**, you'll need to update the `availability_zones` list in `networking.tf`.

## Full List of Required IAM Permissions

For a complete deployment of the SmartStream pipeline, your IAM user/role needs the following permissions:

### EC2/VPC (Networking)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateVpc",
        "ec2:DeleteVpc",
        "ec2:DescribeVpcs",
        "ec2:ModifyVpcAttribute",
        "ec2:CreateSubnet",
        "ec2:DeleteSubnet",
        "ec2:DescribeSubnets",
        "ec2:CreateInternetGateway",
        "ec2:DeleteInternetGateway",
        "ec2:AttachInternetGateway",
        "ec2:DetachInternetGateway",
        "ec2:DescribeInternetGateways",
        "ec2:CreateNatGateway",
        "ec2:DeleteNatGateway",
        "ec2:DescribeNatGateways",
        "ec2:AllocateAddress",
        "ec2:ReleaseAddress",
        "ec2:DescribeAddresses",
        "ec2:CreateRouteTable",
        "ec2:DeleteRouteTable",
        "ec2:DescribeRouteTables",
        "ec2:CreateRoute",
        "ec2:DeleteRoute",
        "ec2:AssociateRouteTable",
        "ec2:DisassociateRouteTable",
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:DescribeSecurityGroups",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:CreateVpcEndpoint",
        "ec2:DeleteVpcEndpoint",
        "ec2:DescribeVpcEndpoints",
        "ec2:ModifyVpcEndpoint",
        "ec2:CreateTags",
        "ec2:DeleteTags",
        "ec2:DescribeTags"
      ],
      "Resource": "*"
    }
  ]
}
```

### RDS (PostgreSQL Database)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rds:CreateDBInstance",
        "rds:DeleteDBInstance",
        "rds:DescribeDBInstances",
        "rds:ModifyDBInstance",
        "rds:CreateDBSubnetGroup",
        "rds:DeleteDBSubnetGroup",
        "rds:DescribeDBSubnetGroups",
        "rds:CreateDBParameterGroup",
        "rds:DeleteDBParameterGroup",
        "rds:DescribeDBParameterGroups",
        "rds:ModifyDBParameterGroup",
        "rds:AddTagsToResource",
        "rds:RemoveTagsFromResource",
        "rds:ListTagsForResource"
      ],
      "Resource": "*"
    }
  ]
}
```

### DMS (Database Migration Service)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dms:CreateReplicationInstance",
        "dms:DeleteReplicationInstance",
        "dms:DescribeReplicationInstances",
        "dms:ModifyReplicationInstance",
        "dms:CreateReplicationSubnetGroup",
        "dms:DeleteReplicationSubnetGroup",
        "dms:DescribeReplicationSubnetGroups",
        "dms:CreateEndpoint",
        "dms:DeleteEndpoint",
        "dms:DescribeEndpoints",
        "dms:ModifyEndpoint",
        "dms:TestConnection",
        "dms:CreateReplicationTask",
        "dms:DeleteReplicationTask",
        "dms:DescribeReplicationTasks",
        "dms:ModifyReplicationTask",
        "dms:StartReplicationTask",
        "dms:StopReplicationTask",
        "dms:AddTagsToResource",
        "dms:RemoveTagsFromResource",
        "dms:ListTagsForResource"
      ],
      "Resource": "*"
    }
  ]
}
```

### Kinesis (Data Streams & Firehose)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kinesis:CreateStream",
        "kinesis:DeleteStream",
        "kinesis:DescribeStream",
        "kinesis:DescribeStreamSummary",
        "kinesis:ListStreams",
        "kinesis:UpdateShardCount",
        "kinesis:AddTagsToStream",
        "kinesis:RemoveTagsFromStream",
        "kinesis:ListTagsForStream",
        "firehose:CreateDeliveryStream",
        "firehose:DeleteDeliveryStream",
        "firehose:DescribeDeliveryStream",
        "firehose:UpdateDestination",
        "firehose:TagDeliveryStream",
        "firehose:UntagDeliveryStream",
        "firehose:ListTagsForDeliveryStream"
      ],
      "Resource": "*"
    }
  ]
}
```

### S3 (Data Lake & Athena Results)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning",
        "s3:GetBucketPublicAccessBlock",
        "s3:PutBucketPublicAccessBlock",
        "s3:GetEncryptionConfiguration",
        "s3:PutEncryptionConfiguration",
        "s3:GetLifecycleConfiguration",
        "s3:PutLifecycleConfiguration",
        "s3:PutBucketNotification",
        "s3:GetBucketNotification",
        "s3:PutBucketTagging",
        "s3:GetBucketTagging",
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "*"
    }
  ]
}
```

### Lambda (Transform & ML Functions)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:GetPolicy",
        "lambda:InvokeFunction",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:ListTags"
      ],
      "Resource": "*"
    }
  ]
}
```

### IAM (Role & Policy Management)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:UpdateRole",
        "iam:PassRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:CreatePolicy",
        "iam:DeletePolicy",
        "iam:GetPolicy",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:TagPolicy",
        "iam:UntagPolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

### Glue (Data Catalog & Crawlers)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "glue:CreateDatabase",
        "glue:DeleteDatabase",
        "glue:GetDatabase",
        "glue:UpdateDatabase",
        "glue:CreateCrawler",
        "glue:DeleteCrawler",
        "glue:GetCrawler",
        "glue:UpdateCrawler",
        "glue:StartCrawler",
        "glue:StopCrawler",
        "glue:GetTables",
        "glue:TagResource",
        "glue:UntagResource"
      ],
      "Resource": "*"
    }
  ]
}
```

### Athena (Query Workgroup)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "athena:CreateWorkGroup",
        "athena:DeleteWorkGroup",
        "athena:GetWorkGroup",
        "athena:UpdateWorkGroup",
        "athena:CreateNamedQuery",
        "athena:DeleteNamedQuery",
        "athena:GetNamedQuery",
        "athena:TagResource",
        "athena:UntagResource"
      ],
      "Resource": "*"
    }
  ]
}
```

### CloudWatch (Logs, Alarms, Dashboard)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:DescribeLogGroups",
        "logs:PutRetentionPolicy",
        "logs:CreateLogStream",
        "logs:DeleteLogStream",
        "logs:PutMetricFilter",
        "logs:DeleteMetricFilter",
        "logs:TagLogGroup",
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:DeleteAlarms",
        "cloudwatch:DescribeAlarms",
        "cloudwatch:PutCompositeAlarm",
        "cloudwatch:PutDashboard",
        "cloudwatch:DeleteDashboards",
        "cloudwatch:GetDashboard"
      ],
      "Resource": "*"
    }
  ]
}
```

### EventBridge (Lambda Scheduling)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:DeleteRule",
        "events:DescribeRule",
        "events:PutTargets",
        "events:RemoveTargets",
        "events:ListTargetsByRule",
        "events:TagResource",
        "events:UntagResource"
      ],
      "Resource": "*"
    }
  ]
}
```

### Secrets Manager (RDS Credentials)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:DeleteSecret",
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "secretsmanager:UpdateSecret",
        "secretsmanager:TagResource",
        "secretsmanager:UntagResource"
      ],
      "Resource": "*"
    }
  ]
}
```

### SNS (Alerts)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:DeleteTopic",
        "sns:GetTopicAttributes",
        "sns:SetTopicAttributes",
        "sns:Subscribe",
        "sns:Unsubscribe",
        "sns:TagResource",
        "sns:UntagResource"
      ],
      "Resource": "*"
    }
  ]
}
```

### KMS (Optional - if using KMS encryption)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kms:DescribeKey",
        "kms:ListAliases"
      ],
      "Resource": "*"
    }
  ]
}
```

## Simplified Option: Use AWS Managed Policies

Instead of creating custom policies, you can request attachment of these AWS-managed policies:

1. **AdministratorAccess** (full access - easiest for testing)
2. **PowerUserAccess** (almost full access, but can't manage IAM)

Or combine these managed policies for more granular control:
- `AmazonVPCFullAccess`
- `AmazonRDSFullAccess`
- `AWSGlueConsoleFullAccess`
- `AmazonAthenaFullAccess`
- `AmazonKinesisFullAccess`
- `AmazonS3FullAccess`
- `AWSLambda_FullAccess`
- `CloudWatchFullAccess`
- Plus custom policy for DMS, IAM, Secrets Manager

## How to Request Permissions

**Option 1: Contact your AWS administrator**
```
Subject: IAM Permissions Request for SmartStream Deployment

Hi [Admin Name],

I need additional IAM permissions to deploy the SmartStream data pipeline using Terraform.

Please grant my user (arn:aws:iam::378192010843:user/C22392083) the following:
- PowerUserAccess managed policy (recommended for development)

OR attach the individual service policies listed in the attached IAM_PERMISSIONS.md file.

This is needed to deploy: VPC, RDS, DMS, Kinesis, Firehose, Lambda, Glue, Athena, S3, CloudWatch, and associated IAM roles.

Thank you!
```

**Option 2: If you have console access**
1. Go to IAM Console → Users → C22392083
2. Click "Add permissions"
3. Attach policies (search for "PowerUserAccess" or individual service policies)

## Testing Your Permissions

After getting new permissions, test with:
```bash
# Test EC2 permissions
aws ec2 describe-availability-zones --region eu-north-1

# Test S3 permissions
aws s3 ls

# Test IAM permissions
aws iam get-user

# Test Lambda permissions
aws lambda list-functions --region eu-north-1
```

## Current Workaround Status

✅ **Fixed**: Availability Zones are now hardcoded for `eu-north-1`
✅ **Fixed**: S3 lifecycle configuration syntax corrected

You can now run `terraform apply` with your current permissions, but you may encounter additional permission errors for other services during deployment.

---

**Next Steps:**
1. Request the necessary IAM permissions from your AWS administrator
2. Re-run `terraform apply` once permissions are granted
3. Or proceed with current permissions and address permission errors as they arise
