# =============================================================================
# Root input variables — GENIE.AI "HealthBOT" AWS dev environment
# See terraform.tfvars.example for a ready-to-edit starting point.
# =============================================================================

# --- General -----------------------------------------------------------------
variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "Named AWS CLI profile for Terraform (pinned to healthbot-dev = account 310997740503; CI overrides with env creds/role)."
  type        = string
  default     = "healthbot-dev"
}

variable "data_backend" {
  description = <<-EOT
    Where PostgreSQL and Redis run:
      "embedded" = bundled postgres + redis-cache containers on the instance (all-in-one; simplest, start here)
      "external" = managed AWS RDS PostgreSQL + ElastiCache Redis (requires the SSL/AUTH fixes — see docs)
  EOT
  type        = string
  default     = "embedded"

  validation {
    condition     = contains(["embedded", "external"], var.data_backend)
    error_message = "data_backend must be \"embedded\" or \"external\"."
  }
}

variable "project" {
  description = "Short project slug used as a name prefix."
  type        = string
  default     = "healthbot"
}

variable "environment" {
  description = "Environment name."
  type        = string
  default     = "dev"
}

variable "tags" {
  description = "Extra tags merged into all resources."
  type        = map(string)
  default     = {}
}

# --- DNS / TLS ---------------------------------------------------------------
variable "domain_name" {
  description = "Public FQDN the app is served on."
  type        = string
  default     = "asante.innov8ai.com"
}

variable "create_route53_zone" {
  description = <<-EOT
    false = use an EXISTING Route 53 hosted zone (route53_zone_name) in this account
            and add records to it (works when innov8ai.com is already in Route 53).
    true  = CREATE a hosted zone for domain_name; you then delegate it from the parent
            registrar using the name servers in the `route53_name_servers` output.
  EOT
  type        = bool
  default     = false
}

variable "route53_zone_name" {
  description = "Existing hosted zone name to use when create_route53_zone = false."
  type        = string
  default     = "innov8ai.com"
}

# --- Networking / access -----------------------------------------------------
variable "vpc_cidr" {
  description = "VPC CIDR block."
  type        = string
  default     = "10.20.0.0/16"
}

variable "allowed_ingress_cidrs" {
  description = "CIDRs allowed to reach the ALB on 80/443. DEV DEFAULT IS OPEN — lock to stakeholder/office IPs for anything sensitive."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "app_port" {
  description = "Instance port the ALB forwards to. nginx serves HTTPS on 443 with a self-signed cert; the ALB re-encrypts to it (ALB does not validate the backend cert), so no app change is needed and there is no 80->443 redirect loop."
  type        = number
  default     = 443
}

variable "health_check_path" {
  description = "ALB target-group health check path."
  type        = string
  default     = "/api/health"
}

# --- Compute (GPU) -----------------------------------------------------------
variable "instance_type" {
  description = "GPU instance type. Default = Qwen-3B (B1). Use g6e.4xlarge for Llama-8B (B2)."
  type        = string
  default     = "g6e.2xlarge"
}

variable "gpu_ami_id" {
  description = "AMI id for the GPU instance. Empty = auto-select the latest AWS Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04). Only takes effect when the instance is created or replaced: the compute module sets ignore_changes = [ami], so changing this on a running instance plans no change. See modules/compute/main.tf."
  type        = string
  default     = ""
}

variable "root_volume_gb" {
  description = "Root EBS volume size (GB). Must be >= the Deep Learning AMI root snapshot (75 GB). 100 gives headroom; Docker/data live on the separate data volume."
  type        = number
  default     = 100
}

variable "data_volume_gb" {
  description = "Persistent data EBS volume (ArangoDB, HF model cache, uploads)."
  type        = number
  default     = 200
}

# --- Managed data services ---------------------------------------------------
variable "rds_engine_version" {
  description = "RDS PostgreSQL engine version (verify availability in-region)."
  type        = string
  default     = "15.8"
}

variable "rds_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.small"
}

variable "rds_allocated_storage" {
  description = "RDS allocated storage (GB)."
  type        = number
  default     = 20
}

variable "rds_master_username" {
  description = "RDS master username (also the stack's POSTGRES_USER for postgres-init)."
  type        = string
  default     = "genieai"
}

variable "elasticache_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "elasticache_engine_version" {
  description = "ElastiCache Redis engine version."
  type        = string
  default     = "7.1"
}

variable "redis_auth_enabled" {
  description = "External mode: enable ElastiCache AUTH + in-transit TLS (recommended — the backend requires a non-empty cache password under NODE_ENV=production, and the app enables Redis TLS via TRANSLATION_CACHE_TLS). Ignored in embedded mode."
  type        = bool
  default     = true
}

# --- Models (see docs/deployment-options.md) ---------------------------------
variable "llm_model_id" {
  description = "Chat LLM model id (Qwen-3B is ungated; Llama-8B is gated)."
  type        = string
  default     = "Qwen/Qwen2.5-3B-Instruct"
}

variable "vllm_gpu_utilization" {
  description = "vLLM GPU memory fraction."
  type        = string
  default     = "0.35"
}

variable "vllm_max_model_len" {
  description = "vLLM max context length. Must exceed the system prompt plus max output tokens — see the default below before lowering it."
  type        = string
  # NOT an arbitrary round number, and NOT safe to lower to 4096. The CHW system
  # prompt alone is ~3073 tokens; with the 1024-token max output that is 4097, so
  # 4096 overflows by one token and EVERY chat request fails with a vLLM 400,
  # surfacing to users as "unable to generate a response due to an upstream model
  # error". That outage happened on 2026-07-15 and again on 2026-08-09, when a CI
  # redeploy regenerated the compose file from this default and silently undid the
  # hand-applied fix. /api/health stays 200 throughout, so no smoke test catches it.
  # 16384 costs no extra GPU memory — the KV budget is bounded by gpu_utilization.
  default = "16384"
}

variable "translation_model_id" {
  description = "Translation model id."
  type        = string
  default     = "google/gemma-3-4b-it"
}

variable "embedding_model_id" {
  description = "Embedding model id."
  type        = string
  default     = "BAAI/bge-base-en-v1.5"
}

variable "reranker_model_id" {
  description = "Reranker model id."
  type        = string
  default     = "cross-encoder/ms-marco-MiniLM-L-6-v2"
}

# --- Application code delivery --------------------------------------------------
# Code ships to the instance as an S3 zip that Terraform builds from this working
# tree (see artifact.tf) — no git repo/branch/token needed on the box.

# --- Secrets you must supply -------------------------------------------------
variable "hf_secret_id" {
  description = "AWS Secrets Manager secret holding the HuggingFace token as JSON key HF_TOKEN. The instance reads it at runtime (never enters Terraform state)."
  type        = string
  default     = "innov8ai/asante/hf-token"
}

variable "genie_admin_email" {
  description = "Email for the GENIE realm admin user (required by the stack)."
  type        = string
  default     = ""
}

# --- Auto-stop scheduler (decision #7 — configurable) ------------------------
variable "enable_scheduler" {
  description = "Enable EventBridge auto stop/start of the GPU instance."
  type        = bool
  default     = false
}

variable "scheduler_timezone" {
  description = "IANA timezone for the stop/start schedules."
  type        = string
  default     = "America/Los_Angeles"
}

variable "scheduler_start_cron" {
  description = "EventBridge cron to START the instance."
  type        = string
  default     = "cron(0 8 ? * MON-FRI *)"
}

variable "scheduler_stop_cron" {
  description = "EventBridge cron to STOP the instance."
  type        = string
  default     = "cron(0 19 ? * * *)"
}
