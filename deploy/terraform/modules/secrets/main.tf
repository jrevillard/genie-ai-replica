# Generates the stack's secrets and stores them in SSM Parameter Store. The last
# path segment of each parameter name equals the Ansible variable name, so the
# instance bootstrap can materialize them straight into group_vars/<env>/vault.yml.

locals {
  # Names match the Ansible vault variable names the playbook expects.
  secret_names = [
    "arango_password",
    "session_secret",
    "translation_cache_password",
    "postgres_password",
    "kong_db_password",
    "keycloak_admin_password",
    "genie_admin_password",
    "keycloak_db_password",
    "keycloak_client_secret",
    "keycloak_proxy_client_secret",
    "kc_dataprep_client_secret",
    "jwt_secret", # shared inter-service/legacy JWT signing key (avoids the app's hardcoded default)
  ]
}

resource "random_password" "this" {
  for_each = toset(local.secret_names)
  length   = 28
  special  = true
  # Avoid characters that break RDS master passwords / URIs / shell heredocs.
  override_special = "-_.!"
}

# Secret parameters (SecureString).
resource "aws_ssm_parameter" "secret" {
  for_each = random_password.this
  name     = "${var.ssm_prefix}/${each.key}"
  type     = "SecureString"
  value    = each.value.result
  tags     = var.tags
}

# Externally-supplied secrets.
# Non-secret but stack-required.
resource "aws_ssm_parameter" "genie_admin_email" {
  name  = "${var.ssm_prefix}/genie_admin_email"
  type  = "String"
  value = var.genie_admin_email != "" ? var.genie_admin_email : "admin@example.com"
  tags  = var.tags
}
