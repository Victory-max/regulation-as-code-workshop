#!/usr/bin/env node
// Builds a DuckDB "enterprise runtime" from any Morphir IR: schema, rule views, synthetic
// rows that exercise every business case, then a zero-drift parity check against Morphir.
//
//   node scripts/enterprise-db.js --ir morphir-ir.json [--out out] [--db out/enterprise.db] [--rows 200]
//
// Nothing here is specific to a model: tables, columns and rules all come from the IR.

const fs = require("fs");
const path = require("path");
const { DuckDBInstance } = require("@duckdb/node-api");
const ir = require("./lib/morphir-ir");
const { emitDdl, findEntities, entityTables } = require("./morphir-to-ddl");
const { emitSql } = require("./morphir-to-sql");
const { checkParity } = require("./morphir-parity");
const { loadDecorations } = require("./lib/decorations");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

// Deterministic PRNG (mulberry32) so every run seeds the same rows.
function prng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Boundary-heavy decimal pool: zero, the cent, common rates and caps, half-cent ties.
const DECIMAL_POOL = ["0", "0.01", "4.5", "6", "12", "19.99", "24.99", "50.50", "100", "1234.56", "2500", "98765.43"];
// Columns that read as rates or percentages get realistic values around common caps.
const RATE_POOL = ["0", "4.5", "5.99", "6", "6.01", "12", "19.99", "24.99", "29.99"];
const isRate = (name) => /(apr|rate|pct|percent)$/.test(name);

function synthesizeRows(index, entityType, count, rand) {
  const table = ir.toSnake(ir.aliasName(entityType));
  const { columns } = entityTables(index).find((t) => t.name === table);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = {};
    columns.forEach((c, ci) => {
      const ct = ir.customTypeOf(index, c.tpe);
      if (ct && ir.isEnum(index, c.tpe)) {
        // Cycle through every case first so each one is guaranteed to appear.
        const n = ct.constructors.length;
        const k = i < n * 2 ? (i + ci) % n : Math.floor(rand() * n);
        row[c.name] = `'${ir.toTitle(ct.constructors[k][0])}'`;
        return;
      }
      switch (ir.sdkTypeKey(index, c.tpe)) {
        case ir.SDK.decimal:
          if (isRate(c.name)) row[c.name] = RATE_POOL[Math.floor(rand() * RATE_POOL.length)];
          else row[c.name] = rand() < 0.5 ? DECIMAL_POOL[Math.floor(rand() * DECIMAL_POOL.length)] : (rand() * 10000).toFixed(2);
          break;
        case ir.SDK.int:
          row[c.name] = String(Math.floor(rand() * 1000));
          break;
        case ir.SDK.float:
          row[c.name] = (rand() * 1000).toFixed(3);
          break;
        case ir.SDK.bool:
          row[c.name] = rand() < 0.5 ? "TRUE" : "FALSE";
          break;
        case ir.SDK.localDate:
          row[c.name] = `DATE '2026-09-${String(1 + (i % 30)).padStart(2, "0")}'`;
          break;
        default:
          row[c.name] = /currency$/.test(c.name) ? "'USD'" : `'${table}-${String(i + 1).padStart(4, "0")}'`;
      }
      if (c.optional && rand() < 0.1) row[c.name] = "NULL";
    });
    rows.push(row);
  }
  return { table, columns: columns.map((c) => c.name), rows };
}

async function main() {
  const irPath = opt("--ir", "morphir-ir.json");
  const outDir = opt("--out", "out");
  const dbPath = opt("--db", path.join(outDir, "enterprise.db"));
  const rowCount = Number(opt("--rows", 200));
  fs.mkdirSync(outDir, { recursive: true });

  const index = ir.indexIr(ir.loadIr(irPath));
  const decorations = loadDecorations(opt("--project", path.dirname(irPath)));
  const ddl = emitDdl(index, "duckdb", { decorations });
  const { sql, manifest } = emitSql(index, { dialect: "duckdb", materialize: false, decorations });
  const manifestPath = path.join(outDir, "rules.manifest.json");
  fs.writeFileSync(path.join(outDir, "schema.sql"), ddl);
  fs.writeFileSync(path.join(outDir, "rules.sql"), sql);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Generated ${path.join(outDir, "schema.sql")}, ${path.join(outDir, "rules.sql")} (${manifest.rules.length} rule views).`);
  for (const s of manifest.skipped) console.log(`  not translated: ${s.rule} (${s.reason})`);

  fs.rmSync(dbPath, { force: true });
  const db = await DuckDBInstance.create(dbPath);
  const conn = await db.connect();
  await conn.run(ddl);
  await conn.run(sql);
  // Persist the schema now: DuckDB 1.5 cannot replay a write-ahead log that contains column
  // comments on tables with CURRENT_TIMESTAMP defaults.
  await conn.run("CHECKPOINT");

  const rand = prng(20261104);
  for (const entity of findEntities(index)) {
    const { table, columns, rows } = synthesizeRows(index, entity, rowCount, rand);
    const values = rows.map((r) => `(${columns.map((c) => r[c]).join(", ")})`).join(",\n");
    await conn.run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${values};`);
    console.log(`Seeded ${rows.length} synthetic rows into ${table}.`);
  }

  const trim = (v) => (typeof v === "string" && /^-?\d+\.\d+$/.test(v) ? v.replace(/0+$/, "").replace(/\.$/, "") : v);
  for (const rule of manifest.rules) {
    const cols = [rule.keyColumn, ...rule.outputs.map((o) => o.column)].filter(Boolean);
    const reader = await conn.runAndReadAll(`SELECT ${cols.join(", ")} FROM ${rule.view} LIMIT ${rule.aggregate ? 1 : 5}`);
    const rows = reader.getRowObjectsJson().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, trim(v)])));
    console.log(`\n${rule.rule} -> ${rule.view}`);
    console.table(rows);
  }

  const parity = await checkParity({ irPath, manifestPath, connection: conn, limit: rowCount });
  await conn.run("CHECKPOINT");
  conn.closeSync();
  process.exit(parity.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(`enterprise-db: ${e.message}`);
  process.exit(1);
});
