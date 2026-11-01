// DataHub metadata: a logical model per policy entity (platform `logical`), with each DuckDB
// table and column linked to it as a physical instance; context documents and evals; and, for
// every table and rule view, descriptions, glossary terms and column-level lineage. Written as
// MetadataChangeProposals for the `file` source. The glossary itself is the SKOS file loaded
// by the `rdf` source, so terms keep their IRIs. Recipes, in load order: glossary-recipe.yml,
// duckdb-recipe.yml, recipe.yml (mcps.json), evals-recipe.yml (evals-mcps.json).

const fs = require("fs");
const path = require("path");
const { conceptIris, businessPath } = require("./iris");

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Logical-model field types, by the business type a field has in the model.
const FIELD_TYPES = { choice: "EnumType", decimal: "NumberType", integer: "NumberType", float: "NumberType", boolean: "BooleanType", date: "DateType", text: "StringType" };

// database and env name the physical tables the metadata attaches to: they must match the
// duckdb-recipe ingestion (file name and env) or the real tables' location in the catalog.
function writeDataHub(model, outDir, { platform = "duckdb", database = "enterprise", env = "DEV", dbPath = null, baseIri = null, glossaryFile = null } = {}) {
  const dir = path.join(outDir, "datahub");
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const audit = { time: now, actor: "urn:li:corpuser:datahub" };
  const mcps = [];
  const put = (entityType, entityUrn, aspectName, json) => mcps.push({ entityType, entityUrn, changeType: "UPSERT", aspectName, aspect: { json } });

  const datasetUrn = (table) => `urn:li:dataset:(urn:li:dataPlatform:${platform},${database}.main.${table},${env})`;
  const fieldUrn = (table, column) => `urn:li:schemaField:(${datasetUrn(table)},${column})`;
  // Logical models describe the policy entity itself, independent of where it is stored.
  const logicalUrn = (t) => {
    const parts = t.source.split(".");
    const name = parts[parts.length - 1];
    return `urn:li:dataset:(urn:li:dataPlatform:logical,${[model.packageName, ...businessPath(parts.slice(0, -1), name[0].toUpperCase() + name.slice(1))].join(".")},PROD)`;
  };
  const logicalFieldPath = (c) => c.path.map((n) => n.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("")).join(".");
  const pkg = slug(model.packageName);
  const iris = conceptIris(model, baseIri);
  const memory = (refs) => ({ elements: refs.map((r) => ({ url: r.permalink, description: `Specification: ${r.section}`, createStamp: audit })) });
  const linkable = (refs) => refs.filter((r) => /^https?:/.test(r.permalink));
  const specProps = (refs) => (refs.length ? { specification: refs.map((r) => `${r.section} <${r.permalink}>`).join("; ") } : {});

  // Glossary terms come from the SKOS glossary through the RDF source (glossary-recipe.yml),
  // keyed by IRI; here they are only referenced, plus a clickable link to each term's source.
  const termFor = new Map();
  for (const t of model.types) {
    termFor.set(JSON.stringify(t.fqn), iris.termUrn(iris.type(t)));
    if (linkable(t.specLinks).length) put("glossaryTerm", iris.termUrn(iris.type(t)), "institutionalMemory", memory(linkable(t.specLinks)));
    for (const v of t.valueInfo) {
      if (linkable(v.specLinks).length) put("glossaryTerm", iris.termUrn(iris.value(t, v.name)), "institutionalMemory", memory(linkable(v.specLinks)));
    }
  }
  const terms = (urns) => ({ terms: urns.map((urn) => ({ urn })), auditStamp: audit });

  // Logical models: one per policy entity, with the entity's fields in business terms.
  for (const t of model.tables) {
    const lurn = logicalUrn(t);
    const fields = t.columns.filter((c) => !c.generated);
    put("dataset", lurn, "datasetProperties", {
      name: t.title,
      description: t.doc,
      customProperties: { morphirType: t.source, ...specProps(t.specLinks) },
    });
    put("dataset", lurn, "subTypes", { typeNames: ["Logical Model"] });
    put("dataset", lurn, "schemaMetadata", {
      schemaName: t.title,
      platform: "urn:li:dataPlatform:logical",
      version: 0,
      hash: "",
      platformSchema: { "com.linkedin.pegasus2avro.schema.OtherSchema": { rawSchema: "" } },
      fields: fields.map((c) => ({
        fieldPath: logicalFieldPath(c),
        nullable: !!c.optional,
        type: { type: { [`com.linkedin.pegasus2avro.schema.${FIELD_TYPES[c.type.kind] || "StringType"}`]: {} } },
        nativeDataType: c.type.kind === "choice" ? c.type.typeName : c.type.kind,
        description: model.annotationText({ description: c.description, specLinks: c.specLinks, values: c.values }) || c.title,
        ...(c.type.kind === "choice" && termFor.get(JSON.stringify(c.type.fqn)) ? { glossaryTerms: terms([termFor.get(JSON.stringify(c.type.fqn))]) } : {}),
      })),
    });
    if (linkable(t.specLinks).length) put("dataset", lurn, "institutionalMemory", memory(linkable(t.specLinks)));
    const entityTerm = termFor.get(JSON.stringify(t.entityType[2]));
    if (entityTerm) put("dataset", lurn, "glossaryTerms", terms([entityTerm]));
    // The table, its adjustments and its current-version view are physical instances of the
    // model; each business column is an instance of its logical field.
    for (const table of [t.name, `${t.name}_adjustments`, `${t.name}_current`]) {
      put("dataset", datasetUrn(table), "logicalParent", { parent: { destinationUrn: lurn } });
      for (const c of fields) put("schemaField", fieldUrn(table, c.name), "logicalParent", { parent: { destinationUrn: `urn:li:schemaField:(${lurn},${logicalFieldPath(c)})` } });
    }
  }

  // Entity tables: description, entity term, and a term on each business-category column.
  for (const t of model.tables) {
    const urn = datasetUrn(t.name);
    put("dataset", urn, "datasetProperties", {
      name: t.name,
      description: `${t.doc}\n\nBitemporal and append-only: valid_from/valid_to (business time), recorded_at (system time). Manual adjustments in ${t.name}_adjustments; current versions in ${t.name}_current.`,
      customProperties: { morphirType: t.source, businessKey: t.key, ...specProps(t.specLinks) },
    });
    if (linkable(t.specLinks).length) put("dataset", urn, "institutionalMemory", memory(linkable(t.specLinks)));
    const entityTerm = termFor.get(JSON.stringify(t.entityType[2]));
    if (entityTerm) put("dataset", urn, "glossaryTerms", terms([entityTerm]));
    put("dataset", urn, "editableSchemaMetadata", {
      editableSchemaFieldInfo: t.columns.map((c) => ({
        fieldPath: c.name,
        description:
          model.annotationText({ description: c.description, specLinks: c.specLinks, values: c.values }) ||
          (c.type.kind === "choice" ? `${c.title}: one of ${c.type.values.join(", ")}` : c.title),
        ...(c.type.kind === "choice" && termFor.get(JSON.stringify(c.type.fqn)) ? { glossaryTerms: terms([termFor.get(JSON.stringify(c.type.fqn))]) } : {}),
      })),
    });
  }

  // Rule views: what the rule decides, where it comes from, and which columns feed each output.
  for (const r of model.rules) {
    const urn = datasetUrn(r.view);
    put("dataset", urn, "datasetProperties", {
      name: r.view,
      description: r.doc || r.title,
      customProperties: { morphirRule: r.rule, verifiedAgainstMorphir: "true", ...specProps(r.specLinks) },
    });
    if (linkable(r.specLinks).length) put("dataset", urn, "institutionalMemory", memory(linkable(r.specLinks)));
    put("dataset", urn, "editableSchemaMetadata", {
      editableSchemaFieldInfo: r.outputs.map((o) => ({
        fieldPath: o.column,
        description: model.annotationText({ description: o.description || `${o.title}, decided by policy rule ${r.rule}.`, specLinks: o.specLinks }),
      })),
    });
    put("dataset", urn, "upstreamLineage", {
      upstreams: [r.table, `${r.table}_adjustments`].map((table) => ({ dataset: datasetUrn(table), type: "VIEW", auditStamp: audit })),
      fineGrainedLineages: r.outputs.map((o) => ({
        upstreamType: "FIELD_SET",
        upstreams: o.inputs.map((c) => fieldUrn(r.table, c)),
        downstreamType: "FIELD",
        downstreams: [fieldUrn(r.view, o.column)],
        transformOperation: `Morphir rule ${r.rule}`,
        confidenceScore: 1.0,
      })),
    });
    const outputTerms = r.outputs.filter((o) => o.type.kind === "choice").map((o) => termFor.get(JSON.stringify(o.type.fqn))).filter(Boolean);
    if (outputTerms.length) put("dataset", urn, "glossaryTerms", terms([...new Set(outputTerms)]));
  }

  // Metrics: each aggregate rule is a metric of the policy's semantic model, with its compiled
  // SQL, the rule view it reads, the aggregates it is built from (the rules it calls), and the
  // glossary term of the same name.
  const aggregates = model.rules.filter((r) => r.aggregate);
  if (aggregates.length) {
    const morphir = "urn:li:dataPlatform:morphir";
    const semanticModel = `urn:li:semanticModel:(${morphir},${model.packageName},policy)`;
    const metricUrn = (r) => {
      const parts = r.rule.split(".");
      const path = businessPath(parts.slice(0, -1), parts[parts.length - 1]);
      return `urn:li:metric:(${morphir},${[model.packageName, ...path.slice(0, -1)].join(".")},${path[path.length - 1]})`;
    };
    put("dataPlatform", morphir, "dataPlatformInfo", { name: "morphir", displayName: "Morphir", type: "OTHERS", datasetNameDelimiter: "." });
    put("semanticModel", semanticModel, "dataPlatformInstance", { platform: morphir });
    put("semanticModel", semanticModel, "semanticModelInfo", {
      name: `${model.packageName} policy`,
      description: `Measures defined by the verified ${model.packageName} policy model.`,
      datasets: [],
    });
    // The other aggregates a rule's definition calls.
    const byKey = new Map(aggregates.map((r) => [model.ir.fqnKey(r.fqn), r]));
    const calls = (node, found = new Set()) => {
      if (!Array.isArray(node)) return found;
      if (node[0] === "Reference" && Array.isArray(node[2]) && node[2].length === 3 && byKey.has(model.ir.fqnKey(node[2]))) found.add(byKey.get(model.ir.fqnKey(node[2])));
      node.forEach((child) => calls(child, found));
      return found;
    };
    for (const r of aggregates) {
      const urn = metricUrn(r);
      const derivedFrom = [...calls(r.def.body)].filter((x) => x !== r);
      put("metric", urn, "dataPlatformInstance", { platform: morphir });
      put("metric", urn, "metricInfo", {
        name: r.title,
        description: r.doc || r.title,
        semanticModel,
        expression: { dialects: r.outputs.map((o) => ({ dialect: "ANSI_SQL", expression: `SELECT ${o.sql} AS ${o.column} FROM ${r.source} t` })) },
      });
      put("metric", urn, "metricUpstreams", { datasetUpstreams: [{ destinationUrn: datasetUrn(r.view) }, { destinationUrn: datasetUrn(r.table) }] });
      if (derivedFrom.length) put("metric", urn, "metricRelationships", { derivedFrom: derivedFrom.map((x) => ({ destinationUrn: metricUrn(x) })), relatedMetrics: [] });
      put("metric", urn, "glossaryTerms", terms([iris.termUrn(iris.rule(r))]));
      if (linkable(r.specLinks).length) put("metric", urn, "institutionalMemory", memory(linkable(r.specLinks)));
    }
  }

  // Context documents: the table guide and the question guide for each entity, under one
  // policy document, each related to the entity's logical model and its physical tables.
  const docUrn = (id) => `urn:li:document:${pkg}-${id}`;
  const readKnowledge = (rel) => (fs.existsSync(path.join(outDir, rel)) ? fs.readFileSync(path.join(outDir, rel), "utf8") : null);
  const docFor = new Map();
  const rootDoc = docUrn("policy");
  const document = (urn, title, text, related, parent) =>
    put("document", urn, "documentInfo", {
      title,
      source: { sourceType: "NATIVE" },
      status: { state: "PUBLISHED" },
      contents: { text },
      created: audit,
      lastModified: audit,
      customProperties: { generatedFrom: `Morphir model ${model.packageName}` },
      ...(related.length ? { relatedAssets: related.map((asset) => ({ asset })) } : {}),
      ...(parent ? { parentDocument: { document: parent } } : {}),
    });
  document(
    rootDoc,
    `${model.packageName} policy`,
    [`# ${model.packageName} policy`, "", "Guides generated from the verified policy model, one pair per policy entity:", "", ...model.tables.map((t) => `- ${t.title}: table guide and question guide`), ""].join("\n"),
    model.tables.map(logicalUrn),
    null
  );
  for (const t of model.tables) {
    const related = [logicalUrn(t), datasetUrn(t.name), ...model.rules.filter((r) => r.table === t.name).map((r) => datasetUrn(r.view))];
    const guide = readKnowledge(path.join("tables", `${t.name}.md`));
    if (guide) document(docUrn(`${t.name}-guide`), `${t.title}: table guide`, guide, related, rootDoc);
    const questions = readKnowledge(path.join("context", `${t.name}-questions.md`));
    if (questions) {
      document(docUrn(`${t.name}-questions`), `${t.title}: answering questions`, questions, related, rootDoc);
      docFor.set(t.name, docUrn(`${t.name}-questions`));
    }
  }

  // Evals: each test question with its accepted answer, judged against the expected result
  // and required to use the policy's own tables and rule views; linked to its question guide.
  const evalsFile = readKnowledge(path.join("evals", "evals.json"));
  const evalMcps = [];
  const putEval = (urn, aspectName, json) => evalMcps.push({ entityType: "eval", entityUrn: urn, changeType: "UPSERT", aspectName, aspect: { json } });
  const relations = new Set([...model.tables.flatMap((t) => [t.name, `${t.name}_adjustments`, `${t.name}_current`, `${t.name}_history`]), ...model.rules.map((r) => r.view)]);
  const expectedText = (e) => {
    if (!e.expected.rows) return `The expected answer is ${e.expected.value}.`;
    const rows = e.expected.rows.slice(0, 20).map((r) => `| ${r.join(" | ")} |`);
    const more = e.expected.rows.length > 20 ? [`(${e.expected.rows.length - 20} more rows)`] : [];
    return ["The expected result:", "", `| ${e.expected.columns.join(" | ")} |`, `|${e.expected.columns.map(() => "---").join("|")}|`, ...rows, ...more].join("\n");
  };
  for (const e of evalsFile ? JSON.parse(evalsFile).evals : []) {
    const urn = `urn:li:eval:${pkg}-${e.id}`;
    const used = e.reference_sql ? [...new Set((e.reference_sql.replace(/'[^']*'/g, "").match(/\b[a-z_][a-z0-9_]*\b/g) || []).map((w) => w.replace(/_as_of$/, "")).filter((w) => relations.has(w)))] : [];
    putEval(urn, "evalInfo", {
      name: e.id,
      description: e.description || `${e.category} question about ${e.table || "the policy"}, generated from the verified policy model.`,
      question: e.question,
      evalType: e.reference_sql ? "SQL" : "METADATA",
      ...(e.reference_sql ? { referenceOutputs: [{ output: e.reference_sql }] } : {}),
      conditions: [
        { type: "LLM_JUDGE", llmJudge: { guidelines: `${e.grading}\n\n${expectedText(e)}` } },
        ...(used.length ? [{ type: "ASSET_REFERENCE", assetReference: { mustReference: used.map(datasetUrn) } }] : []),
      ],
      executor: { type: "NATIVE" },
      origin: "CONTEXT_HUB",
      created: audit,
      lastModified: audit,
    });
    if (docFor.get(e.table)) putEval(urn, "evalDocumentReferences", { referencedDocuments: [docFor.get(e.table)] });
  }

  // Everything a workshop load creates, for reset.sh: the entities written here, the glossary
  // terms and term groups the RDF source derives from the IRIs, and the database's tables and
  // views as the DuckDB source names them. Nothing else in the catalog is touched.
  const created = new Set([...mcps, ...evalMcps].map((m) => m.entityUrn).filter((u) => !u.startsWith("urn:li:dataPlatform:")));
  const allConcepts = [...model.types.flatMap((t) => [iris.type(t), ...t.valueInfo.map((v) => iris.value(t, v.name))]), ...aggregates.map((r) => iris.rule(r))];
  for (const iri of allConcepts) {
    const term = iris.termUrn(iri);
    created.add(term);
    const path = term.slice("urn:li:glossaryTerm:".length).split(".");
    const host = new URL(iri).hostname.split(".").length;
    for (let i = host; i < path.length; i++) created.add(`urn:li:glossaryNode:${path.slice(0, i).join(".")}`);
  }
  for (const t of model.tables) for (const rel of [t.name, `${t.name}_adjustments`, `${t.name}_current`, `${t.name}_history`]) created.add(datasetUrn(rel));
  for (const r of model.rules) created.add(datasetUrn(r.view));
  fs.writeFileSync(path.join(dir, "urns.txt"), [...created].sort().join("\n") + "\n");
  fs.writeFileSync(
    path.join(dir, "reset.sh"),
    [
      "#!/usr/bin/env bash",
      "# Removes everything a workshop load created (listed in urns.txt) from DataHub, so the next",
      "# load starts clean. Nothing else in the catalog is touched. Add -n to preview.",
      "#   DATAHUB_GMS_URL=... DATAHUB_GMS_TOKEN=... bash reset.sh",
      "set -euo pipefail",
      'cd "$(dirname "$0")"',
      'datahub delete by-filter --urn-file urns.txt --hard --force "$@"',
      "",
    ].join("\n")
  );

  fs.writeFileSync(path.join(dir, "mcps.json"), JSON.stringify(mcps, null, 2));
  fs.writeFileSync(path.join(dir, "evals-mcps.json"), JSON.stringify(evalMcps, null, 2));
  const sink = ["sink:", "  type: datahub-rest", "  config:", "    server: ${DATAHUB_GMS_URL}", "    token: ${DATAHUB_GMS_TOKEN}", ""];
  if (glossaryFile) {
    fs.writeFileSync(
      path.join(dir, "glossary-recipe.yml"),
      [
        "# Step 1: the business glossary, from SKOS. Terms are keyed by IRI.",
        "#   datahub ingest -c glossary-recipe.yml   (needs: pip install 'acryl-datahub[rdf]')",
        "source:",
        "  type: rdf",
        "  config:",
        `    source: ${path.resolve(glossaryFile)}`,
        "    format: turtle",
        `    environment: ${env}`,
        ...sink,
      ].join("\n")
    );
  }
  fs.writeFileSync(
    path.join(dir, "duckdb-recipe.yml"),
    [
      "# Step 2: the database's own tables, views and columns.",
      "#   PYTHONPATH=<workspace>/scripts/datahub datahub ingest -c duckdb-recipe.yml",
      "#   needs: pip install 'acryl-datahub[sqlalchemy]' duckdb==1.5.5 duckdb-engine",
      "#   and DATAHUB_GMS_URL, DATAHUB_GMS_TOKEN",
      "source:",
      "  type: duckdb_source.DuckDBSource",
      "  config:",
      `    connect_uri: "duckdb:///${dbPath ? path.resolve(dbPath) : `${database}.db`}?access_mode=read_only"`,
      `    env: ${env}`,
      ...sink,
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(dir, "recipe.yml"),
    [
      `# Step 3: the policy's logical models, context documents, descriptions, glossary terms and`,
      `# lineage, attached to ${platform} database "${database}" (env ${env}).`,
      "#   datahub ingest -c recipe.yml",
      "source:",
      "  type: file",
      "  config:",
      "    path: ./mcps.json",
      // In order, one at a time: DataHub checks each field link against its logical model's
      // schema, which must already be saved (batched writes are checked before saving).
      ...sink.slice(0, -1),
      "    mode: SYNC",
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(dir, "evals-recipe.yml"),
    [
      "# Step 4: the evals, each linked to its question guide.",
      "#   datahub ingest -c evals-recipe.yml",
      "source:",
      "  type: file",
      "  config:",
      "    path: ./evals-mcps.json",
      ...sink,
    ].join("\n")
  );
  return mcps.length + evalMcps.length;
}

module.exports = { writeDataHub };
