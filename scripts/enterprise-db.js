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
const { emitDdl, findEntities, entityTables, flattenColumns } = require("./morphir-to-ddl");
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
const DECIMAL_POOL = ["0", "0.01", "4.5", "6", "12", "19.99", "24.99", "50.50", "100", "1234.56", "2500", "9876.54"];
// Columns that read as rates or percentages get realistic values around common caps.
const RATE_POOL = ["0", "4.5", "5.99", "6", "6.01", "12", "19.99", "24.99", "29.99"];
const isRate = (name) => /(apr|rate|pct|percent)$/.test(name);

function synthesizeRows(index, entityType, count, rand) {
  const table = ir.toSnake(ir.aliasName(entityType));
  const { columns } = entityTables(index).find((t) => t.name === table);
  const rows = [];
  const enumCases = {};
  const decimalColumns = [];
  columns.forEach((c) => {
    const ct = ir.customTypeOf(index, c.tpe);
    if (ct && ir.isEnum(index, c.tpe)) enumCases[c.name] = ct.constructors.map((k) => `'${ir.toTitle(k[0])}'`);
    else if (ir.sdkTypeKey(index, c.tpe) === ir.SDK.decimal && !isRate(c.name)) decimalColumns.push(c.name);
  });
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
  return { table, columns: columns.map((c) => c.name), rows, enumCases, decimalColumns };
}

// Realistic history for a source table, so that only the bitemporal reading is right:
//   - the initial load, recorded 30 days ago;
//   - source restatements: a later version of some records (the raw table now holds two rows
//     for each, so a plain SUM double counts);
//   - forward-dated records, booked already but not in effect until next quarter;
//   - manual adjustments in <table>_adjustments: a fat-finger amount corrected, an asset
//     reclassified, a value corrected after review. The current view applies them.
// Returns how many of each were written.
// Fat-finger errors in the source: a few amounts keyed 100 times too large. Applied to the rows
// before they are loaded; seedHistory corrects each one with a manual adjustment, so the only
// wrong amounts in the data are the ones the adjustments fix.
function planFatFingers(synth, rand) {
  const { rows, columns, decimalColumns } = synth;
  synth.fatFingers = [];
  if (!columns.includes("record_id") || rows.length < 20 || !decimalColumns.length) return;
  for (let n = 0; n < 2; n++) {
    const i = Math.floor(rand() * rows.length);
    const c = decimalColumns[0];
    if (synth.fatFingers.some((f) => f.i === i) || !/^\d+(\.\d+)?$/.test(rows[i][c]) || Number(rows[i][c]) === 0) continue;
    synth.fatFingers.push({ i, column: c, correct: rows[i][c], keyed: (Number(rows[i][c]) * 100).toFixed(2) });
    rows[i][c] = synth.fatFingers[synth.fatFingers.length - 1].keyed;
  }
}

async function seedHistory(conn, { table, columns, rows, enumCases, decimalColumns, fatFingers = [] }, rand) {
  const key = "record_id";
  if (!columns.includes(key) || rows.length < 20) return null;
  const insert = (target, cols, valueRows) =>
    conn.run(`INSERT INTO ${target} (${cols.join(", ")}) VALUES\n${valueRows.map((v) => `(${v.join(", ")})`).join(",\n")};`);
  const at = (days) => `CURRENT_TIMESTAMP - INTERVAL ${days} DAY`;
  const pick = (n, taken) => {
    const out = [];
    while (out.length < n) {
      const i = Math.floor(rand() * rows.length);
      if (!taken.has(i)) { taken.add(i); out.push(i); }
    }
    return out;
  };
  const taken = new Set(fatFingers.map((f) => f.i));
  const latest = rows.map((r) => ({ ...r }));

  // Restatements by the source system.
  const restated = decimalColumns.length ? pick(Math.round(rows.length * 0.05), taken) : [];
  if (restated.length) {
    const versions = restated.map((i) => {
      const v = { ...rows[i] };
      for (const c of decimalColumns) if (v[c] !== "NULL") v[c] = `ROUND(${v[c]} * 1.05, 2)`;
      latest[i] = v;
      return [...columns.map((c) => v[c]), at(15)];
    });
    await insert(table, [...columns, "recorded_at"], versions);
  }

  // Forward-dated records: not in effect until 45 days from now.
  const future = rows.slice(0, 5).map((r, n) => {
    const v = { ...r, [key]: `'${table}-F${String(n + 1).padStart(3, "0")}'` };
    return [...columns.map((c) => v[c]), "CURRENT_DATE + INTERVAL 45 DAY", at(5)];
  });
  await insert(table, [...columns, "valid_from", "recorded_at"], future);

  // Manual adjustments: full replacement versions, recorded after the restatements.
  const adjusted = pick(Math.max(0, Math.round(rows.length * 0.04) - fatFingers.length), taken);
  const enumCols = Object.keys(enumCases).filter((c) => enumCases[c].length > 1);
  const money = (x) => Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fixes = fatFingers.map((f, n) => {
    const v = { ...latest[f.i], [f.column]: f.correct };
    const reason = `Fat-finger entry: ${f.column.replace(/_/g, " ")} keyed as ${money(f.keyed)}, should be ${money(f.correct)}`;
    return [`'ADJ-${table}-${String(n + 1).padStart(3, "0")}'`, `'${reason}'`, "'liquidity-operations'", ...columns.map((c) => v[c]), at(10)];
  });
  const adjustments = [...fixes, ...adjusted.map((i, m) => {
    const n = m + fixes.length;
    const v = { ...latest[i] };
    let reason;
    if (n % 2 === 0 && enumCols.length) {
      const c = enumCols[n % enumCols.length];
      const cases = enumCases[c];
      const to = cases[(cases.indexOf(v[c]) + 1) % cases.length];
      reason = `Reclassified ${c.replace(/_/g, " ")} from ${v[c].replace(/'/g, "")} to ${to.replace(/'/g, "")} after review`;
      v[c] = to;
    } else if (decimalColumns.length) {
      const c = decimalColumns[n % decimalColumns.length];
      v[c] = v[c] === "NULL" ? "NULL" : `ROUND(${v[c]} * 0.5, 2)`;
      reason = `Corrected ${c.replace(/_/g, " ")}: source value double counted`;
    } else return null;
    return [`'ADJ-${table}-${String(n + 1).padStart(3, "0")}'`, `'${reason.replace(/'/g, "''")}'`, "'liquidity-operations'", ...columns.map((c) => v[c]), at(10)];
  })].filter(Boolean);
  if (adjustments.length) await insert(`${table}_adjustments`, ["adjustment_id", "reason", "adjusted_by", ...columns, "recorded_at"], adjustments);
  return { restated: restated.length, future: future.length, adjusted: adjustments.length };
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
  // Calculation tables (manifest.feeds) are seeded last, once the data their calculated fields
  // come from is in place: one run (the bank's own calculation) whose calculated fields are the
  // rules' actual results and whose reported amounts are sample values scaled to them, so the
  // ratio stays plausible. Recalculations then add versions to its history.
  const feedOf = new Map((manifest.feeds || []).map((f) => [f.table, f]));
  const entities = findEntities(index);
  const ordered = [...entities.filter((e) => !feedOf.has(ir.toSnake(ir.aliasName(e)))), ...entities.filter((e) => feedOf.has(ir.toSnake(ir.aliasName(e))))];
  for (const entity of ordered) {
    const table = ir.toSnake(ir.aliasName(entity));
    const feed = feedOf.get(table);
    const synth = synthesizeRows(index, entity, feed ? 1 : rowCount, rand);
    if (!feed) planFatFingers(synth, rand);
    const { columns, rows } = synth;
    if (feed) {
      const calculated = new Map(feed.calculated.map((x) => [x.column, `(SELECT ${x.output} FROM ${x.view})`]));
      const scale = [...calculated.values()].join(" + ");
      const decimals = new Set(flattenColumns(index, ir.recordFieldsOf(index, entity)).filter((c) => ir.sdkTypeKey(index, c.tpe) === ir.SDK.decimal).map((c) => c.name));
      rows.forEach((r, i) => {
        for (const c of columns) {
          if (calculated.has(c)) r[c] = calculated.get(c);
          else if (decimals.has(c)) r[c] = `ROUND((${scale}) * ${[0.2, 0.35, 0.5][(i + c.length) % 3]}, 2)`;
        }
      });
    }
    // Source rows are the initial load, recorded 30 days ago; a calculation run is recorded now,
    // after every correction, so its calculated fields are the corrected results.
    const loaded = feed ? columns : [...columns, "recorded_at"];
    const values = rows.map((r) => `(${[...columns.map((c) => r[c]), ...(feed ? [] : ["CURRENT_TIMESTAMP - INTERVAL 30 DAY"])].join(", ")})`).join(",\n");
    await conn.run(`INSERT INTO ${table} (${loaded.join(", ")}) VALUES\n${values};`);
    console.log(feed ? `Seeded ${rows.length} calculation run into ${table} (calculated: ${feed.calculated.map((x) => x.column).join(", ")}).` : `Seeded ${rows.length} synthetic rows into ${table}.`);
    if (!feed) {
      const h = await seedHistory(conn, synth, rand);
      if (h) console.log(`  history: ${h.restated} restated by the source, ${h.future} forward-dated, ${h.adjusted} manual adjustments (${synth.fatFingers.length} fat-finger fixes)`);
    }
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
