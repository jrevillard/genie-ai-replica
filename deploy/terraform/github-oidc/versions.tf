# Version constraints for the GitHub OIDC stack.
terraform {
  # >= 1.10 is a hard floor, not a preference: backend.tf uses native S3 state
  # locking (use_lockfile), which older versions silently do not support.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    # Used only to read GitHub's OIDC endpoint certificate chain so the provider
    # thumbprint is derived rather than hardcoded. See main.tf.
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}
