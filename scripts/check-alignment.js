#!/usr/bin/env node
// Checks an alignment of the policy to an industry standard: FIBO (meaning) or CDM (data
// structure), in ontologies/<standard>-alignment.ttl:
//   - it parses as Turtle;
//   - every mapping goes from one of the policy's glossary terms (types, values, functions and
//     fields of built-in types, out/knowledge/glossary/) to a resource in the standard's subset
//     (ontologies/<standard>/<standard>-subset.ttl), with an allowed relation; no invented IRIs;
//   - which of the policy's concepts are still unmapped (types, values and measures).
//
//   node scripts/check-alignment.js [--standard fibo|cdm] [--project .] [--alignment <file>]
//
// Prints JSON; exits 0 when every mapping is valid, 2 when there are errors.

const fs = require("fs");
const path = require("path");
const N3 = require("n3");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const projectDir = opt("--project", ".");
const standard = opt("--standard", "fibo");
const alignmentPath = opt("--alignment", path.join(projectDir, "ontologies", `${standard}-alignment.ttl`));
const subsetPath = opt("--subset", path.join(projectDir, "ontologies", standard, `${standard}-subset.ttl`));
const NAME = { fibo: "FIBO", cdm: "CDM" }[standard] || standard;
const knowledgeDir = opt("--knowledge", path.join(projectDir, "out", "knowledge"));

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";
const SKOS = "http://www.w3.org/2004/02/skos/core#";
// Mapping relations, read as "<policy concept> relation <standard's resource>".
const MAPPINGS = {
  [`${SKOS}exactMatch`]: "same concept",
  [`${SKOS}closeMatch`]: "nearly the same concept",
  [`${SKOS}broadMatch`]: "standard's concept is broader",
  [`${SKOS}narrowMatch`]: "standard's concept is narrower",
  [`${SKOS}relatedMatch`]: "related concept",
  [`${RDFS}subClassOf`]: "a kind of the standard's class",
  [`${OWL}equivalentClass`]: "equivalent class",
};
// Statements allowed besides mappings: the alignment's own header and notes.
const ANNOTATIONS = new Set([`${RDF}type`, `${RDFS}label`, `${RDFS}comment`, `${OWL}imports`, `${SKOS}note`, `${SKOS}scopeNote`, "http://purl.org/dc/terms/source", "http://purl.org/dc/terms/created"]);

const parse = (file) => new N3.Parser({ baseIRI: `file://${path.resolve(file)}` }).parse(fs.readFileSync(file, "utf8"));
const ttlIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".ttl")).map((f) => path.join(dir, f)) : []);

function fail(message) {
  console.log(JSON.stringify({ status: "error", message }, null, 2));
  process.exit(2);
}

if (!fs.existsSync(subsetPath)) fail(`No ${NAME} subset at ${subsetPath}.`);
const ours = [...ttlIn(path.join(knowledgeDir, "ontology")), ...ttlIn(path.join(knowledgeDir, "glossary"))];
if (!ours.length) fail(`No generated ontology or glossary under ${knowledgeDir}: run node scripts/morphir-to-knowledge.js first.`);
if (!fs.existsSync(alignmentPath)) fail(`No alignment at ${alignmentPath}.`);

// The standard's classes, concepts, individuals and properties in the subset, with labels.
const TARGET_TYPES = [`${OWL}Class`, `${OWL}NamedIndividual`, `${OWL}ObjectProperty`, `${OWL}DatatypeProperty`, `${SKOS}Concept`];
const fibo = new Map();
for (const q of parse(subsetPath)) {
  if (q.predicate.value === `${RDF}type` && TARGET_TYPES.includes(q.object.value)) fibo.set(q.subject.value, fibo.get(q.subject.value) || q.subject.value);
}
for (const q of parse(subsetPath)) if (q.predicate.value === `${RDFS}label` && fibo.has(q.subject.value)) fibo.set(q.subject.value, q.object.value);

// The policy's concepts: glossary concepts (types, values, measures) and ontology classes,
// individuals and properties, with labels.
const concepts = new Map();
const glossaryConcepts = new Set();
for (const file of ours) {
  for (const q of parse(file)) {
    const s = q.subject.value;
    // Only glossary terms can be aligned: each mapping becomes an edge between terms.
    if (q.predicate.value === `${RDF}type` && q.object.value === `${SKOS}Concept`) {
      if (!concepts.has(s)) concepts.set(s, s);
      glossaryConcepts.add(s);
    }
    if ((q.predicate.value === `${SKOS}prefLabel` || q.predicate.value === `${RDFS}label`) && q.subject.termType === "NamedNode") concepts.set(s, q.object.value);
  }
}
// A labelled ontology property that isn't a glossary term (a field of a core Morphir type) can't be aligned.
for (const s of [...concepts.keys()]) if (!glossaryConcepts.has(s)) concepts.delete(s);

let quads;
try {
  quads = parse(alignmentPath);
} catch (e) {
  fail(`The alignment is not valid Turtle: ${e.message}`);
}

const mappings = [];
const errors = [];
for (const q of quads) {
  const [s, p, o] = [q.subject.value, q.predicate.value, q.object.value];
  if (ANNOTATIONS.has(p)) continue;
  if (!MAPPINGS[p]) {
    errors.push({ problem: "relation not allowed", subject: s, relation: p, object: o, allowed: Object.keys(MAPPINGS) });
    continue;
  }
  if (fibo.has(s) && concepts.has(o)) {
    errors.push({ problem: `reversed: write <policy concept> relation <${NAME} resource>`, subject: s, relation: p, object: o });
    continue;
  }
  if (!concepts.has(s)) errors.push({ problem: "not one of the policy's concepts", subject: s });
  if (!fibo.has(o)) errors.push({ problem: `not in the ${NAME} subset`, object: o });
  if (concepts.has(s) && fibo.has(o)) mappings.push({ concept: concepts.get(s), relation: MAPPINGS[p], [standard]: fibo.get(o), conceptIri: s, targetIri: o, relationIri: p });
}

const mapped = new Set(mappings.map((m) => m.conceptIri));
const unmapped = [...glossaryConcepts].filter((c) => !mapped.has(c)).map((c) => ({ concept: concepts.get(c), iri: c }));
const report = {
  standard: NAME,
  status: errors.length ? "errors" : "ok",
  mappings: mappings.length,
  conceptsMapped: mapped.size,
  glossaryConcepts: glossaryConcepts.size,
  errors,
  unmapped,
  byRelation: Object.fromEntries(Object.values(MAPPINGS).map((r) => [r, mappings.filter((m) => m.relation === r).length]).filter(([, n]) => n)),
  details: mappings.map((m) => ({ concept: m.concept, relation: m.relation, [NAME]: m[standard] })),
};
console.log(JSON.stringify(report, null, 2));
process.exit(errors.length ? 2 : 0);
