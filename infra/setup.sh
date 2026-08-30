#!/usr/bin/env bash
#
# Zone-level configuration for the hosted report service.
#
# wrangler.jsonc owns the Worker, its Static Assets, and its R2 binding. This script owns the
# pieces wrangler does not manage: the bucket itself, its public URL, the free WAF managed
# ruleset, and the publish rate limit. Both are declarative, and re-running this script against
# an already configured zone is a no-op.
#
# Required:
#   CLOUDFLARE_API_TOKEN   token with Zone WAF Write on the report zone
#   CLOUDFLARE_ZONE_ID     the zone holding reports.diffwalk.dev
# Optional:
#   R2_BUCKET              bucket name (default diffwalk-reports)

set -euo pipefail

BUCKET="${R2_BUCKET:-diffwalk-reports}"
API="https://api.cloudflare.com/client/v4"

for tool in curl jq npx; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ZONE_ID:?Set CLOUDFLARE_ZONE_ID}"

wrangler() { npx wrangler "$@"; }

cloudflare_api() {
  local method=$1 path=$2 body=$3
  curl --silent --show-error --fail-with-body \
    --request "$method" \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    --header "Content-Type: application/json" \
    --data "$body" \
    "${API}${path}"
}

echo "==> R2 bucket ${BUCKET}"
if wrangler r2 bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "    already exists"
else
  wrangler r2 bucket create "$BUCKET"
fi

# Reports are served only through the Worker, so the bucket must never answer directly.
echo "==> Disabling the r2.dev public URL"
wrangler r2 bucket dev-url disable "$BUCKET" --force >/dev/null
wrangler r2 bucket dev-url get "$BUCKET"

echo "==> WAF managed rules"
cloudflare_api PUT "/zones/${CLOUDFLARE_ZONE_ID}/rulesets/phases/http_request_firewall_managed/entrypoint" '{
  "rules": [
    {
      "action": "execute",
      "action_parameters": { "id": "77454fe2d30c4220b5701f6fdfb893ba" },
      "expression": "true",
      "description": "Cloudflare Free Managed Ruleset"
    }
  ]
}' | jq -e '.success' >/dev/null
echo "    Cloudflare Free Managed Ruleset deployed"

# The Free plan provides one rate limiting rule. Spend it on anonymous writes; report reads
# remain protected by Cloudflare's network-level DDoS mitigation.
echo "==> Publish rate limit"
cloudflare_api PUT "/zones/${CLOUDFLARE_ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint" '{
  "rules": [
    {
      "action": "block",
      "expression": "http.host eq \"reports.diffwalk.dev\" and starts_with(http.request.uri.path, \"/api/reports\") and (http.request.method eq \"POST\" or http.request.method eq \"DELETE\")",
      "description": "Throttle report publish and revoke",
      "ratelimit": {
        "characteristics": ["ip.src", "cf.colo.id"],
        "period": 10,
        "requests_per_period": 5,
        "mitigation_timeout": 10
      }
    }
  ]
}' | jq -e '.success' >/dev/null
echo "    publish and revoke limited to 5 per 10 seconds per IP"

echo
echo "Zone configuration is up to date. Deploy the Worker with \`pnpm deploy\`."
