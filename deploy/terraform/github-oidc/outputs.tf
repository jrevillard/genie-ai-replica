output "deploy_role_arn" {
  description = "Set this as the AWS_DEPLOY_ROLE_ARN repository variable (or paste into deploy-app.yml)."
  value       = aws_iam_role.deploy.arn
}

output "oidc_provider_arn" {
  description = "GitHub OIDC provider ARN. Reuse this if another stack ever needs it — only one per account is allowed."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "trusted_subjects" {
  description = <<-EOT
    Exact OIDC subject claims permitted to assume the role. A job whose claim is not
    listed here cannot authenticate. To debug a rejection, compare these against
    userIdentity.userName on the failed AssumeRoleWithWebIdentity event in CloudTrail.
  EOT
  value       = local.trusted_subjects
}
