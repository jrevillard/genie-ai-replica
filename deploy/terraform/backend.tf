# Remote state — S3 bucket provisioned by the project owner (Hank).
# Native S3 state locking (use_lockfile) needs Terraform >= 1.10 (local is 1.13).
terraform {
  backend "s3" {
    bucket       = "innov8ai-asante-state"
    key          = "genie-ai/dev/terraform.tfstate"
    region       = "us-east-1"
    profile      = "healthbot-dev" # backends can't read var.aws_profile; pin it here (CI overrides)
    encrypt      = true
    use_lockfile = true
  }
}
