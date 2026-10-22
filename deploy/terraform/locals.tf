locals {
  name_prefix = "${var.project}-${var.environment}" # e.g. healthbot-dev
  ssm_prefix  = "/${var.project}-${var.environment}"
  app_url     = "https://${var.domain_name}"

  # Two AZs (ALB + RDS/ElastiCache subnet groups require >= 2).
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  public_subnet_cidrs  = [cidrsubnet(var.vpc_cidr, 8, 0), cidrsubnet(var.vpc_cidr, 8, 1)]
  private_subnet_cidrs = [cidrsubnet(var.vpc_cidr, 8, 10), cidrsubnet(var.vpc_cidr, 8, 11)]

  # GPU AMI: explicit override, or auto-selected Deep Learning Base GPU AMI.
  gpu_ami_id = var.gpu_ami_id != "" ? var.gpu_ami_id : data.aws_ami.gpu[0].id

  common_tags = merge({
    Project     = var.project
    Environment = var.environment
    Application = "genie-ai"
    ManagedBy   = "terraform"
  }, var.tags)
}
