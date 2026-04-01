resource "terraform_data" "ml_dependencies_build" {
  triggers_replace = {
    requirements_hash = join(
      ",",
      [
        for file_name in fileset("${path.module}/layers/ml", "**") :
        "${file_name}:${filesha256("${path.module}/layers/ml/${file_name}")}"
      ]
    )
    script_hash = filesha256("${path.module}/scripts/package_python_layer.py")
  }

  provisioner "local-exec" {
    working_dir = path.module
    command     = "python scripts/package_python_layer.py --requirements layers/ml/requirements.txt --output-dir build/ml_layer --platform manylinux2014_x86_64 --implementation cp --python-version 3.11"
  }
}

data "archive_file" "ml_dependencies_layer" {
  depends_on  = [terraform_data.ml_dependencies_build]
  type        = "zip"
  source_dir  = "${path.module}/build/ml_layer"
  output_path = "${path.module}/layers/ml_dependencies.zip"
}

resource "aws_s3_object" "ml_dependencies_layer" {
  bucket = aws_s3_bucket.data_lake.id
  key    = "deployment-artifacts/layers/${local.name_prefix}/ml_dependencies.zip"
  source = data.archive_file.ml_dependencies_layer.output_path
  etag   = filemd5(data.archive_file.ml_dependencies_layer.output_path)
}

resource "aws_lambda_layer_version" "ml_dependencies" {
  s3_bucket                = aws_s3_object.ml_dependencies_layer.bucket
  s3_key                   = aws_s3_object.ml_dependencies_layer.key
  s3_object_version        = aws_s3_object.ml_dependencies_layer.version_id
  layer_name               = "${local.name_prefix}-ml-dependencies"
  source_code_hash         = data.archive_file.ml_dependencies_layer.output_base64sha256
  compatible_runtimes      = ["python3.11"]
  compatible_architectures = ["x86_64"]

  description = "Shared ML dependencies for forecasting and anomaly Lambdas"
}
