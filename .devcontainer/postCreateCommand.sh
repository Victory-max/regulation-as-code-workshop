#!/usr/bin/env bash
# Provisions the workshop Codespace: Node 20 and Python (from the image and features), Claude
# Code, the workshop's npm dependencies (Elm 0.19.1, morphir-elm, DuckDB), the notebook's
# Python packages, and a warm Elm package cache so the first compiler-gate run during the
# workshop does not depend on package.elm-lang.org.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Claude Code"
npm install -g @anthropic-ai/claude-code

bash ./setup.sh
