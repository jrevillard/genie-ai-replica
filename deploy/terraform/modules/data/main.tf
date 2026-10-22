# Managed PostgreSQL (Kong + Keycloak) and Redis cache — created only in
# "external" mode (var.enabled). In "embedded" mode nothing here is provisioned
# and the stack uses its bundled postgres/redis-cache containers instead.
# ArangoDB is never here — no managed equivalent; it stays on the data volume.

locals {
  count = var.enabled ? 1 : 0
}

resource "aws_db_subnet_group" "this" {
  count      = local.count
  name       = "${var.name_prefix}-pg-subnets"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

# Disable SSL enforcement so Kong/Keycloak (which don't set SSL by default) can
# connect. Safe here: RDS is in a private subnet reachable only from the app SG.
# For production, drop this group (keep force_ssl=1) and instead set
# KONG_PG_SSL=on and KC_DB_URL "...?sslmode=require".
resource "aws_db_parameter_group" "this" {
  count  = local.count
  name   = "${var.name_prefix}-pg-params"
  family = "postgres${split(".", var.rds_engine_version)[0]}"

  parameter {
    name  = "rds.force_ssl"
    value = "0"
  }

  tags = var.tags
}

resource "aws_db_instance" "postgres" {
  count          = local.count
  identifier     = "${var.name_prefix}-pg"
  engine         = "postgres"
  engine_version = var.rds_engine_version
  instance_class = var.rds_instance_class

  allocated_storage = var.rds_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  username = var.rds_master_username
  password = var.rds_master_password
  # No db_name: postgres-init creates the kong/keycloak databases against the
  # default 'postgres' maintenance database.

  db_subnet_group_name   = aws_db_subnet_group.this[0].name
  parameter_group_name   = aws_db_parameter_group.this[0].name
  vpc_security_group_ids = [var.rds_sg_id]
  publicly_accessible    = false

  multi_az                    = false
  backup_retention_period     = 1
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false
  apply_immediately           = true
  deletion_protection         = false
  skip_final_snapshot         = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-pg" })
}

resource "aws_elasticache_subnet_group" "this" {
  count      = local.count
  name       = "${var.name_prefix}-redis-subnets"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_elasticache_replication_group" "redis" {
  count                = local.count
  replication_group_id = "${var.name_prefix}-redis"
  description          = "GENIE.AI cache (${var.name_prefix})"

  engine         = "redis"
  engine_version = var.elasticache_engine_version
  node_type      = var.elasticache_node_type
  port           = 6379

  num_cache_clusters         = 1
  automatic_failover_enabled = false

  subnet_group_name  = aws_elasticache_subnet_group.this[0].name
  security_group_ids = [var.redis_sg_id]

  at_rest_encryption_enabled = true
  # AUTH requires in-transit TLS, which requires TLS-capable clients. Off by
  # default — isolation is provided by the private subnet + SG.
  transit_encryption_enabled = var.redis_auth_enabled
  auth_token                 = var.redis_auth_enabled ? var.redis_auth_token : null

  apply_immediately = true
  tags              = var.tags
}
