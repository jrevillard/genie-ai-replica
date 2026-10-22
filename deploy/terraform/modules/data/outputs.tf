# Empty/default when disabled (embedded mode) so downstream wiring stays simple.
output "rds_address" {
  description = "RDS PostgreSQL hostname (empty in embedded mode)."
  value       = try(aws_db_instance.postgres[0].address, "")
}

output "rds_port" {
  value = try(aws_db_instance.postgres[0].port, 5432)
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis primary endpoint (empty in embedded mode)."
  value       = try(aws_elasticache_replication_group.redis[0].primary_endpoint_address, "")
}

output "redis_port" {
  value = try(aws_elasticache_replication_group.redis[0].port, 6379)
}
