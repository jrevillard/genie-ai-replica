# =============================================================================
# GENIE.AI "HealthBOT" — AWS dev environment (Option 1: single-node Docker Swarm)
# Provisions infra; user_data hands off to the existing Ansible playbook.
# See docs/aws-dev-deployment-plan.md and docs/aws-orchestration-decision.md.
# =============================================================================

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# HuggingFace token secret (provisioned by the project owner). We read only its
# metadata (ARN) here — the token value is fetched by the instance at runtime.
data "aws_secretsmanager_secret" "hf" {
  name = var.hf_secret_id
}

# Latest AWS Deep Learning Base GPU AMI (ships NVIDIA drivers — the Ansible only
# installs the container toolkit, not the driver itself).
data "aws_ami" "gpu" {
  count       = var.gpu_ami_id == "" ? 1 : 0
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04)*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

module "network" {
  source = "./modules/network"

  name_prefix           = local.name_prefix
  vpc_cidr              = var.vpc_cidr
  azs                   = local.azs
  public_subnet_cidrs   = local.public_subnet_cidrs
  private_subnet_cidrs  = local.private_subnet_cidrs
  allowed_ingress_cidrs = var.allowed_ingress_cidrs
  app_port              = var.app_port
  tags                  = local.common_tags
}

module "secrets" {
  source = "./modules/secrets"

  ssm_prefix        = local.ssm_prefix
  genie_admin_email = var.genie_admin_email
  tags              = local.common_tags
}

module "data" {
  source = "./modules/data"

  enabled                    = var.data_backend == "external"
  name_prefix                = local.name_prefix
  private_subnet_ids         = module.network.private_subnet_ids
  rds_sg_id                  = module.network.rds_sg_id
  redis_sg_id                = module.network.redis_sg_id
  rds_engine_version         = var.rds_engine_version
  rds_instance_class         = var.rds_instance_class
  rds_allocated_storage      = var.rds_allocated_storage
  rds_master_username        = var.rds_master_username
  rds_master_password        = module.secrets.postgres_master_password
  elasticache_node_type      = var.elasticache_node_type
  elasticache_engine_version = var.elasticache_engine_version
  redis_auth_enabled         = var.redis_auth_enabled
  redis_auth_token           = module.secrets.translation_cache_password
  tags                       = local.common_tags
}

module "dns_tls" {
  source = "./modules/dns_tls"

  domain_name         = var.domain_name
  create_route53_zone = var.create_route53_zone
  route53_zone_name   = var.route53_zone_name
  tags                = local.common_tags
}

module "compute" {
  source = "./modules/compute"

  name_prefix    = local.name_prefix
  region         = var.region
  ami_id         = local.gpu_ami_id
  instance_type     = var.instance_type
  subnet_id         = module.network.public_subnet_ids[0]
  availability_zone = local.azs[0] # matches public_subnet_ids[0]'s AZ
  ec2_sg_id         = module.network.ec2_sg_id
  root_volume_gb = var.root_volume_gb
  data_volume_gb = var.data_volume_gb
  ssm_prefix     = local.ssm_prefix
  hf_secret_id   = var.hf_secret_id
  hf_secret_arn  = data.aws_secretsmanager_secret.hf.arn

  # app wiring
  data_backend         = var.data_backend
  domain_name          = var.domain_name
  app_port             = var.app_port
  rds_host             = module.data.rds_address
  rds_port             = module.data.rds_port
  redis_host           = module.data.redis_primary_endpoint
  redis_port           = module.data.redis_port
  redis_auth_enabled   = var.redis_auth_enabled
  llm_model_id         = var.llm_model_id
  vllm_gpu_utilization = var.vllm_gpu_utilization
  vllm_max_model_len   = var.vllm_max_model_len
  translation_model_id = var.translation_model_id
  embedding_model_id   = var.embedding_model_id
  reranker_model_id    = var.reranker_model_id
  app_s3_bucket        = aws_s3_bucket.artifacts.id
  app_s3_key           = aws_s3_object.app.key

  tags = local.common_tags
}

module "alb" {
  source = "./modules/alb"

  name_prefix       = local.name_prefix
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  alb_sg_id         = module.network.alb_sg_id
  instance_id       = module.compute.instance_id
  app_port          = var.app_port
  health_check_path = var.health_check_path
  certificate_arn   = module.dns_tls.certificate_arn
  domain_name       = var.domain_name
  zone_id           = module.dns_tls.zone_id
  tags              = local.common_tags
}

module "scheduler" {
  source = "./modules/scheduler"

  name_prefix = local.name_prefix
  enabled     = var.enable_scheduler
  instance_id = module.compute.instance_id
  region      = var.region
  timezone    = var.scheduler_timezone
  start_cron  = var.scheduler_start_cron
  stop_cron   = var.scheduler_stop_cron
  tags        = local.common_tags
}
