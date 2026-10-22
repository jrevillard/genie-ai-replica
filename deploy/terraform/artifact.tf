# =============================================================================
# Application code delivery via S3 (instead of git clone on the instance).
# Terraform zips the working tree — INCLUDING uncommitted local changes — uploads
# it to a private S3 bucket, and the instance downloads + extracts it on boot.
# No git repo/token needed on the box; the exact local code is what deploys.
# Change the code -> new md5 -> new object key -> a replaced instance pulls it.
# =============================================================================

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${local.name_prefix}-artifacts-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
  tags          = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Zip the repo root. excludes are verified to recurse (no .git / .terraform / etc).
data "archive_file" "app" {
  type        = "zip"
  source_dir  = "${path.module}/../.."
  output_path = "${path.module}/.artifacts/genie-ai.zip"

  excludes = [
    ".git", "node_modules", "deploy/terraform",
    "mobile", "_bmad", "_bmad-output", "docs", "tests", "test-results",
    "secrets", ".idea", ".ruff_cache", ".env",
  ]
}

resource "aws_s3_object" "app" {
  bucket = aws_s3_bucket.artifacts.id
  key    = "genie-ai-${data.archive_file.app.output_md5}.zip"
  source = data.archive_file.app.output_path
  # source_hash (not etag) — avoids the perpetual diff etag=md5 causes for multipart uploads.
  source_hash = data.archive_file.app.output_base64sha256
  tags        = local.common_tags
}
