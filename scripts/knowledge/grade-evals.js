#!/usr/bin/env node
// Grades an agent's answers against evals.json.
//
//   node scripts/knowledge/grade-evals.js out/knowledge/evals/evals.json answers.json
//
// answers.json maps eval id -> the agent's answer: result rows (an array of arrays) for data
// questions, or a value for policy-example questions.

const fs = require("fs");

const norm = (v) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(Number(s)); // decimals compare by value
  return JSON.stringify(v);
};
const rowKey = (row) => (Array.isArray(row) ? row : Object.values(row)).map(norm).join("|");
const sameRows = (a, b) => JSON.stringify(a.map(rowKey).sort()) === JSON.stringify(b.map(rowKey).sort());
const sameValue = (a, b) => JSON.stringify(a, (k, v) => (typeof v === "string" || typeof v === "number" ? norm(v) : v)) === JSON.stringify(b, (k, v) => (typeof v === "string" || typeof v === "number" ? norm(v) : v));

const [evalsPath, answersPath] = process.argv.slice(2);
if (!evalsPath || !answersPath) {
  console.error("usage: grade-evals.js <evals.json> <answers.json>");
  process.exit(64);
}
const { evals } = JSON.parse(fs.readFileSync(evalsPath, "utf8"));
const answers = JSON.parse(fs.readFileSync(answersPath, "utf8"));
let passed = 0;
const results = evals.map((e) => {
  const answer = answers[e.id];
  const ok = answer !== undefined && ("rows" in e.expected ? Array.isArray(answer) && sameRows(answer, e.expected.rows) : sameValue(answer, e.expected.value));
  if (ok) passed++;
  return { id: e.id, category: e.category, result: answer === undefined ? "missing" : ok ? "pass" : "fail" };
});
console.table(results);
console.log(`${passed}/${evals.length} passed`);
process.exit(passed === evals.length ? 0 : 1);
