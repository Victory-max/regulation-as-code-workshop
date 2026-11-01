#!/usr/bin/env node
// Generates a Jupyter notebook (Python + DuckDB) for exploring the verified policy in the
// bank's database: results per record, totals and charts, a what-if, a manual adjustment with
// before/after/as-reported, the record's history, and where every rule comes from.
// Every number is read from the generated rule views; the notebook never re-implements policy.
//
//   node scripts/morphir-to-notebook.js [--ir morphir-ir.json] [--project .] [--db out/enterprise.db]
//                                       [--out out/policy-notebook.ipynb]

const fs = require("fs");
const path = require("path");
const { loadModel } = require("./knowledge/model");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

const md = (...lines) => ({ cell_type: "markdown", metadata: {}, source: lines.join("\n") });
const code = (...lines) => ({ cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: lines.join("\n") });
// Python literal: JSON is valid Python for strings, lists and numbers; booleans and null differ.
const py = (v) => JSON.stringify(v, (k, x) => x).replace(/\btrue\b(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "True").replace(/\bfalse\b(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "False").replace(/\bnull\b(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "None");

// Picks the record and correction the notebook demonstrates: one whose policy result actually
// changes when the correction is applied, tried inside a transaction that is rolled back.
async function pickExample(model, dbPath, t) {
  if (!fs.existsSync(dbPath)) return null;
  const rules = model.rules.filter((r) => r.table === t.name && !r.aggregate);
  const used = new Set(rules.flatMap((r) => r.outputs.flatMap((o) => o.inputs)));
  const choices = t.columns.filter((c) => c.type.kind === "choice" && used.has(c.name));
  const watch = rules.find((r) => r.outputs.some((o) => o.type.kind === "decimal")) || rules[0];
  const { DuckDBInstance } = require("@duckdb/node-api");
  const conn = await (await DuckDBInstance.create(dbPath)).connect();
  const rows = (await conn.runAndReadAll(`SELECT * FROM ${t.name}_current ORDER BY ${t.key} LIMIT 40`)).getRowObjectsJson();
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  let found = null;
  try {
    for (const row of rows) {
      for (const col of choices) {
        for (const value of col.type.values.filter((v) => v !== row[col.name])) {
          if (!watch) break;
          const result = async () => JSON.stringify((await conn.runAndReadAll(`SELECT * EXCLUDE (record_source, adjustment_id, reason, adjusted_by, recorded_at, valid_from, valid_to) FROM ${watch.view} WHERE ${t.key} = ${q(row[t.key])}`)).getRowObjectsJson());
          const before = await result();
          await conn.run("BEGIN TRANSACTION");
          const cols = t.columns.map((c) => c.name);
          await conn.run(
            `INSERT INTO ${t.name}_adjustments (adjustment_id, reason, adjusted_by, ${cols.join(", ")}) ` +
              `SELECT 'PROBE', 'probe', 'probe', ${cols.map((c) => (c === col.name ? q(value) : c)).join(", ")} FROM ${t.name}_current WHERE ${t.key} = ${q(row[t.key])}`
          );
          const after = await result();
          await conn.run("ROLLBACK");
          const changed = (s) => JSON.parse(s).map((r) => watch.outputs.map((o) => r[o.column]).join("|")).join();
          if (changed(before) !== changed(after)) {
            found = { row, column: col, value };
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
  } finally {
    conn.closeSync();
  }
  return found || (rows[0] ? { row: rows[0], column: choices[0], value: choices[0] && choices[0].type.values.find((v) => v !== rows[0][choices[0].name]) } : null);
}

function tableCells(model, t, example) {
  const sample = example ? example.row : null;
  const rules = model.rules.filter((r) => r.table === t.name);
  const rowRules = rules.filter((r) => !r.aggregate);
  const aggregates = rules.filter((r) => r.aggregate);
  const choiceInputs = t.columns.filter((c) => c.type.kind === "choice");
  const seen = new Set();
  const ruleColumns = rowRules.map((r) => [r.view, r.outputs.map((o) => o.column).filter((c) => !seen.has(c) && seen.add(c))]).filter(([, cs]) => cs.length);
  const outputs = rowRules.flatMap((r) => r.outputs.map((o) => ({ ...o, rule: r })));
  const choiceOutputs = outputs.filter((o) => o.type.kind === "choice" && ruleColumns.some(([, cs]) => cs.includes(o.column)));
  const decimalOutputs = outputs.filter((o) => o.type.kind === "decimal" && ruleColumns.some(([, cs]) => cs.includes(o.column)));
  const keyValue = sample ? sample[t.key] : "<id>";
  const entity = t.title.toLowerCase();

  // The correction the notebook demonstrates (chosen so the policy result changes).
  const adjustColumn = example && example.column;
  const adjustTo = example && example.value;

  const cells = [
    md(`## ${t.title}`, "", t.doc || "", "", `Table \`${t.name}\`, one row per version of each record. The policy rules run over \`${t.name}_current\`, the current version of each record.`),
    code(
      `TABLE, KEY = ${py(t.name)}, ${py(t.key)}`,
      `INPUTS = ${py(t.columns.map((c) => c.name))}`,
      `RULES = ${py(ruleColumns)}  # (rule view, output columns)`,
      "",
      "def policy_results(where=None, valid_date=None, known_at=None):",
      '    """Every policy result per record: current by default, or as of a business date as known at a time."""',
      "    as_of = valid_date is not None",
      "    def rel(name):",
      `        return f"{name}_as_of(DATE '{valid_date}', TIMESTAMP '{known_at}')" if as_of else name`,
      "    base = rel(TABLE) if as_of else f\"{TABLE}_current\"",
      '    outputs = ", ".join(f"r{i}.{c}" for i, (view, cols) in enumerate(RULES) for c in cols)',
      '    joins = " ".join(f"JOIN {rel(view)} r{i} USING ({KEY})" for i, (view, cols) in enumerate(RULES))',
      '    sql = f"SELECT b.{KEY}, {\', \'.join(\'b.\' + c for c in INPUTS if c != KEY)}, b.record_source, {outputs} FROM {base} b {joins}"',
      '    return con.sql(sql + (f" WHERE {where}" if where else "") + f" ORDER BY b.{KEY}").df()',
      "",
      `print(con.sql(f"SELECT (SELECT COUNT(*) FROM {TABLE}_current) AS current_records, (SELECT COUNT(*) FROM {TABLE}_history) AS versions, (SELECT COUNT(*) FROM {TABLE}_adjustments) AS adjustments").df().to_string(index=False))`,
      "policy_results().head(10)"
    ),
    md(`### One ${entity}`, "", `Change \`RECORD\` to look at any ${entity}.`),
    code(`RECORD = ${py(keyValue)}`, `policy_results(f"b.{KEY} = '{RECORD}'").T`),
  ];

  for (const o of choiceOutputs) {
    cells.push(
      md(`### ${o.title} across all records`, "", o.rule.doc ? o.rule.doc.split("\n\n")[0] : ""),
      code(
        `by_${o.column} = con.sql("SELECT ${o.column}, COUNT(*) AS records FROM ${o.rule.view} GROUP BY ${o.column} ORDER BY ${o.column}").df()`,
        `by_${o.column}.plot.barh(x=${py(o.column)}, y="records", legend=False, title=${py(o.title)});`,
        `by_${o.column}`
      )
    );
  }
  for (const o of decimalOutputs) {
    const by = choiceInputs.find((c) => o.inputs.includes(c.name));
    if (!by) continue;
    cells.push(
      md(`### Total ${o.title.toLowerCase()} by ${by.title.toLowerCase()}`),
      code(
        `totals = con.sql("SELECT ${by.name}, SUM(${o.column}) AS total_${o.column} FROM ${o.rule.view} GROUP BY ${by.name} ORDER BY ${by.name}").df()`,
        `totals.astype({"total_${o.column}": float}).plot.barh(x=${py(by.name)}, y="total_${o.column}", legend=False, title="Total ${o.title.toLowerCase()} by ${by.title.toLowerCase()}");`,
        "totals"
      )
    );
  }
  for (const r of aggregates) {
    cells.push(md(`### ${r.title}`, "", r.doc || ""), code(`con.sql("SELECT * FROM ${r.view}").df()`));
  }

  if (sample) {
    const editable = t.columns.filter((c) => c.name !== t.key);
    const whatIf = Object.fromEntries(editable.map((c) => [c.name, sample[c.name]]));
    cells.push(
      md(
        "### What if?",
        "",
        `Edit the values below to see what the policy decides for a hypothetical ${entity}. Nothing is saved: the record is evaluated inside a transaction that is rolled back.`
      ),
      code(
        `what_if = ${py(whatIf)}`,
        "",
        "con.begin()",
        "try:",
        "    cols = [KEY] + list(what_if)",
        '    con.execute(f"INSERT INTO {TABLE} ({\', \'.join(cols)}) VALUES ({\', \'.join(\'?\' for _ in cols)})", ["WHAT-IF"] + list(what_if.values()))',
        `    result = policy_results(f"b.{KEY} = 'WHAT-IF'").T`,
        "finally:",
        "    con.rollback()",
        "result"
      )
    );
    if (adjustColumn && adjustTo) {
      cells.push(
        md(
          "### Record a correction",
          "",
          `Corrections are never made by editing data. They are recorded as an **adjustment**: a new version of the record with a reason, kept apart from the source data. Here ${entity} \`${keyValue}\` gets \`${adjustColumn.name}\` = \`${adjustTo}\`.`
        ),
        code(
          'before = con.sql("SELECT CAST(now() AS VARCHAR)").fetchone()[0]',
          'today = con.sql("SELECT CAST(current_date AS VARCHAR)").fetchone()[0]',
          "",
          `con.execute(f"""INSERT INTO {TABLE}_adjustments (adjustment_id, reason, adjusted_by, {', '.join(INPUTS)})`,
          `    SELECT 'ADJ-' || strftime(now(), '%Y%m%d%H%M%S'), 'Corrected after review', 'notebook', {', '.join(c if c != ${py(adjustColumn.name)} else '?' for c in INPUTS)}`,
          `    FROM {TABLE}_current WHERE {KEY} = ?""", [${py(adjustTo)}, RECORD])`,
          "",
          "now_ = policy_results(f\"b.{KEY} = '{RECORD}'\").assign(view='now, with the adjustment')",
          "then_ = policy_results(f\"b.{KEY} = '{RECORD}'\", valid_date=today, known_at=before).assign(view='as reported before it')",
          "pd.concat([then_, now_]).set_index('view').T"
        ),
        md("### The record's history", "", "Every version, from the source system and from adjustments. Nothing is overwritten."),
        code(`con.sql(f"SELECT * FROM {TABLE}_history WHERE {KEY} = '{RECORD}' ORDER BY recorded_at").df()`)
      );
    }
  }
  if (t.feed) {
    const calc = t.feed.calculated.map((x) => `\`${x.column}\` (from ${x.rule})`).join(", ");
    cells.push(
      md(
        "### Recalculate",
        "",
        `This is a calculation table. Its calculated fields, ${calc}, come from the policy's rules; the other fields are reported. \`${t.name}_feed\` shows what a recalculation would record now. Running it adds a new version of each run, and every earlier result stays in the history.`
      ),
      code(`con.sql(f"SELECT * FROM {TABLE}_feed").df()`),
      code(
        `cols = ", ".join(${py(t.feed.columns)})`,
        `con.execute(f"INSERT INTO {TABLE} ({cols}) SELECT {cols} FROM {TABLE}_feed")`,
        `con.sql(f"SELECT {KEY}, recorded_at, record_source, ${t.feed.calculated.map((x) => x.column).join(", ")} FROM {TABLE}_history ORDER BY {KEY}, recorded_at").df()`
      ),
      md("The results now come from the latest calculation:"),
      code("policy_results().T")
    );
  }
  return cells;
}

async function main() {
  const projectDir = opt("--project", ".");
  const irPath = opt("--ir", path.join(projectDir, "morphir-ir.json"));
  const dbPath = opt("--db", path.join(projectDir, "out", "enterprise.db"));
  const outPath = opt("--out", path.join(path.dirname(dbPath), "policy-notebook.ipynb"));
  const model = loadModel({ irPath, projectDir });

  const cells = [
    md(
      `# ${model.packageName} policy explorer`,
      "",
      "Explore the verified policy as it runs in the bank's database. Every value comes from a policy rule generated from the SME-verified model and checked against it, to the cent. Run the cells top to bottom."
    ),
    code(
      "try:",
      "    import duckdb, pandas, matplotlib",
      "except ImportError:",
      "    # First run in a fresh Python: install the notebook's packages into this kernel.",
      "    get_ipython().run_line_magic(\"pip\", \"install -q duckdb==1.5.5 pandas matplotlib\")",
      "import duckdb, pandas as pd",
      "from pathlib import Path",
      "",
      `DB = next(p for p in [Path(${py(path.basename(dbPath))}), Path("out") / ${py(path.basename(dbPath))}] if p.exists())`,
      "con = duckdb.connect(str(DB))",
      'pd.set_option("display.max_columns", None)',
      'pd.set_option("display.max_colwidth", None)',
      'print(f"Connected to {DB.resolve()}")'
    ),
  ];
  for (const t of model.tables) cells.push(...tableCells(model, t, await pickExample(model, dbPath, t)));
  cells.push(
    md("## Where each rule comes from", "", "The descriptions and specification links recorded in the policy model, as stored in the database."),
    code(`con.sql("SELECT view_name AS rule, comment AS description_and_source FROM duckdb_views() WHERE view_name LIKE 'rule_%' ORDER BY view_name").df()`),
    md("## How each rule runs", "", "The SQL the database runs for each rule. It was compiled from the policy model, not written by hand, and every result is checked against the model. The full file is `out/rules.sql`."),
    code([
      `for name, sql in con.sql("SELECT view_name, sql FROM duckdb_views() WHERE view_name LIKE 'rule_%' AND view_name NOT LIKE '%_as_of' ORDER BY view_name").fetchall():`,
      `    print(f"-- {name}\\n{sql}\\n")`,
    ].join("\n")),
    code("con.close()")
  );

  const notebook = {
    cells: cells.map((c, i) => ({ id: `cell-${String(i + 1).padStart(2, "0")}`, ...c })),
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(notebook, null, 1));
  console.log(`Notebook: ${outPath} (${cells.length} cells)`);
}

main().catch((e) => {
  console.error(`morphir-to-notebook: ${e.stack || e.message}`);
  process.exit(1);
});
