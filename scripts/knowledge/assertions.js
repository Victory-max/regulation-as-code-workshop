// Data quality assertions derived from the verified model, each with the SQL that counts its
// violations, evaluated against the policy database:
//   allowed values   a choice column holds only the model's cases          (FIELD, IN)
//   logical values   on the logical model, each choice field's value, in
//                    lower case, is one of the model's cases in lower case (FIELD, REGEX_MATCH)
//   required         a field the model doesn't mark optional is never null (FIELD, NOT_NULL)
//   unique key       one current version per record                       (SQL)
//   positive divisor anything a rule divides by is above zero, because the
//                    policy would otherwise return its fallback            (FIELD, > 0)
//   up to date       a calculation table's calculated fields equal their
//                    rules' current results (calculatedFrom)               (SQL)

const SDK_DIV = new Set(["morphir.sdk:decimal:div_with_default", "morphir.sdk:decimal:div", "morphir.sdk:basics:divide"]);

// A function application unwound into its function and arguments.
function unapply(node) {
  const args = [];
  while (Array.isArray(node) && node[0] === "Apply") {
    args.unshift(node[3]);
    node = node[2];
  }
  return { fn: node, args };
}

// Every division in a value: the denominator expression of each.
function divisions(ir, node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node) && node[0] === "Apply") {
    const { fn, args } = unapply(node);
    if (Array.isArray(fn) && fn[0] === "Reference" && SDK_DIV.has(ir.fqnKey(fn[2]))) {
      const denominator = ir.fqnKey(fn[2]).endsWith("div_with_default") ? args[2] : args[1];
      if (denominator) found.push(denominator);
    }
  }
  Object.values(node).forEach((child) => divisions(ir, child, found));
  return found;
}

// Where a denominator's value lives in the database: a rule's output (a call to another rule on
// the same record) or a column of the rule's table (a field of its input record).
function denominatorTarget(model, rule, expr) {
  const { ir } = model;
  const { fn, args } = unapply(expr);
  if (Array.isArray(fn) && fn[0] === "Reference" && args.length) {
    const callee = model.rules.find((r) => ir.fqnKey(r.fqn) === ir.fqnKey(fn[2]));
    if (callee && callee.outputs.length === 1) return { relation: callee.view, column: callee.outputs[0].column, label: callee.title };
  }
  const path = [];
  let node = expr;
  while (Array.isArray(node) && node[0] === "Field") {
    path.unshift(node[3]);
    node = node[2];
  }
  if (path.length && Array.isArray(node) && node[0] === "Variable") {
    const table = model.tables.find((t) => t.name === rule.table);
    const column = table && table.columns.find((c) => JSON.stringify(c.path) === JSON.stringify(path));
    if (column) return { relation: `${table.name}_current`, column: column.name, label: column.title };
  }
  return null;
}

const sqlText = (s) => `'${String(s).replace(/'/g, "''")}'`;
const regexText = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const logicalPath = (c) => c.path.map((n) => n.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("")).join(".");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function deriveAssertions(model) {
  const out = [];
  for (const t of model.tables) {
    for (const c of t.columns.filter((x) => !x.generated)) {
      if (c.type.kind === "choice") {
        out.push({
          id: `${t.name}-${c.name}-allowed-values`,
          relation: t.name,
          kind: "field",
          field: c.name,
          fieldType: "STRING",
          operator: "IN",
          values: c.type.values,
          description: `${c.title} holds only the policy's values: ${c.type.values.join(", ")}.`,
          why: `The model defines ${c.type.typeName} as exactly these cases.`,
          violationsSql: `SELECT COUNT(*) FROM ${t.name} WHERE ${c.name} IS NOT NULL AND CAST(${c.name} AS VARCHAR) NOT IN (${c.type.values.map(sqlText).join(", ")})`,
          rowsSql: `SELECT COUNT(*) FROM ${t.name}`,
        });
        // The same rule on the logical model, case-insensitive: the value in lower case must be
        // one of the cases in lower case. Evaluated on the entity's physical table.
        const lower = [...new Set(c.type.values.map((v) => String(v).toLowerCase()))];
        out.push({
          id: `${t.name}-${c.name}-logical-allowed-values`,
          relation: t.name,
          logical: true,
          kind: "field",
          field: logicalPath(c),
          fieldType: "STRING",
          operator: "REGEX_MATCH",
          pattern: `^(${lower.map(regexText).join("|")})$`,
          lowerValues: lower,
          description: `${c.title} in lower case is one of: ${lower.join(", ")}.`,
          why: `The model defines ${c.type.typeName} as exactly these cases; the logical model checks them regardless of case.`,
          violationsSql: `SELECT COUNT(*) FROM ${t.name} WHERE ${c.name} IS NOT NULL AND LOWER(CAST(${c.name} AS VARCHAR)) NOT IN (${lower.map(sqlText).join(", ")})`,
          rowsSql: `SELECT COUNT(*) FROM ${t.name}`,
        });
      }
      if (!c.optional) {
        out.push({
          id: `${t.name}-${c.name}-required`,
          relation: t.name,
          kind: "field",
          field: c.name,
          fieldType: c.type.kind === "choice" || c.type.kind === "text" ? "STRING" : c.type.kind === "boolean" ? "BOOLEAN" : c.type.kind === "date" ? "DATE" : "NUMBER",
          operator: "NOT_NULL",
          description: `${c.title} is always present.`,
          why: "The model doesn't mark this field optional.",
          violationsSql: `SELECT COUNT(*) FROM ${t.name} WHERE ${c.name} IS NULL`,
          rowsSql: `SELECT COUNT(*) FROM ${t.name}`,
        });
      }
    }
    out.push({
      id: `${t.name}-unique-key`,
      relation: `${t.name}_current`,
      kind: "sql",
      description: `One current version per ${t.title.toLowerCase()} (${t.key} is unique).`,
      why: `${t.key} identifies the record in the model.`,
      violationsSql: `SELECT COUNT(*) - COUNT(DISTINCT ${t.key}) FROM ${t.name}_current`,
      rowsSql: `SELECT COUNT(*) FROM ${t.name}_current`,
    });
    if (t.feed) {
      for (const c of t.feed.calculated) {
        out.push({
          id: `${t.name}-${c.column}-up-to-date`,
          relation: `${t.name}_current`,
          kind: "sql",
          description: `The recorded ${c.column.replace(/_/g, " ")} equals what ${c.rule} gives today; otherwise the calculation needs recalculating.`,
          why: `The model says ${c.column} is calculated from ${c.rule} (calculatedFrom).`,
          violationsSql: `SELECT COUNT(*) FROM ${t.name}_current c JOIN ${t.name}_feed f USING (${t.key}) WHERE c.${c.column} IS DISTINCT FROM f.${c.column}`,
          rowsSql: `SELECT COUNT(*) FROM ${t.name}_current`,
        });
      }
    }
  }
  const seen = new Set();
  for (const r of model.rules) {
    for (const expr of divisions(model.ir, r.def.body)) {
      const target = denominatorTarget(model, r, expr);
      if (!target || seen.has(`${target.relation}.${target.column}`)) continue;
      seen.add(`${target.relation}.${target.column}`);
      out.push({
        id: `${target.relation}-${target.column}-positive`,
        relation: target.relation,
        kind: "field",
        field: target.column,
        fieldType: "NUMBER",
        operator: "GREATER_THAN",
        threshold: 0,
        description: `${target.label} is above zero.`,
        why: `${r.title} divides by it; at zero the policy returns its fallback instead of a real result.`,
        violationsSql: `SELECT COUNT(*) FROM ${target.relation} WHERE NOT (${target.column} > 0) OR ${target.column} IS NULL`,
        rowsSql: `SELECT COUNT(*) FROM ${target.relation}`,
      });
    }
  }
  return out.map((a) => ({ ...a, id: slug(a.id) }));
}

// Runs each assertion's SQL: violations and rows checked.
async function evaluateAssertions(assertions, connection) {
  const scalar = async (sql) => Number(Object.values((await connection.runAndReadAll(sql)).getRowObjectsJson()[0])[0]);
  for (const a of assertions) {
    try {
      a.result = { violations: await scalar(a.violationsSql), rows: await scalar(a.rowsSql) };
      a.result.passed = a.result.violations === 0;
    } catch (e) {
      a.result = { error: e.message };
    }
  }
  return assertions;
}

module.exports = { deriveAssertions, evaluateAssertions };
