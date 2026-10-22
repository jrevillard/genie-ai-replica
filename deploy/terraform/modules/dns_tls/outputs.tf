output "zone_id" {
  value = local.zone_id
}

output "certificate_arn" {
  description = "Validated ACM certificate ARN for the ALB HTTPS listener."
  value       = aws_acm_certificate_validation.this.certificate_arn
}

output "name_servers" {
  description = "NS records to delegate at the parent registrar (only when a zone was created)."
  value       = var.create_route53_zone ? aws_route53_zone.this[0].name_servers : null
}
