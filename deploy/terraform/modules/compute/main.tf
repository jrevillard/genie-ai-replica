data "aws_caller_identity" "current" {}

# --- IAM: SSM shell + read the stack's SSM secrets --------------------------
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "${var.name_prefix}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

# Session Manager (no SSH / port 22).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "inline" {
  statement {
    sid     = "ReadStackSecrets"
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    # GetParametersByPath is authorized against the PATH node ARN (no /*), while
    # GetParameter is against each child — grant both.
    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_prefix}",
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_prefix}/*",
    ]
  }
  statement {
    sid       = "DecryptSecureStrings"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
  statement {
    sid       = "InstanceLogs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/genie-ai/*"]
  }
  statement {
    sid       = "ReadAppArtifact"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.app_s3_bucket}/*"]
  }
  statement {
    sid       = "ReadHFToken"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.hf_secret_arn]
  }
}

resource "aws_iam_role_policy" "inline" {
  name   = "${var.name_prefix}-ec2-inline"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.inline.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.name_prefix}-ec2-profile"
  role = aws_iam_role.ec2.name
}

# --- GPU instance ------------------------------------------------------------
resource "aws_instance" "this" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [var.ec2_sg_id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  # Public IP for outbound pulls only; inbound is locked to the ALB SG.
  associate_public_ip_address = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required" # IMDSv2
  }

  root_block_device {
    volume_size           = var.root_volume_gb
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/templates/user_data.sh.tftpl", {
    region               = var.region
    ssm_prefix           = var.ssm_prefix
    hf_secret_id         = var.hf_secret_id
    app_env_group        = "aws_dev"
    data_backend         = var.data_backend
    domain_name          = var.domain_name
    rds_host             = var.rds_host
    rds_port             = var.rds_port
    redis_host           = var.redis_host
    redis_port           = var.redis_port
    redis_auth_enabled   = var.redis_auth_enabled
    llm_model_id         = var.llm_model_id
    vllm_gpu_utilization = var.vllm_gpu_utilization
    vllm_max_model_len   = var.vllm_max_model_len
    translation_model_id = var.translation_model_id
    embedding_model_id   = var.embedding_model_id
    reranker_model_id    = var.reranker_model_id
    app_s3_bucket        = var.app_s3_bucket
    app_s3_key           = var.app_s3_key
  })

  lifecycle {
    # The AMI is resolved by a `most_recent = true` data source, so it silently
    # changes whenever AWS publishes a new Deep Learning AMI. Without this, ANY
    # `terraform apply` — even one resizing a disk — plans
    #   ami = "ami-07869df7a188bb1aa" -> "ami-0326665395a428ccf" # forces replacement
    # and destroys the running GPU instance. That is exactly the outcome
    # docs/ci-cd-plan.md §3.2 rules out, and it is not covered by
    # user_data_replace_on_change, which only governs user_data.
    #
    # Observed for real on 2026-08-09: a volume-resize plan wanted to replace the
    # instance for this reason alone, and had to be applied with -target to avoid it.
    #
    # Upgrading the AMI is therefore a DELIBERATE act — but setting var.gpu_ami_id
    # is NOT sufficient on its own. ignore_changes suppresses every config-vs-state
    # difference on `ami` regardless of where the new value came from, so a pinned
    # var alone plans "No changes" and quietly leaves the box on its old AMI. To
    # move a RUNNING instance, force the replacement explicitly:
    #
    #   terraform apply -replace=module.compute.aws_instance.this
    #
    # ignore_changes does not apply to a create (no prior state to preserve), so the
    # new instance boots whatever the config resolves to — var.gpu_ami_id if set,
    # else the data source's latest match. Pin var.gpu_ami_id first if you care
    # which one you land on. Temporarily deleting this block works too; a toggle
    # variable does not, as ignore_changes requires a static list. Either way,
    # accept the GPU capacity risk on relaunch before you do it.
    ignore_changes = [ami]
  }

  # Deliberately false: application deploys go through the SSM redeploy button
  # (docs/ci-cd-plan.md §3.1 option B), not through instance replacement. The GPU
  # box must be reused, never recreated — a rebuild costs 20-40 min and destroys
  # whatever demo is running on it.
  #
  # Consequence: user_data edits now apply in place and only take effect on the
  # NEXT boot. That is intended — user_data is a thin bootstrap shim, and the
  # config rendering it used to own lives in deploy/scripts/render-config.sh so
  # it can change without touching this template at all.
  #
  # To force a genuine re-bootstrap, taint or replace the instance explicitly.
  user_data_replace_on_change = false

  tags = merge(var.tags, {
    Name     = "${var.name_prefix}-app"
    AutoStop = "true"
  })
}

# --- Persistent data volume (survives instance replacement) ------------------
resource "aws_ebs_volume" "data" {
  # Pinned to a stable AZ (not the instance's computed AZ) so replacing the instance
  # re-attaches this volume instead of destroying it — the data survives replacement.
  availability_zone = var.availability_zone
  size              = var.data_volume_gb
  type              = "gp3"
  encrypted         = true
  tags              = merge(var.tags, { Name = "${var.name_prefix}-data" })
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.this.id
}
