variable "name_prefix" { type = string }
variable "enabled" { type = bool }
variable "instance_id" { type = string }
variable "region" { type = string }
variable "timezone" { type = string }
variable "start_cron" { type = string }
variable "stop_cron" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
