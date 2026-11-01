#!/usr/bin/env node
// Flags the policy's relationship properties (calculatedBy, the SKOS mapping relations) as
// relationships in DataHub, with their semantics. DataHub accepts this only through GraphQL; it
// then points each property at the relationship type of the same id, and assignments loaded
// afterwards (relationships-recipe.yml) become graph edges that SPARQL can query.
//   DATAHUB_GMS_URL=... DATAHUB_GMS_TOKEN=... node scripts/datahub/set-relationships.js out/knowledge/datahub/relationships.json
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("usage: set-relationships.js <relationships.json>");
  process.exit(64);
}
const gms = process.env.DATAHUB_GMS_URL;
const token = process.env.DATAHUB_GMS_TOKEN;
if (!gms) {
  console.error("Set DATAHUB_GMS_URL (and DATAHUB_GMS_TOKEN).");
  process.exit(64);
}
const mutation = `mutation ($input: UpdateStructuredPropertyInput!) { updateStructuredProperty(input: $input) { urn settings { isRelationship relationshipType { urn } } } }`;
(async () => {
  let failed = 0;
  for (const { urn, semantics } of JSON.parse(fs.readFileSync(file, "utf8"))) {
    const res = await fetch(`${gms.replace(/\/$/, "")}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query: mutation, variables: { input: { urn, settings: { isRelationship: true, relationshipSemantics: semantics } } } }),
    });
    const body = await res.json().catch(() => ({}));
    const result = body.data && body.data.updateStructuredProperty;
    if (!res.ok || body.errors || !result || !result.settings || !result.settings.isRelationship) {
      failed++;
      console.error(`${urn}: ${JSON.stringify(body.errors || body).slice(0, 400)}`);
    } else {
      console.log(`${urn} -> relationship ${result.settings.relationshipType ? result.settings.relationshipType.urn : "(type pending)"}`);
    }
  }
  process.exit(failed ? 1 : 0);
})();
