// Lower (domain) ontology in Turtle, generated from the verified model:
//   record types      -> owl:Class, their fields -> datatype / object properties
//   choice types      -> owl:Class enumerated by owl:oneOf its values (owl:NamedIndividual)
//   policy rules      -> derived properties of the entity class they are computed for
// Docs become rdfs:comment; spec links become rdfs:seeAlso (or dct:source when local).
// Alignment to an upper ontology such as FIBO is left to an ontology tool: add
// rdfs:subClassOf / skos:closeMatch statements there, against these IRIs.

const fs = require("fs");
const path = require("path");
const { conceptIris } = require("./iris");

const XSD = { decimal: "xsd:decimal", integer: "xsd:integer", float: "xsd:double", boolean: "xsd:boolean", text: "xsd:string", date: "xsd:date" };
const lit = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"@en`;

function writeOntology(model, outDir, { baseIri } = {}) {
  const dir = path.join(outDir, "ontology");
  fs.mkdirSync(dir, { recursive: true });
  const pkg = model.packageName.toLowerCase().replace(/\W+/g, "-");
  const iris = conceptIris(model, baseIri);
  const cls = (t) => `<${iris.type(t)}>`;
  const typeByFqn = new Map(model.types.map((t) => [JSON.stringify(t.fqn), t]));
  const out = [];
  const refs = (links) =>
    links.map((r) => (/^https?:/.test(r.permalink) ? `    rdfs:seeAlso <${r.permalink}> ;` : `    dct:source ${lit(`${r.section} (${r.url})`)} ;`));

  out.push(
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
    "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
    "@prefix dct: <http://purl.org/dc/terms/> .",
    "",
    `<${iris.ontology}> a owl:Ontology ;`,
    `    rdfs:label ${lit(`${model.packageName} policy ontology`)} ;`,
    `    rdfs:comment ${lit(`Domain ontology generated from the SME-verified ${model.packageName} Morphir model. Align to an upper ontology (e.g. FIBO) with rdfs:subClassOf or skos:closeMatch.`)} .`,
    ""
  );

  // Range of a field or rule output: a class for records and choices, else an XSD datatype.
  const range = (tpe) => {
    const resolved = model.ir.resolveType(model.index, tpe);
    const fqn = tpe[0] === "Reference" ? JSON.stringify(tpe[2]) : null;
    const named = fqn && typeByFqn.get(fqn);
    if (named) return { object: true, iri: cls(named) };
    const d = model.describeType(model.index, resolved);
    return { object: false, iri: XSD[d.kind] || "xsd:string" };
  };

  for (const t of model.types) {
    out.push(`${cls(t)} a owl:Class ;`, `    rdfs:label ${lit(t.name)} ;`);
    if (t.doc) out.push(`    rdfs:comment ${lit(t.doc)} ;`);
    out.push(...refs(t.specLinks));
    if (t.kind === "choice") out.push(`    owl:equivalentClass [ a owl:Class ; owl:oneOf ( ${t.values.map((v) => `<${iris.value(t, v)}>`).join(" ")} ) ] ;`);
    out[out.length - 1] = out[out.length - 1].replace(/ ;$/, " .");
    out.push("");
    for (const v of t.valueInfo) {
      out.push(`<${iris.value(t, v.name)}> a owl:NamedIndividual , ${cls(t)} ;`, `    rdfs:label ${lit(v.name)} ;`);
      if (v.description) out.push(`    rdfs:comment ${lit(v.description)} ;`);
      out.push(...refs(v.specLinks));
      out[out.length - 1] = out[out.length - 1].replace(/ ;$/, " .");
    }
    if (t.values.length) out.push("");
    for (const f of t.fields) {
      const r = range(f.tpe);
      out.push(
        `<${iris.member(t, f.name)}> a ${r.object ? "owl:ObjectProperty" : "owl:DatatypeProperty"} ;`,
        `    rdfs:label ${lit(f.name)} ;`,
        ...(f.description ? [`    rdfs:comment ${lit(f.description)} ;`] : []),
        ...refs(f.specLinks),
        `    rdfs:domain ${cls(t)} ;`,
        `    rdfs:range ${r.iri} .`,
        ""
      );
    }
  }

  // Policy rules as derived properties of the entity they are computed for.
  for (const rule of model.rules.filter((x) => !x.aggregate)) {
    const entity = model.tables.find((x) => x.name === rule.table);
    const domain = typeByFqn.get(JSON.stringify(entity.entityType[2]));
    for (const o of rule.outputs) {
      const fields = model.ir.recordFieldsOf(model.index, rule.def.outputType);
      const tpe = fields ? fields.find((f) => model.ir.toSnake(f.name) === o.column.replace(/_result$/, "")).tpe : rule.def.outputType;
      const r = range(tpe);
      const name = fields ? `${rule.name}.${o.morphirField}` : rule.name;
      out.push(`<${iris.member(domain, name)}> a ${r.object ? "owl:ObjectProperty" : "owl:DatatypeProperty"} ;`, `    rdfs:label ${lit(o.title)} ;`);
      out.push(`    rdfs:comment ${lit(`Derived by policy rule ${rule.rule}.${rule.doc ? ` ${rule.doc}` : ""}`)} ;`);
      out.push(...refs(rule.specLinks));
      out.push(`    rdfs:domain ${cls(domain)} ;`, `    rdfs:range ${r.iri} .`, "");
    }
  }

  const file = path.join(dir, `${pkg}-policy.ttl`);
  fs.writeFileSync(file, out.join("\n"));
  return { file, classes: model.types.length };
}

module.exports = { writeOntology };
