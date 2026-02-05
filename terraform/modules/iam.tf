data "aws_iam_policy_document" "firehose_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["firehose.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "firehose_role" {
  name               = "${local.name_prefix}-firehose-role"
  assume_role_policy = data.aws_iam_policy_document.firehose_assume.json
}

data "aws_iam_policy_document" "firehose_policy" {
  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:PutObject"
    ]
    resources = [
      aws_s3_bucket.data_lake.arn,
      "${aws_s3_bucket.data_lake.arn}/*"
    ]
  }

  statement {
    actions   = ["kinesis:DescribeStream","kinesis:GetShardIterator","kinesis:GetRecords","kinesis:ListShards"]
    resources = [aws_kinesis_stream.cdc_stream.arn]
  }

  statement {
    actions   = ["logs:PutLogEvents"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "firehose_role_policy" {
  role   = aws_iam_role.firehose_role.id
  policy = data.aws_iam_policy_document.firehose_policy.json
}


resource "aws_iam_role" "dms_role" {
  name               = "${local.name_prefix}-dms-role"
  assume_role_policy = data.aws_iam_policy_document.dms_assume.json
}

data "aws_iam_policy_document" "dms_policy" {
  statement {
    actions   = ["kinesis:PutRecord","kinesis:PutRecords","kinesis:DescribeStream"]
    resources = [aws_kinesis_stream.cdc_stream.arn]
  }
  statement {
    actions   = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "dms_role_policy" {
  role   = aws_iam_role.dms_role.id
  policy = data.aws_iam_policy_document.dms_policy.json
}
