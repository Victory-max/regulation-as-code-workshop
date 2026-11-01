// Shared view of a verified Morphir model for the knowledge generators: entity tables, rule
// views (with docs and column lineage), business types, and spec links.

const fs = require("fs");
const path = require("path");
const ir = require("../lib/morphir-ir");
const { entityTables } = require("../morphir-to-ddl");
const { emitSql } = require("../morphir-to-sql");
const deco = require("../lib/decorations");

const nodeId = (fqn, kind) => `${ir.pathToString(fqn[0])}:${ir.pathToString(fqn[1])}:${ir.toCamel(fqn[2])}.${kind}`;

// "militaryStatus" / ["military","status"] -> "Military status". A letter after a number
// joins it ("level 2 a" -> "Level 2A"), and words written in capitals in the given text keep
// that casing ("hqla amount" with a doc saying "HQLA" -> "HQLA amount").
const humanize = (name, text = "") => {
  const words = (Array.isArray(name) ? name : String(name).split("_")).map(String);
  const caps = new Set((String(text).match(/\b[A-Z]{2,}\b/g) || []).map((w) => w.toLowerCase()));
  const out = [];
  for (const w of words) {
    if (/^[a-z]$/.test(w) && out.length && /\d$/.test(out[out.length - 1])) out[out.length - 1] += w.toUpperCase();
    else out.push(caps.has(w.toLowerCase()) ? w.toUpperCase() : w);
  }
  const s = out.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Business description of a column or output type.
function describeType(index, tpe) {
  const ct = ir.customTypeOf(index, tpe);
  if (ct && ir.isEnum(index, tpe)) {
    const entry = index.types.get(ir.fqnKey(ct.fqn));
    return { kind: "choice", typeName: ir.toTitle(ct.fqn[2]), fqn: ct.fqn, values: ct.constructors.map(([n]) => ir.toTitle(n)), doc: entry.doc.trim() };
  }
  const key = ir.sdkTypeKey(index, tpe);
  const kinds = {
    [ir.SDK.decimal]: "decimal",
    [ir.SDK.int]: "integer",
    [ir.SDK.float]: "float",
    [ir.SDK.bool]: "boolean",
    [ir.SDK.string]: "text",
    [ir.SDK.localDate]: "date",
  };
  return { kind: kinds[key] || "text" };
}

function loadModel({ irPath, projectDir = "." }) {
  const index = ir.indexIr(ir.loadIr(irPath));
  const decorations = deco.loadDecorations(projectDir);
  const specLinksFor = decorations.specLinksFor;
  const { manifest } = emitSql(index, { dialect: "duckdb", materialize: false, temporal: true, decorations });

  const tables = entityTables(index).map((t) => ({
    ...t,
    title: humanize(ir.aliasName(t.entityType)),
    specLinks: specLinksFor(nodeId(t.entityType[2], "type")),
    columns: t.columns.map((c) => {
      const a = deco.columnAnnotation(index, decorations, t.entityType, c);
      return { ...c, title: humanize(c.path.flat()), type: describeType(index, c.tpe), description: a.description, specLinks: a.specLinks, values: a.values, nodeId: a.nodeId };
    }),
  }));

  const rules = manifest.rules.map((r) => {
    const { def } = index.values.get(ir.fqnKey(r.fqn));
    const fields = ir.recordFieldsOf(index, def.outputType);
    return {
      ...r,
      name: ir.toCamel(r.fqn[2]),
      title: humanize(r.fqn[2], r.doc),
      specLinks: specLinksFor(nodeId(r.fqn, "value")),
      def,
      outputs: r.outputs.map((o, i) => {
        const fieldId = fields && def.outputType[0] === "Reference" ? deco.childId(deco.typeId(def.outputType[2]), fields[i].name) : null;
        return {
          ...o,
          title: humanize(o.column.split("_")),
          type: describeType(index, fields ? fields[i].tpe : def.outputType),
          description: fieldId ? decorations.descriptionFor(fieldId) : null,
          specLinks: fieldId ? specLinksFor(fieldId) : [],
        };
      }),
    };
  });

  // Business types worth a glossary entry: every type in the model.
  const types = [...index.types.values()].map((t) => ({
    fqn: t.fqn,
    name: ir.toTitle(t.fqn[2]),
    module: ir.pathToString(t.fqn[1]),
    doc: t.doc.trim(),
    kind: t.def[0] === "CustomTypeDefinition" ? "choice" : "record",
    values: t.def[0] === "CustomTypeDefinition" ? t.def[2].value.map(([n]) => ir.toTitle(n)) : [],
    valueInfo:
      t.def[0] === "CustomTypeDefinition"
        ? t.def[2].value.map(([n]) => {
            const id = deco.childId(deco.typeId(t.fqn), n);
            return { name: ir.toTitle(n), description: decorations.descriptionFor(id), specLinks: specLinksFor(id) };
          })
        : [],
    fields:
      t.def[0] === "TypeAliasDefinition" && t.def[2][0] === "Record"
        ? t.def[2][2].map((f) => {
            const id = deco.childId(deco.typeId(t.fqn), f.name);
            return { name: ir.toCamel(f.name), tpe: f.tpe, description: decorations.descriptionFor(id), specLinks: specLinksFor(id) };
          })
        : [],
    specLinks: specLinksFor(nodeId(t.fqn, "type")),
  }));

  return { index, ir, decorations, annotationText: deco.annotationText, packageName: ir.pathToString(index.packagePath), tables, rules, types, nodeId, humanize, describeType };
}

module.exports = { loadModel };
