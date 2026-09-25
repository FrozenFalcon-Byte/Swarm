#!/usr/bin/env bash
# Deploy the web app and the security rules to your Firebase project.
#   scripts/deploy.sh            rules + indexes + hosting
#   scripts/deploy.sh rules      rules + indexes only
set -euo pipefail
cd "$(dirname "$0")/.."

project=$(grep -E '^VITE_FIREBASE_PROJECT_ID=' web/.env.local 2>/dev/null | cut -d= -f2- || true)
if [[ -z "${project}" || "${project}" == "demo-swarm" ]]; then
  echo "Set VITE_FIREBASE_PROJECT_ID in web/.env.local first (see SETUP.md)." >&2; exit 1
fi
if grep -qE '^VITE_USE_EMULATORS=true' web/.env.local; then
  echo "web/.env.local still has VITE_USE_EMULATORS=true. Set it to false before deploying." >&2; exit 1
fi

only="firestore:rules,firestore:indexes"
# Storage rules only if the project uses Cloud Storage (Blaze plan)
if grep -qE '^VITE_FIREBASE_STORAGE_BUCKET=.+' web/.env.local; then only="${only},storage"; fi
if [[ "${1:-all}" != "rules" ]]; then
  (cd web && npm run build)
  only="${only},hosting"
fi
npx --yes firebase-tools@latest deploy --project "${project}" --only "${only}"
