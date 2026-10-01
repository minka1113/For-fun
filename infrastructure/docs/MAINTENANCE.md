# Maintenance

## Routine deploys
Push to `web`. Each deploy briefly restarts the container (a few seconds of 502s; there is one instance).

## Rollback
Every image is tagged with its git SHA (last 10 kept in ECR).
```bash
aws ecr describe-images --repository-name source-lense \
  --query 'sort_by(imageDetails,&imagePushedAt)[].[imageTags[0],imagePushedAt]' --output text
aws ssm send-command --document-name source-lense-deploy \
  --targets Key=tag:Name,Values=source-lense --parameters imageTag=<sha>
```
Note the next push to `web` deploys the new commit again; revert the commit if the bad code should not redeploy.

## Rotating the Anthropic API key
```bash
aws secretsmanager put-secret-value --secret-id source-lense/anthropic-api-key --secret-string 'sk-ant-NEW'
aws ssm send-command --document-name AWS-RunShellScript --targets Key=tag:Name,Values=source-lense \
  --parameters commands='systemctl restart source-lense'
```
Revoke the old key in the Anthropic console afterwards.

## OS / Docker patching
Instance is Amazon Linux 2023, no auto-patching. Monthly:
```bash
aws ssm send-command --document-name AWS-RunShellScript --targets Key=tag:Name,Values=source-lense \
  --parameters commands='dnf -y upgrade --refresh && reboot'
```
For a fresh AMI or changed user-data, replace the instance (data volume is re-attached automatically, ~2 min downtime, then re-run the deploy workflow because the image tag file lives on the root disk):
```bash
terraform apply -replace=aws_instance.app
```

## Backups and restore
`backup.tf` snapshots the data volume daily at 07:00 UTC, keeping 7. Restore:
1. Find a snapshot: `aws ec2 describe-snapshots --owner-ids self --filters Name=tag:Backup,Values=source-lense`.
2. Create a volume from it in the instance's AZ, stop the service (`systemctl stop source-lense`), unmount, detach the old volume, attach the new one at `/dev/sdf`, mount, start.
3. Update Terraform: `terraform import aws_ebs_volume.data <new-volume-id>` (after `terraform state rm aws_volume_attachment.data aws_ebs_volume.data`) so state matches reality.

Cognito users are defined in Terraform, so they are recreated by `apply` (new temp passwords). Browser-side projects/drafts live in each user's browser `localStorage`, not on the server.

## Resizing
- Data disk: change `data_volume_size_gb`, `terraform apply`, then on the box `sudo xfs_growfs /var/lib/source-lense`.
- Instance size: change `instance_type` (restarts the instance; ~1 min downtime).

## Tuning the WAF
Metrics/samples: TROUBLESHOOTING.md. Rate limits are variables (`waf_rate_limit`, `waf_login_rate_limit`); rule overrides in `waf_common_rules_count_only`. Review "count" hits monthly and promote rules to block only if they don't hit real traffic.

## Users
Add/remove in `terraform.tfvars` → `terraform apply` (DEPLOY.md). Immediate sign-out of a user: `aws cognito-idp admin-user-global-sign-out --user-pool-id <id> --username <name>` (ALB sessions can last up to 7 days, so also disable the user: `admin-disable-user`).

## Terraform hygiene
- State: S3 bucket with versioning (90-day history). Never edit it by hand.
- Upgrade providers: `terraform init -upgrade`, review `plan`, commit `.terraform.lock.hcl`.
- Always run `terraform plan` and read it before `apply`; WAF/Cognito/ALB changes affect live login.

## Costs (approx., us-east-1, always on)
| Item | $/month |
|---|---|
| ALB | ~17 |
| WAF (2 ACLs + rules + requests) | ~12–15 |
| EC2 t3.small | ~15 |
| EBS 30 GB + snapshots | ~3 |
| Secrets Manager, Route53 queries, ECR | ~1 |
| Cognito (<10k MAU) | 0 |
| **Total** | **~50–55** + Anthropic API usage |

Savings: `t3.micro` (~$7) if memory allows; drop the login WAF ACL (~$6); stop/start the instance when not in use (ALB and WAF still bill).

## Monthly checklist
- [ ] Patch the instance (above) and check `docker ps` shows the expected SHA.
- [ ] Look at WAF metrics: blocked vs. counted requests.
- [ ] Confirm the latest snapshot exists and its age < 2 days.
- [ ] Review ECR scan findings for the running image; rebuild (push to `web`) to pick up base-image fixes.
- [ ] Check the Anthropic key spend/limits.
- [ ] Cognito users are still only derek and sarah.

## Move off the root account
The `default` AWS profile used to create this was the account **root** user. Create an IAM Identity Center or IAM admin user, use that for Terraform, enable MFA on root and delete any root access keys.
