# Home maintenance tracker (../home-maintenance). Shares the Source Lens ALB, WAF, Cognito users and
# EC2 instance; it gets its own hostname, certificate, target group, image repo and deploy document.
#
#   home.roostercoop.tech/cal/*   ─▶ forwarded with NO login (calendar apps can't sign in; the app checks a secret token)
#   home.roostercoop.tech/*       ─▶ Cognito login ─▶ container "home-maintenance" on :8788
#
# Data: /var/lib/source-lense/home-data on the shared EBS volume, so the daily snapshots cover it.

locals {
  home_name = "${var.name}-home"
}

# --- Certificate + DNS --------------------------------------------------------------------
resource "aws_acm_certificate" "home" {
  domain_name       = var.home_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "home_cert_validation" {
  for_each = {
    for o in aws_acm_certificate.home.domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      record = o.resource_record_value
      type   = o.resource_record_type
    }
  }

  zone_id         = data.aws_route53_zone.this.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "home" {
  certificate_arn         = aws_acm_certificate.home.arn
  validation_record_fqdns = [for r in aws_route53_record.home_cert_validation : r.fqdn]
}

# Served by the existing HTTPS listener via SNI.
resource "aws_lb_listener_certificate" "home" {
  listener_arn    = aws_lb_listener.https.arn
  certificate_arn = aws_acm_certificate_validation.home.certificate_arn
}

resource "aws_route53_record" "home" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.home_domain_name
  type    = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

# --- Routing ------------------------------------------------------------------------------
resource "aws_lb_target_group" "home" {
  name                 = local.home_name
  port                 = 8788
  protocol             = "HTTP"
  vpc_id               = data.aws_vpc.default.id
  deregistration_delay = 30

  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group_attachment" "home" {
  target_group_arn = aws_lb_target_group.home.arn
  target_id        = aws_instance.app.id
  port             = 8788
}

resource "aws_vpc_security_group_ingress_rule" "app_home_from_alb" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8788
  to_port                      = 8788
  description                  = "Home maintenance app port from ALB only"
}

# 1) The calendar feed: no login. Unguessable token in the path; wrong token = 404 from the app.
resource "aws_lb_listener_rule" "home_calendar" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    host_header {
      values = [var.home_domain_name]
    }
  }
  condition {
    path_pattern {
      values = ["/cal/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.home.arn
  }
}

# 2) Everything else on the home hostname: Cognito login (same users as Source Lens), then the app.
resource "aws_lb_listener_rule" "home" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  condition {
    host_header {
      values = [var.home_domain_name]
    }
  }

  action {
    type  = "authenticate-cognito"
    order = 1

    authenticate_cognito {
      user_pool_arn              = aws_cognito_user_pool.this.arn
      user_pool_client_id        = aws_cognito_user_pool_client.alb.id
      user_pool_domain           = aws_cognito_user_pool_domain.this.domain
      scope                      = "openid email"
      on_unauthenticated_request = "authenticate"
      session_timeout            = 2592000 # 30 days: a household app you open now and then
    }
  }

  action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.home.arn
  }
}

# --- Image repo ---------------------------------------------------------------------------
resource "aws_ecr_repository" "home" {
  name                 = local.home_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "home" {
  repository = aws_ecr_repository.home.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images (rollback targets)"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# --- Deploy -------------------------------------------------------------------------------
# The instance's user-data only runs on first boot (and is ignored by Terraform after that), so this
# document installs the systemd unit itself on every deploy. Rollback by hand:
#   aws ssm send-command --document-name source-lense-home-deploy --targets Key=tag:Name,Values=source-lense \
#     --parameters imageTag=<git sha>
resource "aws_ssm_document" "home_deploy" {
  name            = "${local.home_name}-deploy"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Deploy a home maintenance image tag and wait for it to be healthy"
    parameters = {
      imageTag = {
        type           = "String"
        description    = "ECR image tag (git commit SHA)"
        allowedPattern = "^[A-Za-z0-9_.-]{1,128}$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = {
        timeoutSeconds = "900"
        runCommand = split("\n", templatefile("${path.module}/templates/home-deploy.sh.tftpl", {
          region       = var.aws_region
          ecr_registry = split("/", aws_ecr_repository.home.repository_url)[0]
          ecr_url      = aws_ecr_repository.home.repository_url
        }))
      }
    }]
  })
}
