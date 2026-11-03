#!/usr/bin/env node
// Generates a small web API from a verified Morphir model: one endpoint per policy rule, read
// endpoints over the database's current records, and automatic API docs. The rules run as the
// Python generated from the same model (out/policy_rules.py), which agrees with the database.
// An app written against it (in app/) is served at /app, so it never needs the rules itself.
//
//   node scripts/morphir-to-api.js [--ir morphir-ir.json] [--project .] [--out out/api.py]
//   python3 out/api.py        # http://localhost:8000  (docs at /docs, your app at /app)
//
// Nothing here is specific to a model.

const fs = require("fs");
const path = require("path");
const ir = require("./lib/morphir-ir");
const { entityTables } = require("./morphir-to-ddl");
const { emitSql } = require("./morphir-to-sql");
const { emitPython } = require("./morphir-to-python");
const { loadDecorations } = require("./lib/decorations");

const kebab = (name) => name.join("-");
const pyStr = (s) => JSON.stringify(String(s));

function emitApi(index, { decorations = null } = {}) {
  const pkg = ir.pathToString(index.packagePath);
  const { nameOf, skipped } = emitPython(index, { decorations });
  const skippedRules = new Set(skipped.map((s) => s.rule));
  const { manifest } = emitSql(index, { dialect: "duckdb", materialize: false, decorations });
  const tables = entityTables(index);

  // Request models: one per record type the endpoints take, nested records first.
  const models = new Map();
  const order = [];
  const modelName = (fqn) => ir.toTitle(fqn[2]);
  function pyType(tpe) {
    if (tpe[0] === "Reference") {
      const key = ir.fqnKey(tpe[2]);
      if (key === ir.SDK.maybe) return `Optional[${pyType(tpe[3][0])}]`;
      if (key === ir.SDK.list) return `List[${pyType(tpe[3][0])}]`;
    }
    if (ir.isEnum(index, tpe)) {
      const ct = ir.customTypeOf(index, tpe);
      return `Literal[${ct.constructors.map(([n]) => pyStr(ir.toTitle(n))).join(", ")}]`;
    }
    const fields = ir.recordFieldsOf(index, tpe);
    if (fields) {
      const fqn = tpe[0] === "Reference" ? tpe[2] : null;
      if (!fqn) throw new Error("anonymous record types are not supported in the API");
      defineModel(fqn, fields);
      return modelName(fqn);
    }
    switch (ir.sdkTypeKey(index, tpe)) {
      case ir.SDK.decimal:
        return "float";
      case ir.SDK.int:
        return "int";
      case ir.SDK.float:
        return "float";
      case ir.SDK.bool:
        return "bool";
      case ir.SDK.localDate:
        return "date";
      default:
        return "str";
    }
  }
  function defineModel(fqn, fields) {
    const key = ir.fqnKey(fqn);
    if (models.has(key)) return;
    models.set(key, null);
    const lines = fields.map((f) => {
      const name = ir.toSnake(f.name);
      const t = pyType(f.tpe);
      const isId = /Id$/.test(ir.toCamel(f.name)) && t === "str";
      return `    ${name}: ${t}${isId ? ' = "what-if"' : t.startsWith("Optional[") ? " = None" : ""}`;
    });
    const doc = (index.types.get(key) || { doc: "" }).doc.trim().replace(/\s*\n\s*/g, " ");
    models.set(key, `class ${modelName(fqn)}(BaseModel):\n    """${doc.replace(/"""/g, "'''")}"""\n${lines.join("\n")}`);
    order.push(key);
  }

  const linksFor = (fqn) =>
    decorations ? decorations.specLinksFor(`${ir.pathToString(fqn[0])}:${ir.pathToString(fqn[1])}:${ir.toCamel(fqn[2])}.value`) : [];

  const tableInfo = tables.map((t) => ({ name: t.name, key: t.key, source: `${t.name}_current`, model: (pyType(t.entityType), modelName(t.entityType[2])) }));
  const routes = [];
  for (const r of manifest.rules) {
    if (skippedRules.has(ir.fqnDisplay(r.fqn))) continue;
    const fn = nameOf(r.fqn);
    const slug = kebab(r.fqn[2]);
    const t = tables.find((x) => x.name === r.table);
    const links = linksFor(r.fqn).map((l) => l.section);
    const summary = r.doc ? r.doc.split("\n")[0].trim() : ir.toCamel(r.fqn[2]);
    const description = [r.doc ? r.doc.trim().replace(/\s*\n\s*/g, " ") : "", links.length ? `Regulation: ${links.join("; ")}` : ""].filter(Boolean).join("\n\n");
    if (r.aggregate) {
      routes.push(`
@app.get("/api/rules/${slug}", tags=["rules"], summary=${pyStr(summary)}, description=${pyStr(description)})
def rule_${fn}():
    with connect() as con:
        return {"rule": ${pyStr(r.rule)}, "result": to_json(rules.${fn}(rules.records(con, ${pyStr(r.source || r.table)}, ${pyStr(r.table)})))}
`);
    } else {
      const model = modelName(t.entityType[2]);
      routes.push(`
@app.post("/api/rules/${slug}", tags=["rules"], summary=${pyStr(summary)}, description=${pyStr(description)})
def rule_${fn}(record: ${model}):
    return {"rule": ${pyStr(r.rule)}, "result": to_json(rules.${fn}(to_record(record)))}


@app.get("/api/rules/${slug}", tags=["rules"], summary=${pyStr(`${summary} (every current record)`)}, description=${pyStr(description)})
def rule_${fn}_all():
    with connect() as con:
        recs = rules.records(con, ${pyStr(r.source || r.table)}, ${pyStr(r.table)})
    return [{"${t.key}": key_of(rec, ${pyStr(r.table)}), "result": to_json(rules.${fn}(rec))} for rec in recs]
`);
    }
  }
  const tableRoutes = tableInfo.map((t) => `
@app.get("/api/${t.name}", tags=["records"], summary=${pyStr(`Current ${t.name.replace(/_/g, " ")} records`)})
def list_${t.name}():
    with connect() as con:
        return [to_json(rec) for rec in rules.records(con, ${pyStr(t.source)}, ${pyStr(t.name)})]


@app.get("/api/${t.name}/{key}", tags=["records"], summary=${pyStr(`One current ${t.name.replace(/_/g, " ")} record`)})
def get_${t.name}(key: str):
    with connect() as con:
        for rec in rules.records(con, ${pyStr(t.source)}, ${pyStr(t.name)}):
            if str(key_of(rec, ${pyStr(t.name)})) == key:
                return to_json(rec)
    raise HTTPException(404, f"No ${t.name.replace(/_/g, " ")} {key}")
`);

  const source = `"""${pkg} policy API.

Generated from the verified Morphir model by scripts/morphir-to-api.js; do not edit by hand.
Every rule endpoint runs the Python generated from the same model (policy_rules.py), which agrees
with the database's rule views. Records come from the database's current views.

    python3 out/api.py      ->  http://localhost:8000   (docs at /docs, your app at /app)
"""

import os
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import List, Literal, Optional

import duckdb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import policy_rules as rules  # noqa: E402

DB = HERE / "enterprise.db"
APP_DIR = HERE.parent / "app"

app = FastAPI(
    title=${pyStr(`${pkg} policy API`)},
    description="Generated from the verified policy model. Each rule endpoint returns exactly what the verified policy decides.",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def connect():
    return duckdb.connect(str(DB), read_only=True)


def to_json(value):
    """A policy value as JSON: amounts as numbers, records as objects, choices as their names."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, rules.Record):
        return {k: to_json(v) for k, v in vars(value).items()}
    if isinstance(value, list):
        return [to_json(v) for v in value]
    if isinstance(value, date):
        return value.isoformat()
    return value


def to_record(model):
    """A request body as the policy's record: amounts as Decimals, nested records nested."""
    def convert(v):
        if isinstance(v, BaseModel):
            return rules.Record(**{k: convert(x) for k, x in v})
        if isinstance(v, float):
            return Decimal(str(v))
        if isinstance(v, list):
            return [convert(x) for x in v]
        return v
    return convert(model)


def key_of(rec, table):
    node = rec
    for part in dict(rules.COLUMNS[table])[KEYS[table]]:
        node = getattr(node, part)
    return node


KEYS = ${JSON.stringify(Object.fromEntries(tableInfo.map((t) => [t.name, t.key])))}

${order.map((k) => models.get(k)).join("\n\n\n")}


@app.get("/", include_in_schema=False)
def home():
    return RedirectResponse("/app/" if (APP_DIR / "index.html").exists() else "/docs")


@app.get("/api", tags=["policy"], summary="What this API offers")
def overview():
    return {
        "policy": ${pyStr(pkg)},
        "records": [${tableInfo.map((t) => `"/api/${t.name}"`).join(", ")}],
        "rules": [${manifest.rules.filter((r) => !skippedRules.has(ir.fqnDisplay(r.fqn))).map((r) => `"/api/rules/${kebab(r.fqn[2])}"`).join(", ")}],
        "docs": "/docs",
    }
${tableRoutes.join("")}${routes.join("")}

APP_DIR.mkdir(exist_ok=True)
app.mount("/app", StaticFiles(directory=str(APP_DIR), html=True), name="app")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
`;
  return { source, rules: routes.length, tables: tableInfo.length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const projectDir = opt("--project", ".");
  const irPath = opt("--ir", path.join(projectDir, "morphir-ir.json"));
  const outPath = opt("--out", path.join(projectDir, "out", "api.py"));
  const index = ir.indexIr(ir.loadIr(irPath));
  const { source, rules, tables } = emitApi(index, { decorations: loadDecorations(projectDir) });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, source);
  console.log(`API: ${outPath} (${rules} rule endpoints, ${tables} record tables; run: python3 ${path.relative(projectDir, outPath) || outPath})`);
}

module.exports = { emitApi };
