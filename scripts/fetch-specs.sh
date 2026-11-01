#!/usr/bin/env bash
# Downloads a folder of specification Markdown from GitHub into ./specs, and records where it
# came from (specs/source.json) so every spec link can be traced to an exact revision.
#
#   scripts/fetch-specs.sh https://github.com/<owner>/<repo>/tree/main/<folder of spec markdown>
#
# Uses a shallow sparse git clone: one connection, no GitHub API rate limits (which a room
# full of people behind one conference IP would hit).
set -euo pipefail

URL="${1:?usage: fetch-specs.sh <github folder url> [dest]}"
DEST="${2:-specs}"

if [[ ! "$URL" =~ ^https://github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.+)$ ]]; then
  echo "Expected a GitHub folder URL like https://github.com/<owner>/<repo>/tree/<branch>/<path>" >&2
  exit 64
fi
OWNER="${BASH_REMATCH[1]}"
REPO="${BASH_REMATCH[2]}"
REF="${BASH_REMATCH[3]}"
SUBPATH="${BASH_REMATCH[4]%/}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone --quiet --depth 1 --filter=blob:none --sparse --branch "$REF" "https://github.com/$OWNER/$REPO.git" "$work/repo"
git -C "$work/repo" sparse-checkout set --no-cone "/$SUBPATH/"
COMMIT="$(git -C "$work/repo" rev-parse HEAD)"

mkdir -p "$DEST"
cp -R "$work/repo/$SUBPATH/." "$DEST/"
cat > "$DEST/source.json" <<EOF
{
  "url": "$URL",
  "repository": "https://github.com/$OWNER/$REPO",
  "ref": "$REF",
  "path": "$SUBPATH",
  "commit": "$COMMIT",
  "permalinkBase": "https://github.com/$OWNER/$REPO/blob/$COMMIT/$SUBPATH",
  "fetchedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
echo "$(find "$DEST" -name '*.md' | wc -l | tr -d ' ') spec files -> $DEST (commit ${COMMIT:0:7})"
