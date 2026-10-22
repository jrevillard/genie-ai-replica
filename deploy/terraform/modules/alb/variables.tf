variable "name_prefix" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "alb_sg_id" { type = string }
variable "instance_id" { type = string }
variable "app_port" { type = number }
variable "health_check_path" { type = string }
variable "certificate_arn" { type = string }
variable "domain_name" { type = string }
variable "zone_id" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
