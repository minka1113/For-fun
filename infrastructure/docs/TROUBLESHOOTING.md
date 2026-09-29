# Troubleshooting

Get a shell on the instance (no SSH, no open ports):
```bash
aws ssm start-session --target $(terraform output -raw instance_id)   # needs the Session Manager plugin
sudo journalctl -u source-lense -n 100 --no-pager     # service + prepare-script output
sudo docker logs --tail 100 source-lense              # app output
sudo docker ps; cat /etc/source-lense/image_tag       # what is running
curl -s localhost:8787/api/health
```
No plugin? Use Run Command instead: `aws ssm send-command --document-name AWS-RunShellScript --targets Key=tag:Name,Values=source-lense --parameters commands='journalctl -u source-lense -n 100 --no-pager'`.

| Symptom | Likely cause | Fix |
|---|---|---|
| **502 / 503** from the site | Target unhealthy: container not running | `aws elbv2 describe-target-health --target-group-arn <arn>`; check `journalctl -u source-lense`. Common: no image deployed yet (`/etc/source-lense/image_tag` missing) → run the deploy workflow; image pull failed → check ECR permissions / that the tag exists |
| **504** on a long request | ALB idle timeout (set to 3600s) or the app's 15 min request timeout | Very long PDF/expert calls: retry with fewer sources; the app itself times out at 15 min |
| `terraform apply` hangs on the certificate | DNS validation record missing | Check the Route53 zone is the *public* zone that is actually delegated (`dig NS roostercoop.tech`) |
| Login page loops / `redirect_mismatch` | Cognito client callback URL ≠ `https://<domain>/oauth2/idpresponse` | Confirm `var.domain_name`; re-apply `cognito.tf` |
| No temp-password email | Wrong address, spam folder, or default Cognito sender limit (50/day) | Check `terraform.tfvars`; resend with `admin-create-user --message-action RESEND`; or set a password directly: `aws cognito-idp admin-set-user-password --user-pool-id <id> --username derek --password '<pw>' --permanent` |
| Page loads but actions show network/CORS errors | The 7-day login session expired; API calls got a redirect to Cognito | Refresh the page and log in again |
| 403 from the site right after a login attempt burst | WAF rate limit (login ACL 300 req/5 min/IP, site ACL 1000) | Wait 5 minutes. Adjust `waf_rate_limit` / `waf_login_rate_limit` |
| 403 on a specific action (upload, summarize, paste) | A WAF managed rule false positive | See "WAF false positives" below |
| `hasKey: false` in `/api/health`, "API key" errors in the app | Secret has no value or restart hasn't happened since it was set | `put-secret-value` (DEPLOY.md step 3), then re-run the deploy or `sudo systemctl restart source-lense` |
| Deploy workflow: "Not authorized to perform sts:AssumeRoleWithWebIdentity" | Not on the `web` branch, repo renamed, or `AWS_DEPLOY_ROLE_ARN` wrong | Check `github_repo` / `deploy_branch` variables and the repo variables |
| Deploy workflow: SSM "InvalidInstanceId" / no invocations | Instance not registered with SSM or tag `Name=source-lense` missing | `aws ssm describe-instance-information`; check the instance has internet + role `AmazonSSMManagedInstanceCore` |
| Deploy workflow: health check failed | New image crashes | Output shows the last journal lines; roll back (MAINTENANCE.md) and fix |
| Uploaded papers missing after reboot | Data volume not mounted (app would write to root disk) | `findmnt /var/lib/source-lense`; the service refuses to start without the mount (`RequiresMountsFor`) |
| "No space left on device" | Data volume or root disk full | `df -h`; grow the volume (MAINTENANCE.md); `docker system prune -af` |

## WAF false positives
Blocked requests are sampled for 3 hours:
```bash
aws wafv2 list-web-acls --scope REGIONAL
aws wafv2 get-sampled-requests --web-acl-arn <arn> --scope REGIONAL \
  --rule-metric-name source-lense-common --max-items 50 \
  --time-window StartTime=$(date -u -d '-2 hours' +%s),EndTime=$(date -u +%s)
```
Also CloudWatch metrics `AWS/WAFV2` → `BlockedRequests` per rule. To stop a rule from blocking, add its name to `waf_common_rules_count_only` in `variables.tf` (rule then only counts) and apply. Body rules already start in count mode because uploads are up to 40 MB and WAF inspects only the first 8 KB.

## Terraform issues
- *"Error acquiring the state lock"*: a previous run was killed. Confirm nobody is running Terraform, then `terraform force-unlock <id>`.
- *"InvalidParameterValue … AZ / instance type not supported"*: change `instance_type`.
- *Instance replaced unexpectedly*: `ami` and `user_data` changes are deliberately ignored; any other change to the instance arguments may replace it. Data survives (separate volume).
