# Public ALB terminating TLS with the ACM cert, forwarding HTTP to the in-instance
# nginx. HTTP:80 redirects to HTTPS:443. Route 53 alias points the domain here.

resource "aws_lb" "this" {
  name               = "${var.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [var.alb_sg_id]
  subnets            = var.public_subnet_ids
  tags               = var.tags
}

resource "aws_lb_target_group" "this" {
  name        = "${var.name_prefix}-tg"
  port        = var.app_port
  protocol    = "HTTPS" # ALB re-encrypts to nginx's self-signed TLS on 443
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    path                = var.health_check_path
    protocol            = "HTTPS"
    matcher             = "200-399"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }

  tags = var.tags
}

resource "aws_lb_target_group_attachment" "this" {
  target_group_arn = aws_lb_target_group.this.arn
  target_id        = var.instance_id
  port             = var.app_port
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
  tags = var.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
  tags = var.tags
}

resource "aws_route53_record" "alias" {
  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}
