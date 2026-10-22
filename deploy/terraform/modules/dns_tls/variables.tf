variable "domain_name" { type = string }
variable "create_route53_zone" { type = bool }
variable "route53_zone_name" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
