output "postgres_master_password" {
  description = "RDS master password (also POSTGRES_PASSWORD for postgres-init)."
  value       = random_password.this["postgres_password"].result
  sensitive   = true
}

output "translation_cache_password" {
  description = "Redis password / ElastiCache AUTH token when auth is enabled."
  value       = random_password.this["translation_cache_password"].result
  sensitive   = true
}

output "ssm_prefix" {
  value = var.ssm_prefix
}
