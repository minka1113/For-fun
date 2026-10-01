data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# --- IAM: what the instance itself may do -------------------------------------------------
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.name}-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

# Session Manager shell + SSM Run Command (used by the deploy workflow). No SSH needed.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "ReadAnthropicKey"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.anthropic.arn]
  }

  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "EcrPull"
    actions   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
    resources = [aws_ecr_repository.app.arn, aws_ecr_repository.home.arn]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "app"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.name}-instance"
  role = aws_iam_role.app.name
}

# --- Persistent data (uploaded papers). Survives instance replacement. --------------------
resource "aws_ebs_volume" "data" {
  availability_zone = data.aws_subnet.instance.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true

  tags = {
    Name   = "${var.name}-data"
    Backup = var.name # picked up by the DLM snapshot policy
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data.id
  instance_id                    = aws_instance.app.id
  stop_instance_before_detaching = true
}

# --- The instance ------------------------------------------------------------------------
resource "aws_instance" "app" {
  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnet.instance.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  associate_public_ip_address = true # outbound only (Anthropic API); the SG blocks all direct inbound

  # IMDSv2 only, hop limit 1: processes on the host can use the instance role, containers cannot.
  # This stops the app's /api/fetch-url from being used to steal instance credentials (SSRF).
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    region         = var.aws_region
    secret_id      = aws_secretsmanager_secret.anthropic.name
    ecr_registry   = split("/", aws_ecr_repository.app.repository_url)[0]
    ecr_url        = aws_ecr_repository.app.repository_url
    data_volume_id = replace(aws_ebs_volume.data.id, "-", "")
  })

  tags = {
    Name = var.name # the deploy workflow targets this tag
  }

  # Don't replace the box for a new AMI or user-data edit; use `terraform apply -replace=aws_instance.app`
  # deliberately (see docs/MAINTENANCE.md).
  lifecycle {
    ignore_changes = [ami, user_data]
  }
}
