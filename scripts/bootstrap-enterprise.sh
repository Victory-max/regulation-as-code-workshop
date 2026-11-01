#!/usr/bin/env bash
# One-click enterprise runtime for whatever the SME has verified in this workspace:
#   compile (compiler gate) -> morphir-ir.json -> DuckDB DDL + rule SQL -> seeded DuckDB -> parity check
#   -> a Jupyter notebook for exploring the result (out/policy-notebook.ipynb).
#
#   scripts/bootstrap-enterprise.sh                       # use the model authored in ./src
#   scripts/bootstrap-enterprise.sh --cheat-sheet scra    # fallback: install the pre-built SCRA model
#   scripts/bootstrap-enterprise.sh --cheat-sheet lcr     # fallback: install the pre-built FR 2052a model
#   scripts/bootstrap-enterprise.sh --cheat-sheet hqla    # fallback: install the pre-built HQLA model
#   scripts/bootstrap-enterprise.sh --rows 1000           # more synthetic rows
# A cheat-sheet install copies the verified model (IR, morphir.json, decorations) into this
# workspace, as if the session had produced it; any existing model is backed up first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$(pwd)"
OUT="$PROJECT/out"
ROWS=200
CHEAT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cheat-sheet) CHEAT="$2"; shift 2 ;;
    --rows) ROWS="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 64 ;;
  esac
done

if [[ -n "$CHEAT" ]]; then
  SRC="$ROOT/cheat-sheet/$CHEAT"
  if [[ ! -d "$SRC" ]]; then echo "Unknown cheat sheet '$CHEAT' (use scra, lcr or hqla)" >&2; exit 64; fi
  if [[ -f "$PROJECT/morphir-ir.json" ]]; then
    backup="$PROJECT/.morphir/backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup"
    for f in morphir-ir.json morphir.json descriptions.json spec-links.json spec-scope.json; do
      if [[ -f "$PROJECT/$f" ]]; then cp "$PROJECT/$f" "$backup/"; fi
    done
    echo "==> Backed up the existing model to ${backup#$PROJECT/}"
  fi
  cp "$SRC"/*.json "$PROJECT/"
  IR="$PROJECT/morphir-ir.json"
  echo "==> Installed the pre-built $CHEAT model"
else
  echo "==> Compiler gate"
  set +e
  node "$ROOT/scripts/morphir-check.js" "$PROJECT" > "$OUT.verdict.json" 2>/dev/null
  status=$?
  set -e
  if [[ $status -ne 0 ]]; then
    node -e '
      const v = require(process.argv[1]);
      if (v.status === "needs_sme_clarification") {
        console.log("The model is not verified yet. Open business questions:");
        for (const c of v.clarifications) console.log(`  - ${c.rule}: what should happen for ${c.missingCases.join(", ")}?`);
      } else console.log("The model is not verified yet (" + v.status + "). Ask Claude to finish formalizing it.");
    ' "$OUT.verdict.json"
    rm -f "$OUT.verdict.json"
    exit 1
  fi
  rm -f "$OUT.verdict.json"
  IR="$PROJECT/morphir-ir.json"
  echo "    verified -> morphir-ir.json"
fi

echo "==> Transpile, seed and evaluate in DuckDB"
node "$ROOT/scripts/enterprise-db.js" --ir "$IR" --project "$PROJECT" --out "$OUT" --db "$OUT/enterprise.db" --rows "$ROWS"
echo "==> Notebook"
node "$ROOT/scripts/morphir-to-notebook.js" --ir "$IR" --project "$PROJECT" --db "$OUT/enterprise.db" --out "$OUT/policy-notebook.ipynb"
echo "==> Done. Database: $OUT/enterprise.db  Notebook: $OUT/policy-notebook.ipynb"
