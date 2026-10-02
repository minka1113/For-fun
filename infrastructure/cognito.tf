resource "aws_cognito_user_pool" "this" {
  name                = var.name
  mfa_configuration   = "OFF"
  deletion_protection = "ACTIVE"

  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true # no self sign-up

    invite_message_template {
      email_subject = "Your Source Lens login"
      email_message = "Hi {username}, you've been invited to Source Lens (https://${var.domain_name}). Your temporary password is {####} . You'll be asked to choose a new password the first time you sign in."
      sms_message   = "Source Lens: username {username}, temporary password {####}"
    }
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 5
      max_length = 254
    }
  }
}

resource "aws_cognito_user" "users" {
  for_each = var.users

  user_pool_id             = aws_cognito_user_pool.this.id
  username                 = each.key
  desired_delivery_mediums = ["EMAIL"]

  attributes = {
    email          = each.value.email
    email_verified = "true"
  }

  # Users choose their own password on first login; don't fight Cognito over state.
  lifecycle {
    ignore_changes = [password, temporary_password]
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = "${var.name}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_pool_client" "alb" {
  name         = "${var.name}-alb"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = true # required by ALB authenticate-cognito
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${var.domain_name}/oauth2/idpresponse"]
  logout_urls                          = ["https://${var.domain_name}/"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
}
