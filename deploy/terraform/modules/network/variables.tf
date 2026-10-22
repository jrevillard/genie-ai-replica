variable "name_prefix" { type = string }
variable "vpc_cidr" { type = string }
variable "azs" { type = list(string) }
variable "public_subnet_cidrs" { type = list(string) }
variable "private_subnet_cidrs" { type = list(string) }
variable "allowed_ingress_cidrs" { type = list(string) }
variable "app_port" { type = number }
variable "tags" {
  type    = map(string)
  default = {}
}
