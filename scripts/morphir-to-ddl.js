#!/usr/bin/env node
// Emits SQL DDL (ENUMs + CREATE TABLE) from a Morphir IR.
//
//   node scripts/morphir-to-ddl.js [morphir-ir.json] [--dialect duckdb|ansi] [--out schema.sql]
//
// Mapping rules (generic: nothing here knows about SCRA or LCR):
//   - A custom type whose constructors take no arguments  -> ENUM (duckdb) or CHECK constraint (ansi).
//   - A record alias that is the input of a public rule    -> TABLE (one row per record).
//     `List X` inputs make X a table too (aggregate rules run over it).
//   - Nested records are flattened into prefixed columns:   cashBalance.amount.value -> cash_balance_amount_value
//   - Maybe X                                               -> nullable column; everything else is NOT NULL.
//   - Decimal -> DECIMAL(18,4), Int -> BIGINT, Float -> DOUBLE, Bool -> BOOLEAN, String -> VARCHAR, LocalDate -> DATE.
//
// Temporal layout (default; --no-temporal for plain tables). Every entity table is bitemporal
// and append-only: a row is a version of a business record, never updated in place.
//   <table>               valid_from / valid_to (business time, [from, to)) and recorded_at
//                         (when the bank recorded it). A correction is a new row.
//   <table>_adjustments   manual adjustments: full replacement versions of a record, with
//                         adjustment_id, reason and adjusted_by. Never mixed into <table>.
//   <table>_history       view: both, labelled by record_source ('source' | 'adjustment').
//   <table>_as_of(d, t)   table macro: the version of each record valid on date d, as known
//                         at time t (the latest recorded version wins; adjustments win ties).
//   <table>_current       view: <table>_as_of(today, now). Rule views read from this.
// The business key is the first column named *_id. An entity without one gets a generated
// record_id column (not part of the policy model) so every record can be addressed.

const fs = require("fs");
const path = require("path");
const ir = require("./lib/morphir-ir");
const { loadDecorations, columnAnnotation, annotationText, typeId } = require("./lib/decorations");

const DECIMAL_COLUMN = "DECIMAL(18, 4)";

const TEMPORAL_COLUMNS = [
  "    valid_from DATE NOT NULL DEFAULT DATE '1900-01-01'",
  "    valid_to DATE NOT NULL DEFAULT DATE '9999-12-31'",
  "    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
];
const ADJUSTMENT_COLUMNS = ["    adjustment_id VARCHAR NOT NULL", "    reason VARCHAR NOT NULL", "    adjusted_by VARCHAR NOT NULL"];

function parseArgs(argv) {
  const opts = { irPath: "morphir-ir.json", dialect: "duckdb", out: null, temporal: true, project: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dialect") opts.dialect = argv[++i];
    else if (argv[i] === "--out") opts.out = argv[++i];
    else if (argv[i] === "--no-temporal") opts.temporal = false;
    else if (argv[i] === "--project") opts.project = argv[++i];
    else opts.irPath = argv[i];
  }
  if (!["duckdb", "ansi"].includes(opts.dialect)) throw new Error(`Unknown dialect ${opts.dialect}`);
  return opts;
}

// Record types that rules take as input: these are the business entities.
function findEntities(index) {
  const entities = new Map();
  const consider = (tpe) => {
    if (tpe[0] === "Reference" && ir.fqnKey(tpe[2]) === ir.SDK.list) tpe = tpe[3][0];
    if (ir.recordFieldsOf(index, tpe) && ir.aliasName(tpe)) entities.set(ir.fqnKey(tpe[2]), tpe);
  };
  for (const { access, def } of index.values.values()) {
    if (access === "Public" && def.inputTypes.length === 1) consider(def.inputTypes[0][2]);
  }
  return [...entities.values()];
}

const enumTypeName = (fqn) => ir.toSnake(fqn[2]);

function columnType(index, tpe, dialect) {
  const ct = ir.customTypeOf(index, tpe);
  if (ct) {
    if (ir.isEnum(index, tpe)) return dialect === "duckdb" ? enumTypeName(ct.fqn) : "VARCHAR(64)";
    return "VARCHAR"; // constructors with arguments: stored as the Morphir JSON encoding
  }
  switch (ir.sdkTypeKey(index, tpe)) {
    case ir.SDK.decimal:
      return DECIMAL_COLUMN;
    case ir.SDK.int:
      return "BIGINT";
    case ir.SDK.float:
      return "DOUBLE";
    case ir.SDK.bool:
      return "BOOLEAN";
    case ir.SDK.string:
    case ir.SDK.char:
      return "VARCHAR";
    case ir.SDK.localDate:
      return "DATE";
    case ir.SDK.localTime:
      return "TIME";
    default:
      return "VARCHAR"; // lists, tuples, other SDK types: serialized
  }
}

// Depth-first flattening of (possibly nested, possibly optional) record fields.
function flattenColumns(index, fields, prefix = [], nullable = false) {
  const columns = [];
  for (const { name, tpe } of fields) {
    let fieldType = tpe;
    let optional = nullable;
    if (fieldType[0] === "Reference" && ir.fqnKey(fieldType[2]) === ir.SDK.maybe) {
      fieldType = fieldType[3][0];
      optional = true;
    }
    const nested = ir.recordFieldsOf(index, fieldType);
    if (nested) columns.push(...flattenColumns(index, nested, [...prefix, name], optional));
    else columns.push({ name: ir.toSnake(prefix.flat().concat(name)), path: [...prefix, name], tpe: fieldType, optional });
  }
  return columns;
}

const RECORD_ID = {
  name: "record_id",
  path: [["record", "id"]],
  tpe: ["Reference", {}, [[["morphir"], ["s", "d", "k"]], [["string"]], ["string"]], []],
  optional: false,
  generated: true,
};

// The table layout for every entity: name, business key, columns.
function entityTables(index) {
  return findEntities(index).map((tpe) => {
    const columns = flattenColumns(index, ir.recordFieldsOf(index, tpe));
    if (!columns.some((c) => /(^|_)id$/.test(c.name))) columns.unshift(RECORD_ID);
    const key = columns.find((c) => /(^|_)id$/.test(c.name)).name;
    return {
      name: ir.toSnake(ir.aliasName(tpe)),
      entityType: tpe,
      doc: index.types.get(ir.fqnKey(tpe[2])).doc.trim(),
      source: ir.fqnDisplay(tpe[2]),
      key,
      columns,
    };
  });
}

// The relation rule views read from: the current version of each record when temporal.
const ruleSource = (table, temporal) => (temporal ? `${table}_current` : table);

function emitTemporalViews(t, dialect) {
  const business = t.columns.map((c) => c.name).join(", ");
  const out = [];
  out.push(`-- History of ${t.name}: recorded versions and manual adjustments, side by side.`);
  out.push(
    `CREATE OR REPLACE VIEW ${t.name}_history AS\n` +
      `SELECT ${business}, valid_from, valid_to, recorded_at, 'source' AS record_source, NULL AS adjustment_id, NULL AS reason, NULL AS adjusted_by FROM ${t.name}\n` +
      `UNION ALL\n` +
      `SELECT ${business}, valid_from, valid_to, recorded_at, 'adjustment' AS record_source, adjustment_id, reason, adjusted_by FROM ${t.name}_adjustments;`
  );
  const pick = (validDate, knownAt) =>
    `SELECT * EXCLUDE (version_rank) FROM (\n` +
    `    SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.${t.key} ORDER BY h.recorded_at DESC, h.record_source = 'adjustment' DESC) AS version_rank\n` +
    `    FROM ${t.name}_history h\n` +
    `    WHERE h.valid_from <= ${validDate} AND ${validDate} < h.valid_to AND h.recorded_at <= ${knownAt}\n` +
    `) WHERE version_rank = 1`;
  if (dialect === "duckdb") {
    out.push(`-- ${t.name} as it was on business date valid_date, as known at time known_at.`);
    out.push(`CREATE OR REPLACE MACRO ${t.name}_as_of(valid_date, known_at) AS TABLE\n${pick("valid_date", "known_at")};`);
    out.push(`-- The current version of each ${t.name} record.`);
    out.push(`CREATE OR REPLACE VIEW ${t.name}_current AS SELECT * FROM ${t.name}_as_of(CURRENT_DATE, CURRENT_TIMESTAMP);`);
  } else {
    out.push(`CREATE VIEW ${t.name}_current AS\n${pick("CURRENT_DATE", "CURRENT_TIMESTAMP").replace("SELECT * EXCLUDE (version_rank)", `SELECT ${business}, valid_from, valid_to, recorded_at, record_source, adjustment_id, reason, adjusted_by`)};`);
  }
  out.push("");
  return out;
}

const sqlText = (s) => `'${s.replace(/'/g, "''")}'`;

// COMMENT ON statements carrying descriptions and spec links into the database catalog.
function tableComments(index, deco, t, relation) {
  const out = [];
  const tableText = annotationText({ description: t.doc, specLinks: deco.specLinksFor(typeId(t.entityType[2])) });
  if (tableText) out.push(`COMMENT ON TABLE ${relation} IS ${sqlText(tableText)};`);
  for (const c of t.columns) {
    const text = annotationText(columnAnnotation(index, deco, t.entityType, c));
    if (text) out.push(`COMMENT ON COLUMN ${relation}.${c.name} IS ${sqlText(text)};`);
  }
  return out;
}

function emitDdl(index, dialect, { temporal = true, decorations = null } = {}) {
  const deco = decorations || loadDecorations("/nonexistent");
  const out = [];
  const tables = entityTables(index);

  // Enums used by any table column, in a stable order.
  const enums = new Map();
  for (const t of tables) {
    for (const c of t.columns) {
      if (ir.isEnum(index, c.tpe)) {
        const ct = ir.customTypeOf(index, c.tpe);
        enums.set(ir.fqnKey(ct.fqn), ct);
      }
    }
  }

  out.push(`-- Generated by morphir-to-ddl.js from Morphir IR (package ${ir.pathToString(index.packagePath)}).`);
  out.push(`-- Do not edit: regenerate from the SME-verified model instead.`);
  out.push("");

  if (dialect === "duckdb") {
    for (const ct of enums.values()) {
      const labels = ct.constructors.map(([n]) => `'${ir.toTitle(n)}'`).join(", ");
      out.push(`-- Morphir custom type ${ir.fqnDisplay(ct.fqn)}`);
      out.push(`CREATE TYPE ${enumTypeName(ct.fqn)} AS ENUM (${labels});`);
      out.push("");
    }
  }

  for (const t of tables) {
    out.push(`-- Morphir record ${t.source}`);
    const lines = t.columns.map((c) => {
      let line = `    ${c.name} ${columnType(index, c.tpe, dialect)}${c.optional ? "" : " NOT NULL"}`;
      if (dialect === "ansi" && ir.isEnum(index, c.tpe)) {
        const labels = ir.customTypeOf(index, c.tpe).constructors.map(([n]) => `'${ir.toTitle(n)}'`);
        line += ` CHECK (${c.name} IN (${labels.join(", ")}))`;
      }
      return line;
    });
    out.push(`CREATE TABLE ${t.name} (\n${[...lines, ...(temporal ? TEMPORAL_COLUMNS : [])].join(",\n")}\n);`);
    if (dialect === "duckdb") out.push(...tableComments(index, deco, t, t.name));
    out.push("");
    if (temporal) {
      out.push(`-- Manual adjustments to ${t.name}: full replacement versions, kept apart from source data.`);
      out.push(`CREATE TABLE ${t.name}_adjustments (\n${[...ADJUSTMENT_COLUMNS, ...lines, ...TEMPORAL_COLUMNS].join(",\n")}\n);`);
      if (dialect === "duckdb") out.push(...tableComments(index, deco, t, `${t.name}_adjustments`).filter((l) => l.startsWith("COMMENT ON COLUMN")));
      out.push("");
      out.push(...emitTemporalViews(t, dialect));
    }
  }
  return out.join("\n");
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const decorations = loadDecorations(opts.project || path.dirname(opts.irPath));
    const ddl = emitDdl(ir.indexIr(ir.loadIr(opts.irPath)), opts.dialect, { temporal: opts.temporal, decorations });
    if (opts.out) fs.writeFileSync(opts.out, ddl);
    else process.stdout.write(ddl);
  } catch (e) {
    console.error(`morphir-to-ddl: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { emitDdl, findEntities, flattenColumns, entityTables, ruleSource };
