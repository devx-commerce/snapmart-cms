#!/usr/bin/env bash
#
# Makes the media bucket publicly readable.
#
# ONLY needed when there is no CloudFront in front of it. With CloudFront you want the
# opposite — bucket stays private, and an Origin Access Control grants the distribution
# read. provision-s3.sh sets up that (safer) shape; this script deliberately undoes part
# of it.
#
#   ./scripts/s3-public-read.sh <bucket-name>
#
# What it grants: s3:GetObject on the objects, to everyone. Nothing else.
# It does NOT grant s3:ListBucket, so the bucket cannot be enumerated — someone needs the
# exact object key, which for media is the filename Payload generated.
#
set -euo pipefail

BUCKET="${1:-${S3_BUCKET:-}}"
[ -n "$BUCKET" ] || { echo "usage: $0 <bucket-name>"; exit 1; }

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1. Allowing bucket policies to grant public read on $BUCKET"
# BlockPublicPolicy and RestrictPublicBuckets must be false for a public-read policy to
# take effect. The two ACL blocks stay ON: ACLs remain disabled, which is still correct —
# access comes from the bucket policy, not from per-object ACLs.
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"

say "2. Bucket policy: public s3:GetObject, and nothing else"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadObjectsOnly",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${BUCKET}/*"
    }
  ]
}
JSON
)"

REGION=$(aws s3api get-bucket-location --bucket "$BUCKET" --query 'LocationConstraint' --output text)
[ "$REGION" = "None" ] && REGION="us-east-1"

say "Done. Set this in .env:"
echo
echo "  CDN_BASE_URL=https://${BUCKET}.s3.${REGION}.amazonaws.com"
echo
echo "Then verify with: pnpm check:s3"
echo
printf '\033[33m%s\033[0m\n' "Note: objects are now world-readable to anyone holding the URL."
echo "The bucket cannot be listed, so keys are not discoverable — but treat everything"
echo "uploaded here as public. Do not put anything in this bucket that is not marketing media."
