#!/usr/bin/env node
// Read-only MCP server over the workspace's verified Morphir policy, so an agent can ask the
// model itself: what a type or rule means, where it comes from in the regulation, how it lines
// up with FIBO and CDM, and what a rule returns for given inputs (run by Morphir's own
// interpreter, the same one the zero-drift check uses).
//
//   node scripts/morphir-policy-mcp.js [--project <dir>]      (stdio; default: current directory)
//
// It reads morphir-ir.json and the decoration files on every call, so it always answers about
// the latest verified version, and it never changes the model.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const ir = require("./lib/morphir-ir");
const { loadModel } = require("./knowledge/model");
const { conceptIris } = require("./knowledge/iris");
const { loadAlignments } = require("./knowledge/alignments");

const argv = process.argv.slice(2);
const ROOT = path.resolve(argv.includes("--project") ? argv[argv.indexOf("--project") + 1] : process.cwd());
const IR_PATH = path.join(ROOT, "morphir-ir.json");

// ---------------------------------------------------------------------------------------------
// The policy, as currently verified.

class NoPolicy extends Error {}

function policy() {
  if (!fs.existsSync(IR_PATH)) throw new NoPolicy("There is no verified policy in this workspace yet. Describe the policy (or point at the regulation) and verify it first.");
  const model = loadModel({ irPath: IR_PATH, projectDir: ROOT });
  const { index } = model;
  const standards = ["fibo", "cdm"].map((name) => ({
    name,
    label: name.toUpperCase(),
    termTypes: ["http://www.w3.org/2002/07/owl#Class", "http://www.w3.org/2004/02/skos/core#Concept"],
    subsetFile: path.join(ROOT, "ontologies", name, `${name}-subset.ttl`),
    alignmentFile: path.join(ROOT, "ontologies", `${name}-alignment.ttl`),
  }));
  let alignments = [];
  try {
    alignments = loadAlignments(standards);
  } catch (e) {
    alignments = [];
  }
  return { model, index, iris: conceptIris(model), alignments };
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const localName = (fqn) => ir.toCamel(fqn[2]);
const moduleName = (fqn) => ir.pathToString(fqn[1]);
const keyOf = (fqn) => ir.fqnKey(fqn);

// A type, readable: Decimal, List RetailDeposit, Maybe Date, { a : Decimal, ... }.
function typeText(tpe) {
  if (!Array.isArray(tpe)) return "?";
  switch (tpe[0]) {
    case "Reference": {
      const name = ir.toTitle(tpe[2][2]);
      const args = (tpe[3] || []).map(typeText);
      return args.length ? `${name} ${args.map((a) => (a.includes(" ") ? `(${a})` : a)).join(" ")}` : name;
    }
    case "Record":
      return `{ ${tpe[2].map((f) => `${ir.toCamel(f.name)} : ${typeText(f.tpe)}`).join(", ")} }`;
    case "Tuple":
      return `( ${tpe[2].map(typeText).join(", ")} )`;
    case "Variable":
      return ir.toCamel(tpe[2]);
    case "Function":
      return `${typeText(tpe[2])} -> ${typeText(tpe[3])}`;
    case "Unit":
      return "()";
    default:
      return tpe[0];
  }
}

const links = (refs) => (refs || []).map((r) => ({ section: r.section, link: r.permalink || r.url }));

// Finds a type or value by name: "AssetCode", "Pl7.Fields.AssetCode", "asset code", ...
function find(p, name, kinds = ["type", "value"]) {
  const want = norm(name);
  const hits = [];
  if (kinds.includes("type")) {
    for (const t of p.index.types.values()) {
      const names = [localName(t.fqn), `${moduleName(t.fqn)}.${localName(t.fqn)}`, ir.toTitle(t.fqn[2])];
      if (names.some((n) => norm(n) === want)) hits.push({ kind: "type", entry: t });
    }
  }
  if (kinds.includes("value")) {
    for (const v of p.index.values.values()) {
      const rule = p.model.rules.find((r) => keyOf(r.fqn) === keyOf(v.fqn));
      const names = [localName(v.fqn), `${moduleName(v.fqn)}.${localName(v.fqn)}`, rule ? rule.title : ""];
      if (names.some((n) => n && norm(n) === want)) hits.push({ kind: "value", entry: v, rule });
    }
  }
  return hits;
}

function notFound(p, name, kinds) {
  const want = norm(name);
  const near = [];
  if (kinds.includes("type")) for (const t of p.index.types.values()) if (norm(localName(t.fqn)).includes(want) || want.includes(norm(localName(t.fqn)))) near.push(localName(t.fqn));
  if (kinds.includes("value")) for (const v of p.index.values.values()) if (norm(localName(v.fqn)).includes(want)) near.push(localName(v.fqn));
  return { found: false, message: `Nothing in the policy is called "${name}".`, didYouMean: [...new Set(near)].slice(0, 10) };
}

// FIBO and CDM mappings recorded for a concept IRI.
function mappingsFor(p, iri) {
  if (!iri) return [];
  return p.alignments.flatMap((std) =>
    std.mappings.filter((m) => m.subject === iri).map((m) => ({ standard: std.label, relation: m.relation, target: m.targetLabel, targetIri: m.target, reason: m.reason || undefined }))
  );
}

const glossaryType = (p, fqn) => p.model.types.find((t) => keyOf(t.fqn) === keyOf(fqn));

// Policy rules and constants a value's body refers to.
function referencesIn(p, node, found = new Map()) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node) && node[0] === "Reference" && Array.isArray(node[2]) && node[2].length === 3) {
    const v = p.index.values.get(keyOf(node[2]));
    if (v) found.set(keyOf(node[2]), v);
  }
  Object.values(node).forEach((child) => referencesIn(p, child, found));
  return found;
}

// ---------------------------------------------------------------------------------------------
// Tools.

function overview() {
  const p = policy();
  const { model } = p;
  const finals = model.rules.filter((r) => r.calledBy.length === 0);
  const specFiles = [...new Set(model.types.flatMap((t) => t.specLinks).concat(model.rules.flatMap((r) => r.specLinks)).map((l) => l.url.split("#")[0]))];
  return {
    policy: model.packageName,
    records: model.tables.map((t) => ({ name: ir.toTitle(t.entityType[2][2]), title: model.humanize(t.entityType[2][2], (p.index.types.get(keyOf(t.entityType[2])) || { doc: "" }).doc), domain: t.domain, fields: t.columns.filter((c) => !c.generated).length, calculation: !!t.feed })),
    choices: model.types.filter((t) => t.kind === "choice").map((t) => ({ name: t.name, cases: t.values.length })),
    finalResults: finals.map((r) => ({ rule: r.name, title: r.title, decides: r.doc.split("\n")[0] })),
    interimRules: model.rules.length - finals.length,
    specification: specFiles,
    aligned: p.alignments.map((s) => ({ standard: s.label, mappings: s.mappings.length })),
  };
}

function search({ text }) {
  const p = policy();
  const words = String(text).toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (...fields) => {
    const hay = fields.filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const out = [];
  for (const t of p.model.types) {
    if (matches(t.name, t.doc)) out.push({ kind: t.kind, name: t.name, module: t.module, about: t.doc.split("\n")[0] });
    for (const v of t.valueInfo) if (matches(v.name, v.description)) out.push({ kind: "case", name: `${t.name}.${v.name}`, about: v.description });
    for (const f of t.fields) if (matches(f.name, f.description)) out.push({ kind: "field", name: `${t.name}.${f.name}`, type: typeText(f.tpe), about: f.description });
  }
  for (const v of p.index.values.values()) {
    const rule = p.model.rules.find((r) => keyOf(r.fqn) === keyOf(v.fqn));
    if (matches(localName(v.fqn), rule && rule.title, v.doc)) out.push({ kind: rule ? "rule" : "definition", name: localName(v.fqn), module: moduleName(v.fqn), about: v.doc.trim().split("\n")[0] });
  }
  return { query: text, results: out.slice(0, 40), more: Math.max(0, out.length - 40) };
}

function describeType({ name }) {
  const p = policy();
  const hits = find(p, name, ["type"]);
  if (!hits.length) return notFound(p, name, ["type"]);
  const t = glossaryType(p, hits[0].entry.fqn);
  const usedBy = [...p.index.values.values()]
    .filter((v) => JSON.stringify([v.def.inputTypes, v.def.outputType]).includes(JSON.stringify(t.fqn)))
    .map((v) => localName(v.fqn));
  return {
    name: t.name,
    module: t.module,
    kind: t.kind,
    meaning: t.doc,
    specification: links(t.specLinks),
    standards: mappingsFor(p, p.iris.type(t)),
    ...(t.kind === "choice"
      ? { cases: t.valueInfo.map((v) => ({ name: v.name, meaning: v.description, specification: links(v.specLinks), standards: mappingsFor(p, p.iris.value(t, v.name)) })) }
      : {}),
    ...(t.kind === "record"
      ? {
          fields: t.fields.map((f) => {
            const termIri = p.iris.member(t, f.name);
            return { name: f.name, type: typeText(f.tpe), meaning: f.description, specification: links(f.specLinks), businessTerm: termIri ? termIri.split("/").pop() : null };
          }),
        }
      : {}),
    ...(t.kind === "alias" ? { definedAs: typeText(hits[0].entry.def[2]) } : {}),
    usedByRules: usedBy,
  };
}

function explainRule({ name }) {
  const p = policy();
  const hits = find(p, name, ["value"]);
  if (!hits.length) return notFound(p, name, ["value"]);
  const { entry: v, rule } = hits[0];
  const refs = [...referencesIn(p, v.def.body).values()].filter((x) => keyOf(x.fqn) !== keyOf(v.fqn));
  const ruleFor = (x) => p.model.rules.find((r) => keyOf(r.fqn) === keyOf(x.fqn));
  const nodeId = p.model.nodeId(v.fqn, "value");
  return {
    name: localName(v.fqn),
    module: moduleName(v.fqn),
    title: rule ? rule.title : undefined,
    decides: v.doc.trim(),
    inputs: v.def.inputTypes.map(([argName, , tpe]) => ({ name: ir.toCamel(argName), type: typeText(tpe) })),
    returns: typeText(v.def.outputType),
    specification: links(p.model.decorations.specLinksFor(nodeId)),
    standards: rule ? mappingsFor(p, p.iris.rule(rule)) : [],
    uses: refs.map((x) => ({ name: localName(x.fqn), kind: ruleFor(x) ? "rule" : x.def.inputTypes.length ? "helper" : "constant", meaning: x.doc.trim().split("\n")[0] })),
    usedBy: [...p.index.values.values()].filter((x) => referencesIn(p, x.def.body).has(keyOf(v.fqn)) && keyOf(x.fqn) !== keyOf(v.fqn)).map((x) => localName(x.fqn)),
    database: rule ? { view: rule.view, columns: rule.outputs.map((o) => o.column), sql: rule.outputs.map((o) => o.sql).filter(Boolean)[0] } : null,
  };
}

// Where a result comes from: the rules it uses, down to the input fields, with the regulation
// sections at each step. A calculation record's field filled by another rule is followed into
// that rule; one that is reported is named as a reported input.
function trace({ name }) {
  const p = policy();
  const hits = find(p, name, ["value"]);
  if (!hits.length) return notFound(p, name, ["value"]);
  const seen = new Set();
  const sectionsAll = new Map();
  const reported = [];
  const calc = p.model.decorations;

  const step = (v, depth) => {
    const key = keyOf(v.fqn);
    const nodeId = p.model.nodeId(v.fqn, "value");
    const specs = links(calc.specLinksFor(nodeId));
    specs.forEach((s) => sectionsAll.set(s.link, s.section));
    const node = { name: localName(v.fqn), decides: v.doc.trim().split("\n")[0], specification: specs.map((s) => s.section) };
    if (seen.has(key) || depth > 12) return { ...node, seeAbove: true };
    seen.add(key);
    const uses = [...referencesIn(p, v.def.body).values()].filter((x) => keyOf(x.fqn) !== key && (x.def.inputTypes.length || p.model.rules.some((r) => keyOf(r.fqn) === keyOf(x.fqn))));
    const children = uses.map((x) => step(x, depth + 1));
    // Fields of the input records this value reads, and for a calculation record where each comes from.
    const inputs = [];
    for (const [, , tpe] of v.def.inputTypes) {
      const recType = tpe[0] === "Reference" && p.index.types.get(keyOf(tpe[2]));
      const t = recType && glossaryType(p, tpe[2]);
      if (!t || t.kind !== "record") continue;
      // Fields the body reads: a Field node carries the field's name as Morphir words.
      const read = new Set();
      const collect = (n) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n) && n[0] === "Field" && Array.isArray(n[3])) read.add(JSON.stringify(n[3]));
        Object.values(n).forEach(collect);
      };
      collect(v.def.body);
      const isCalculation = p.model.tables.some((tb) => tb.feed && keyOf(tb.entityType[2]) === keyOf(t.fqn));
      for (const f of ir.recordFieldsOf(p.index, tpe) || []) {
        if (!read.has(JSON.stringify(f.name))) continue;
        const field = ir.toCamel(f.name);
        const from = calc.calculatedFromFor(`${p.model.nodeId(t.fqn, "type")}#${field}`);
        if (from) {
          const producer = find(p, from.split(".").pop(), ["value"])[0];
          inputs.push({ field: `${t.name}.${field}`, calculatedBy: from });
          if (producer) children.push(step(producer.entry, depth + 1));
        } else {
          inputs.push({ field: `${t.name}.${field}`, source: isCalculation ? "reported" : "input data" });
          if (isCalculation) reported.push(`${t.name}.${field}`);
        }
      }
    }
    return { ...node, ...(inputs.length ? { reads: inputs } : {}), ...(children.length ? { builtFrom: children } : {}) };
  };

  return {
    result: localName(hits[0].entry.fqn),
    tree: step(hits[0].entry, 0),
    regulationSections: [...sectionsAll].map(([link, section]) => ({ section, link })),
    reportedNotCalculated: [...new Set(reported)],
  };
}

// --- evaluate: plain JSON in, Morphir's own answer out ---------------------------------------

// Plain JSON -> Morphir's JSON encoding for a type.
function toMorphir(p, tpe, value, where) {
  const { index } = p;
  if (tpe[0] === "Reference" && keyOf(tpe[2]) === ir.SDK.maybe) return value === null || value === undefined ? null : toMorphir(p, tpe[3][0], value, where);
  if (tpe[0] === "Reference" && keyOf(tpe[2]) === ir.SDK.list) {
    if (!Array.isArray(value)) throw new Error(`${where}: expected a list`);
    return value.map((x, i) => toMorphir(p, tpe[3][0], x, `${where}[${i}]`));
  }
  if (ir.isEnum(index, tpe)) {
    const ct = ir.customTypeOf(index, tpe);
    const names = ct.constructors.map(([n]) => ir.toTitle(n));
    const hit = names.find((n) => norm(n) === norm(Array.isArray(value) ? value[0] : value));
    if (!hit) throw new Error(`${where}: "${value}" is not one of ${names.join(", ")}`);
    return [hit];
  }
  const fields = ir.recordFieldsOf(index, tpe);
  if (fields) {
    if (!value || typeof value !== "object") throw new Error(`${where}: expected a record with ${fields.map((f) => ir.toCamel(f.name)).join(", ")}`);
    const out = {};
    for (const f of fields) {
      const k = ir.toCamel(f.name);
      const given = Object.keys(value).find((x) => norm(x) === norm(k));
      // Identifiers (recordId, accountId, ...) don't affect a decision: default them.
      if (given === undefined && /Id$/.test(k) && ir.sdkTypeKey(index, f.tpe) === ir.SDK.string) out[k] = "what-if";
      else if (given === undefined) throw new Error(`${where}: missing ${k} (fields: ${fields.map((x) => ir.toCamel(x.name)).join(", ")})`);
      else out[k] = toMorphir(p, f.tpe, value[given], `${where}.${k}`);
    }
    return out;
  }
  switch (ir.sdkTypeKey(index, tpe)) {
    case ir.SDK.decimal:
      if (value === null || value === "" || isNaN(Number(value))) throw new Error(`${where}: expected a number`);
      return String(value);
    case ir.SDK.int:
      return Math.trunc(Number(value));
    case ir.SDK.float:
      return Number(value);
    case ir.SDK.bool:
      if (typeof value === "boolean") return value;
      if (/^(yes|true|y)$/i.test(String(value))) return true;
      if (/^(no|false|n)$/i.test(String(value))) return false;
      throw new Error(`${where}: expected yes or no`);
    default:
      return String(value);
  }
}

// A value of the type that decodes, used as the "expected" output so the interpreter reports
// the actual one.
function placeholder(p, tpe) {
  const { index } = p;
  if (tpe[0] === "Reference" && keyOf(tpe[2]) === ir.SDK.maybe) return null;
  if (tpe[0] === "Reference" && keyOf(tpe[2]) === ir.SDK.list) return [];
  if (ir.isEnum(index, tpe)) return [ir.toTitle(ir.customTypeOf(index, tpe).constructors[0][0])];
  const fields = ir.recordFieldsOf(index, tpe);
  if (fields) return Object.fromEntries(fields.map((f) => [ir.toCamel(f.name), placeholder(p, f.tpe)]));
  switch (ir.sdkTypeKey(index, tpe)) {
    case ir.SDK.decimal:
      return "-0.000000123";
    case ir.SDK.int:
    case ir.SDK.float:
      return -123456789;
    case ir.SDK.bool:
      return false;
    default:
      return "\u0000";
  }
}

// The interpreter's printed value, readable: short case names, true/false, and numbers without
// floating-point print noise (350.00000000000005 -> 350).
const shortValue = (s) => {
  const v = String(s).replace(/\b(?:[A-Z][A-Za-z0-9]*\.)+([A-Z][A-Za-z0-9]*)\b/g, "$1");
  if (/^(true|false)$/i.test(v)) return v.toLowerCase();
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(Number(v).toFixed(10)).toString();
  return v;
};

function findMorphirElm() {
  for (let dir = ROOT; ; dir = path.dirname(dir)) {
    const bin = path.join(dir, "node_modules", ".bin", "morphir-elm");
    if (fs.existsSync(bin)) return bin;
    if (dir === path.dirname(dir)) break;
  }
  const own = path.join(__dirname, "..", "node_modules", ".bin", "morphir-elm");
  return fs.existsSync(own) ? own : "morphir-elm";
}

function evaluate({ rule, inputs, showSteps = true }) {
  const p = policy();
  const hits = find(p, rule, ["value"]);
  if (!hits.length) return notFound(p, rule, ["value"]);
  const v = hits[0].entry;
  const args = v.def.inputTypes;
  const given = Array.isArray(inputs) && args.length > 1 ? inputs : [inputs];
  if (given.length !== args.length) throw new Error(`${localName(v.fqn)} takes ${args.length} input(s): ${args.map(([n, , t]) => `${ir.toCamel(n)} : ${typeText(t)}`).join(", ")}`);
  const encoded = args.map(([n, , t], i) => toMorphir(p, t, given[i], ir.toCamel(n)));

  // The rule itself, plus (for a single record input) every other rule over the same record,
  // so the answer shows each step of the decision.
  const targets = [v];
  if (showSteps && args.length === 1) {
    const sig = JSON.stringify(args[0][2]);
    for (const x of p.index.values.values()) if (x !== v && x.def.inputTypes.length === 1 && JSON.stringify(x.def.inputTypes[0][2]) === sig && p.model.rules.some((r) => keyOf(r.fqn) === keyOf(x.fqn))) targets.push(x);
  }
  const suites = targets.map((x) => [x.fqn, [{ inputs: encoded, expectedOutput: placeholder(p, x.def.outputType), description: "what-if" }]]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "morphir-whatif-"));
  try {
    fs.copyFileSync(IR_PATH, path.join(dir, "morphir-ir.json"));
    fs.writeFileSync(path.join(dir, "morphir.json"), JSON.stringify({ name: p.model.packageName, sourceDirectory: "src", exposedModules: [] }));
    fs.writeFileSync(path.join(dir, "morphir-tests.json"), JSON.stringify(suites));
    const run = spawnSync(findMorphirElm(), ["test", "-p", dir], { encoding: "utf8", timeout: 60000 });
    const out = `${run.stdout}\n${run.stderr}`;
    const problem = out.match(/Problem with the value[\s\S]*?(?=\n\n\S|$)/);
    if (problem) throw new Error(`The interpreter could not read the inputs: ${problem[0].slice(0, 400)}`);
    const results = new Map();
    let current = null;
    for (const line of out.split("\n")) {
      const fn = line.match(/Function Name - (.*)$/);
      if (fn) current = fn[1].trim();
      const actual = line.match(/Actual Output - (.*)$/);
      if (actual && current) results.set(current, shortValue(actual[1].trim()));
    }
    const answer = (x) => {
      const id = `${ir.pathToString(x.fqn[0])}:${ir.pathToString(x.fqn[1])}:${localName(x.fqn)}`;
      if (results.has(id)) return results.get(id);
      // No "Actual Output" line: the interpreter's answer equalled the placeholder.
      return shortValue(JSON.stringify(placeholder(p, x.def.outputType)).replace(/^\["?|"?\]$/g, "").replace(/^"|"$/g, ""));
    };
    return {
      rule: localName(v.fqn),
      result: answer(v),
      ...(targets.length > 1 ? { steps: targets.slice(1).map((x) => ({ rule: localName(x.fqn), result: answer(x), decides: x.doc.trim().split("\n")[0] })) } : {}),
      evaluatedBy: "Morphir interpreter (morphir-elm test), on the verified policy",
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function coverage() {
  if (!fs.existsSync(IR_PATH)) throw new NoPolicy("There is no verified policy in this workspace yet.");
  const run = spawnSync(process.execPath, [path.join(__dirname, "spec-trace.js"), ROOT], { encoding: "utf8", timeout: 60000 });
  let t;
  try {
    t = JSON.parse(run.stdout);
  } catch (e) {
    return { message: "The specification check did not run.", detail: (run.stderr || run.stdout).slice(0, 400) };
  }
  const { linked, sections, ...rest } = t;
  return rest;
}

// ---------------------------------------------------------------------------------------------

const server = new McpServer(
  { name: "morphir-policy", version: "1.0.0" },
  {
    instructions:
      "Answers questions about the bank's verified policy from the Morphir model itself: what types and rules mean, which regulation sections they come from, how they map to FIBO and CDM, and what a rule returns for given inputs (evaluated by Morphir, not estimated). Read-only. Answer the person in business language.",
  }
);

const reply = (fn) => async (args) => {
  try {
    return { content: [{ type: "text", text: JSON.stringify(fn(args || {}), null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof NoPolicy ? e.message : `Could not answer: ${e.message}` }], isError: !(e instanceof NoPolicy) };
  }
};

server.registerTool("policy_overview", { description: "Summary of the verified policy: its records (tables), choice types, final results and interim rules, the specification it traces to, and how much of it is aligned to FIBO and CDM.", inputSchema: {} }, reply(overview));
server.registerTool(
  "search",
  { description: "Find types, choice cases, fields, rules and definitions whose name or business description contains all the given words.", inputSchema: { text: z.string().describe("Words to look for, e.g. 'guarantee' or 'tier limit'") } },
  reply(search)
);
server.registerTool(
  "describe_type",
  { description: "Everything about a business type: its meaning, fields or choice cases with their meanings, the regulation sections, its FIBO and CDM mappings, and the rules that use it.", inputSchema: { name: z.string().describe("Type name, e.g. 'AssetCode' or 'RetailDeposit'") } },
  reply(describeType)
);
server.registerTool(
  "explain_rule",
  { description: "What a rule decides: inputs and result type, the regulation sections, the rules and constants it uses, what uses it, and the database view and SQL it was generated into.", inputSchema: { name: z.string().describe("Rule name, e.g. 'stockOfEligibleLiquidAssets' or 'outflowRule'") } },
  reply(explainRule)
);
server.registerTool(
  "trace",
  { description: "Where a result comes from: the tree of rules it is built from down to the input fields, the regulation sections along the way, and which inputs are reported rather than calculated.", inputSchema: { name: z.string().describe("Rule name, e.g. 'liquidityResilienceRatio'") } },
  reply(trace)
);
server.registerTool(
  "evaluate",
  {
    description:
      "Run a rule on given inputs with Morphir's own interpreter (what-if). Give a record as plain JSON with field names and business values, e.g. {\"product\":\"IntermediatedDeposits\",\"counterparty\":\"Retail\",\"guarantee\":\"Unguaranteed\",\"balance\":1000}; a list of records for rules over many; an array of arguments for rules with several inputs. Record IDs may be left out. With showSteps, also returns every other rule over the same record.",
    inputSchema: { rule: z.string(), inputs: z.any().describe("The rule's input(s) as plain JSON"), showSteps: z.boolean().optional() },
  },
  reply(evaluate)
);
server.registerTool("coverage", { description: "How the policy covers the specification: sections linked, sections out of scope (with the reason), and any gaps or broken links.", inputSchema: {} }, reply(coverage));

server.connect(new StdioServerTransport());
