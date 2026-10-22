variable "name_prefix" { type = string }
variable "region" { type = string }
variable "ami_id" { type = string }
variable "instance_type" { type = string }
variable "subnet_id" { type = string }
variable "availability_zone" { type = string } # stable AZ for the data volume (decoupled from the instance)
variable "ec2_sg_id" { type = string }
variable "root_volume_gb" { type = number }
variable "data_volume_gb" { type = number }
variable "ssm_prefix" { type = string }
variable "hf_secret_id" { type = string }
variable "hf_secret_arn" { type = string }

# App wiring
variable "data_backend" { type = string }
variable "domain_name" { type = string }
variable "app_port" { type = number }
variable "rds_host" { type = string }
variable "rds_port" { type = number }
variable "redis_host" { type = string }
variable "redis_port" { type = number }
variable "redis_auth_enabled" { type = bool }
variable "llm_model_id" { type = string }
variable "vllm_gpu_utilization" { type = string }
variable "vllm_max_model_len" { type = string }
variable "translation_model_id" { type = string }
variable "embedding_model_id" { type = string }
variable "reranker_model_id" { type = string }
variable "app_s3_bucket" { type = string }
variable "app_s3_key" { type = string }

variable "tags" {
  type    = map(string)
  default = {}
}
