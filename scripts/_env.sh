# Shared by the operator scripts: loads deploy/deploy.env and finds gcloud.
# Not meant to be run on its own.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ENV_FILE="deploy/deploy.env"
[ -f "$ENV_FILE" ] || { echo "❌ no $ENV_FILE — copy deploy/deploy.env.example and fill it in"; exit 1; }
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a
for v in GCP_PROJECT GCP_ZONE VM VM_IP DOMAIN; do
  [ -n "${!v:-}" ] || { echo "❌ $ENV_FILE: $v is empty"; exit 1; }
done
# launchd hands scripts a bare PATH; gcloud usually lives in Homebrew
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH
GCLOUD="$(command -v gcloud 2>/dev/null || true)"
[ -n "$GCLOUD" ] || { echo "❌ gcloud not found"; exit 1; }
G=("$GCLOUD" compute --project="$GCP_PROJECT")
ZONE="$GCP_ZONE"
# the zone's own nameserver answers before caches do
dns_resolves() { [ "$(dig +short "$DOMAIN" @"$(dig +short NS "${DOMAIN#*.}" | head -1)" 2>/dev/null | tail -1)" = "$VM_IP" ]; }
