#!/usr/bin/env bash
# Prepare an isolated public website with the current official release metadata.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
site=$(mktemp -d "${TMPDIR:-/tmp}/protoflow-website.XXXXXXXX")
git -C "$root/website" ls-files -z -- . ':!README.md' ':!downloads' |
  rsync -a --from0 --files-from=- "$root/website/" "$site/"
cp "$root/deploy/vercel-website.json" "$site/vercel.json"
cat >> "$site/config.js" <<'JS'
window.ALEX_SITE_CONFIG.releaseSource = 'github';
window.ALEX_SITE_CONFIG.githubReleaseProxy = true;
JS

# Keep the original GitHub fields consumed by the site's release validator.
gh api repos/EvanClub-Agent/protoflow-ai/releases/latest | jq -e '
  select(.draft == false and .prerelease == false and (.assets | length > 0))
  | {tag_name, draft, prerelease, html_url, published_at,
     assets: [.assets[] | {name, state, size, digest, browser_download_url}]}
' > "$site/release-snapshot.json"
echo "$site"
