variable "region" {
  description = "AWS region holding the deploy target and the artifacts bucket."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = <<-EOT
    Local AWS profile. Leave empty (the default) to use the ambient credential
    chain — required in CI, where credentials arrive via OIDC and no profile
    exists. Empty is converted to null in providers.tf.
  EOT
  type        = string
  default     = ""
}

variable "name_prefix" {
  description = "Resource name prefix, matching the workload stack."
  type        = string
  default     = "healthbot-dev"
}

variable "github_repo" {
  description = <<-EOT
    GitHub repository in owner/name form. Must match the real repository EXACTLY,
    including capitalisation: OIDC `sub` claims are compared case-sensitively, so
    "innov8ai-dev/asante" would silently never match.
  EOT
  type        = string
  default     = "Innov8AI-dev/ASante"
}

variable "github_org_id" {
  description = <<-EOT
    Numeric GitHub organisation ID.

    This org has IMMUTABLE (ID-based) OIDC subject claims enabled, so GitHub emits
      repo:<org>@<org_id>/<repo>@<repo_id>:environment:<env>
    rather than the familiar repo:<org>/<repo>:environment:<env>. The IDs make the
    claim survive an org or repo rename, and prevent a deleted-then-re-registered
    name from inheriting trust.

    Confirmed from the actual rejected claim in CloudTrail
    (AssumeRoleWithWebIdentity, userIdentity.userName), not inferred.

    If a deploy ever fails with "Not authorized to perform
    sts:AssumeRoleWithWebIdentity", look up that same CloudTrail field to see the
    exact subject GitHub presented and compare it against `trusted_subjects`.
  EOT
  type        = string
  default     = "311533184"
}

variable "github_repo_id" {
  description = "Numeric GitHub repository ID. See github_org_id for why this is needed."
  type        = string
  default     = "1318648830"
}

variable "extra_trusted_subjects" {
  description = <<-EOT
    Additional OIDC subjects to trust verbatim, beyond the generated ID-based ones.

    Left empty on purpose. The legacy name-based form
    ("repo:Innov8AI-dev/ASante:environment:dev") would be the value to add here if
    the org ever turns immutable claims OFF — but adding it permanently reinstates
    exactly the rename-hijack exposure that immutable claims exist to remove, so it
    should be a deliberate, temporary choice rather than a default.
  EOT
  type        = list(string)
  default     = []
}

variable "github_environments" {
  description = <<-EOT
    GitHub Environment names permitted to assume the deploy role.

    The trust policy keys on the `environment:` subject rather than `ref:` on
    purpose. Deploys must be possible from ANY branch (docs/ci-cd-plan.md §3.2),
    and a ref-based condition broad enough to allow that would be a wildcard over
    the whole repo. The environment claim is stable across branches.

    Consequence: any job assuming this role MUST declare `environment: dev`, or
    the claim is absent and AssumeRoleWithWebIdentity fails.
  EOT
  type        = list(string)
  default     = ["dev"]
}

variable "artifacts_bucket" {
  description = "S3 bucket the deploy workflow publishes application artifacts to."
  type        = string
  default     = "healthbot-dev-artifacts-310997740503"
}

variable "deploy_target_name_tag" {
  description = <<-EOT
    Value of the `Name` tag on the instance the deploy role may target with SSM
    RunCommand. Scoping by tag rather than by instance ARN keeps this stack free of
    any dependency on the workload stack's state, and keeps working if the
    instance is ever rebuilt with a new ID.
  EOT
  type        = string
  default     = "healthbot-dev-app"
}

variable "tags" {
  description = "Tags applied to created resources."
  type        = map(string)
  default = {
    Project   = "genie-ai"
    ManagedBy = "terraform"
    Stack     = "github-oidc"
  }
}
