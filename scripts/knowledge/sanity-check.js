#!/usr/bin/env node
// Checks that everything generated from the Morphir model hangs together, before loading DataHub:
//   structures   -> database tables, logical models (with Morphir types) linked to their physical
//                   DuckDB tables, views and columns
//   types        -> glossary terms, database column types, column assertions
//   functions    -> glossary terms and, for measures, metrics (calculatedBy, DerivedFrom)
//   alignments   -> edges by the standard SKOS / OWL predicate, no mapping properties
//   lineage      -> rule views from their table and the functions they call
//   columns      -> every column of every policy table and view carries its glossary terms
//   documents    -> each guide related to the logical and physical datasets it describes
//   domains      -> every policy asset in its domain; one data product per domain
//
//   node scripts/knowledge/sanity-check.js [--project .]
// Run after morphir-to-knowledge.js. Prints each check; exits 2 when any check fails.

const fs = require("fs");
const path = require("path");
const { loadModel } = require("./model");
const { conceptIris } = require("./iris");
const { deriveAssertions } = require("./assertions");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const projectDir = opt("--project", ".");
const outDir = path.join(projectDir, "out");
const knowledge = path.join(outDir, "knowledge");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(knowledge, rel), "utf8"));

const results = [];
const check = (area, name, problems, detail = "") => results.push({ area, name, ok: problems.length === 0, problems, detail });

(async () => {
  const model = loadModel({ irPath: path.join(projectDir, "morphir-ir.json"), projectDir });
  const iris = conceptIris(model);
  const pkg = model.packageName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const mcps = read("datahub/mcps.json");
  const relationshipMcps = read("datahub/relationship-mcps.json");
  const evalMcps = read("datahub/evals-mcps.json");
  const all = [...mcps, ...relationshipMcps, ...evalMcps];
  const aspect = (urn, name) => all.filter((m) => m.entityUrn === urn && m.aspectName === name).map((m) => m.aspect.json);
  const ds = (rel) => `urn:li:dataset:(urn:li:dataPlatform:duckdb,enterprise.main.${rel},DEV)`;
  const field = (rel, col) => `urn:li:schemaField:(${ds(rel)},${col})`;
  const camel = (words) => words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
  const typeOf = (t) => model.types.find((x) => JSON.stringify(x.fqn) === JSON.stringify(t.entityType[2]));
  const termOf = (iri) => iris.termUrn(iri);
  const logicalOf = new Map(mcps.filter((m) => m.aspectName === "subTypes" && m.aspect.json.typeNames.includes("Logical Model")).map((m) => [m.entityUrn, m]));
  const logicalFor = (t) => [...logicalOf.keys()].find((u) => aspect(u, "datasetProperties").some((p) => p.customProperties && p.customProperties.morphirType === t.source));
  const instancesOf = (t) => [t.name, `${t.name}_adjustments`, `${t.name}_current`, `${t.name}_history`, ...(t.feed ? [`${t.name}_feed`] : [])];

  // The database catalog.
  const { DuckDBInstance } = require("@duckdb/node-api");
  const conn = await (await DuckDBInstance.create(path.join(outDir, "enterprise.db"), { access_mode: "READ_ONLY" })).connect();
  const rows = async (sql) => (await conn.runAndReadAll(sql)).getRowObjectsJson();
  const relations = new Set((await rows("SELECT table_name AS n FROM duckdb_tables() WHERE schema_name = 'main' UNION ALL SELECT view_name FROM duckdb_views() WHERE schema_name = 'main' AND NOT internal")).map((r) => r.n));
  const columns = await rows("SELECT table_name AS t, column_name AS c, data_type AS type FROM duckdb_columns() WHERE schema_name = 'main' AND NOT internal");
  conn.closeSync();

  // Structures -> tables and logical models.
  check("Structures", "Every entity record has its table, adjustments, current and history (and feed) in DuckDB",
    model.tables.flatMap((t) => instancesOf(t).filter((rel) => !relations.has(rel)).map((rel) => `missing ${rel}`)), `${model.tables.length} entities`);
  check("Structures", "Every entity record is a logical model",
    model.tables.filter((t) => !logicalFor(t)).map((t) => `no logical model for ${t.source}`));
  const KIND_TYPE = { choice: "EnumType", decimal: "NumberType", integer: "NumberType", float: "NumberType", boolean: "BooleanType", date: "DateType", text: "StringType" };
  const typeProblems = [];
  let typedFields = 0;
  for (const t of model.tables) {
    const lurn = logicalFor(t);
    const schema = lurn && aspect(lurn, "schemaMetadata")[0];
    if (!schema) continue;
    if (!schema.platformSchema["com.linkedin.schema.OtherSchema"]) typeProblems.push(`${t.name}: platformSchema not in wire form`);
    for (const c of t.columns.filter((x) => !x.generated)) {
      const f = schema.fields.find((x) => x.fieldPath === c.path.map(camel).join("."));
      const want = `com.linkedin.schema.${KIND_TYPE[c.type.kind] || "StringType"}`;
      if (!f) typeProblems.push(`${t.name}.${c.name}: no logical field`);
      else if (!f.type.type[want]) typeProblems.push(`${t.name}.${c.name}: logical type ${Object.keys(f.type.type)[0]}, expected ${want}`);
      else typedFields++;
    }
  }
  check("Structures", "Logical model fields have the Morphir type (wire form)", typeProblems, `${typedFields} fields`);
  const parentProblems = [];
  for (const t of model.tables) {
    const lurn = logicalFor(t);
    for (const rel of instancesOf(t)) {
      if (!aspect(ds(rel), "logicalParent").some((p) => p.parent.destinationUrn === lurn)) parentProblems.push(`${rel} not linked to ${lurn}`);
    }
    const views = model.rules.filter((r) => r.table === t.name && !r.aggregate).map((r) => r.view);
    for (const rel of [...instancesOf(t), ...views]) {
      for (const c of t.columns.filter((x) => !x.generated)) {
        if (!aspect(field(rel, c.name), "logicalParent").length) parentProblems.push(`${rel}.${c.name} has no logical field`);
      }
    }
  }
  check("Structures", "Physical tables, views and columns are linked to their logical model and fields", parentProblems);

  // Types -> column types.
  const DUCK = { choice: /^ENUM/, decimal: /^DECIMAL/, integer: /INT/, float: /DOUBLE|FLOAT/, boolean: /^BOOLEAN/, date: /^DATE/, text: /^VARCHAR/ };
  const columnTypeProblems = [];
  for (const t of model.tables) {
    for (const c of t.columns) {
      const actual = columns.find((x) => x.t === t.name && x.c === c.name);
      const want = DUCK[c.generated ? "text" : c.type.kind];
      if (!actual) columnTypeProblems.push(`${t.name}.${c.name} missing`);
      else if (want && !want.test(actual.type)) columnTypeProblems.push(`${t.name}.${c.name}: ${actual.type}, expected ${want}`);
    }
  }
  check("Types", "DuckDB column types follow the Morphir types", columnTypeProblems);

  // Glossary.
  const ttl = fs.readFileSync(fs.readdirSync(path.join(knowledge, "glossary")).map((f) => path.join(knowledge, "glossary", f))[0], "utf8");
  const concepts = new Set([...ttl.matchAll(/^<([^>]+)> a skos:Concept/gm)].map((m) => m[1]));
  let uniqueOk = [];
  try {
    iris.checkUnique();
  } catch (e) {
    uniqueOk = [e.message];
  }
  check("Glossary", "One Morphir node, one IRI (no two nodes share a term)", uniqueOk);
  const missingConcepts = [];
  for (const t of model.types) {
    if (!concepts.has(iris.type(t))) missingConcepts.push(`type ${t.module}.${t.name}`);
    for (const v of t.valueInfo) if (!concepts.has(iris.value(t, v.name))) missingConcepts.push(`value ${t.name}.${v.name}`);
    for (const f of t.fields) {
      const own = iris.fieldProperty(t, f.name);
      if (iris.member(t, f.name) && !concepts.has(iris.member(t, f.name))) missingConcepts.push(`field ${t.name}.${f.name}: its type's or function's term is missing`);
      if (!iris.member(t, f.name) && concepts.has(own)) missingConcepts.push(`field ${t.name}.${f.name} has a core Morphir type but is a glossary term`);
    }
  }
  for (const r of model.rules) if (!concepts.has(iris.rule(r))) missingConcepts.push(`function ${r.rule}`);
  check("Glossary", "Every type (record, choice, alias), value and function is a glossary term; fields take their type's or function's term, and fields of core Morphir types have none", missingConcepts, `${concepts.size} terms`);
  const calcProblems = [];
  for (const t of model.tables.filter((x) => x.feed)) {
    for (const c of t.feed.calculated) {
      const column = t.columns.find((x) => x.name === c.column);
      const fn = model.rules.find((x) => x.rule === c.rule);
      if (iris.member(typeOf(t), camel(column.path[0])) !== iris.rule(fn)) calcProblems.push(`${t.name}.${c.column} is not the term of ${c.rule}`);
    }
  }
  check("Glossary", "A calculated field is its function's term (one term per FQN)", calcProblems);

  // Columns -> terms.
  const fieldInfos = new Map();
  for (const m of mcps.filter((x) => x.aspectName === "editableSchemaMetadata")) {
    for (const f of m.aspect.json.editableSchemaFieldInfo) fieldInfos.set(`${m.entityUrn}|${f.fieldPath}`, (f.glossaryTerms ? f.glossaryTerms.terms : []).map((x) => x.urn));
  }
  // The terms each column should carry: its field's type or function term (none for a field of a
  // core Morphir type), its choice type's term, Record ID for a generated key, the record-keeping
  // terms for the bitemporal and adjustment columns, and its function's term for a rule output.
  const { RECORD_KEEPING } = require("./iris");
  const recordKeepingTerm = new Map(RECORD_KEEPING.map(([column, name]) => [column, termOf(iris.recordKeeping(name))]));
  const expectedFor = new Map();
  const expect = (rel, col, term) => {
    const key = `${ds(rel)}|${col}`;
    if (!expectedFor.has(key)) expectedFor.set(key, new Set());
    if (term) expectedFor.get(key).add(term);
  };
  for (const t of model.tables) {
    const views = model.rules.filter((r) => r.table === t.name && !r.aggregate).map((r) => r.view);
    for (const rel of [...instancesOf(t), ...views]) {
      for (const c of t.columns) {
        expect(rel, c.name, null);
        if (c.generated) expect(rel, c.name, recordKeepingTerm.get("record_id"));
        else {
          const own = iris.member(typeOf(t), camel(c.path[0]));
          if (own) expect(rel, c.name, termOf(own));
          if (c.type.kind === "choice") {
            const choice = model.types.find((x) => JSON.stringify(x.fqn) === JSON.stringify(c.type.fqn));
            if (choice) expect(rel, c.name, termOf(iris.type(choice)));
          }
          // A (nested) field declared with a policy type, such as an alias, carries that type's term.
          const named = c.tpe && c.tpe[0] === "Reference" && model.types.find((x) => JSON.stringify(x.fqn) === JSON.stringify(c.tpe[2]));
          if (named) expect(rel, c.name, termOf(iris.type(named)));
        }
      }
    }
  }
  // Bitemporal and adjustment columns of the policy relations carry their record-keeping terms.
  for (const x of columns) {
    if (x.c !== "record_id" && recordKeepingTerm.has(x.c) && expectedFor.has(`${ds(x.t)}|${x.c}`) === false &&
        [...model.tables.flatMap(instancesOf), ...model.rules.filter((r) => !r.aggregate).map((r) => r.view)].includes(x.t)) {
      expect(x.t, x.c, recordKeepingTerm.get(x.c));
    }
  }
  for (const r of model.rules) for (const o of r.outputs) {
    expect(r.view, o.column, termOf(iris.rule(r)));
    const choice = o.type.kind === "choice" && model.types.find((x) => JSON.stringify(x.fqn) === JSON.stringify(o.type.fqn));
    if (choice) expect(r.view, o.column, termOf(iris.type(choice)));
  }
  const termProblems = [];
  let termed = 0;
  let core = 0;
  for (const [key, want] of expectedFor) {
    const got = fieldInfos.get(key) || [];
    const [urn, col] = key.split("|");
    const label = `${urn.split(",")[1].replace("enterprise.main.", "")}.${col}`;
    for (const w of want) if (!got.includes(w)) termProblems.push(`${label}: missing ${w.split(".").pop()}`);
    for (const g of got) if (!want.has(g)) termProblems.push(`${label}: unexpected ${g.split(".").pop()}`);
    if (want.size) termed++;
    else core++;
  }
  check("Columns", "Every column carries exactly the terms the model gives it (none for fields of core Morphir types)", termProblems, `${termed} columns with terms, ${core} core-typed without`);

  // Functions -> metrics.
  const metricOf = new Map(mcps.filter((m) => m.aspectName === "metricInfo").map((m) => [m.aspect.json.name, m.entityUrn]));
  const calcTables = new Set(model.tables.filter((t) => t.feed).map((t) => t.name));
  const measures = model.rules.filter((r) => r.aggregate || calcTables.has(r.table));
  const metricProblems = [];
  const calculatedBy = `urn:li:structuredProperty:${pkg}.calculatedBy`;
  for (const r of measures) {
    const urn = metricOf.get(r.title);
    if (!urn) {
      metricProblems.push(`no metric for ${r.rule}`);
      continue;
    }
    if (!aspect(urn, "glossaryTerms").some((g) => g.terms.some((x) => x.urn === termOf(iris.rule(r))))) metricProblems.push(`${r.rule}: metric not tagged with its term`);
    const assigned = aspect(termOf(iris.rule(r)), "structuredProperties").flatMap((p) => p.properties).filter((p) => p.propertyUrn === calculatedBy).flatMap((p) => p.values.map((v) => v.string));
    if (!assigned.includes(urn)) metricProblems.push(`${r.rule}: term not calculatedBy its metric`);
    const derived = aspect(urn, "metricRelationships").flatMap((x) => x.derivedFrom.map((d) => d.destinationUrn));
    for (const callee of r.calls.filter((x) => measures.includes(x))) if (!derived.includes(metricOf.get(callee.title))) metricProblems.push(`${r.rule}: not derived from ${callee.rule}`);
  }
  check("Functions", "Every measure is a metric, tagged with and calculatedBy its term, derived from the measures it calls", metricProblems, `${measures.length} metrics`);

  // Assertions.
  const expected = deriveAssertions(model);
  const assertionUrns = new Set(mcps.filter((m) => m.aspectName === "assertionInfo").map((m) => m.entityUrn));
  const runs = new Set(mcps.filter((m) => m.aspectName === "assertionRunEvent").map((m) => m.entityUrn));
  const assertionProblems = [];
  for (const a of expected) {
    const urn = `urn:li:assertion:${pkg}-${a.id}`;
    if (!assertionUrns.has(urn)) assertionProblems.push(`missing ${a.id}`);
    else if (!runs.has(urn)) assertionProblems.push(`no result for ${a.id}`);
  }
  for (const t of model.tables) {
    for (const c of t.columns.filter((x) => !x.generated && x.type.kind === "choice")) if (!expected.some((a) => a.relation === t.name && a.field === c.name && a.operator === "IN")) assertionProblems.push(`${t.name}.${c.name}: no allowed-values assertion`);
  }
  // Every choice field of every logical model: its lower-cased value is one of the cases.
  const assertionInfo = new Map(mcps.filter((m) => m.aspectName === "assertionInfo").map((m) => [m.entityUrn, m.aspect.json]));
  for (const t of model.tables) {
    const lurn = logicalFor(t);
    for (const c of t.columns.filter((x) => !x.generated && x.type.kind === "choice")) {
      const path = c.path.map(camel).join(".");
      const a = [...assertionInfo.values()].find((x) => x.entityUrn === lurn && x.fieldAssertion && x.fieldAssertion.fieldValuesAssertion.field.path === path);
      const want = [...new Set(c.type.values.map((v) => String(v).toLowerCase()))];
      if (!a) assertionProblems.push(`logical ${t.source}.${path}: no lower-case allowed-values assertion`);
      else if (a.fieldAssertion.fieldValuesAssertion.operator !== "REGEX_MATCH" || (a.customProperties.allowedValues || "") !== want.join(", ")) assertionProblems.push(`logical ${t.source}.${path}: assertion doesn't match the model's cases`);
    }
  }
  check("Types", "Column assertions from the model (allowed values, required, unique, divisors, up to date; lower-case allowed values on every logical choice field) with results", assertionProblems, `${expected.length} assertions`);

  // Alignments.
  const relTypes = mcps.filter((m) => m.aspectName === "relationshipTypeInfo").map((m) => m.entityUrn.replace("urn:li:relationshipType:", ""));
  const allowedTypes = /^(skos_(exact|close|broad|narrow|related)Match|rdfs_subClassOf|owl_equivalentClass)$/;
  const alignmentProblems = [
    ...relTypes.filter((id) => !allowedTypes.test(id) && id !== `${pkg}.calculatedBy`).map((id) => `non-standard relationship type ${id}`),
    ...mcps.filter((m) => m.entityType === "structuredProperty" && /_mapping$/.test(m.entityUrn)).map((m) => `mapping property ${m.entityUrn}`),
    ...mcps.filter((m) => m.entityType === "schemaField" && m.aspectName === "structuredProperties").map((m) => `column property on ${m.entityUrn}`),
  ];
  const { loadAlignments } = require("./alignments");
  const standards = ["fibo", "cdm"].map((name) => ({
    name,
    subsetFile: path.join(projectDir, "ontologies", name, `${name}-subset.ttl`),
    alignmentFile: path.join(projectDir, "ontologies", `${name}-alignment.ttl`),
    termTypes: name === "fibo" ? ["http://www.w3.org/2002/07/owl#Class"] : ["http://www.w3.org/2002/07/owl#Class", "http://www.w3.org/2004/02/skos/core#Concept"],
  }));
  let mappingCount = 0;
  for (const std of loadAlignments(standards)) {
    for (const m of std.mappings) {
      mappingCount++;
      if (!m.isTerm) {
        alignmentProblems.push(`${std.name}: ${m.target} is not a term in DataHub, so ${m.subject} can't link to it`);
        continue;
      }
      const assigned = aspect(termOf(m.subject), "structuredProperties").flatMap((p) => p.properties).flatMap((p) => p.values.map((v) => v.string));
      if (!assigned.includes(termOf(m.target))) alignmentProblems.push(`${std.name}: ${m.subject} -> ${m.target} not an edge`);
    }
  }
  check("Alignments", "FIBO and CDM mappings are edges by the standard SKOS / OWL predicate; no mapping properties", alignmentProblems, `${mappingCount} mappings`);

  // Lineage.
  const lineageProblems = [];
  for (const r of model.rules) {
    const up = aspect(ds(r.view), "upstreamLineage")[0];
    if (!up) {
      lineageProblems.push(`${r.view}: no lineage`);
      continue;
    }
    const sources = up.upstreams.map((u) => u.dataset);
    if (!sources.includes(ds(r.table))) lineageProblems.push(`${r.view}: not downstream of ${r.table}`);
    for (const callee of r.calls.filter((x) => x.view)) if (!sources.includes(ds(callee.view))) lineageProblems.push(`${r.view}: not downstream of ${callee.view} (function dependency)`);
    if (up.fineGrainedLineages.length !== r.outputs.length) lineageProblems.push(`${r.view}: column lineage for ${up.fineGrainedLineages.length} of ${r.outputs.length} outputs`);
  }
  for (const t of model.tables.filter((x) => x.feed)) {
    const up = aspect(ds(t.name), "upstreamLineage")[0];
    for (const c of t.feed.calculated) if (!up || !up.upstreams.some((u) => u.dataset === ds(c.view))) lineageProblems.push(`${t.name}.${c.column}: not downstream of ${c.view}`);
  }
  check("Lineage", "Rule views come from their table and the functions they call; calculated columns from their rules", lineageProblems);

  // Documents.
  const docs = mcps.filter((m) => m.aspectName === "documentInfo");
  const related = (id) => ((docs.find((d) => d.entityUrn.endsWith(id)) || { aspect: { json: {} } }).aspect.json.relatedAssets || []).map((x) => x.asset);
  const docProblems = [];
  for (const t of model.tables) {
    const want = [logicalFor(t), ...instancesOf(t).map(ds), ...model.rules.filter((r) => r.table === t.name).map((r) => ds(r.view))];
    for (const kind of ["guide", "questions"]) {
      const got = related(`-${t.name}-${kind}`);
      if (!got.length) docProblems.push(`no ${kind} document for ${t.name}`);
      for (const w of want) if (got.length && !got.includes(w)) docProblems.push(`${t.name} ${kind}: not related to ${w.split(",")[1]}`);
    }
    const design = related("-table-design");
    for (const w of [logicalFor(t), ...instancesOf(t).map(ds)]) if (!design.includes(w)) docProblems.push(`table design: not related to ${w.split(",")[1]}`);
  }
  check("Documents", "Each guide is related to the logical and physical datasets it describes", docProblems, `${docs.length} documents`);

  // Domains and products.
  const domainProblems = [];
  for (const t of model.tables) {
    const assets = [logicalFor(t), ...instancesOf(t).map(ds), ...model.rules.filter((r) => r.table === t.name).map((r) => ds(r.view))];
    for (const a of assets) if (!aspect(a, "domains").length) domainProblems.push(`${a.split(",")[1] || a} has no domain`);
  }
  for (const r of measures) if (metricOf.get(r.title) && !aspect(metricOf.get(r.title), "domains").length) domainProblems.push(`metric ${r.title} has no domain`);
  const products = mcps.filter((m) => m.aspectName === "dataProductProperties");
  if (!products.length) domainProblems.push("no data product");
  check("Domains", "Every policy asset is in its domain; each domain has a data product", domainProblems, `${products.length} data product(s)`);

  // Report.
  let area = "";
  for (const r of results) {
    if (r.area !== area) console.log(`\n${(area = r.area)}`);
    console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
    for (const p of r.problems.slice(0, 8)) console.log(`         - ${p}`);
    if (r.problems.length > 8) console.log(`         … and ${r.problems.length - 8} more`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks pass.`);
  process.exit(failed ? 2 : 0);
})().catch((e) => {
  console.error(`sanity-check: ${e.stack || e.message}`);
  process.exit(1);
});
