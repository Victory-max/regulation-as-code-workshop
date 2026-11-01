#!/usr/bin/env node
// Zero-drift check: every row the SQL views produced is replayed through Morphir's own
// interpreter (`morphir-elm test`) as an expected output. If SQL and Morphir disagree on a
// single value, by a single cent, the test run fails and the differing rows are listed.
//
//   node scripts/morphir-parity.js --ir morphir-ir.json --manifest rules.manifest.json --db app.db
//                                  [--rule Scra.Rules.statement]... [--limit 500]
//
// Library use: const { checkParity } = require("./morphir-parity"); await checkParity({...})

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ir = require("./lib/morphir-ir");
const { flattenColumns } = require("./morphir-to-ddl");

// Converts a DuckDB JSON value back into Morphir's JSON encoding for the given type.
function toMorphirJson(index, tpe, value) {
  if (value === null || value === undefined) return null;
  if (tpe[0] === "Reference" && ir.fqnKey(tpe[2]) === ir.SDK.maybe) return toMorphirJson(index, tpe[3][0], value);
  if (ir.isEnum(index, tpe)) return [value];
  switch (ir.sdkTypeKey(index, tpe)) {
    case ir.SDK.decimal:
      return normalizeDecimal(String(value));
    case ir.SDK.int:
      return Number(value);
    case ir.SDK.float:
      return Number(value);
    case ir.SDK.bool:
      return value === true || value === "true";
    default:
      return value;
  }
}

const normalizeDecimal = (s) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

// Rebuilds a nested Morphir record from its flattened columns.
function rowToRecord(index, entityType, row) {
  const record = {};
  for (const col of flattenColumns(index, ir.recordFieldsOf(index, entityType))) {
    let node = record;
    const keys = col.path.map(ir.toCamel);
    keys.slice(0, -1).forEach((k) => (node = node[k] = node[k] || {}));
    node[keys[keys.length - 1]] = toMorphirJson(index, col.tpe, row[col.name]);
  }
  return record;
}

function expectedOutput(index, rule, def, row) {
  if (!rule.outputIsRecord) return toMorphirJson(index, def.outputType, row[rule.outputs[0].column]);
  const fields = ir.recordFieldsOf(index, def.outputType);
  const out = {};
  rule.outputs.forEach((o, i) => (out[o.morphirField] = toMorphirJson(index, fields[i].tpe, row[o.column])));
  return out;
}

function findMorphirElm(start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const bin = path.join(dir, "node_modules", ".bin", "morphir-elm");
    if (fs.existsSync(bin)) return bin;
    if (dir === path.dirname(dir)) return "morphir-elm"; // fall back to PATH
  }
}

async function checkParity({ irPath, manifestPath, connection, rules: only = [], limit = 500, log = console.log }) {
  const rawIr = ir.loadIr(irPath);
  const index = ir.indexIr(rawIr);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const selected = manifest.rules.filter((r) => only.length === 0 || only.includes(r.rule));
  const suites = [];
  let caseCount = 0;

  for (const rule of selected) {
    const { def } = index.values.get(ir.fqnKey(rule.fqn));
    const inputType = def.inputTypes[0][2];
    const entityType = rule.aggregate ? inputType[3][0] : inputType;
    const cases = [];
    if (rule.aggregate) {
      const rows = (await connection.runAndReadAll(`SELECT * FROM ${rule.source || rule.table}`)).getRowObjectsJson();
      const [result] = (await connection.runAndReadAll(`SELECT * FROM ${rule.view}`)).getRowObjectsJson();
      cases.push({
        inputs: [rows.map((r) => rowToRecord(index, entityType, r))],
        expectedOutput: expectedOutput(index, rule, def, result),
        description: `${rule.view} over ${rows.length} rows`,
      });
    } else {
      const rows = (await connection.runAndReadAll(`SELECT * FROM ${rule.view} LIMIT ${limit}`)).getRowObjectsJson();
      rows.forEach((row, i) =>
        cases.push({
          inputs: [rowToRecord(index, entityType, row)],
          expectedOutput: expectedOutput(index, rule, def, row),
          description: `${rule.view} row ${i + 1}`,
        })
      );
    }
    caseCount += cases.length;
    suites.push([rule.fqn, cases]);
  }

  // morphir-elm test reads morphir-ir.json + morphir-tests.json from a project directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "morphir-parity-"));
  fs.copyFileSync(irPath, path.join(dir, "morphir-ir.json"));
  fs.writeFileSync(path.join(dir, "morphir-tests.json"), JSON.stringify(suites));
  fs.writeFileSync(path.join(dir, "morphir.json"), JSON.stringify({ name: manifest.package, sourceDirectory: "src", exposedModules: [] }));
  const run = spawnSync(findMorphirElm(path.dirname(irPath)), ["test", "-p", dir], { encoding: "utf8" });
  const output = `${run.stdout}\n${run.stderr}`;
  const failLines = output.split("\n").filter((l) => /Expected Output|Actual Output/.test(l));
  const passed = run.status === 0;

  log(`Parity: ${caseCount} SQL results replayed through the Morphir interpreter across ${selected.length} rule(s).`);
  if (passed) log("Parity: zero drift. SQL and Morphir agree on every value.");
  else {
    log("Parity: DRIFT DETECTED.");
    failLines.slice(0, 20).forEach((l) => log(`  ${l.replace(/^\[[^\]]+\]\s*/, "")}`));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { passed, caseCount, rules: selected.map((r) => r.rule), output: passed ? "" : output };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const rules = args.flatMap((a, i) => (a === "--rule" ? [args[i + 1]] : []));
  (async () => {
    const { DuckDBInstance } = require("@duckdb/node-api");
    const db = await DuckDBInstance.create(opt("--db", "app.db"));
    const connection = await db.connect();
    const result = await checkParity({
      irPath: opt("--ir", "morphir-ir.json"),
      manifestPath: opt("--manifest", "rules.manifest.json"),
      connection,
      rules,
      limit: Number(opt("--limit", 500)),
    });
    process.exit(result.passed ? 0 : 1);
  })().catch((e) => {
    console.error(`morphir-parity: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { checkParity, rowToRecord, toMorphirJson };
