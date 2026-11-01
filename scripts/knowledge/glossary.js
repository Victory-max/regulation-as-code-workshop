// Business glossary as SKOS in Turtle, for DataHub's RDF ingestion source (glossary-recipe.yml).
// Every business type is a skos:Concept and each value of a choice is a narrower concept;
// every aggregate rule (a measure such as total outflow amount) is a concept too, which the
// DataHub metric of the same name is tagged with. Concepts sit at
// the same IRIs as the ontology's classes and individuals, so DataHub keeps the IRI on each
// term and an ontology alignment made elsewhere refers to the same terms.

const fs = require("fs");
const path = require("path");
const { conceptIris } = require("./iris");

const lit = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"@en`;

function writeGlossary(model, outDir, { baseIri } = {}) {
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
  for (const r of model.rules.filter((x) => x.aggregate)) {
    concept(iris.rule(r), r.title, r.doc, r.rule, r.specLinks);
    terms++;
  }
  const pkg = model.packageName.toLowerCase().replace(/\W+/g, "-");
  const file = path.join(dir, `${pkg}-glossary.ttl`);
  fs.writeFileSync(file, out.join("\n"));
  return { file, terms };
}

module.exports = { writeGlossary };
