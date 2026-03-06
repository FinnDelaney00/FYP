moved {
  from = aws_iam_role.dms_secrets_access
  to   = aws_iam_role.dms_secrets_access[0]
}

moved {
  from = aws_iam_role_policy.dms_secrets_access
  to   = aws_iam_role_policy.dms_secrets_access[0]
}

moved {
  from = aws_iam_role.dms_kinesis_target
  to   = aws_iam_role.dms_kinesis_target[0]
}

moved {
  from = aws_iam_role_policy.dms_kinesis_target
  to   = aws_iam_role_policy.dms_kinesis_target[0]
}

moved {
  from = aws_iam_role_policy_attachment.dms_vpc_management
  to   = aws_iam_role_policy_attachment.dms_vpc_management[0]
}

moved {
  from = aws_iam_role.dms_vpc
  to   = aws_iam_role.dms_vpc[0]
}

moved {
  from = aws_iam_role_policy_attachment.dms_vpc_role_management
  to   = aws_iam_role_policy_attachment.dms_vpc_role_management[0]
}

moved {
  from = aws_iam_role.firehose
  to   = aws_iam_role.firehose[0]
}

moved {
  from = aws_iam_role_policy.firehose_kinesis
  to   = aws_iam_role_policy.firehose_kinesis[0]
}

moved {
  from = aws_iam_role_policy_attachment.firehose_kinesis
  to   = aws_iam_role_policy_attachment.firehose_kinesis[0]
}

moved {
  from = aws_iam_policy.firehose_kinesis
  to   = aws_iam_policy.firehose_kinesis[0]
}

moved {
  from = aws_iam_role_policy.firehose_s3
  to   = aws_iam_role_policy.firehose_s3[0]
}

moved {
  from = aws_iam_role_policy_attachment.firehose_s3
  to   = aws_iam_role_policy_attachment.firehose_s3[0]
}

moved {
  from = aws_iam_policy.firehose_s3
  to   = aws_iam_policy.firehose_s3[0]
}

moved {
  from = aws_iam_role_policy.firehose_cloudwatch
  to   = aws_iam_role_policy.firehose_cloudwatch[0]
}

moved {
  from = aws_iam_role.lambda_transform
  to   = aws_iam_role.lambda_transform[0]
}

moved {
  from = aws_iam_role_policy.lambda_transform_s3
  to   = aws_iam_role_policy.lambda_transform_s3[0]
}

moved {
  from = aws_iam_role_policy_attachment.lambda_transform_basic
  to   = aws_iam_role_policy_attachment.lambda_transform_basic[0]
}

moved {
  from = aws_iam_role.lambda_ml
  to   = aws_iam_role.lambda_ml[0]
}

moved {
  from = aws_iam_role_policy.lambda_ml_s3
  to   = aws_iam_role_policy.lambda_ml_s3[0]
}

moved {
  from = aws_iam_role_policy_attachment.lambda_ml_basic
  to   = aws_iam_role_policy_attachment.lambda_ml_basic[0]
}

moved {
  from = aws_iam_role.glue_crawler
  to   = aws_iam_role.glue_crawler[0]
}

moved {
  from = aws_iam_role_policy_attachment.glue_service
  to   = aws_iam_role_policy_attachment.glue_service[0]
}

moved {
  from = aws_iam_role_policy.glue_crawler_s3
  to   = aws_iam_role_policy.glue_crawler_s3[0]
}

moved {
  from = aws_iam_role.lambda_live_api
  to   = aws_iam_role.lambda_live_api[0]
}

moved {
  from = aws_iam_role_policy.lambda_live_api_s3
  to   = aws_iam_role_policy.lambda_live_api_s3[0]
}

moved {
  from = aws_iam_role_policy_attachment.lambda_live_api_basic
  to   = aws_iam_role_policy_attachment.lambda_live_api_basic[0]
}
