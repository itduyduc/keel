#!/bin/bash
# Notarizes and staples Plumb.app so a teammate's Mac opens it without a
# Gatekeeper warning, then zips the stapled app for sharing.
#
#   bash mac/build-app.sh            # must have signed with a Developer ID identity
#   bash mac/notarize.sh [app]       # default: mac/build/Plumb.app → mac/build/Plumb.zip
#
# Auth is the App Store Connect API key in ~/.private_keys/asc.env
# (ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH) — no Apple ID session, no
# app-specific password. ⚠️ This uploads the app to Apple's notary service.
set -euo pipefail

die() { echo "✕ $*" >&2; exit 1; }

# An [app] argument is resolved against the caller's directory, before the cd.
if [ -n "${1:-}" ]; then
  [ -d "$1" ] || die "no app at $1"
  APP="$(cd "$1" && pwd)"
fi
cd "$(dirname "$0")/.."
REPO="$(pwd)"
BUILD="$REPO/mac/build"
APP="${APP:-$BUILD/Plumb.app}"
[ -d "$APP" ] || die "no app at $APP — run: bash mac/build-app.sh"

ENV_FILE="$HOME/.private_keys/asc.env"
[ -f "$ENV_FILE" ] || die "missing $ENV_FILE (it sets ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH)"
# shellcheck disable=SC1090
source "$ENV_FILE"
[ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] && [ -n "${ASC_KEY_PATH:-}" ] \
  || die "$ENV_FILE must set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH"
[ -f "$ASC_KEY_PATH" ] || die "the API key file named by ASC_KEY_PATH does not exist"

# Apple notarizes only Developer ID signatures with the hardened runtime. An
# ad-hoc or "Apple Development" signature would be rejected after the upload,
# so refuse here instead. (case, not grep -q: under pipefail an early-exiting
# grep can fail the pipe.)
SIGNATURE="$(codesign -dv --verbose=2 "$APP" 2>&1 || true)"
case "$SIGNATURE" in
  *"Authority=Developer ID Application:"*) ;;
  *) die "$APP is not signed with a \"Developer ID Application\" identity (ad-hoc and Apple Development cannot be notarized). Install a Developer ID cert, run bash mac/build-app.sh again, then this." ;;
esac
case "$SIGNATURE" in
  *"(runtime)"*) ;;
  *) die "$APP lacks the hardened runtime; rebuild with bash mac/build-app.sh, which signs with --options runtime" ;;
esac

SUBMISSION="$BUILD/Plumb-notarize.zip"
RESULT="$BUILD/notary-result.json"
SHARE="$BUILD/Plumb.zip"
mkdir -p "$BUILD"

echo "→ zipping for submission…"
rm -f "$SUBMISSION"
ditto -c -k --keepParent "$APP" "$SUBMISSION"

echo "→ submitting to Apple's notary service and waiting (usually a few minutes)…"
# Judge by the reported status, not the exit code, and keep the JSON either way.
xcrun notarytool submit "$SUBMISSION" \
  --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" \
  --wait --output-format json > "$RESULT" || true
STATUS="$(plutil -extract status raw -o - "$RESULT" 2>/dev/null || echo "unknown")"
SUBMISSION_ID="$(plutil -extract id raw -o - "$RESULT" 2>/dev/null || true)"
if [ "$STATUS" != "Accepted" ]; then
  echo "✕ notarization status: $STATUS" >&2
  cat "$RESULT" >&2
  if [ -n "$SUBMISSION_ID" ]; then
    echo "→ Apple's log for $SUBMISSION_ID:" >&2
    xcrun notarytool log "$SUBMISSION_ID" \
      --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" >&2 || true
  fi
  exit 1
fi
echo "  accepted ($SUBMISSION_ID)"
rm -f "$SUBMISSION"

echo "→ stapling the ticket into the app…"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=2 "$APP"   # expect: source=Notarized Developer ID

echo "→ zipping for sharing…"
rm -f "$SHARE"
ditto -c -k --keepParent "$APP" "$SHARE"
echo "✅ $SHARE — opens on any Mac without a Gatekeeper warning."
