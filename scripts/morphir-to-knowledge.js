#!/usr/bin/env node
// Generates the knowledge layer for a verified Morphir model:
//   tables/      table guides (what each table holds, history and adjustments, rules, queries)
//   context/     agent context: business questions and the SQL that answers them correctly
//   evals/       evals.json: those questions with golden answers, plus the SME's examples
//   glossary/    business glossary in SKOS (Turtle), loaded into DataHub by its RDF source
//   datahub/     logical models, context documents, evals, descriptions and column-level
//                lineage as DataHub MCPs, plus the recipes that load everything in order
//   ossie/       Apache Ossie (Open Semantic Interchange) semantic model with metrics
//   ontology/    lower ontology in Turtle, ready to align with an upper ontology (FIBO)
//
//   node scripts/morphir-to-knowledge.js [--ir morphir-ir.json] [--db out/enterprise.db]
//        [--project .] [--out out/knowledge] [--database <name>] [--env DEV] [--base-iri <iri>]
//
// --db is the database built by bootstrap-enterprise.sh; evals need it for golden answers.
// --database and --env say which tables the DataHub metadata describes: by default the
// workspace database (named after its file) in env DEV. Use the real database name and PROD
// when the catalog should describe the bank's production tables.

const fs = require("fs");
const path = require("path");
const { loadModel } = require("./knowledge/model");
const { writeTableGuides } = require("./knowledge/table-guides");
const { writeContextAndEvals } = require("./knowledge/context-evals");
const { writeDataHub } = require("./knowledge/datahub");
const { writeGlossary } = require("./knowledge/glossary");
const { writeOssie } = require("./knowledge/ossie");
const { writeOntology } = require("./knowledge/ontology");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

async function main() {
  const projectDir = opt("--project", ".");
  const irPath = opt("--ir", path.join(projectDir, "morphir-ir.json"));
  const dbPath = opt("--db", path.join(projectDir, "out", "enterprise.db"));
  const outDir = opt("--out", path.join(projectDir, "out", "knowledge"));
  fs.mkdirSync(outDir, { recursive: true });

  const model = loadModel({ irPath, projectDir });
  const guides = writeTableGuides(model, outDir);
  console.log(`Table guides:   ${guides.length} in ${path.join(outDir, "tables")}`);

  let connection = null;
  if (fs.existsSync(dbPath)) {
    const { DuckDBInstance } = require("@duckdb/node-api");
    connection = await (await DuckDBInstance.create(dbPath, { access_mode: "READ_ONLY" })).connect();
  } else {
    console.log(`  (no database at ${dbPath}: evals skipped; run bootstrap-enterprise.sh first)`);
  }
  const evalCount = await writeContextAndEvals(model, outDir, { connection, projectDir });
  console.log(`Agent context:  ${model.tables.length} guide(s) in ${path.join(outDir, "context")}; ${evalCount} evals in ${path.join(outDir, "evals", "evals.json")}`);
  connection?.closeSync();

  const database = opt("--database", path.basename(dbPath).replace(/\.db$/, ""));
  const env = opt("--env", "DEV");
  const baseIri = opt("--base-iri");
  const glossary = writeGlossary(model, outDir, { baseIri });
  console.log(`Glossary:       ${glossary.terms} terms (SKOS) in ${glossary.file}`);
  const mcps = writeDataHub(model, outDir, { database, env, dbPath, baseIri, glossaryFile: glossary.file });
  console.log(`DataHub:        ${mcps} metadata change proposals in ${path.join(outDir, "datahub", "mcps.json")} (database ${database}, env ${env})`);
  const ossie = writeOssie(model, outDir);
  console.log(`Ossie:          ${ossie.datasets} datasets, ${ossie.metrics} metrics in ${ossie.file}`);
  const onto = writeOntology(model, outDir, { baseIri });
  console.log(`Ontology:       ${onto.classes} classes in ${onto.file}`);
}

main().catch((e) => {
  console.error(`morphir-to-knowledge: ${e.stack || e.message}`);
  process.exit(1);
});
