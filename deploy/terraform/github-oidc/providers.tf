provider "aws" {
  region = var.region
  # An empty string is NOT a valid profile name — it must become null, or the
  # provider looks for a profile literally named "" and fails. This is what lets
  # CI run with TF_VAR_aws_profile unset while a laptop can still pin a profile.
  profile = var.aws_profile != "" ? var.aws_profile : null

  default_tags {
    tags = var.tags
  }
}
