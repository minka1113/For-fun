# Deploying Source Lens

## Prerequisites
- AWS CLI v2 and Terraform ≥ 1.10 installed; `aws sts get-caller-identity` works with the profile you'll use (default profile, region `us-east-1`).
- The Route53 public zone `roostercoop.tech` exists in the same account.
- Admin-level AWS permissions for the person running Terraform (IAM, EC2, ALB, WAF, Cognito, Route53, ACM, S3, ECR, SSM, Secrets Manager).
- Admin rights on the GitHub repo `minka1113/For-fun` (to set variables).

All commands below run from `For-fun/infrastructure/`.

## 1. One-time: create the Terraform state bucket
```bash
cd bootstrap
terraform init
terraform apply          # creates s3://roostercoop-source-lense-tfstate-<account-id>
cd ..
```
The bootstrap uses local state (`bootstrap/terraform.tfstate`, git-ignored). If you lose it the bucket is unaffected; you would only need `terraform import` to manage the bucket again.
If your account ID differs from the one in `backend.tf`, edit the bucket name there.

## 2. Create the infrastructure
```bash
cp terraform.tfvars.example terraform.tfvars   # then put the real emails in (file is git-ignored)
terraform init
terraform plan
terraform apply
```
- ACM validation takes 2–10 minutes; the apply waits for it.
- Cognito emails each user a **temporary password** (valid 7 days) at the address in `terraform.tfvars`.
- The instance boots and installs Docker, but no app runs until the first deploy (step 5).

## 3. Store the Anthropic API key (once)
The value is never in Terraform or git:
```bash
aws secretsmanager put-secret-value \
  --secret-id source-lense/anthropic-api-key \
  --secret-string 'sk-ant-...'
```
Tip: prefix the command with a space or use `read -rs KEY` to keep it out of shell history.

## 4. Configure GitHub (no secrets needed)
```bash
terraform output github_deploy_role_arn
terraform output aws_region
```
In GitHub → repo → Settings → Secrets and variables → Actions → **Variables** add:
- `AWS_DEPLOY_ROLE_ARN` = the role ARN
- `AWS_REGION` = `us-east-1`

(or `gh variable set AWS_DEPLOY_ROLE_ARN --body "$(terraform output -raw github_deploy_role_arn)"`)

The role can only be assumed by workflows on the `web` branch of `minka1113/For-fun`.

## 5. First deploy
Push to `web` (or Actions → Deploy → Run workflow, selecting `web`). The workflow builds the image, pushes it to ECR tagged with the commit SHA, and runs the SSM document on the instance, which pulls the image, restarts the service and waits for `/api/health`.

## 6. First login (derek / sarah)
1. Open <https://source-lense.roostercoop.tech> → redirected to the Cognito sign-in page.
2. Username `derek` (or `sarah`) + the emailed temporary password.
3. Choose a new password (12+ chars, upper/lower/number/symbol).
4. You land in the app. Sessions last 7 days.

Forgot password: the Cognito page has a "Forgot your password?" link (uses the verified email).

## Adding / removing users
Edit `users` in `terraform.tfvars` and `terraform apply`. Removing an entry deletes the user. The username is the map key.
Re-sending a temp password: `aws cognito-idp admin-create-user --user-pool-id <id> --username <name> --message-action RESEND`.

## Verify
```bash
curl -sI https://source-lense.roostercoop.tech | head -3      # 302 → Cognito
curl -sI http://source-lense.roostercoop.tech  | head -3      # 301 → https
```
Then log in and run a summary. `hasKey` in `/api/health` (visible only after login) should be `true`.

## Teardown
1. The Cognito pool has deletion protection and the data volume has `prevent_destroy`. Edit those (`deletion_protection = "INACTIVE"`, remove the `prevent_destroy` lifecycle block in `compute.tf`), apply, then `terraform destroy`.
2. Uploaded papers live on the data volume and its snapshots: snapshot manually first if you want to keep them.
3. Delete the secret immediately if desired: `aws secretsmanager delete-secret --secret-id source-lense/anthropic-api-key --force-delete-without-recovery`.
4. The state bucket in `bootstrap/` must be emptied and removed separately.
