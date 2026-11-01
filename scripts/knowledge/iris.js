// One IRI per business concept, shared by the ontology, the SKOS glossary and DataHub, so an
// alignment made in one (e.g. to FIBO) refers to the same concept in the others. IRIs are
// slash-separated: DataHub's RDF source builds glossary URNs from the IRI path and ignores
// fragments, so `#` IRIs would collapse into one term.
//
//   type    <base>Scra/Types/MilitaryStatus
//   value   <base>Scra/Types/MilitaryStatus/ActiveDuty
//   field   <base>Scra/Types/CardAccount/militaryStatus
//   measure <base>Lcr/Outflows/RetailDeposits/totalOutflowAmount   (an aggregate rule)

// Morphir modules are often named after the type they hold (Fields.CollateralClass contains
// type CollateralClass), which doubles the name: Fields.CollateralClass.CollateralClass. The
// business path drops the repeat, ignoring case: Fields.CollateralClass. The exact Morphir
// name stays on each concept (skos:notation, morphirType) so the mapping back is lossless.
const businessPath = (modulePath, name) =>
  modulePath.length && modulePath[modulePath.length - 1].toLowerCase() === name.toLowerCase() ? [...modulePath.slice(0, -1), name] : [...modulePath, name];

const defaultBase = (model) => `https://ontology.${model.packageName.toLowerCase().replace(/\W+/g, "-")}.example/policy/`;

function conceptIris(model, baseIri) {
  const base = (baseIri || defaultBase(model)).replace(/[#/]?$/, "/");
  const typePath = (t) => businessPath(t.module.split("."), t.name).join("/");
  const iri = (...segments) => `${base}${segments.join("/")}`;
  return {
    base,
    ontology: base.replace(/\/$/, ""),
    type: (t) => iri(typePath(t)),
    value: (t, value) => iri(typePath(t), value),
    member: (t, name) => iri(typePath(t), name),
    rule: (r) => {
      const parts = r.rule.split(".");
      return iri(...businessPath(parts.slice(0, -1), parts[parts.length - 1]));
    },
    // The glossary term URN DataHub's RDF source derives from an IRI: host and path
    // segments joined with dots.
    termUrn: (conceptIri) => {
      const u = new URL(conceptIri);
      return `urn:li:glossaryTerm:${[u.hostname, ...u.pathname.split("/").filter(Boolean)].join(".")}`;
    },
  };
}

module.exports = { conceptIris, businessPath };
