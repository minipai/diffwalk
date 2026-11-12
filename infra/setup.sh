#!/usr/bin/env bash
#
# Zone-level configuration for the hosted report service.
#
# cloudflare.config.ts owns the Worker, its static assets, and its R2 binding. This script owns
# the pieces the project configuration does not manage: the bucket itself, its public URL, its
# lifecycle rules, the free WAF managed ruleset, and the publish rate limit. Every setting is
# declarative, so re-running this script against an already configured zone is a no-op.
#
# Requires the Cloudflare cf CLI: npm install --global cf@latest
#
# Required:
#   CLOUDFLARE_API_TOKEN   token with R2 bucket write and Zone WAF Write on the report zone
#   CLOUDFLARE_ZONE_ID     the zone holding review.diffwalk.dev
# Optional:
#   R2_BUCKET              bucket name (default diffwalk-reports)

set -euo pipefail

BUCKET="${R2_BUCKET:-diffwalk-reports}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

main() {
  validate_prerequisites
  create_report_bucket
  disable_public_bucket_url
  configure_report_lifecycle
  configure_managed_rules
  configure_publish_rate_limit

  echo
  echo "Zone configuration is up to date. Deploy the Worker with \`pnpm deploy\`."
}

validate_prerequisites() {
  command -v cf >/dev/null || {
    echo "Missing required tool: cf (npm install --global cf@latest)" >&2
    exit 1
  }
  command -v jq >/dev/null || { echo "Missing required tool: jq" >&2; exit 1; }
  : "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
  : "${CLOUDFLARE_ZONE_ID:?Set CLOUDFLARE_ZONE_ID}"
}

create_report_bucket() {
  echo "==> R2 bucket ${BUCKET}"
  if cf r2 buckets list --name-contains "$BUCKET" --quiet \
    | jq -e --arg name "$BUCKET" 'any(.buckets[]; .name == $name)' >/dev/null; then
    echo "    already exists"
  else
    cf r2 buckets create --name "$BUCKET" --quiet
    echo "    created"
  fi
}

# Reports are served only through the Worker, so the bucket must never answer directly.
disable_public_bucket_url() {
  echo "==> Disabling the r2.dev public URL"
  cf r2 buckets domains managed update "$BUCKET" --enabled false --force >/dev/null
  cf r2 buckets domains managed list --bucket-name "$BUCKET" \
    | jq -e '.enabled == false' >/dev/null
  echo "    public URL disabled"
}

# An unlisted link stops resolving on its own: retention is the whole lifetime policy, so
# nobody has to remember to revoke a review. Deletion happens in the background and may
# trail the 7-day boundary by a few hours.
configure_report_lifecycle() {
  echo "==> R2 lifecycle rules"
  cf r2 buckets lifecycle update "$BUCKET" \
    --rules "@${REPO_ROOT}/infra/r2-lifecycle.json" --force >/dev/null
  echo "    reviews expire 7 days after upload"
}

configure_managed_rules() {
  echo "==> WAF managed rules"
  cf rulesets entrypoint update http_request_firewall_managed --zone "$CLOUDFLARE_ZONE_ID" \
    --rules '[{
  "action": "execute",
  "action_parameters": { "id": "77454fe2d30c4220b5701f6fdfb893ba" },
  "expression": "true",
  "description": "Cloudflare Free Managed Ruleset"
}]' --quiet >/dev/null
  echo "    Cloudflare Free Managed Ruleset deployed"
}

# The Free plan provides one rate limiting rule. Spend it on anonymous writes; report reads
# remain protected by Cloudflare's network-level DDoS mitigation.
configure_publish_rate_limit() {
  echo "==> Publish rate limit"
  cf rulesets entrypoint update http_ratelimit --zone "$CLOUDFLARE_ZONE_ID" \
    --rules '[{
  "action": "block",
  "expression": "http.host eq \"review.diffwalk.dev\" and starts_with(http.request.uri.path, \"/api/reports\") and (http.request.method eq \"POST\" or http.request.method eq \"DELETE\")",
  "description": "Throttle report publish and revoke",
  "ratelimit": {
    "characteristics": ["ip.src", "cf.colo.id"],
    "period": 10,
    "requests_per_period": 5,
    "mitigation_timeout": 10
  }
}]' --quiet >/dev/null
  echo "    publish and revoke limited to 5 per 10 seconds per IP"
}

main
