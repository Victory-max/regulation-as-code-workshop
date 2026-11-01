// Table guides: one Markdown document per entity table explaining what it holds, how its
// history and adjustments work, which policy rules are computed over it, and how to query it.

const fs = require("fs");
const path = require("path");

const md = {
  links: (refs) => refs.map((r) => `[${r.section}](${r.permalink})`).join("; "),
  typeLabel: (t) =>
    t.kind === "choice" ? `one of ${t.values.map((v) => `\`${v}\``).join(", ")}` : { decimal: "exact decimal", integer: "whole number", float: "number", boolean: "yes / no", text: "text", date: "date" }[t.kind],
};

function tableGuide(model, t) {
  const rules = model.rules.filter((r) => r.table === t.name);
  const rowRules = rules.filter((r) => !r.aggregate);
  const aggregates = rules.filter((r) => r.aggregate);
  const businessColumns = t.columns.map((c) => c.name).join(", ");
  const sampleKey = `'<${t.key}>'`;
  const out = [];

  out.push(`# ${t.title} (\`${t.name}\`)`, "");
  out.push(t.doc || `Records of ${t.title.toLowerCase()}.`, "");
  out.push(`- **Business key:** \`${t.key}\``);
  out.push(`- **Defined by:** Morphir type \`${t.source}\` in the verified ${model.packageName} policy model`);
  if (t.specLinks.length) out.push(`- **Specification:** ${md.links(t.specLinks)}`);
  out.push("", "## Columns", "", "| Column | Meaning | Values | Source |", "|---|---|---|---|");
  const cell = (s) => String(s).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  for (const c of t.columns) {
    const meaning = c.description || (c.type.kind === "choice" && c.type.doc ? `${c.title}: ${c.type.doc}` : c.title);
    const values = c.values.some((v) => v.description)
      ? c.values.map((v) => `\`${v.name}\`${v.description ? `: ${v.description}` : ""}`).join("<br>")
      : md.typeLabel(c.type);
    out.push(`| \`${c.name}\` | ${cell(meaning)} | ${cell(values)}${c.optional ? " (optional)" : ""} | ${md.links(c.specLinks)} |`);
  }
  out.push(
    "| `valid_from`, `valid_to` | Business time: the period `[valid_from, valid_to)` in which this version of the record was true | dates; open-ended is `9999-12-31` | |",
    "| `recorded_at` | System time: when the bank recorded this version | timestamp | |",
    ""
  );

  out.push("## History and adjustments", "");
  out.push(
    `\`${t.name}\` is **append-only and bitemporal**. Never \`UPDATE\` or \`DELETE\` a row: a change, correction or restatement is a new row, so every past answer can be reproduced.`,
    "",
    "| Relation | Use it for |",
    "|---|---|",
    `| \`${t.name}_current\` | **Default.** The version of each record true today, as known now. |`,
    `| \`${t.name}_as_of(valid_date, known_at)\` | The record as it was on a business date, as the bank knew it at a point in time (e.g. "what did we report at quarter end?"). |`,
    `| \`${t.name}_history\` | Every version, from the source system and from adjustments, with \`record_source\`. |`,
    `| \`${t.name}\` | Versions loaded from the source system. |`,
    `| \`${t.name}_adjustments\` | Manual adjustments, kept apart from source data, each with \`adjustment_id\`, \`reason\`, \`adjusted_by\`. |`,
    "",
    "When both exist for the same moment, **the latest recorded version wins, and an adjustment beats a source row recorded at the same time.**",
    "",
    "Record an adjustment as a full replacement version of the record:",
    "",
    "```sql",
    `INSERT INTO ${t.name}_adjustments (adjustment_id, reason, adjusted_by, ${businessColumns}, valid_from)`,
    `SELECT 'ADJ-0001', '<why>', '<who>', ${t.columns.map((c) => c.name).join(", ")}, DATE '<effective date>'`,
    `FROM ${t.name}_current WHERE ${t.key} = ${sampleKey};  -- then change the corrected columns`,
    "```",
    ""
  );

  if (rules.length) {
    out.push("## Policy rules computed over this table", "");
    out.push(
      "Each rule is a view generated from the SME-verified policy and checked against it value by value. **Use these views; do not re-implement the policy in your own SQL.** Each also has an `_as_of(valid_date, known_at)` form.",
      ""
    );
    for (const r of rules) {
      out.push(`### \`${r.view}\`${r.aggregate ? " (total over the table)" : ""}`, "");
      if (r.doc) out.push(r.doc, "");
      out.push(`- **Rule:** \`${r.rule}\``);
      if (r.specLinks.length) out.push(`- **Specification:** ${md.links(r.specLinks)}`);
      for (const o of r.outputs) {
        const about = o.description ? `: ${o.description}` : "";
        const src = o.specLinks.length ? ` Source: ${md.links(o.specLinks)}.` : "";
        out.push(`- **\`${o.column}\`** (${md.typeLabel(o.type)})${about}. Computed from ${o.inputs.map((c) => `\`${c}\``).join(", ") || "constants"}.${src}`);
      }
      out.push("");
    }
  }

  out.push("## Example queries", "", "```sql");
  for (const r of rowRules.slice(0, 3)) {
    out.push(`-- ${r.title} for one ${t.title.toLowerCase()}, today`);
    out.push(`SELECT ${t.key}, ${r.outputs.map((o) => o.column).join(", ")} FROM ${r.view} WHERE ${t.key} = ${sampleKey};`, "");
  }
  for (const r of rowRules.filter((x) => x.outputs.some((o) => o.type.kind === "choice")).slice(0, 1)) {
    const o = r.outputs.find((x) => x.type.kind === "choice");
    out.push(`-- How many ${t.title.toLowerCase()} records fall in each ${o.title.toLowerCase()}`);
    out.push(`SELECT ${o.column}, COUNT(*) AS records FROM ${r.view} GROUP BY ${o.column} ORDER BY ${o.column};`, "");
  }
  for (const r of aggregates) {
    out.push(`-- ${r.title}, today and as reported at quarter end`);
    out.push(`SELECT * FROM ${r.view};`);
    out.push(`SELECT * FROM ${r.view}_as_of(DATE '2026-09-30', TIMESTAMP '2026-10-15 00:00:00');`, "");
  }
  out.push(`-- Records changed by manual adjustment, and why`);
  out.push(`SELECT ${t.key}, adjustment_id, reason, adjusted_by, recorded_at FROM ${t.name}_history WHERE record_source = 'adjustment';`);
  out.push("```", "");
  return out.join("\n");
}

function writeTableGuides(model, outDir) {
  const dir = path.join(outDir, "tables");
  fs.mkdirSync(dir, { recursive: true });
  return model.tables.map((t) => {
    const file = path.join(dir, `${t.name}.md`);
    fs.writeFileSync(file, tableGuide(model, t));
    return file;
  });
}

module.exports = { writeTableGuides, md };
