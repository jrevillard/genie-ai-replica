# Optional auto stop/start of the GPU instance via EventBridge Scheduler
# (Lambda-free universal targets). Enabled by var.enabled.

data "aws_caller_identity" "current" {}

locals {
  count        = var.enabled ? 1 : 0
  instance_arn = "arn:aws:ec2:${var.region}:${data.aws_caller_identity.current.account_id}:instance/${var.instance_id}"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  count              = local.count
  name               = "${var.name_prefix}-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "perms" {
  statement {
    actions   = ["ec2:StartInstances", "ec2:StopInstances"]
    resources = [local.instance_arn]
  }
}

resource "aws_iam_role_policy" "perms" {
  count  = local.count
  name   = "${var.name_prefix}-scheduler-perms"
  role   = aws_iam_role.scheduler[0].id
  policy = data.aws_iam_policy_document.perms.json
}

resource "aws_scheduler_schedule" "start" {
  count                        = local.count
  name                         = "${var.name_prefix}-start"
  schedule_expression          = var.start_cron
  schedule_expression_timezone = var.timezone
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:startInstances"
    role_arn = aws_iam_role.scheduler[0].arn
    input    = jsonencode({ InstanceIds = [var.instance_id] })
  }
}

resource "aws_scheduler_schedule" "stop" {
  count                        = local.count
  name                         = "${var.name_prefix}-stop"
  schedule_expression          = var.stop_cron
  schedule_expression_timezone = var.timezone
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.scheduler[0].arn
    input    = jsonencode({ InstanceIds = [var.instance_id] })
  }
}
