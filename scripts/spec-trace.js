#!/usr/bin/env node
// Traceability check: is every part of the Morphir model described and linked to its source?
//
//   node scripts/spec-trace.js [projectDir] [--links]
//
// Reads morphir-ir.json, the `specLink` and `description` decorations (see morphir.json) and
// specs/**/*.md, and reports in one JSON verdict:
//   undescribedNodes   types and rules without a doc comment, and record fields and choice cases
//                      without a description decoration
//   unlinkedNodes      types and rules with no spec link (only when the model is spec-derived,
//                      i.e. the specLink decoration is configured)
//   unknownNodes       decoration entries for node IDs not in the model (renamed or removed)
//   brokenLinks        links whose file or #anchor does not exist in specs/
//   uncoveredSections  in-scope spec sections that nothing links to (a scoping question for
//                      the SME, not an error). Scope comes from spec-scope.json when present:
//                        { "include": ["specs/a.md", "specs/b.md#anchor"],
//                          "outOfScope": [{ "url": "specs/a.md#x", "reason": "..." }] }
//                      Otherwise every heading of every spec file the model links to.
// With --links, also lists every link with its permanent URL.
// With --nodes, only lists every decoratable node ID (the exact keys for spec-links.json and
// descriptions.json) and exits.
// Exit codes: 0 fully traced, 2 gaps to fix, 1 tool failure.

const fs = require("fs");
const path = require("path");
const ir = require("./lib/morphir-ir");
const { nodesOf, loadDecorations } = require("./lib/decorations");

// GitHub's heading anchor algorithm: lower-case, drop punctuation, spaces to hyphens,
// de-duplicate with -1, -2, ...
function slugsFor(markdown) {
  const seen = new Map();
  const headings = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    let slug = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(slug) || 0;
    seen.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n}`;
    headings.push({ level: m[1].length, text, slug });
  }
  return headings;
}

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listMarkdown(p) : e.name.endsWith(".md") ? [p] : [];
  });
}

const nameOf = (id) => id.split(":").slice(1).join(".").replace(/\.(type|value)/, "").replace("#", ".");

function main() {
  const args = process.argv.slice(2);
  const projectDir = path.resolve(args.find((a) => !a.startsWith("--")) || ".");
  const index = ir.indexIr(ir.loadIr(path.join(projectDir, "morphir-ir.json")));
  const nodes = nodesOf(index);
  if (args.includes("--nodes")) {
    return { exit: 0, verdict: { nodes: [...nodes.entries()].map(([id, n]) => ({ node: id, kind: n.kind, hasDocComment: !!n.doc })) } };
  }
  const deco = loadDecorations(projectDir);

  const undescribedNodes = [...nodes.entries()]
    .filter(([id, n]) => !(n.doc || deco.descriptionFor(id)))
    .map(([id, n]) => ({ node: id, name: nameOf(id), kind: n.kind }));

  const unlinkedNodes = deco.configured.specLink
    ? [...nodes.entries()].filter(([id, n]) => (n.kind === "type" || n.kind === "rule") && deco.specLinksFor(id).length === 0).map(([id, n]) => ({ node: id, name: nameOf(id), kind: n.kind }))
    : [];

  const unknownNodes = [...new Set([...deco.specLinkIds, ...deco.descriptionIds])].filter((id) => !nodes.has(id));

  const headingsByFile = new Map(
    listMarkdown(path.join(projectDir, "specs")).map((f) => [path.relative(projectDir, f).split(path.sep).join("/"), slugsFor(fs.readFileSync(f, "utf8"))])
  );
  const brokenLinks = [];
  const linked = new Map(); // file -> Set(anchor)
  const resolved = [];
  for (const id of deco.specLinkIds) {
    for (const ref of deco.specLinksFor(id)) {
      if (/^https?:\/\//.test(ref.url)) {
        resolved.push({ node: id, ...ref });
        continue;
      }
      const [file, anchor = ""] = ref.url.split("#");
      const headings = headingsByFile.get(file);
      if (!headings) brokenLinks.push({ node: id, url: ref.url, problem: "spec file not found" });
      else if (anchor && !headings.some((h) => h.slug === anchor)) brokenLinks.push({ node: id, url: ref.url, problem: "section anchor not found" });
      else {
        if (!linked.has(file)) linked.set(file, new Set());
        linked.get(file).add(anchor);
        resolved.push({ node: id, ...ref });
      }
    }
  }

  // In-scope sections that nothing links to yet.
  const scopePath = path.join(projectDir, "spec-scope.json");
  const scope = fs.existsSync(scopePath) ? JSON.parse(fs.readFileSync(scopePath, "utf8")) : null;
  const excluded = new Set((scope?.outOfScope || []).map((o) => o.url));
  const uncoveredSections = {};
  for (const entry of scope ? scope.include || [] : [...linked.keys()]) {
    const [file, anchor] = entry.split("#");
    const headings = headingsByFile.get(file);
    if (!headings) {
      brokenLinks.push({ node: "spec-scope.json", url: entry, problem: "spec file not found" });
      continue;
    }
    const candidates = anchor ? headings.filter((h) => h.slug === anchor) : headings.filter((h) => h.level >= 2);
    if (anchor && candidates.length === 0) brokenLinks.push({ node: "spec-scope.json", url: entry, problem: "section anchor not found" });
    const missing = candidates.filter((h) => !(linked.get(file) || new Set()).has(h.slug) && !excluded.has(`${file}#${h.slug}`)).map((h) => h.text);
    if (missing.length) uncoveredSections[file] = [...(uncoveredSections[file] || []), ...missing];
  }

  const failing = undescribedNodes.length + unlinkedNodes.length + unknownNodes.length + brokenLinks.length;
  const verdict = {
    status: failing === 0 ? "traced" : "gaps",
    nodes: nodes.size,
    specDerived: deco.configured.specLink,
    undescribedNodes,
    unlinkedNodes,
    unknownNodes,
    brokenLinks,
    uncoveredSections,
    outOfScope: scope?.outOfScope || [],
  };
  if (args.includes("--links")) verdict.links = resolved;
  return { exit: failing === 0 ? 0 : 2, verdict };
}

try {
  const { exit, verdict } = main();
  process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  process.exit(exit);
} catch (e) {
  process.stdout.write(JSON.stringify({ status: "tool_failure", detail: e.message }, null, 2) + "\n");
  process.exit(1);
}
