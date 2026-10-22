output "app_url" {
  description = "Public URL of the deployed app."
  value       = local.app_url
}

output "alb_dns_name" {
  description = "ALB DNS name (Route 53 alias points here)."
  value       = module.alb.alb_dns_name
}

output "route53_name_servers" {
  description = "If a new hosted zone was created, delegate the subdomain to these NS records at the parent registrar. Null when using an existing zone."
  value       = module.dns_tls.name_servers
}

output "instance_id" {
  description = "GPU EC2 instance id (use for SSM Session Manager)."
  value       = module.compute.instance_id
}

output "ssm_session_command" {
  description = "Open a shell on the instance (no SSH/port 22 needed)."
  value       = "aws ssm start-session --region ${var.region} --target ${module.compute.instance_id}"
}

output "rds_endpoint" {
  description = "RDS PostgreSQL address."
  value       = module.data.rds_address
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint."
  value       = module.data.redis_primary_endpoint
}

output "ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix holding generated secrets."
  value       = local.ssm_prefix
}
