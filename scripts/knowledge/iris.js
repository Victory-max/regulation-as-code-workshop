// One Morphir node, one IRI, one DataHub URN. Types and functions are identified by their FQN,
// fields and choice values by their type's FQN plus their name; each gets exactly one IRI, used
// by the ontology, the SKOS glossary and DataHub alike, so an alignment made in one (e.g. to
// FIBO) refers to the same concept in the others. A field has no FQN of its own, so it takes
// the concept of what defines it: the function that fills it, for a calculated field
// (calculatedFrom); else its declared type, when that is one of the policy's own named types
// (AssetRecord.collateralClass is the CollateralClass field definition). A field of a core
// Morphir type (Decimal, String, ...) is no concept at all: member() returns null for it, and it
// gets no glossary term.
// checkUnique() fails if two distinct nodes would ever share an IRI. IRIs are slash-separated:
// DataHub's RDF source builds glossary URNs from the IRI path and ignores fragments.
//
//   type    <base>Scra/Types/MilitaryStatus
//   value   <base>Scra/Types/MilitaryStatus/ActiveDuty
//   field   <base>Scra/Types/CardAccount/militaryStatus
//   measure <base>Lrr/Outflows/RetailDeposits/totalRetailOutflows   (an aggregate rule)

// Morphir modules are often named after the type they hold (Fields.CollateralClass contains
// type CollateralClass), which doubles the name: Fields.CollateralClass.CollateralClass. The
// business path drops the repeat, ignoring case: Fields.CollateralClass. The exact Morphir
// name stays on each concept (skos:notation, morphirType) so the mapping back is lossless.
const businessPath = (modulePath, name) =>
  modulePath.length && modulePath[modulePath.length - 1].toLowerCase() === name.toLowerCase() ? [...modulePath.slice(0, -1), name] : [...modulePath, name];

// The record-keeping columns every policy table has (bitemporal versions and adjustments), as
// glossary terms of their own: [column, term name, label, definition].
const RECORD_KEEPING = [
  ["record_id", "recordId", "Record ID", "A generated identifier for a record whose policy model doesn't define one of its own."],
  ["valid_from", "validFrom", "Valid from", "Business time: the first date this version of the record is true for."],
  ["valid_to", "validTo", "Valid to", "Business time: the date this version stops being true (9999-12-31 while current)."],
  ["recorded_at", "recordedAt", "Recorded at", "System time: when the bank recorded this version. A later recording of the same dates supersedes it; both are kept."],
  ["record_source", "recordSource", "Record source", "Where a version came from: source (the source system) or adjustment (a manual correction)."],
  ["adjustment_id", "adjustmentId", "Adjustment ID", "Identifies a manual correction, recorded in the table's adjustments companion."],
  ["reason", "adjustmentReason", "Adjustment reason", "Why a manual correction was made."],
  ["adjusted_by", "adjustedBy", "Adjusted by", "Who made a manual correction."],
];

const defaultBase = (model) => `https://ontology.${model.packageName.toLowerCase().replace(/\W+/g, "-")}.example/policy/`;

function conceptIris(model, baseIri) {
  const base = (baseIri || defaultBase(model)).replace(/[#/]?$/, "/");
  const typePath = (t) => businessPath(t.module.split("."), t.name).join("/");
  const iri = (...segments) => `${base}${segments.join("/")}`;
  const rule = (r) => {
    const parts = r.rule.split(".");
    return iri(...businessPath(parts.slice(0, -1), parts[parts.length - 1]));
  };
  // A calculated field (calculatedFrom) is the concept of the rule that fills it: the LRR
  // calculation's stockOfEligibleLiquidAssets is the stock of eligible liquid assets, not a second term of the same name.
  const calculatedField = new Map();
  for (const t of model.tables || []) {
    if (!t.feed) continue;
    const type = model.types.find((x) => JSON.stringify(x.fqn) === JSON.stringify(t.entityType[2]));
    for (const c of t.feed.calculated) {
      const column = t.columns.find((x) => x.name === c.column);
      const source = model.rules.find((x) => x.rule === c.rule);
      if (type && column && source) calculatedField.set(`${iri(typePath(type))}|${column.path[0].map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("")}`, rule(source));
    }
  }
  // Fields declared with one of the policy's own named types: that type's concept.
  const typedField = new Map();
  for (const t of model.types) {
    for (const f of t.fields || []) {
      const named = f.tpe && f.tpe[0] === "Reference" && model.types.find((x) => JSON.stringify(x.fqn) === JSON.stringify(f.tpe[2]));
      if (named) typedField.set(`${iri(typePath(t))}|${f.name}`, iri(typePath(named)));
    }
  }
  const member = (t, name) => calculatedField.get(`${iri(typePath(t))}|${name}`) || typedField.get(`${iri(typePath(t))}|${name}`) || null;
  return {
    base,
    ontology: base.replace(/\/$/, ""),
    type: (t) => iri(typePath(t)),
    value: (t, value) => iri(typePath(t), value),
    member,
    // A field as an ontology property (structure, not a glossary term): always its own path.
    fieldProperty: (t, name) => iri(typePath(t), name),
    rule,
    recordKeeping: (name) => iri("RecordKeeping", name),
    // Fails when two distinct Morphir nodes would share an IRI (and so a glossary term).
    // Fields that take their function's or type's concept are excluded: sharing is the point.
    checkUnique: () => {
      const owner = new Map();
      const claim = (node, target) => {
        if (owner.has(target) && owner.get(target) !== node) throw new Error(`Morphir nodes ${owner.get(target)} and ${node} would share the IRI ${target}`);
        owner.set(target, node);
      };
      for (const t of model.types) {
        claim(`${t.module}.${t.name}`, iri(typePath(t)));
        for (const v of t.valueInfo) claim(`${t.module}.${t.name}#${v.name}`, iri(typePath(t), v.name));

      }
      for (const r of model.rules) claim(r.rule, rule(r));
    },
    // Every concept the glossary holds: types, their values and fields, rules, record keeping.
    concepts: () => {
      const all = [];
      for (const t of model.types) {
        all.push(iri(typePath(t)));
        for (const v of t.valueInfo) all.push(iri(typePath(t), v.name));
        for (const f of t.fields) if (member(t, f.name)) all.push(member(t, f.name));
      }
      for (const r of model.rules) all.push(rule(r));
      for (const [, name] of RECORD_KEEPING) all.push(iri("RecordKeeping", name));
      return [...new Set(all)];
    },
    // The glossary term URN DataHub's RDF source derives from an IRI: host and path
    // segments joined with dots.
    termUrn: (conceptIri) => {
      const u = new URL(conceptIri);
      return `urn:li:glossaryTerm:${[u.hostname, ...u.pathname.split("/").filter(Boolean)].join(".")}`;
    },
  };
}

module.exports = { conceptIris, businessPath, RECORD_KEEPING };
