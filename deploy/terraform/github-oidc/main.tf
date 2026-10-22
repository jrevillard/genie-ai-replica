# =============================================================================
# GitHub Actions -> AWS access for the application deploy workflow.
#
# Grants .github/workflows/deploy-app.yml exactly enough to:
#   1. publish an application artifact to the artifacts bucket, and
#   2. run deploy/scripts/redeploy.sh on the EXISTING instance over SSM.
#
# It cannot create, replace, stop or terminate an EC2 instance. That is the point:
# docs/ci-cd-plan.md §3.2 makes "never request a new machine" a hard constraint, so
# the deploy credential is built to be incapable of it rather than merely
# uninterested. Terraform applies use a separate role (not created here) so
# provisioning rights and deploy rights never share one credential.
# =============================================================================

data "aws_caller_identity" "current" {}

locals {
  # Immutable, ID-based subject claims. See var.github_org_id for the format and
  # for how this was confirmed against a real rejected request.
  #   repo:<org>@<org_id>/<repo>@<repo_id>:environment:<env>
  org_name  = split("/", var.github_repo)[0]
  repo_name = split("/", var.github_repo)[1]

  trusted_subjects = concat(
    [
      for env in var.github_environments :
      "repo:${local.org_name}@${var.github_org_id}/${local.repo_name}@${var.github_repo_id}:environment:${env}"
    ],
    var.extra_trusted_subjects,
  )
}

# GitHub's OIDC endpoint certificate chain. Read dynamically so the thumbprint is
# never a hardcoded fingerprint that silently rots when GitHub rotates certs.
#
# AWS validates well-known IdPs against its own trust store and effectively
# ignores this value for GitHub, but the provider still requires the argument.
data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# One per AWS account. Verified absent in 310997740503 before writing this — if
# another stack ever creates it first, import rather than duplicating:
#   terraform import aws_iam_openid_connect_provider.github <arn>
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [for cert in data.tls_certificate.github.certificates : cert.sha1_fingerprint]
  tags            = var.tags
}

# --- Trust policy ------------------------------------------------------------
data "aws_iam_policy_document" "assume" {
  statement {
    sid     = "GitHubOIDC"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    # Without the aud check the role would trust tokens minted for other
    # audiences; this is the standard guard and is not optional.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # StringEquals (not StringLike) against a fixed list — no wildcards, so only
    # the named repo AND a job declaring one of these environments can assume.
    # See var.github_environments for why this keys on environment, not ref, and
    # var.github_org_id for why the subjects embed numeric IDs.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.trusted_subjects
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.name_prefix}-github-deploy"
  description        = "GitHub Actions app deploy: publish artifact + SSM RunCommand. No EC2 provisioning."
  assume_role_policy = data.aws_iam_policy_document.assume.json
  # 3600s is both the AWS minimum and the default. Stated explicitly so a later
  # edit has to be deliberate about widening it rather than inheriting a change.
  max_session_duration = 3600
  tags                 = var.tags
}

# --- Permissions -------------------------------------------------------------
data "aws_iam_policy_document" "deploy" {
  # Publish the application zip. Scoped to this one bucket.
  statement {
    sid    = "PublishArtifact"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:AbortMultipartUpload",
    ]
    resources = ["arn:aws:s3:::${var.artifacts_bucket}/*"]
  }

  # Needed for aws s3 cp/sync to resolve the bucket at all.
  statement {
    sid       = "ListArtifactBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = ["arn:aws:s3:::${var.artifacts_bucket}"]
  }

  # SendCommand authorises against BOTH the target instance and the document, so
  # both statements are required — a policy naming only one fails at runtime.
  #
  # The instance is selected by tag rather than by ARN so this stack needs no
  # reference to the workload stack's state, and keeps working across instance
  # rebuilds. resourceTag scoping means an instance without this exact Name tag
  # cannot be targeted even though the resource pattern is instance/*.
  statement {
    sid       = "SendCommandToTaggedInstance"
    effect    = "Allow"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ec2:${var.region}:${data.aws_caller_identity.current.account_id}:instance/*"]

    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/Name"
      values   = [var.deploy_target_name_tag]
    }
  }

  statement {
    sid       = "SendCommandDocument"
    effect    = "Allow"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ssm:${var.region}::document/AWS-RunShellScript"]
  }

  # Polling and pre-flight checks. These APIs do not support resource-level
  # permissions, so "*" is the only valid form — not an oversight.
  statement {
    sid    = "PollCommandAndInspectFleet"
    effect = "Allow"
    actions = [
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:ListCommands",
      "ssm:DescribeInstanceInformation",
      "ec2:DescribeInstances",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${var.name_prefix}-github-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
