#!/usr/bin/env bash
#
# Creates the S3 bucket and IAM user for the snapmart-cms media POC, with the
# mandatory tags on every resource, and writes the credentials straight into .env
# so the secret never appears in terminal scrollback.
#
#   aws login                       # or however you authenticate
#   ./scripts/provision-s3.sh
#
# Safe to re-run: every step checks for an existing resource first.
# Creates nothing outside S3 and IAM. CloudFront is a separate, console step —
# see docs/feasibility/06-aws-s3-cloudfront-setup.md.

set -euo pipefail
export AWS_PAGER=""

REGION="${AWS_REGION:-ap-southeast-1}"          # Singapore — nearest to landers.ph
BUCKET_PREFIX="${BUCKET_PREFIX:-snapmart-cms-media-poc}"
USER_NAME="${IAM_USER:-snapmart-cms-poc}"
POLICY_NAME="${IAM_POLICY:-SnapmartCmsMediaPoc}"

# Mandatory tags. Two encodings because S3 and IAM disagree about the shape.
TAGS_IAM='[{"Key":"CreatedBy","Value":"Abhishek Kumbhani"},{"Key":"Department","Value":"Snapmart"},{"Key":"Environment","Value":"POC"}]'
TAGS_S3='{"TagSet":[{"Key":"CreatedBy","Value":"Abhishek Kumbhani"},{"Key":"Department","Value":"Snapmart"},{"Key":"Environment","Value":"POC"}]}'

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
info() { printf '  · %s\n' "$*"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

say "Who am I"
CALLER=$(aws sts get-caller-identity --output json) || die "Not authenticated. Run 'aws login' first."
ACCOUNT=$(echo "$CALLER" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Account"])')
ARN=$(echo "$CALLER" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Arn"])')
info "account $ACCOUNT"
info "$ARN"
info "region  $REGION"

# Bucket names are globally unique across all of AWS, so suffix with the account id.
BUCKET="${BUCKET_PREFIX}-${ACCOUNT}"

say "1. S3 bucket: $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  ok "already exists — leaving it alone"
else
  # us-east-1 must NOT be given a LocationConstraint; every other region must.
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
  ok "created"
fi

# create-bucket takes no --tags, so tagging is always a second call. If your org
# enforces tags at creation this is the step that satisfies it.
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging "$TAGS_S3"
ok "tagged"

# Defaults are what we want and the storage adapter is configured for them:
# ACLs disabled, public access blocked. CloudFront OAC grants read later.
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
ok "public access blocked (CloudFront OAC will grant read)"

aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
ok "default encryption on"

# The admin panel is a browser uploading straight to... no: Payload uploads server-side.
# CORS here is only needed if you later switch to presigned client-side uploads.

say "2. IAM policy: $POLICY_NAME"
POLICY_ARN="arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}"
if aws iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1; then
  ok "already exists"
else
  # Note the two different ARN shapes: object actions need /*, bucket actions do not.
  aws iam create-policy --policy-name "$POLICY_NAME" --tags "$TAGS_IAM" \
    --description "Payload CMS media access for the Snapmart POC bucket" \
    --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PayloadObjectAccess",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::${BUCKET}/*"
    },
    {
      "Sid": "PayloadBucketCheck",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::${BUCKET}"
    }
  ]
}
JSON
)" >/dev/null
  ok "created and tagged"
fi

say "3. IAM user: $USER_NAME"
if aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  ok "already exists"
else
  aws iam create-user --user-name "$USER_NAME" --tags "$TAGS_IAM" >/dev/null
  ok "created and tagged"
fi
aws iam attach-user-policy --user-name "$USER_NAME" --policy-arn "$POLICY_ARN"
ok "policy attached"

say "4. Access key"
EXISTING=$(aws iam list-access-keys --user-name "$USER_NAME" \
  --query 'length(AccessKeyMetadata)' --output text)
if [ "$EXISTING" != "0" ]; then
  info "$USER_NAME already has $EXISTING key(s)."
  info "AWS only reveals a secret at creation time, so an existing key cannot be re-read."
  info "Either reuse the values already in .env, or delete the old key and re-run:"
  info "  aws iam list-access-keys --user-name $USER_NAME"
  info "  aws iam delete-access-key --user-name $USER_NAME --access-key-id <id>"
else
  KEY_JSON=$(aws iam create-access-key --user-name "$USER_NAME" --output json)
  KEY_ID=$(echo "$KEY_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["AccessKey"]["AccessKeyId"])')
  KEY_SECRET=$(echo "$KEY_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["AccessKey"]["SecretAccessKey"])')

  # Written straight into .env rather than printed, so the secret never lands in
  # terminal scrollback, tmux history, or a screen share.
  python3 - "$KEY_ID" "$KEY_SECRET" "$BUCKET" "$REGION" <<'PY'
import pathlib, sys
key_id, secret, bucket, region = sys.argv[1:5]
p = pathlib.Path('.env')
lines = p.read_text().splitlines() if p.exists() else []
managed = {
    'S3_BUCKET': bucket,
    'S3_REGION': region,
    'S3_ACCESS_KEY_ID': key_id,
    'S3_SECRET_ACCESS_KEY': secret,
}
out, seen = [], set()
for line in lines:
    k = line.split('=', 1)[0].strip()
    # MinIO-only settings must be REMOVED for real S3, not just changed: a stale
    # endpoint sends uploads to a dead container, and forced path style breaks TLS
    # certificate matching in several regions.
    if k in ('S3_ENDPOINT', 'S3_FORCE_PATH_STYLE'):
        out.append(f'# {line}   # MinIO-only; commented out for real S3')
        continue
    if k in managed:
        out.append(f'{k}={managed[k]}')
        seen.add(k)
        continue
    out.append(line)
for k, v in managed.items():
    if k not in seen:
        out.append(f'{k}={v}')
p.write_text('\n'.join(out).rstrip() + '\n')
print('  \033[32m✓\033[0m credentials written to .env (not printed)')
PY
  info "key id ends ...${KEY_ID: -4}"
fi

cat <<EOF

$(printf '\033[1mDone. Bucket and IAM are ready.\033[0m')

  bucket   $BUCKET
  region   $REGION
  user     $USER_NAME

$(printf '\033[1mNext — pick one:\033[0m')

  A. CloudFront in front (recommended, matches production)
     Console steps in docs/feasibility/06-aws-s3-cloudfront-setup.md §1.
     Then set:   CDN_BASE_URL=https://<distribution-id>.cloudfront.net

  B. Skip the CDN for a first test
     Set:        CDN_BASE_URL=https://${BUCKET}.s3.${REGION}.amazonaws.com
     and turn Block Public Access off plus add a public-read bucket policy.
     Quicker, but every object becomes world-readable straight from S3.

Then verify before involving Payload at all:

  pnpm check:s3
EOF
