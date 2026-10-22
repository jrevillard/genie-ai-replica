# ACM certificate (DNS-validated) + the Route 53 zone that holds validation and
# app records. Two modes controlled by create_route53_zone (see root variable).

data "aws_route53_zone" "existing" {
  count        = var.create_route53_zone ? 0 : 1
  name         = var.route53_zone_name
  private_zone = false
}

resource "aws_route53_zone" "this" {
  count = var.create_route53_zone ? 1 : 0
  name  = var.domain_name
  tags  = var.tags
}

locals {
  zone_id = var.create_route53_zone ? aws_route53_zone.this[0].zone_id : data.aws_route53_zone.existing[0].zone_id
}

resource "aws_acm_certificate" "this" {
  domain_name       = var.domain_name
  validation_method = "DNS"
  tags              = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for dvo in aws_acm_certificate.this.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id         = local.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}
