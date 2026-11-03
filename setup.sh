#!/usr/bin/env bash
# One-step setup for the workshop workspace, on a laptop or in a Codespace:
#   ./setup.sh
# Checks Node.js and Python, installs the workshop's packages, warms the Elm package cache so the
# first policy check doesn't depend on package.elm-lang.org, and checks that Claude Code is
# installed. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")"

fail() { echo; echo "Setup stopped: $1" >&2; exit 1; }

echo "==> Checking Node.js and Python"
command -v node > /dev/null || fail "Node.js 20 or newer is needed (https://nodejs.org), or use a Codespace."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" -ge 20 ]] || fail "Node.js 20 or newer is needed; this is $(node --version)."
PY="$(command -v python3 || command -v python || true)"
[[ -n "$PY" ]] || fail "Python 3.10 or newer is needed for the notebook (https://www.python.org)."
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || fail "Python 3.10 or newer is needed; this is $("$PY" --version)."

echo "==> Workshop packages (Morphir, Elm, DuckDB, the policy server)"
npm ci --no-audit --no-fund || npm install --no-audit --no-fund

echo "==> Notebook packages"
"$PY" -m pip install --quiet --disable-pip-version-check -r requirements.txt || "$PY" -m pip install --quiet --disable-pip-version-check --user -r requirements.txt

echo "==> Warming the Elm package cache"
warm="$(mktemp -d)"
mkdir -p "$warm/src/Warm"
printf '{ "name": "Warm", "sourceDirectory": "src", "exposedModules": ["Rules"] }\n' > "$warm/morphir.json"
printf 'module Warm.Rules exposing (double)\n\n\ndouble : Int -> Int\ndouble n =\n    n * 2\n' > "$warm/src/Warm/Rules.elm"
node scripts/morphir-check.js "$warm" > /dev/null || true
rm -rf "$warm"

echo "==> Claude Code"
if command -v claude > /dev/null; then
  claude --version
  next="Start the workshop from this folder with:

    claude"
else
  next="Claude Code isn't installed. Either install it:

    npm install -g @anthropic-ai/claude-code

then run   claude   in this folder, or open this folder in the Code tab of the Claude desktop app."
fi

cat <<EOF

Ready. This folder is your workspace: $(pwd)

$next

When Claude asks to approve morphir-policy, approve it.
EOF
