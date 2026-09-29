# Source Lens – AWS infrastructure

Terraform for <https://source-lense.roostercoop.tech>. Deployed by GitHub Actions (`.github/workflows/deploy.yml`).

```
Browser ─▶ Route53 ─▶ WAF (rate limit, IP reputation, bad inputs, common rules)
                        │
                        ▼
                     ALB :443 (ACM cert) ── authenticate-cognito ──▶ Cognito hosted login (own WAF ACL)
                        │  (only after login)
                        ▼
              EC2 t3.small ── Docker container (Express + React, :8787)
                 ├─ EBS data volume  → /app/data  (uploaded papers, daily snapshots)
                 └─ Secrets Manager  → ANTHROPIC_API_KEY (value set by hand, never in code)
```

The app itself has no auth; the ALB refuses every request that has no valid Cognito session, and the instance security group only accepts traffic from the ALB, so there is no way around the login.

| Doc | Read it when |
|---|---|
| [docs/DEPLOY.md](docs/DEPLOY.md) | First-time setup, adding users, teardown |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Something is broken |
| [docs/MAINTENANCE.md](docs/MAINTENANCE.md) | Rollbacks, key rotation, patching, restores, costs |
| [docs/SECURITY.md](docs/SECURITY.md) | What is protected by what, and the limits |

## File map

| File | Purpose |
|---|---|
| `bootstrap/` | One-time: S3 bucket for Terraform state (local state) |
| `backend.tf`, `versions.tf`, `providers.tf`, `variables.tf` | Terraform plumbing, inputs |
| `network.tf` | Default VPC lookups, security groups |
| `dns.tf` | ACM certificate (DNS validated) + Route53 alias |
| `cognito.tf` | User pool, users (derek, sarah), app client, login domain |
| `alb.tf` | ALB, HTTP→HTTPS redirect, Cognito auth + forward |
| `waf.tf` | Two web ACLs: site (ALB) and login (Cognito) |
| `compute.tf`, `templates/user-data.sh.tftpl` | EC2, IAM role, data volume, first-boot script/systemd unit |
| `deploy.tf` | SSM document that GitHub Actions calls to roll out an image |
| `ecr.tf` | Container registry |
| `secrets.tf` | Empty Secrets Manager secret for the Anthropic key |
| `backup.tf` | Daily snapshots of the data volume (7 kept) |
| `github_oidc.tf` | Keyless deploy role for GitHub Actions |
| `terraform.tfvars` | **Git-ignored**: user emails. Template: `terraform.tfvars.example` |
