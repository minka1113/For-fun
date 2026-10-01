# State bucket is created by ./bootstrap. Bucket names are not secret.
# If your account ID differs, change it here (or pass -backend-config="bucket=...").
terraform {
  backend "s3" {
    bucket       = "roostercoop-source-lense-tfstate-573938088575"
    key          = "source-lense/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
