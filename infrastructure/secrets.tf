# Only the empty container is managed here. The value is set once, out-of-band:
#   aws secretsmanager put-secret-value --secret-id source-lense/anthropic-api-key --secret-string '...'
# so it never appears in code or Terraform state.
resource "aws_secretsmanager_secret" "anthropic" {
  name                    = "${var.name}/anthropic-api-key"
  description             = "ANTHROPIC_API_KEY for Source Lens (value set manually)"
  recovery_window_in_days = 7
}
