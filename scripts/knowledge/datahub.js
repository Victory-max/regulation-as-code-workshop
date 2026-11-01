// DataHub metadata: a logical model per policy entity (platform `logical`), with each DuckDB
// table and column linked to it as a physical instance; context documents and evals; and, for
// every table and rule view, descriptions, glossary terms and column-level lineage. Written as
// MetadataChangeProposals for the `file` source. The glossary itself is the SKOS file loaded
// by the `rdf` source, so terms keep their IRIs. Recipes, in load order: glossary-recipe.yml,
// duckdb-recipe.yml, recipe.yml (mcps.json), evals-recipe.yml (evals-mcps.json).

const fs = require("fs");
const path = require("path");
const { conceptIris, businessPath, RECORD_KEEPING } = require("./iris");
const { loadAlignments } = require("./alignments");

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Logical-model field types, by the business type a field has in the model.
const FIELD_TYPES = { choice: "EnumType", decimal: "NumberType", integer: "NumberType", float: "NumberType", boolean: "BooleanType", date: "DateType", text: "StringType" };

// database and env name the physical tables the metadata attaches to: they must match the
// duckdb-recipe ingestion (file name and env) or the real tables' location in the catalog.
function writeDataHub(model, outDir, { platform = "duckdb", database = "enterprise", env = "DEV", dbPath = null, baseIri = null, glossaryFile = null, standards = [], assertions = [] } = {}) {
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
  // The policy's alignments to industry standards (FIBO, CDM), shared by the column
  // descriptions, the glossary links, the column properties and the alignment document.
  const aligned = loadAlignments(standards);
  const camel = (words) => words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
  const fieldIri = (t, c) => iris.member(model.types.find((x) => JSON.stringify(x.fqn) === JSON.stringify(t.entityType[2])), camel(c.path[0]));
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
  // The glossary terms a column carries: its field's term, its choice type's term, and for a
  // calculated column the term of the rule it comes from. The same column appears in the table,
  // its companions and every rule view, and carries the same terms in each.
  const ruleByName = new Map(model.rules.map((x) => [x.rule, x]));
  const columnTerms = (t, c) => {
    const found = [];
    // A field's term is its type's or its function's; a field of a core Morphir type has none.
    if (c.generated) found.push(iris.termUrn(iris.recordKeeping("recordId")));
    else if (fieldIri(t, c)) found.push(iris.termUrn(fieldIri(t, c)));
    if (c.type.kind === "choice" && termFor.get(JSON.stringify(c.type.fqn))) found.push(termFor.get(JSON.stringify(c.type.fqn)));
    // A field declared with a named type (an alias such as Apr = Decimal) carries that type's term.
    if (c.tpe && c.tpe[0] === "Reference" && termFor.get(JSON.stringify(c.tpe[2]))) found.push(termFor.get(JSON.stringify(c.tpe[2])));
    const calc = t.feed && t.feed.calculated.find((x) => x.column === c.name);
    if (calc && ruleByName.get(calc.rule)) found.push(iris.termUrn(iris.rule(ruleByName.get(calc.rule))));
    return [...new Set(found)];
  };
  const columnInfo = (t, c) => {
    const found = columnTerms(t, c);
    return {
      fieldPath: c.name,
      description:
        (model.annotationText({ description: c.description, specLinks: c.specLinks, values: c.values }) ||
          (c.type.kind === "choice" ? `${c.title}: one of ${c.type.values.join(", ")}` : c.title)),
      ...(found.length ? { glossaryTerms: terms(found) } : {}),
    };
  };
  // The record-keeping columns each kind of relation has, with their terms.
  const recordKeepingInfo = (columns) =>
    RECORD_KEEPING.filter(([column]) => columns.includes(column)).map(([column, name, label, definition]) => ({
      fieldPath: column,
      description: `${label}: ${definition}`,
      glossaryTerms: terms([iris.termUrn(iris.recordKeeping(name))]),
    }));
  const TEMPORAL = ["valid_from", "valid_to", "recorded_at"];
  const VERSIONED = [...TEMPORAL, "record_source", "adjustment_id", "reason", "adjusted_by"];
  const recordColumnsOf = { table: TEMPORAL, adjustments: [...TEMPORAL, "adjustment_id", "reason", "adjusted_by"], view: VERSIONED, feed: [] };
  // A rule's output column carries the rule's term and, for a choice, the choice type's term.
  const outputTerms = (rule, o) =>
    [...new Set([iris.termUrn(iris.rule(rule)), ...(o.type.kind === "choice" && termFor.get(JSON.stringify(o.type.fqn)) ? [termFor.get(JSON.stringify(o.type.fqn))] : [])])];

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
      // Union members by their wire names (com.linkedin.schema.*), as DataHub expects them.
      platformSchema: { "com.linkedin.schema.OtherSchema": { rawSchema: "" } },
      fields: fields.map((c) => ({
        fieldPath: logicalFieldPath(c),
        nullable: !!c.optional,
        type: { type: { [`com.linkedin.schema.${FIELD_TYPES[c.type.kind] || "StringType"}`]: {} } },
        nativeDataType: c.type.kind === "choice" ? c.type.typeName : c.type.kind,
        description: model.annotationText({ description: c.description, specLinks: c.specLinks, values: c.values }) || c.title,
        ...(columnTerms(t, c).length ? { glossaryTerms: terms(columnTerms(t, c)) } : {}),
      })),
    });
    if (linkable(t.specLinks).length) put("dataset", lurn, "institutionalMemory", memory(linkable(t.specLinks)));
    const entityTerm = termFor.get(JSON.stringify(t.entityType[2]));
    if (entityTerm) put("dataset", lurn, "glossaryTerms", terms([entityTerm]));
    // Every relation holding versions of the record is a physical instance of the model: the
    // table, its adjustments, its current and history views, and a calculation table's feed. Each
    // business column is an instance of its logical field, including the copies of those columns
    // in the entity's rule views (the view itself is a rule's result, not an instance).
    const instances = [t.name, `${t.name}_adjustments`, `${t.name}_current`, `${t.name}_history`, ...(t.feed ? [`${t.name}_feed`] : [])];
    const ruleViews = model.rules.filter((r) => r.table === t.name && !r.aggregate).map((r) => r.view);
    for (const table of instances) put("dataset", datasetUrn(table), "logicalParent", { parent: { destinationUrn: lurn } });
    for (const table of [...instances, ...ruleViews]) {
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
    const relations = [[t.name, "table"], [`${t.name}_adjustments`, "adjustments"], [`${t.name}_current`, "view"], [`${t.name}_history`, "view"], ...(t.feed ? [[`${t.name}_feed`, "feed"]] : [])];
    for (const [relation, kind] of relations) {
      put("dataset", datasetUrn(relation), "editableSchemaMetadata", { editableSchemaFieldInfo: [...t.columns.map((c) => columnInfo(t, c)), ...recordKeepingInfo(recordColumnsOf[kind])] });
    }
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
    // A rule view repeats its table's columns (t.*) and adds the rule's outputs.
    const ruleTable = model.tables.find((x) => x.name === r.table);
    put("dataset", urn, "editableSchemaMetadata", {
      editableSchemaFieldInfo: [
        ...(r.aggregate || !ruleTable ? [] : [...ruleTable.columns.map((c) => columnInfo(ruleTable, c)), ...recordKeepingInfo(recordColumnsOf.view)]),
        ...r.outputs.map((o) => ({
          fieldPath: o.column,
          description: model.annotationText({ description: o.description || `${o.title}, decided by policy rule ${r.rule}.`, specLinks: o.specLinks }),
          glossaryTerms: terms(outputTerms(r, o)),
        })),
      ],
    });
    // Upstream: the table it reads (and its adjustments), and the views of the policy functions it
    // calls (its function dependencies in the model).
    put("dataset", urn, "upstreamLineage", {
      upstreams: [
        ...[r.table, `${r.table}_adjustments`].map((table) => ({ dataset: datasetUrn(table), type: "VIEW", auditStamp: audit })),
        ...r.calls.filter((x) => x.view).map((x) => ({ dataset: datasetUrn(x.view), type: "TRANSFORMED", auditStamp: audit })),
      ],
      fineGrainedLineages: r.outputs.map((o) => ({
        upstreamType: "FIELD_SET",
        upstreams: o.inputs.map((c) => fieldUrn(r.table, c)),
        downstreamType: "FIELD",
        downstreams: [fieldUrn(r.view, o.column)],
        transformOperation: `Morphir rule ${r.rule}`,
        confidenceScore: 1.0,
      })),
    });
    put("dataset", urn, "glossaryTerms", terms([...new Set(r.outputs.flatMap((o) => outputTerms(r, o)))]));
  }

  // Metrics: each measure is a metric of the policy's semantic model, with its compiled SQL, the
  // rule view it reads, the measures it is built from, and the glossary term of the same name.
  // Measures are aggregate rules and the rules over a calculation table (the LRR); a measure is
  // built from the measures it calls and, through calculated columns, the aggregates that fill
  // the columns it reads.
  const feedOf = new Map(model.tables.filter((t) => t.feed).map((t) => [t.name, t.feed]));
  const metricUrnOf = (r) => {
    const parts = r.rule.split(".");
    const path = businessPath(parts.slice(0, -1), parts[parts.length - 1]);
    return `urn:li:metric:(urn:li:dataPlatform:morphir,${[model.packageName, ...path.slice(0, -1)].join(".")},${path[path.length - 1]})`;
  };
  const measures = model.rules.filter((r) => r.aggregate || feedOf.has(r.table));
  if (measures.length) {
    const morphir = "urn:li:dataPlatform:morphir";
    const semanticModel = `urn:li:semanticModel:(${morphir},${model.packageName},policy)`;
    const metricUrn = metricUrnOf;
    put("dataPlatform", morphir, "dataPlatformInfo", { name: "morphir", displayName: "Morphir", type: "OTHERS", datasetNameDelimiter: "." });
    put("semanticModel", semanticModel, "dataPlatformInstance", { platform: morphir });
    put("semanticModel", semanticModel, "semanticModelInfo", {
      name: `${model.packageName} policy`,
      description: `Measures defined by the verified ${model.packageName} policy model.`,
      datasets: [],
    });
    // The other measures a rule's definition calls.
    const byKey = new Map(measures.map((r) => [model.ir.fqnKey(r.fqn), r]));
    // Walks arrays and objects alike: a let definition's body sits inside an object.
    const calls = (node, found = new Set()) => {
      if (!node || typeof node !== "object") return found;
      if (Array.isArray(node) && node[0] === "Reference" && Array.isArray(node[2]) && node[2].length === 3 && byKey.has(model.ir.fqnKey(node[2]))) found.add(byKey.get(model.ir.fqnKey(node[2])));
      Object.values(node).forEach((child) => calls(child, found));
      return found;
    };
    for (const r of measures) {
      const urn = metricUrn(r);
      const viaColumns = (feedOf.get(r.table) || { calculated: [] }).calculated
        .filter((c) => r.outputs.some((o) => o.inputs.includes(c.column)))
        .map((c) => measures.find((m) => m.rule === c.rule))
        .filter(Boolean);
      const derivedFrom = [...new Set([...calls(r.def.body), ...viaColumns])].filter((x) => x !== r);
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

  // Domains and data products. Each entity's tables, views, rules, logical model and metrics go
  // in its owning business domain (domains decoration). Each domain gets one data product of its
  // non-interim assets: every entity's current and history views, and the final rule outputs
  // (rules no other rule calls) as output ports. Raw source tables, adjustments, feeds and
  // interim rules stay out of the product.
  const domainUrn = (name) => `urn:li:domain:${pkg}.${slug(name)}`;
  const productUrn = (name) => `urn:li:dataProduct:${pkg}.${slug(name)}`;
  for (const name of new Set(model.tables.map((t) => t.domain))) {
    const tables = model.tables.filter((t) => t.domain === name);
    const rules = model.rules.filter((r) => tables.some((t) => t.name === r.table));
    put("domain", domainUrn(name), "domainProperties", { name, description: `${name}: the ${model.packageName} policy's tables, rules and metrics owned by this domain.` });
    const owned = [
      ...tables.flatMap((t) => [logicalUrn(t), ...[t.name, `${t.name}_adjustments`, `${t.name}_current`, `${t.name}_history`, ...(t.feed ? [`${t.name}_feed`] : [])].map(datasetUrn)]),
      ...rules.map((r) => datasetUrn(r.view)),
      ...rules.filter((r) => measures.includes(r)).map((r) => metricUrnOf(r)),
    ];
    for (const urn of owned) put(urn.startsWith("urn:li:metric") ? "metric" : "dataset", urn, "domains", { domains: [domainUrn(name)] });
    const finals = rules.filter((r) => !r.calledBy.length);
    put("dataProduct", productUrn(name), "dataProductProperties", {
      name: `${name} policy data`,
      description: `The ${model.packageName} policy's data for ${name}: each record's current and history views, and the final policy results (${finals.map((r) => r.title).join(", ")}). Generated from the verified policy model; every result is checked against it.`,
      assets: [
        ...finals.map((r) => ({ destinationUrn: datasetUrn(r.view), outputPort: true })),
        ...tables.flatMap((t) => [`${t.name}_current`, `${t.name}_history`]).map((v) => ({ destinationUrn: datasetUrn(v), outputPort: false })),
      ],
    });
    put("dataProduct", productUrn(name), "domains", { domains: [domainUrn(name)] });
  }

  // Calculation tables: each calculated column comes from its aggregate rule's view.
  for (const [table, feed] of feedOf) {
    put("dataset", datasetUrn(table), "upstreamLineage", {
      upstreams: [...new Set(feed.calculated.map((c) => c.view))].map((view) => ({ dataset: datasetUrn(view), type: "TRANSFORMED", auditStamp: audit })),
      fineGrainedLineages: feed.calculated.map((c) => ({
        upstreamType: "FIELD_SET",
        upstreams: [fieldUrn(c.view, c.output)],
        downstreamType: "FIELD",
        downstreams: [fieldUrn(table, c.column)],
        transformOperation: `Calculated from ${c.rule}`,
        confidenceScore: 1.0,
      })),
    });
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
  // How every policy table is built: business and system time, the adjustments companion, the
  // current and history views, as-of queries, and recalculating a calculation table. Related to
  // every table and view it describes, so an agent looking at any of them finds it.
  const example = model.tables.find((t) => !t.feed) || model.tables[0];
  const calcTables = model.tables.filter((t) => t.feed);
  if (example) {
    const cols = example.columns.map((c) => c.name).join(", ");
    document(
      docUrn("table-design"),
      "How the policy tables work: history, corrections and as-of questions",
      [
        "# How the policy tables work: history, corrections and as-of questions",
        "",
        `Every table generated from the ${model.packageName} policy model (${model.tables.map((t) => `\`${t.name}\``).join(", ")}) follows the same design. Nothing is ever updated or deleted: every change is a new row, so any past answer can be reproduced exactly.`,
        "",
        "## Two kinds of time (bitemporal)",
        "",
        "- `valid_from` / `valid_to`: **business time**, the dates a version of the record is true for. A version applies on dates `valid_from <= d < valid_to`; the current version runs to `9999-12-31`.",
        "- `recorded_at`: **system time**, when the bank recorded that version. A later recording of the same business dates supersedes an earlier one, but the earlier one stays.",
        "",
        "## The companion tables and views, for a table `<t>`",
        "",
        "| Name | What it is |",
        "|---|---|",
        "| `<t>` | Versions as delivered by the source system. Append-only. |",
        "| `<t>_adjustments` | Manual corrections: full replacement versions with `adjustment_id`, `reason` and `adjusted_by`. Kept apart from source data, so every correction is attributable. |",
        "| `<t>_history` | Both together, with `record_source` = `source` or `adjustment`. |",
        "| `<t>_current` | The version of each record that applies today, as known now. An adjustment wins over a source row recorded at the same time. |",
        "| `<t>_as_of(valid_date, known_at)` | The version of each record that applied on `valid_date`, as the bank knew it at `known_at`. |",
        "",
        "## Policy results",
        "",
        "The policy's rule views (`rule_*`) read `<t>_current`, so they always reflect corrections. Each has an `_as_of(valid_date, known_at)` form for past dates and as-reported questions. Never re-derive a policy result in your own SQL: the rule views are generated from the verified policy and checked against it value by value.",
        "",
        "## Typical questions",
        "",
        `- **Today's answer:** \`SELECT ... FROM rule_<name>\` (reads \`${example.name}_current\`).`,
        `- **As reported on a date:** \`SELECT ... FROM rule_<name>_as_of(DATE '2026-09-30', TIMESTAMP '2026-09-30 23:59:59')\`.`,
        `- **What changed and why:** \`SELECT * FROM ${example.name}_history WHERE record_source = 'adjustment'\`.`,
        `- **Before and after a correction:** compare \`rule_<name>_as_of(CURRENT_DATE, <time before the adjustment>)\` with \`rule_<name>\`.`,
        "",
        "## Recording a correction",
        "",
        "```sql",
        `INSERT INTO ${example.name}_adjustments (adjustment_id, reason, adjusted_by, ${cols}, valid_from)`,
        `SELECT 'ADJ-0001', '<why>', '<who>', ${cols}, CURRENT_DATE`,
        `FROM ${example.name}_current WHERE ${example.key} = '<id>';  -- then change the corrected columns`,
        "```",
        "",
        ...(calcTables.length
          ? [
              "## Calculation tables",
              "",
              ...calcTables.map(
                (t) =>
                  `\`${t.name}\` records each run of a calculation. Its calculated columns (${t.feed.calculated.map((c) => `\`${c.column}\` from \`${c.view}\``).join(", ")}) come from the policy's rules; its other columns are reported from slices not yet modeled. \`${t.name}_feed\` shows what a recalculation would record now; recalculating appends a new version (\`INSERT INTO ${t.name} (...) SELECT ... FROM ${t.name}_feed\`), and every earlier run stays in \`${t.name}_history\`.`
              ),
              "",
            ]
          : []),
      ].join("\n"),
      model.tables.flatMap((t) => [logicalUrn(t), ...[t.name, `${t.name}_adjustments`, `${t.name}_current`, `${t.name}_history`, ...(t.feed ? [`${t.name}_feed`] : [])].map(datasetUrn)]),
      rootDoc
    );
  }
  for (const t of model.tables) {
    const related = [logicalUrn(t), ...[t.name, `${t.name}_adjustments`, `${t.name}_current`, `${t.name}_history`, ...(t.feed ? [`${t.name}_feed`] : [])].map(datasetUrn), ...model.rules.filter((r) => r.table === t.name).map((r) => datasetUrn(r.view))];
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

  // Alignments to industry standards (FIBO for meaning, CDM for data structure): the policy's
  // glossary terms (types, values, fields, functions) mapped in ontologies/<standard>-alignment.ttl
  // to terms of the standard's subset, which <standard>-recipe.yml loads keyed by IRI. Each
  // mapping is a graph edge whose relationship type is the standard predicate itself
  // (skos:closeMatch, skos:broadMatch, rdfs:subClassOf, ...), so SPARQL and the catalog show the
  // same statement as the alignment file. Each function's term is also linked to its metric by
  // calculatedBy, the policy's own relationship.
  //
  // A relationship type is a relationshipType entity (its meaning) plus a structured property
  // flagged as a relationship (what is assigned); DataHub turns each assignment into an edge
  // (needs STRUCTURED_PROPERTY_GRAPH_EDGES_ENABLED).
  const relationshipSettings = [];
  const relationshipMcps = [];
  const relationshipUrn = (id) => `urn:li:relationshipType:${id}`;
  const relationshipProperty = (id) => `urn:li:structuredProperty:${id}`;
  const defineRelationship = (id, { displayName, description, direction = "DIRECTED", transitive = false, reverse = null, predicateIri = null, entityTypes, allowedTypes }) => {
    put("relationshipType", relationshipUrn(id), "relationshipTypeInfo", {
      displayName,
      description,
      directionMode: direction,
      transitive,
      ...(reverse ? { reverseDisplayName: reverse } : {}),
      ...(predicateIri ? { predicateIri, equivalentProperties: [predicateIri] } : {}),
    });
    put("structuredProperty", relationshipProperty(id), "propertyDefinition", {
      qualifiedName: id,
      displayName,
      description,
      valueType: "urn:li:dataType:datahub.urn",
      cardinality: "MULTIPLE",
      entityTypes,
      typeQualifier: { allowedTypes },
      immutable: false,
    });
    // DataHub flags a property as a relationship only through GraphQL (set-relationships.js),
    // which also points it at the relationship type of the same id.
    relationshipSettings.push({
      urn: relationshipProperty(id),
      semantics: { directionMode: direction, transitive, ...(reverse ? { reverseDisplayName: reverse } : {}), ...(predicateIri ? { equivalentProperties: [predicateIri] } : {}) },
    });
  };
  // The standard predicates an alignment may use, by IRI: relationship type id (vocabulary
  // prefix + local name, as DataHub's RDF source names rdfs_subClassOf) and semantics.
  const SKOS = "http://www.w3.org/2004/02/skos/core#";
  const PREDICATES = {
    [`${SKOS}exactMatch`]: { id: "skos_exactMatch", curie: "skos:exactMatch", direction: "UNDIRECTED", transitive: true },
    [`${SKOS}closeMatch`]: { id: "skos_closeMatch", curie: "skos:closeMatch", direction: "UNDIRECTED" },
    [`${SKOS}broadMatch`]: { id: "skos_broadMatch", curie: "skos:broadMatch", reverse: "skos:narrowMatch" },
    [`${SKOS}narrowMatch`]: { id: "skos_narrowMatch", curie: "skos:narrowMatch", reverse: "skos:broadMatch" },
    [`${SKOS}relatedMatch`]: { id: "skos_relatedMatch", curie: "skos:relatedMatch", direction: "UNDIRECTED" },
    "http://www.w3.org/2000/01/rdf-schema#subClassOf": { id: "rdfs_subClassOf", curie: "rdfs:subClassOf", transitive: true },
    "http://www.w3.org/2002/07/owl#equivalentClass": { id: "owl_equivalentClass", curie: "owl:equivalentClass", direction: "UNDIRECTED", transitive: true },
  };
  const termAssignments = new Map(); // glossary term URN -> Map(property URN -> Set(values))
  const assign = (termUrn, property, value) => {
    if (!termAssignments.has(termUrn)) termAssignments.set(termUrn, new Map());
    const props = termAssignments.get(termUrn);
    if (!props.has(property)) props.set(property, new Set());
    props.get(property).add(value);
  };
  const glossaryTermType = "urn:li:entityType:datahub.glossaryTerm";
  const ownTerms = new Set(iris.concepts());
  const usedPredicates = new Set();
  const standardTerms = new Set();
  const loadedStandards = aligned;
  for (const std of aligned) {
    std.terms.forEach((x) => standardTerms.add(x));
    for (const m of std.mappings) {
      const predicate = PREDICATES[m.predicate];
      if (!predicate || !ownTerms.has(m.subject) || !m.isTerm) continue;
      usedPredicates.add(m.predicate);
      assign(iris.termUrn(m.subject), relationshipProperty(predicate.id), iris.termUrn(m.target));
    }
  }
  for (const iri of usedPredicates) {
    const { id, curie, direction, transitive, reverse } = PREDICATES[iri];
    defineRelationship(id, {
      displayName: curie,
      description: `${curie}, as used in the policy's alignments to industry standards (FIBO, CDM).`,
      direction,
      transitive,
      reverse,
      predicateIri: iri,
      entityTypes: [glossaryTermType],
      allowedTypes: [glossaryTermType],
    });
  }
  if (measures.length) {
    defineRelationship(`${pkg}.calculatedBy`, {
      displayName: "Calculated by",
      description: "The metric that calculates this business term's value, generated from the policy function of the same name.",
      reverse: "Calculates",
      entityTypes: [glossaryTermType],
      allowedTypes: ["urn:li:entityType:datahub.metric"],
    });
    for (const r of measures) assign(iris.termUrn(iris.rule(r)), relationshipProperty(`${pkg}.calculatedBy`), metricUrnOf(r));
  }
  // Assignments become edges only once their property is flagged as a relationship, so they
  // load after set-relationships.js, from their own file.
  for (const [termUrn, props] of termAssignments) {
    relationshipMcps.push({ entityType: "glossaryTerm", entityUrn: termUrn, changeType: "UPSERT", aspectName: "structuredProperties", aspect: { json: { properties: [...props].map(([propertyUrn, values]) => ({ propertyUrn, values: [...values].map((v) => ({ string: v })) })) } } });
  }

  // Data quality assertions derived from the model (see assertions.js), each with its latest
  // result from the policy database, reported as an external assertion run.
  const runAt = Date.now();
  for (const a of assertions) {
    const urn = `urn:li:assertion:${pkg}-${a.id}`;
    const table = a.logical && model.tables.find((t) => t.name === a.relation);
    const entity = table ? logicalUrn(table) : datasetUrn(a.relation);
    const info = {
      type: a.kind === "field" ? "FIELD" : "SQL",
      description: `${a.description} ${a.why}`,
      source: { type: "EXTERNAL", created: audit },
      customProperties: {
        generatedFrom: `Morphir model ${model.packageName}`,
        violationsSql: a.violationsSql,
        ...(a.lowerValues ? { transform: "lower case", allowedValues: a.lowerValues.join(", ") } : {}),
      },
      entityUrn: entity,
    };
    if (a.kind === "field") {
      info.fieldAssertion = {
        type: "FIELD_VALUES",
        entity,
        fieldValuesAssertion: {
          field: { path: a.field, type: a.fieldType, nativeType: a.fieldType },
          operator: a.operator,
          ...(a.operator === "IN" ? { parameters: { value: { value: JSON.stringify(a.values), type: "SET" } } } : {}),
          ...(a.operator === "REGEX_MATCH" ? { parameters: { value: { value: a.pattern, type: "STRING" } } } : {}),
          ...(a.operator === "GREATER_THAN" ? { parameters: { value: { value: String(a.threshold), type: "NUMBER" } } } : {}),
          failThreshold: { type: "COUNT", value: 0 },
          excludeNulls: a.operator !== "NOT_NULL",
        },
      };
    } else {
      info.sqlAssertion = { type: "METRIC", entity, statement: a.violationsSql, operator: "EQUAL_TO", parameters: { value: { value: "0", type: "NUMBER" } } };
    }
    put("assertion", urn, "assertionInfo", info);
    if (a.result) {
      put("assertion", urn, "assertionRunEvent", {
        timestampMillis: runAt,
        runId: `morphir-${runAt}`,
        asserteeUrn: entity,
        assertionUrn: urn,
        status: "COMPLETE",
        result: a.result.error
          ? { type: "ERROR", nativeResults: { error: a.result.error.slice(0, 500) } }
          : { type: a.result.passed ? "SUCCESS" : "FAILURE", rowCount: a.result.rows, unexpectedCount: a.result.violations, actualAggValue: a.result.violations },
        partitionSpec: { partition: "FULL_TABLE_SNAPSHOT", type: "FULL_TABLE" },
      });
    }
  }

  // Everything a workshop load creates, for reset.sh: the entities written here, the glossary
  // terms and term groups the RDF source derives from the IRIs, and the database's tables and
  // views as the DuckDB source names them. Nothing else in the catalog is touched.
  const created = new Set([...mcps, ...evalMcps, ...relationshipMcps].map((m) => m.entityUrn).filter((u) => !u.startsWith("urn:li:dataPlatform:")));
  const allConcepts = iris.concepts();
  for (const iri of [...allConcepts, ...standardTerms]) {
    const term = iris.termUrn(iri);
    created.add(term);
    const path = term.slice("urn:li:glossaryTerm:".length).split(".");
    const host = new URL(iri).hostname.split(".").length;
    for (let i = host; i < path.length; i++) created.add(`urn:li:glossaryNode:${path.slice(0, i).join(".")}`);
  }
  for (const t of model.tables) for (const rel of [t.name, `${t.name}_adjustments`, `${t.name}_current`, `${t.name}_history`]) created.add(datasetUrn(rel));
  for (const r of model.rules) created.add(datasetUrn(r.view));
  fs.writeFileSync(path.join(dir, "urns.txt"), [...created].sort().join("\n") + "\n");
  // Namespaces only a workshop load writes to: the reset also sweeps these, which catches
  // entities from earlier loads whose names have since changed.
  const owned = [
    `urn:li:glossaryTerm:${new URL(iris.base).hostname}.`,
    `urn:li:glossaryNode:${new URL(iris.base).hostname}`,
    `urn:li:document:${pkg}-`,
    `urn:li:eval:${pkg}-`,
    `urn:li:dataset:(urn:li:dataPlatform:logical,${model.packageName}.`,
    `urn:li:dataset:(urn:li:dataPlatform:${platform},${database}.main.`,
    `urn:li:metric:(urn:li:dataPlatform:morphir,${model.packageName}`,
    `urn:li:semanticModel:(urn:li:dataPlatform:morphir,${model.packageName}`,
    `urn:li:structuredProperty:${pkg}.`,
    `urn:li:domain:${pkg}.`,
    `urn:li:dataProduct:${pkg}.`,
    `urn:li:relationshipType:${pkg}.`,
    `urn:li:assertion:${pkg}-`,
  ];
  fs.writeFileSync(
    path.join(dir, "reset.sh"),
    [
      "#!/usr/bin/env bash",
      "# Removes everything a workshop load created from DataHub, so the next load starts clean:",
      "# the entities listed in urns.txt, plus anything else in the workshop's own namespaces",
      "# (left by earlier loads). Nothing else in the catalog is touched. Add -n to preview.",
      "# Structured property and relationship type definitions are kept: DataHub refuses to",
      "# hard-delete a structured property (its name could not be reused), and the next load",
      "# rewrites both unchanged.",
      "#   DATAHUB_GMS_URL=... DATAHUB_GMS_TOKEN=... bash reset.sh",
      "set -euo pipefail",
      'cd "$(dirname "$0")"',
      "python3 - <<'PY' > urns-to-delete.txt",
      "import os",
      "from datahub.ingestion.graph.client import DataHubGraph, DatahubClientConfig",
      `owned = ${JSON.stringify(owned)}`,
      "graph = DataHubGraph(DatahubClientConfig(server=os.environ['DATAHUB_GMS_URL'], token=os.environ.get('DATAHUB_GMS_TOKEN')))",
      "found = set(line.strip() for line in open('urns.txt') if line.strip())",
      "for urn in graph.get_urns_by_filter(entity_types=['glossaryTerm', 'glossaryNode', 'document', 'dataset', 'metric', 'semanticModel', 'structuredProperty', 'schemaField', 'domain', 'dataProduct', 'assertion']):",
      "    if any(urn.startswith(prefix) for prefix in owned) or any(f'({prefix}' in urn for prefix in owned if prefix.startswith('urn:li:dataset')):",
      "        found.add(urn)",
      "keep = ('urn:li:structuredProperty:', 'urn:li:relationshipType:')",
      "print('\\n'.join(sorted(u for u in found if not u.startswith(keep))))",
      "PY",
      'datahub delete by-filter --urn-file urns-to-delete.txt --hard --force "$@"',
      "",
    ].join("\n")
  );

  fs.writeFileSync(path.join(dir, "mcps.json"), JSON.stringify(mcps, null, 2));
  fs.writeFileSync(path.join(dir, "evals-mcps.json"), JSON.stringify(evalMcps, null, 2));
  fs.writeFileSync(path.join(dir, "relationships.json"), JSON.stringify(relationshipSettings, null, 2));
  fs.writeFileSync(path.join(dir, "relationship-mcps.json"), JSON.stringify(relationshipMcps, null, 2));
  const sink = ["sink:", "  type: datahub-rest", "  config:", "    server: ${DATAHUB_GMS_URL}", "    token: ${DATAHUB_GMS_TOKEN}", ""];
  for (const std of loadedStandards) {
    fs.writeFileSync(
      path.join(dir, `${std.name}-recipe.yml`),
      [
        `# Step 1b: the ${std.label} subset the policy is aligned to, as glossary terms keyed by IRI.`,
        `#   datahub ingest -c ${std.name}-recipe.yml   (needs: pip install 'acryl-datahub[rdf]')`,
        "source:",
        "  type: rdf",
        "  config:",
        `    source: ${path.resolve(std.subsetFile)}`,
        "    format: turtle",
        `    dialect: ${std.dialect}`,
        `    environment: ${env}`,
        ...sink,
      ].join("\n")
    );
  }
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
    path.join(dir, "relationships-recipe.yml"),
    [
      "# Step 5: typed relationships (calculatedBy, SKOS mappings to FIBO and CDM), after",
      "# flagging their properties as relationships:",
      "#   node <workspace>/scripts/datahub/set-relationships.js relationships.json",
      "#   datahub ingest -c relationships-recipe.yml",
      "# Needs STRUCTURED_PROPERTY_GRAPH_EDGES_ENABLED on the DataHub instance; skip both otherwise.",
      "source:",
      "  type: file",
      "  config:",
      "    path: ./relationship-mcps.json",
      ...sink,
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
