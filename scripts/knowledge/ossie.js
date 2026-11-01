// Apache Ossie (Open Semantic Interchange) semantic model, spec version 0.2.0.dev0.
// One dataset per rule view: the business key and categories are fields (dimensions), the
// rule outputs are fields, and metrics aggregate them. An aggregate rule that folds a row
// rule (e.g. total outflows = sum of each deposit's outflow) becomes a metric on that row
// rule's dataset, with the rule's own name and description.

const fs = require("fs");
const path = require("path");

const OSSIE_VERSION = "0.2.0.dev0";
const DATATYPE = { decimal: "Decimal", integer: "Integer", float: "Float", boolean: "Boolean", text: "String", date: "Date", choice: "String" };

// Minimal YAML emitter for plain data (objects, arrays, strings, numbers, booleans).
function yaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  const scalar = (v) => {
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    const s = String(v);
    if (s.includes("\n")) return `|\n${s.split("\n").map((l) => `${pad}  ${l}`).join("\n")}`;
    return /^[\w./ -]+$/.test(s) && !/^(true|false|null|yes|no|\d.*)$/i.test(s) && !/^ | $/.test(s) ? s : JSON.stringify(s);
  };
  if (Array.isArray(value)) {
    if (value.length === 0) return " []";
    return value
      .map((v) => {
        if (v !== null && typeof v === "object") {
          const body = yaml(v, indent + 2).replace(/^\n/, "");
          return `\n${pad}- ${body.trimStart()}`;
        }
        return `\n${pad}- ${scalar(v)}`;
      })
      .join("");
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (v !== null && typeof v === "object") return `\n${pad}${k}:${yaml(v, indent + 2)}`;
        return `\n${pad}${k}: ${scalar(v)}`;
      })
      .join("");
  }
  return ` ${scalar(value)}`;
}

const expr = (sql) => ({ sql });

function datasetFor(model, r, aggregates) {
  const t = model.tables.find((x) => x.name === r.table);
  const used = new Set(r.outputs.flatMap((o) => o.inputs));
  const dimensions = t.columns.filter((c) => c.name === t.key || (c.type.kind === "choice" && used.has(c.name)));
  const fields = [
    ...dimensions.map((c) => ({
      name: c.name,
      expression: expr(c.name),
      datatype: DATATYPE[c.type.kind],
      description: c.description || (c.type.kind === "choice" ? `${c.title}: one of ${c.type.values.join(", ")}` : c.title),
    })),
    { name: "valid_from", expression: expr("valid_from"), datatype: "Date", dimension: { is_time: true }, description: "Business date from which this version of the record is true" },
    ...r.outputs.map((o) => ({
      name: o.column,
      expression: expr(o.column),
      datatype: DATATYPE[o.type.kind],
      description: `${o.description || o.title}, decided by policy rule ${r.rule}${o.type.kind === "choice" ? `: one of ${o.type.values.join(", ")}` : ""}`,
    })),
  ];
  const metrics = [{ name: `${t.name}_count`, expression: expr("COUNT(*)"), datatype: "Integer", description: `Number of ${t.title.toLowerCase()} records` }];
  for (const o of r.outputs) {
    if (o.type.kind === "decimal") metrics.push({ name: `total_${o.column}`, expression: expr(`SUM(${o.column})`), datatype: "Decimal", description: `Total ${o.title.toLowerCase()}` });
    if (o.type.kind === "boolean") metrics.push({ name: `${o.column}_count`, expression: expr(`SUM(CASE WHEN ${o.column} THEN 1 ELSE 0 END)`), datatype: "Integer", description: `Number of records meeting ${r.title.toLowerCase()}` });
  }
  for (const a of aggregates.filter((x) => x.over === r)) {
    metrics.push({
      name: a.rule.outputs[0].column,
      expression: expr(`SUM(${r.outputs[0].column})`),
      datatype: "Decimal",
      description: a.rule.doc || a.rule.title,
      ai_context: { instructions: `Equals policy rule ${a.rule.rule} (view ${a.rule.view}).` },
    });
  }
  return {
    name: r.view,
    source: r.view,
    primary_key: [t.key],
    description: r.doc || r.title,
    ai_context: {
      instructions: `Rows are the current version of each ${t.title.toLowerCase()} record. Values come from the SME-verified policy rule ${r.rule}; do not recompute them. For a past date use ${r.view}_as_of(valid_date, known_at).`,
    },
    fields,
    metrics,
  };
}

function writeOssie(model, outDir) {
  const dir = path.join(outDir, "ossie");
  fs.mkdirSync(dir, { recursive: true });
  const rowRules = model.rules.filter((r) => !r.aggregate && r.outputs.length);
  // An aggregate that folds a row rule: find which row rule its body references.
  const aggregates = model.rules
    .filter((r) => r.aggregate)
    .map((rule) => ({ rule, over: rowRules.find((rr) => rr.table === rule.table && JSON.stringify(rule.def.body).includes(JSON.stringify(rr.fqn))) }))
    .filter((a) => a.over && a.over.outputs.length === 1 && a.over.outputs[0].type.kind === "decimal");
  const doc = {
    version: OSSIE_VERSION,
    name: model.packageName.toLowerCase().replace(/\W+/g, "_") + "_policy",
    description: `Semantic model of the SME-verified ${model.packageName} policy rules. Generated from Morphir IR.`,
    ai_context: {
      instructions: "Every dataset is a policy rule view generated from a verified Morphir model and checked against it value by value. Answer with these fields and metrics; never re-derive policy values.",
    },
    datasets: rowRules.map((r) => datasetFor(model, r, aggregates)),
  };
  const text = `# Apache Ossie semantic model (spec ${OSSIE_VERSION}), generated from Morphir IR.${yaml(doc)}\n`;
  const file = path.join(dir, `${doc.name}.ossie.yaml`);
  fs.writeFileSync(file, text);
  return { file, datasets: doc.datasets.length, metrics: doc.datasets.reduce((n, d) => n + d.metrics.length, 0) };
}

module.exports = { writeOssie, yaml };
