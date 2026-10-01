variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  description = "Resource name prefix."
  type        = string
  default     = "source-lense"
}

variable "domain_name" {
  description = "Public hostname for the app."
  type        = string
  default     = "source-lens.roostercoop.tech"
}

variable "hosted_zone_name" {
  description = "Existing Route53 public hosted zone that contains domain_name."
  type        = string
  default     = "roostercoop.tech"
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "data_volume_size_gb" {
  description = "Size of the EBS volume that holds data/packs (uploaded papers)."
  type        = number
  default     = 10
}

variable "users" {
  description = "Cognito users allowed to log in. Set in terraform.tfvars (git-ignored)."
  type = map(object({
    email = string
  }))

  validation {
    condition     = alltrue([for u in values(var.users) : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", u.email))])
    error_message = "Every user needs a valid email address."
  }
}

variable "github_repo" {
  description = "GitHub repository (owner/name) allowed to deploy."
  type        = string
  default     = "minka1113/For-fun"
}

variable "github_oidc_repo_subject" {
  description = <<-EOT
    Repo part of the GitHub OIDC "sub" claim. This repo uses immutable subjects (owner/repo IDs),
    so it is not just "owner/name". Find it with:
      gh api repos/OWNER/REPO/actions/oidc/customization/sub   (sub_claim_prefix, without the leading "repo:")
    Set to null to use var.github_repo (classic "owner/name" subjects).
  EOT
  type        = string
  default     = "minka1113@310428896/For-fun@1389966947"
}

variable "deploy_branch" {
  description = "Only this branch may assume the deploy role."
  type        = string
  default     = "web"
}

variable "waf_rate_limit" {
  description = "Max requests per IP per 5 minutes to the site before WAF blocks."
  type        = number
  default     = 1000
}

variable "waf_login_rate_limit" {
  description = "Max requests per IP per 5 minutes to the Cognito login endpoints."
  type        = number
  default     = 300
}

variable "waf_common_rules_count_only" {
  description = "Rules in AWSManagedRulesCommonRuleSet set to Count instead of Block (body rules false-positive on pasted research text and 40 MB uploads)."
  type        = list(string)
  default     = ["SizeRestrictions_BODY", "CrossSiteScripting_BODY"]
}
