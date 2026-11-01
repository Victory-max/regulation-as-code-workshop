#!/usr/bin/env bash
# Provisions the workshop Codespace: Node 20 and Python (from the image and features), Claude
# Code, the workshop's npm dependencies (Elm 0.19.1, morphir-elm, DuckDB), the notebook's
# Python packages, and a warm Elm package cache so the first compiler-gate run during the
# workshop does not depend on package.elm-lang.org.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Claude Code"
npm install -g @anthropic-ai/claude-code

echo "==> Workshop dependencies (Elm, morphir-elm, DuckDB)"
npm ci || npm install

echo "==> Python packages for the policy notebook"
pip install --quiet -r requirements.txt

if compgen -G "repos/*/package.json" > /dev/null; then
  echo "==> Reference repositories"
  for repo in repos/*/; do
    if [[ -f "$repo/package.json" ]]; then
      (cd "$repo" && (npm ci || npm install))
    fi
  done
fi

echo "==> Warming the Elm package cache (elm/core, elm/json)"
warm="$(mktemp -d)"
mkdir -p "$warm/src/Warm"
cat > "$warm/morphir.json" <<'JSON'
{ "name": "Warm", "sourceDirectory": "src", "exposedModules": ["Rules"] }
JSON
cat > "$warm/src/Warm/Rules.elm" <<'ELM'
module Warm.Rules exposing (double)


double : Int -> Int
double n =
    n * 2
ELM
node scripts/morphir-check.js "$warm" > /dev/null || true
rm -rf "$warm"

echo "==> Versions"
node --version
npx elm --version
npx morphir-elm --version
claude --version || true

cat <<'EOF'

Ready. Start the workshop with:

    claude

Then describe Fiction Bank's policy in plain English (see README.md for the prompts).
EOF
