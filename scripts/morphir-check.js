#!/usr/bin/env node
// The compiler gate used by the morphir-logic-formalization skill.
//
//   node scripts/morphir-check.js [projectDir]
//
// 1. `elm make` type-checks the model, including exhaustiveness of every `case`.
//    (`morphir-elm make` alone does not reject a case that forgets a status, so this step
//    is what turns "you never said what happens to Exempt accounts" into a hard stop.)
// 2. `morphir-elm make` writes the canonical morphir-ir.json.
//
// Prints one JSON verdict on stdout and never raw compiler text, so the agent can turn it
// into business language:
//   { "status": "verified" | "needs_sme_clarification" | "needs_technical_fix", ... }
// Exit codes: 0 verified, 2 needs SME clarification, 3 needs technical fix, 1 tool failure.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let projectRoot = process.cwd();
const rel = (p) => path.relative(projectRoot, fs.existsSync(p) ? fs.realpathSync(p) : p);
const STUB_SDK = path.join(__dirname, "gate", "sdk");

function findBin(name, start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const bin = path.join(dir, "node_modules", ".bin", name);
    if (fs.existsSync(bin)) return bin;
    if (dir === path.dirname(dir)) break;
  }
  const local = path.join(ROOT, "node_modules", ".bin", name);
  return fs.existsSync(local) ? local : name;
}

function listElmFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listElmFiles(p) : e.name.endsWith(".elm") ? [p] : [];
  });
}

const messageText = (parts) => parts.map((p) => (typeof p === "string" ? p : p.string)).join("");

// Name of the top-level definition that contains a given (1-based) line.
function enclosingDefinition(lines, line) {
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = lines[i].match(/^([a-z][A-Za-z0-9_]*)\s*(:|[^=]*=)/);
    if (m) return m[1];
  }
  return null;
}

// Custom types declared in the model: { TypeName: [Constructor, ...] }.
function declaredCustomTypes(files) {
  const types = {};
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = line.match(/^type\s+(?!alias\b)([A-Z]\w*)/);
      if (!m) return;
      const body = [line];
      for (let j = i + 1; j < lines.length && (lines[j] === "" || /^\s/.test(lines[j])); j++) body.push(lines[j]);
      const ctors = body.join("\n").split("=").slice(1).join("=");
      types[m[1]] = ctors
        .split("|")
        .map((c) => c.replace(/--.*$/gm, "").trim().split(/\s+/)[0])
        .filter((c) => /^[A-Z]/.test(c));
    });
  }
  return types;
}

function missingPossibilities(text) {
  const m = text.match(/Missing possibilities include:\n\n((?:    .*\n?)+)/);
  return m ? m[1].split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

function classifyElmErrors(report, files) {
  const customTypes = declaredCustomTypes(files);
  const clarifications = [];
  const technical = [];
  for (const err of report.errors || []) {
    const lines = fs.existsSync(err.path) ? fs.readFileSync(err.path, "utf8").split("\n") : [];
    for (const problem of err.problems) {
      const text = messageText(problem.message);
      const line = problem.region.start.line;
      if (problem.title === "MISSING PATTERNS") {
        const missing = missingPossibilities(text);
        const ctor = (missing[0] || "").split(/\s+/)[0];
        const typeName = Object.keys(customTypes).find((t) => customTypes[t].includes(ctor)) || null;
        clarifications.push({
          kind: "unhandled-case",
          module: err.name,
          rule: enclosingDefinition(lines, line),
          businessType: typeName,
          allCases: typeName ? customTypes[typeName] : null,
          missingCases: missing,
          file: rel(err.path),
          line,
        });
      } else {
        technical.push({
          kind: problem.title.toLowerCase().replace(/\s+/g, "-"),
          module: err.name,
          rule: enclosingDefinition(lines, line),
          file: rel(err.path),
          line,
          detail: text.replace(/\n{3,}/g, "\n\n").trim(),
        });
      }
    }
  }
  if (report.type === "error") {
    technical.push({ kind: (report.title || "error").toLowerCase().replace(/\s+/g, "-"), detail: messageText(report.message || []) });
  }
  return { clarifications, technical };
}

// `_ ->` branches silently absorb any status the SME has not decided on, which defeats the
// exhaustiveness gate. They are reported so the agent replaces them with explicit cases.
function wildcardBranches(files) {
  const found = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((l, i) => {
      if (/^\s+_\s*->/.test(l)) found.push({ kind: "wildcard-branch", rule: enclosingDefinition(lines, i + 1), file: rel(f), line: i + 1 });
    });
  }
  return found;
}

function summarizeIr(irPath) {
  const ir = require("./lib/morphir-ir");
  const index = ir.indexIr(ir.loadIr(irPath));
  const types = [...index.types.values()].map((t) => ({
    name: ir.fqnDisplay(t.fqn),
    kind: t.def[0] === "CustomTypeDefinition" ? "choice" : "record",
    cases: t.def[0] === "CustomTypeDefinition" ? t.def[2].value.map(([n]) => ir.toTitle(n)) : undefined,
  }));
  const rules = [...index.values.values()]
    .filter((v) => v.access === "Public")
    .map((v) => ({ name: ir.fqnDisplay(v.fqn), inputs: v.def.inputTypes.map(([n]) => ir.toCamel(n)), doc: v.doc.trim() || undefined }));
  return { types, rules };
}

function main() {
  const projectDir = path.resolve(process.argv[2] || ".");
  projectRoot = fs.existsSync(projectDir) ? fs.realpathSync(projectDir) : projectDir;
  const morphirJsonPath = path.join(projectDir, "morphir.json");
  if (!fs.existsSync(morphirJsonPath)) {
    return { exit: 3, verdict: { status: "needs_technical_fix", technicalErrors: [{ kind: "no-project", detail: `No morphir.json in ${projectDir}` }] } };
  }
  const morphirJson = JSON.parse(fs.readFileSync(morphirJsonPath, "utf8"));
  const srcDir = path.join(projectDir, morphirJson.sourceDirectory || "src");
  const files = listElmFiles(srcDir);
  if (files.length === 0) {
    return { exit: 3, verdict: { status: "needs_technical_fix", technicalErrors: [{ kind: "no-sources", detail: `No .elm files under ${srcDir}` }] } };
  }

  // Step 1: elm make against the type-check SDK stub.
  fs.mkdirSync(path.join(projectDir, ".morphir", "gate"), { recursive: true });
  const gateDir = fs.realpathSync(path.join(projectDir, ".morphir", "gate"));
  fs.writeFileSync(
    path.join(gateDir, "elm.json"),
    JSON.stringify(
      {
        type: "application",
        "source-directories": [path.relative(gateDir, fs.realpathSync(srcDir)), path.relative(gateDir, fs.realpathSync(STUB_SDK))],
        "elm-version": "0.19.1",
        dependencies: { direct: { "elm/core": "1.0.5", "elm/json": "1.1.3" }, indirect: {} },
        "test-dependencies": { direct: {}, indirect: {} },
      },
      null,
      4
    )
  );
  const elm = spawnSync(findBin("elm", projectDir), ["make", ...files, "--output=/dev/null", "--report=json"], { cwd: gateDir, encoding: "utf8" });
  if (elm.error) throw new Error(`could not run elm: ${elm.error.message}`);
  if (elm.status !== 0) {
    let report;
    try {
      report = JSON.parse(elm.stderr);
    } catch {
      return { exit: 3, verdict: { status: "needs_technical_fix", technicalErrors: [{ kind: "elm-failure", detail: elm.stderr.trim() }] } };
    }
    const { clarifications, technical } = classifyElmErrors(report, files);
    if (technical.length) return { exit: 3, verdict: { status: "needs_technical_fix", technicalErrors: technical, clarifications } };
    return { exit: 2, verdict: { status: "needs_sme_clarification", clarifications } };
  }

  const wildcards = wildcardBranches(files);
  if (wildcards.length) {
    return { exit: 3, verdict: { status: "needs_technical_fix", technicalErrors: wildcards, note: "Replace each `_ ->` with explicit cases; ask the SME about any case they have not decided." } };
  }

  // Step 2: morphir-elm make produces the canonical IR.
  const morphir = spawnSync(findBin("morphir-elm", projectDir), ["make"], { cwd: projectDir, encoding: "utf8" });
  const irPath = path.join(projectDir, "morphir-ir.json");
  if (morphir.status !== 0 || !fs.existsSync(irPath)) {
    const detail = `${morphir.stdout}\n${morphir.stderr}`.split("\n").filter((l) => !/^\[\d{4}-|Compiled in DEV mode/.test(l)).join("\n").trim();
    return { exit: 3, verdict: { status: "needs_technical_fix", technicalErrors: [{ kind: "morphir-make", detail }] } };
  }
  return { exit: 0, verdict: { status: "verified", ir: rel(irPath), ...summarizeIr(irPath) } };
}

try {
  const { exit, verdict } = main();
  process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  process.exit(exit);
} catch (e) {
  process.stdout.write(JSON.stringify({ status: "tool_failure", detail: e.message }, null, 2) + "\n");
  process.exit(1);
}
