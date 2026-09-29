# Security notes

## What protects what
| Layer | Protects against |
|---|---|
| **Cognito + ALB `authenticate-cognito`** | Anyone without an account. This is the actual login: no valid session → redirect to sign-in; the app never sees the request. Self sign-up is disabled; only users in Terraform exist. |
| **WAF ACL on the ALB** | Floods (rate limit), known-bad IPs, exploit payloads (Log4j etc.), common web attacks. Evaluated *before* the login check, so junk is dropped early. |
| **WAF ACL on Cognito** | Password guessing / credential stuffing against the sign-in page (rate limit, IP reputation). |
| **Security groups** | Instance accepts port 8787 only from the ALB; no SSH. The login cannot be bypassed by hitting the instance IP. |
| **TLS** | HTTP is redirected; TLS 1.2+ (1.3 preferred) policy; ACM certificate. |
| **IMDSv2, hop limit 1** | The app's `/api/fetch-url` fetches arbitrary URLs. Containers cannot reach the instance metadata service, so it can't be used to steal the instance role. |
| **Container** | Runs as non-root, all capabilities dropped, `no-new-privileges`. |

A WAF alone cannot authenticate users; it only filters traffic. That is why Cognito is the gate.

## Secrets
- Nothing sensitive is in the repository: the Anthropic key is in Secrets Manager (value set by hand), GitHub uses OIDC (no AWS keys), user emails are in git-ignored `terraform.tfvars`.
- `.env` is git-ignored and excluded from the Docker image (`.dockerignore`). **Do not paste real keys into the Terraform files, workflow, or docs.**
- The Terraform state (encrypted, private, versioned S3 bucket) contains the Cognito app-client secret and user emails. Limit access to that bucket.
- The instance role can read only this one secret. The GitHub role can push to this ECR repo and run one SSM document; it cannot change infrastructure or read secrets.

## Known limitations
- Two known users share one instance; there is no per-user data separation (the app has none).
- `/api/fetch-url` can still reach other private addresses inside the VPC and any public site.
- Password-only (no MFA). To enable, set `mfa_configuration = "OPTIONAL"` (or `ON`) with a `software_token_mfa_configuration` block in `cognito.tf`.
- Body-inspection WAF rules run in count mode (large uploads, pasted text) — they log but don't block.
- Sessions last 7 days (`session_timeout` in `alb.tf`); disable a user to cut access sooner (MAINTENANCE.md).
- Single instance: no high availability.
