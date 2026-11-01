// Agent context and evals.
//
// Context: one Markdown guide per entity table, written for an AI agent, mapping the business
// questions the policy can answer to the SQL that answers them correctly (rule views, current
// vs. as-of, adjustments), plus the guardrails that keep answers faithful to the policy.
//
// Evals: the same questions with golden answers computed against the database, plus the SME's
// own worked examples (morphir-tests.json) as policy questions. Grade an agent's answers with
// grade-evals.js.

const fs = require("fs");
const path = require("path");

const sqlString = (v) => `'${String(v).replace(/'/g, "''")}'`;
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// Business questions for one table, each with the SQL that answers it.
function questionsFor(model, t, sample) {
  const rules = model.rules.filter((r) => r.table === t.name);
  const choiceColumns = t.columns.filter((c) => c.type.kind === "choice");
  const entity = lower(t.title);
  const qs = [];
  const add = (category, question, sql, guidance) => qs.push({ category, question, sql, guidance });

  for (const r of rules.filter((x) => !x.aggregate)) {
    for (const o of r.outputs) {
      add(
        "lookup",
        `What is the ${lower(o.title)} for ${entity} record ${sample.key}?`,
        `SELECT ${o.column} FROM ${r.view} WHERE ${t.key} = ${sqlString(sample.key)}`,
        `Read \`${o.column}\` from \`${r.view}\`; never recompute it.`
      );
      if (o.type.kind === "choice") {
        add(
          "distribution",
          `How many ${entity} records fall under each ${lower(o.title)}?`,
          `SELECT ${o.column}, COUNT(*) AS records FROM ${r.view} GROUP BY ${o.column} ORDER BY ${o.column}`,
          "Group the rule view by its output."
        );
      }
      if (o.type.kind === "boolean") {
        add("count", `How many ${entity} records meet ${r.title.toLowerCase()}?`, `SELECT COUNT(*) AS records FROM ${r.view} WHERE ${o.column}`, "Count rows where the rule holds.");
      }
      if (o.type.kind === "decimal") {
        add("total", `What is the total ${lower(o.title)} across all ${entity} records?`, `SELECT SUM(${o.column}) AS total FROM ${r.view}`, "Sum the rule output; it is already rounded per record.");
        for (const c of choiceColumns.filter((col) => o.inputs.includes(col.name)).slice(0, 1)) {
          add(
            "breakdown",
            `What is the total ${lower(o.title)} by ${lower(c.title)}?`,
            `SELECT ${c.name}, SUM(${o.column}) AS total FROM ${r.view} GROUP BY ${c.name} ORDER BY ${c.name}`,
            `Group by the input column \`${c.name}\`.`
          );
        }
      }
    }
  }
  for (const r of rules.filter((x) => x.aggregate)) {
    add("aggregate", `What is the ${lower(r.title)}?`, `SELECT ${r.outputs[0].column} FROM ${r.view}`, `Use the aggregate view \`${r.view}\`.`);
    add(
      "as-of",
      `What was the ${lower(r.title)} on ${sample.date}, as known at the end of that day?`,
      `SELECT ${r.outputs[0].column} FROM ${r.view}_as_of(DATE '${sample.date}', TIMESTAMP '${sample.date} 23:59:59')`,
      "Past dates use the `_as_of(valid_date, known_at)` form, not the current view."
    );
  }
  add(
    "adjustments",
    `Which ${entity} records have been manually adjusted, and why?`,
    `SELECT ${t.key}, adjustment_id, reason, adjusted_by FROM ${t.name}_history WHERE record_source = 'adjustment' ORDER BY ${t.key}, adjustment_id`,
    `Adjustments live in \`${t.name}_adjustments\`; \`${t.name}_history\` shows them alongside source rows.`
  );
  return qs;
}

function contextGuide(model, t, questions) {
  const out = [];
  out.push(`# Answering questions about ${lower(t.title)} records`, "");
  out.push(`Context for AI agents querying \`${t.name}\` and the policy rules computed over it. See also the table guide \`tables/${t.name}.md\`.`, "");
  out.push("## Rules for answering", "");
  out.push(
    "1. **Use the rule views (`rule_*`) for anything the policy decides.** They are generated from the SME-verified policy and checked against it value by value. Never re-derive a rate, category or amount in your own SQL.",
    `2. **Default to the present:** rule views read \`${t.name}_current\`. For a past date or "as reported", use the rule's \`_as_of(valid_date, known_at)\` form.`,
    `3. **Adjusted values are the official values.** Current and as-of views already apply manual adjustments; mention when an answer depends on one (\`record_source = 'adjustment'\`).`,
    "4. **Amounts are exact decimals**, already rounded per record as the policy requires (half to even). Sum them; don't round again.",
    "5. **Cite the rule** (and its specification section, when listed) when you explain an answer.",
    ""
  );
  out.push("## Questions and how to answer them", "");
  for (const q of questions) {
    out.push(`### ${q.question}`, "", q.guidance, "", "```sql", `${q.sql};`, "```", "");
  }
  return out.join("\n");
}

async function sampleFor(connection, t) {
  const rows = (await connection.runAndReadAll(`SELECT ${t.key} AS k FROM ${t.name}_current ORDER BY ${t.key} LIMIT 1`)).getRowObjectsJson();
  const today = (await connection.runAndReadAll("SELECT CAST(CURRENT_DATE AS VARCHAR) AS d")).getRowObjectsJson()[0].d;
  return { key: rows.length ? rows[0].k : "<id>", date: today };
}

// The SME's worked examples, phrased as policy questions with the SME-confirmed answer.
function smeExampleEvals(model, projectDir) {
  const testsPath = path.join(projectDir, "morphir-tests.json");
  if (!fs.existsSync(testsPath)) return [];
  const suites = JSON.parse(fs.readFileSync(testsPath, "utf8"));
  const evals = [];
  for (const [fqn, cases] of suites) {
    const rule = model.rules.find((r) => JSON.stringify(r.fqn) === JSON.stringify(fqn));
    const title = rule ? rule.title.toLowerCase() : fqn[2].join(" ");
    cases.forEach((c, i) => {
      evals.push({
        id: `sme-${fqn[2].join("-")}-${i + 1}`,
        table: rule ? rule.table : null,
        category: "policy-example",
        question: `Under the policy, what is the ${title} for ${JSON.stringify(c.inputs.length === 1 ? c.inputs[0] : c.inputs)}?`,
        description: c.description,
        expected: { value: c.expectedOutput },
        grading: "The answer must equal the expected value; decimals compare by value.",
      });
    });
  }
  return evals;
}

async function writeContextAndEvals(model, outDir, { connection, projectDir = "." }) {
  const contextDir = path.join(outDir, "context");
  const evalDir = path.join(outDir, "evals");
  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(evalDir, { recursive: true });
  const evals = [];
  for (const t of model.tables) {
    const sample = connection ? await sampleFor(connection, t) : { key: "<id>", date: "2026-09-30" };
    const questions = questionsFor(model, t, sample);
    fs.writeFileSync(path.join(contextDir, `${t.name}-questions.md`), contextGuide(model, t, questions));
    if (!connection) continue;
    for (const [i, q] of questions.entries()) {
      const reader = await connection.runAndReadAll(q.sql);
      evals.push({
        id: `${t.name}-${q.category}-${i + 1}`,
        table: t.name,
        category: q.category,
        question: q.question,
        reference_sql: q.sql,
        expected: { columns: reader.columnNames(), rows: reader.getRowsJson() },
        grading: "Compare result rows as a set, ignoring column names and row order; decimals compare by value.",
      });
    }
  }
  evals.push(...smeExampleEvals(model, projectDir));
  fs.writeFileSync(path.join(evalDir, "evals.json"), JSON.stringify({ model: model.packageName, generatedAt: new Date().toISOString(), evals }, null, 2));
  return evals.length;
}

module.exports = { writeContextAndEvals, questionsFor };
