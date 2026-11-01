// Morphir decorations used for traceability, read from a project's morphir.json:
//   specLink     Regulation.Trace:SpecLink:SpecLinks      -> spec sections per node
//   description  Regulation.Trace:Description:Description -> business description per node
//   calculatedFrom Regulation.Trace:CalculatedFrom:CalculatedFrom -> producing rule per field
//   domain       Regulation.Trace:Domain:Domain           -> owning business domain per entity
// Decoration values are keyed by Morphir node ID:
//   <Package>:<Module>:<typeName>.type            a type
//   <Package>:<Module>:<typeName>.type#<child>    a record field or a choice case
//   <Package>:<Module>:<ruleName>.value           a rule

const fs = require("fs");
const path = require("path");
const ir = require("./morphir-ir");

const ENTRY_POINTS = {
  specLink: "Regulation.Trace:SpecLink:SpecLinks",
  description: "Regulation.Trace:Description:Description",
  calculatedFrom: "Regulation.Trace:CalculatedFrom:CalculatedFrom",
  domain: "Regulation.Trace:Domain:Domain",
};

const DECORATIONS_IR = "scripts/decorations/regulation-trace/morphir-ir.json";

const typeId = (fqn) => `${ir.pathToString(fqn[0])}:${ir.pathToString(fqn[1])}:${ir.toCamel(fqn[2])}.type`;
const valueId = (fqn) => `${ir.pathToString(fqn[0])}:${ir.pathToString(fqn[1])}:${ir.toCamel(fqn[2])}.value`;
const childId = (parent, name) => `${parent}#${ir.toCamel(name)}`;

// Every node that can carry a decoration, with what it is.
function nodesOf(index) {
  const nodes = new Map();
  for (const t of index.types.values()) {
    const id = typeId(t.fqn);
    nodes.set(id, { kind: "type", fqn: t.fqn, doc: t.doc.trim(), access: t.access });
    const def = t.def;
    if (def[0] === "CustomTypeDefinition") {
      for (const [ctor] of def[2].value) nodes.set(childId(id, ctor), { kind: "case", parent: id, name: ctor });
    } else if (def[2][0] === "Record") {
      for (const f of def[2][2]) nodes.set(childId(id, f.name), { kind: "field", parent: id, name: f.name });
    }
  }
  for (const v of index.values.values()) nodes.set(valueId(v.fqn), { kind: "rule", fqn: v.fqn, doc: v.doc.trim(), access: v.access });
  return nodes;
}

// The node of the record field at the end of a (possibly nested) column path.
function fieldNodeId(index, entityType, columnPath) {
  let tpe = entityType;
  let id = null;
  for (const step of columnPath) {
    let resolved = tpe;
    if (resolved[0] === "Reference" && ir.fqnKey(resolved[2]) === ir.SDK.maybe) resolved = resolved[3][0];
    const owner = resolved[0] === "Reference" ? resolved[2] : null;
    const fields = ir.recordFieldsOf(index, resolved);
    const field = fields && fields.find((f) => JSON.stringify(f.name) === JSON.stringify(step));
    if (!owner || !field) return null;
    id = childId(typeId(owner), step);
    tpe = field.tpe;
  }
  return id;
}

function loadDecorations(projectDir = ".") {
  const morphirJsonPath = path.join(projectDir, "morphir.json");
  const config = fs.existsSync(morphirJsonPath) ? JSON.parse(fs.readFileSync(morphirJsonPath, "utf8")).decorations || {} : {};
  const read = (entryPoint, fallback) => {
    const found = Object.entries(config).find(([, d]) => d.entryPoint === entryPoint);
    const file = path.join(projectDir, found ? found[1].storageLocation || `${found[0]}.json` : fallback);
    return { configured: !!found, file, data: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {} };
  };
  const specLinks = read(ENTRY_POINTS.specLink, "spec-links.json");
  const descriptions = read(ENTRY_POINTS.description, "descriptions.json");
  const calculatedFrom = read(ENTRY_POINTS.calculatedFrom, "calculated-from.json");
  const domains = read(ENTRY_POINTS.domain, "domains.json");

  // Permanent URL for a spec link: absolute URLs as is; files fetched from GitHub through
  // specs/source.json; an excerpt through its <file>.sources.json anchor map.
  const fetched = path.join(projectDir, "specs", "source.json");
  const source = fs.existsSync(fetched) ? JSON.parse(fs.readFileSync(fetched, "utf8")) : null;
  const sidecars = new Map();
  const permalink = (url) => {
    if (/^https?:/.test(url)) return url;
    const [file, anchor = ""] = url.split("#");
    const sidecarPath = path.join(projectDir, file.replace(/\.md$/, ".sources.json"));
    if (!sidecars.has(sidecarPath)) sidecars.set(sidecarPath, fs.existsSync(sidecarPath) ? JSON.parse(fs.readFileSync(sidecarPath, "utf8")) : null);
    const sidecar = sidecars.get(sidecarPath);
    if (sidecar && sidecar[anchor]) return sidecar[anchor];
    if (source) return `${source.permalinkBase}/${url.replace(/^specs\//, "")}`;
    return url;
  };

  return {
    configured: { specLink: specLinks.configured, description: descriptions.configured, calculatedFrom: calculatedFrom.configured },
    specLinkIds: Object.keys(specLinks.data),
    descriptionIds: Object.keys(descriptions.data),
    specLinksFor: (id) => (specLinks.data[id] || []).map((r) => ({ section: r.section, url: r.url, permalink: permalink(r.url) })),
    descriptionFor: (id) => descriptions.data[id] || null,
    // The rule (`<Module>.<rule>`) that produces a calculation field, or null for a reported one.
    calculatedFromFor: (id) => calculatedFrom.data[id] || null,
    calculatedFromIds: Object.keys(calculatedFrom.data),
    // The business domain that owns an entity type, or null.
    domainFor: (id) => domains.data[id] || null,
    permalink,
  };
}

// Everything known about one table column: its description, spec links, and (for a choice)
// the description of each value.
function columnAnnotation(index, deco, entityType, column) {
  if (column.generated) return { nodeId: null, description: "Record ID: a generated identifier for the record (not part of the policy).", specLinks: [], values: [] };
  const id = fieldNodeId(index, entityType, column.path);
  const ct = ir.isEnum(index, column.tpe) ? ir.customTypeOf(index, column.tpe) : null;
  return {
    nodeId: id,
    description: id ? deco.descriptionFor(id) : null,
    specLinks: id ? deco.specLinksFor(id) : [],
    values: ct
      ? ct.constructors.map(([n]) => {
          const vid = childId(typeId(ct.fqn), n);
          return { name: ir.toTitle(n), nodeId: vid, description: deco.descriptionFor(vid), specLinks: deco.specLinksFor(vid) };
        })
      : [],
  };
}

// One-line text for a database comment or catalog description.
function annotationText({ description, specLinks = [], values = [] }) {
  const parts = [];
  if (description) parts.push(description.replace(/\s+/g, " ").trim());
  const described = values.filter((v) => v.description);
  if (described.length) parts.push(`Values: ${described.map((v) => `${v.name} = ${v.description.replace(/\s+/g, " ").trim().replace(/\.$/, "")}`).join("; ")}.`);
  if (specLinks.length) parts.push(`Source: ${specLinks.map((r) => `${r.section} <${r.permalink}>`).join("; ")}.`);
  return parts.join(" ");
}

module.exports = { columnAnnotation, annotationText, ENTRY_POINTS, DECORATIONS_IR, typeId, valueId, childId, nodesOf, fieldNodeId, loadDecorations };
