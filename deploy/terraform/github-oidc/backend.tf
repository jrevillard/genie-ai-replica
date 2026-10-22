# Remote state — same bucket as the main stack, DIFFERENT key.
#
# This stack is deliberately separate from ../ (the workload stack). Because
# aws_instance is not in this state, applying this stack cannot replace, stop, or
# recreate the GPU box — the "never request a new machine" constraint
# (docs/ci-cd-plan.md §3.2) becomes structural rather than a promise.
#
# NOTE: no `profile` here, unlike ../backend.tf which pins healthbot-dev. The
# backend picks up the standard AWS credential chain instead, so the same config
# works from a laptop (export AWS_PROFILE=healthbot-dev) and from CI (OIDC
# credentials in the environment) with no override flags. See §3.6 option B.
terraform {
  backend "s3" {
    bucket       = "innov8ai-asante-state"
    key          = "genie-ai/github-oidc/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
