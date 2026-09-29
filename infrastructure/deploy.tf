# Run by GitHub Actions (aws ssm send-command). Also usable by hand for rollbacks:
#   aws ssm send-command --document-name source-lense-deploy --targets Key=tag:Name,Values=source-lense \
#     --parameters imageTag=<git sha>
resource "aws_ssm_document" "deploy" {
  name            = "${var.name}-deploy"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Deploy a Source Lens image tag and wait for it to be healthy"
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
        runCommand = [
          "set -uo pipefail",
          "mkdir -p /etc/source-lense",
          "echo '{{ imageTag }}' > /etc/source-lense/image_tag",
          "systemctl restart source-lense || { journalctl -u source-lense -n 60 --no-pager; exit 1; }",
          "for i in $(seq 1 90); do",
          "  if out=$(curl -fsS http://localhost:8787/api/health); then echo \"deployed {{ imageTag }}: $out\"; exit 0; fi",
          "  sleep 2",
          "done",
          "echo 'health check failed'; journalctl -u source-lense -n 60 --no-pager; exit 1",
        ]
      }
    }]
  })
}
