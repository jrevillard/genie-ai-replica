variable "enabled" {
  description = "Create RDS + ElastiCache (external mode). When false, nothing is provisioned."
  type        = bool
  default     = true
}
variable "name_prefix" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "rds_sg_id" { type = string }
variable "redis_sg_id" { type = string }
variable "rds_engine_version" { type = string }
variable "rds_instance_class" { type = string }
variable "rds_allocated_storage" { type = number }
variable "rds_master_username" { type = string }
variable "rds_master_password" {
  type      = string
  sensitive = true
}
variable "elasticache_node_type" { type = string }
variable "elasticache_engine_version" { type = string }
variable "redis_auth_enabled" { type = bool }
variable "redis_auth_token" {
  type      = string
  sensitive = true
}
variable "tags" {
  type    = map(string)
  default = {}
}
