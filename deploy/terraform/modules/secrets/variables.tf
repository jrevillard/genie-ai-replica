variable "ssm_prefix" { type = string }
variable "genie_admin_email" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
