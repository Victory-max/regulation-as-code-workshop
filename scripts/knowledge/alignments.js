// Reads the policy's alignments to industry standards (ontologies/<standard>-alignment.ttl,
// against ontologies/<standard>/<standard>-subset.ttl) into one structure the knowledge
// generators share: the glossary, the DataHub links and column properties, the column
// descriptions and the alignment document all show the same mappings.

const fs = require("fs");

const SKOS = "http://www.w3.org/2004/02/skos/core#";
const RELATIONS = {
  [`${SKOS}exactMatch`]: { label: "same as", isA: false },
  [`${SKOS}closeMatch`]: { label: "nearly the same as", isA: false },
  [`${SKOS}broadMatch`]: { label: "a kind of", isA: true },
  [`${SKOS}narrowMatch`]: { label: "broader than", isA: false },
  [`${SKOS}relatedMatch`]: { label: "related to", isA: false },
  "http://www.w3.org/2000/01/rdf-schema#subClassOf": { label: "a kind of", isA: true },
  "http://www.w3.org/2002/07/owl#equivalentClass": { label: "same as", isA: false },
};

// The `#` comment directly above each statement, keyed by the statement's subject IRI: the
// mapping's reason, as written in the alignment file.
function reasonsByLine(text, prefixes) {
  const reasons = new Map();
  let comment = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      comment = trimmed.replace(/^#\s*/, "");
      continue;
    }
    if (!trimmed || trimmed.startsWith("@")) {
      if (!trimmed) comment = null;
      continue;
    }
    const token = trimmed.split(/\s+/)[0];
    let iri = null;
    if (token.startsWith("<")) iri = token.slice(1, -1);
    else if (token.includes(":")) {
      const [prefix, local] = [token.slice(0, token.indexOf(":")), token.slice(token.indexOf(":") + 1)];
      if (prefixes[prefix]) iri = prefixes[prefix] + local.replace(/\\(.)/g, "$1");
    }
    if (iri && comment && !reasons.has(iri)) reasons.set(iri, comment);
    // A comment gives the reason for the statement directly below it only.
    if (!trimmed.endsWith(";") && !trimmed.endsWith(",")) comment = null;
  }
  return reasons;
}

function loadAlignments(standards) {
  const N3 = require("n3");
  const loaded = [];
  for (const std of standards.filter((x) => x.subsetFile && fs.existsSync(x.subsetFile))) {
    const labels = new Map();
    const notations = new Map();
    const terms = new Set();
    for (const q of new N3.Parser().parse(fs.readFileSync(std.subsetFile, "utf8"))) {
      if (q.predicate.value.endsWith("#type") && std.termTypes.includes(q.object.value)) terms.add(q.subject.value);
      if (q.predicate.value === `${SKOS}notation`) notations.set(q.subject.value, q.object.value);
      if (q.predicate.value.endsWith("#label") && !labels.has(q.subject.value)) labels.set(q.subject.value, q.object.value);
    }
    const mappings = [];
    if (std.alignmentFile && fs.existsSync(std.alignmentFile)) {
      const text = fs.readFileSync(std.alignmentFile, "utf8");
      let prefixes = {};
      const quads = new N3.Parser().parse(text, null, (prefix, iri) => (prefixes[prefix] = iri.value));
      const reasons = reasonsByLine(text, prefixes);
      for (const q of quads) {
        const relation = RELATIONS[q.predicate.value];
        if (!relation || !(labels.has(q.object.value) || notations.has(q.object.value))) continue;
        mappings.push({
          subject: q.subject.value,
          predicate: q.predicate.value,
          relation: relation.label,
          isA: relation.isA,
          target: q.object.value,
          targetLabel: labels.get(q.object.value) || notations.get(q.object.value),
          targetNotation: notations.get(q.object.value) || labels.get(q.object.value),
          isTerm: terms.has(q.object.value),
          reason: reasons.get(q.subject.value) || null,
        });
      }
    }
    loaded.push({ ...std, terms, labels, notations, mappings });
  }
  return loaded;
}

module.exports = { loadAlignments };
