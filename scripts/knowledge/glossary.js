// Business glossary as SKOS in Turtle, for DataHub's RDF ingestion source (glossary-recipe.yml).
// Every business type is a skos:Concept and each value of a choice is a narrower concept;
// every measure (an aggregate rule such as total outflow amount, or a rule over a calculation
// table such as the LRR) is a concept too, which the
// DataHub metric of the same name is tagged with. Concepts sit at
// the same IRIs as the ontology's classes and individuals, so DataHub keeps the IRI on each
// term and an ontology alignment made elsewhere refers to the same terms.

const fs = require("fs");
const path = require("path");
const { conceptIris, RECORD_KEEPING } = require("./iris");
const { loadAlignments } = require("./alignments");

const lit = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"@en`;

function writeGlossary(model, outDir, { baseIri, standards = [] } = {}) {
  const dir = path.join(outDir, "glossary");
  fs.mkdirSync(dir, { recursive: true });
  const iris = conceptIris(model, baseIri);
  const scheme = `<${iris.base}glossary>`;
  const refs = (links) => links.filter((r) => /^https?:/.test(r.permalink)).map((r) => `    rdfs:seeAlso <${r.permalink}> ;`);
  const out = [
    "@prefix skos: <http://www.w3.org/2004/02/skos/core#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "",
    `${scheme} a skos:ConceptScheme ;`,
    `    skos:prefLabel ${lit(`${model.packageName} policy glossary`)} ;`,
    `    skos:definition ${lit(`Business terms of the verified ${model.packageName} policy model.`)} .`,
    "",
  ];
  const concept = (iri, label, definition, notation, links, broader) => {
    out.push(`<${iri}> a skos:Concept ;`, `    skos:prefLabel ${lit(label)} ;`);
    if (definition) out.push(`    skos:definition ${lit(definition)} ;`);
    out.push(`    skos:notation ${lit(notation)} ;`, ...refs(links));
    if (broader) out.push(`    skos:broader <${broader}> ;`);
    out.push(`    skos:inScheme ${scheme} .`, "");
  };
  let terms = 0;
  for (const t of model.types) {
    concept(iris.type(t), t.name, t.doc, `${t.module}.${t.name}`, t.specLinks);
    terms++;
    for (const v of t.valueInfo) {
      concept(iris.value(t, v.name), v.name, v.description, `${t.module}.${t.name}.${v.name}`, v.specLinks, iris.type(t));
      terms++;
    }
  }
  // Every record field is a term (the business attribute a column holds), narrower than its
  // record type; every rule is a term too (the value it decides or calculates). A field or rule
  // that is its type's concept (iris.js) is already there.
  const done = new Set(out.filter((l) => l.startsWith("<") && l.includes(" a skos:Concept")).map((l) => l.slice(1, l.indexOf(">"))));
  const label = (description, fallback) => (description && /^[^:]{2,60}:/.test(description) ? description.slice(0, description.indexOf(":")) : fallback);
  for (const t of model.types) {
    for (const f of t.fields) {
      const iri = iris.member(t, f.name);
      if (!iri || done.has(iri)) continue;
      done.add(iri);
      concept(iri, label(f.description, model.humanize(f.name)), f.description, `${t.module}.${t.name}.${f.name}`, f.specLinks, iris.type(t));
      terms++;
    }
  }
  for (const r of model.rules) {
    const iri = iris.rule(r);
    if (done.has(iri)) continue;
    done.add(iri);
    concept(iri, r.title, r.doc, r.rule, r.specLinks);
    terms++;
  }
  // Record keeping: the bitemporal and adjustment columns every policy table carries.
  for (const [, name, label, definition] of RECORD_KEEPING) {
    concept(iris.recordKeeping(name), label, definition, `RecordKeeping.${name}`, []);
    terms++;
  }
  // Mappings to industry standards (FIBO, CDM) ride on each mapped concept, so the IRI links
  // travel with the glossary (DataHub's RDF source keeps every statement on a term).
  const concepts = new Set(out.filter((l) => l.startsWith("<") && l.includes(" a skos:Concept")).map((l) => l.slice(1, l.indexOf(">"))));
  const mappings = loadAlignments(standards).flatMap((std) => std.mappings.filter((m) => concepts.has(m.subject)));
  if (mappings.length) {
    out.push("# Alignments to industry standards", "");
    for (const m of mappings) out.push(`<${m.subject}> <${m.predicate}> <${m.target}> .`);
    out.push("");
  }
  const pkg = model.packageName.toLowerCase().replace(/\W+/g, "-");
  const file = path.join(dir, `${pkg}-glossary.ttl`);
  fs.writeFileSync(file, out.join("\n"));
  return { file, terms };
}

module.exports = { writeGlossary };
