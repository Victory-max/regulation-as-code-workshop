// Helpers for reading Morphir IR (formatVersion 3, as written by `morphir-elm make`).
//
// The IR is tagged-array JSON: every node is ["Tag", attributes, ...children].
//   Name:  ["available", "funds"]                       (lower-case words)
//   Path:  [["fiction"], ["bank"]]                       (list of names)
//   FQName: [packagePath, modulePath, localName]
// Value nodes carry their inferred type as the attribute slot, which the
// transpilers use to tell Decimal arithmetic from Int/Float arithmetic.

const fs = require("fs");

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

const toSnake = (name) => name.join("_");
const toCamel = (name) => name.map((w, i) => (i === 0 ? w : cap(w))).join("");
const toTitle = (name) => name.map(cap).join("");
const pathToString = (path, sep = ".") => path.map(toTitle).join(sep);

// "morphir.sdk:decimal:add" style key, used to look up SDK functions and types.
const fqnKey = ([pkg, mod, local]) =>
  `${pkg.map((n) => n.join("")).join(".")}:${mod.map(toSnake).join(".")}:${toSnake(local)}`;

const fqnDisplay = ([, mod, local]) => `${pathToString(mod)}.${toCamel(local)}`;

function loadIr(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Morphir IR not found at ${file}. Run \`morphir-elm make\` first.`);
  }
  const ir = JSON.parse(fs.readFileSync(file, "utf8"));
  if (ir.formatVersion !== 3 || !Array.isArray(ir.distribution) || ir.distribution[0] !== "Library") {
    throw new Error(`${file} is not a Morphir IR (formatVersion 3) library distribution.`);
  }
  return ir;
}

// Flattens the distribution into lookup tables keyed by fqnKey.
function indexIr(ir) {
  const [, packagePath, , pkgDef] = ir.distribution;
  const types = new Map();
  const values = new Map();
  for (const [modulePath, moduleDef] of pkgDef.modules) {
    const mod = moduleDef.value;
    for (const [name, typeDef] of mod.types) {
      const fqn = [packagePath, modulePath, name];
      types.set(fqnKey(fqn), { fqn, access: typeDef.access, doc: typeDef.value.doc, def: typeDef.value.value });
    }
    for (const [name, valueDef] of mod.values) {
      const fqn = [packagePath, modulePath, name];
      values.set(fqnKey(fqn), { fqn, access: valueDef.access, doc: valueDef.value.doc, def: valueDef.value.value });
    }
  }
  return { packagePath, types, values };
}

// Resolves a type through aliases until it is a record, a custom type, or an SDK type.
function resolveType(index, tpe) {
  if (tpe[0] !== "Reference") return tpe;
  const entry = index.types.get(fqnKey(tpe[2]));
  if (entry && entry.def[0] === "TypeAliasDefinition") return resolveType(index, entry.def[2]);
  return tpe;
}

function customTypeOf(index, tpe) {
  const resolved = resolveType(index, tpe);
  if (resolved[0] !== "Reference") return null;
  const entry = index.types.get(fqnKey(resolved[2]));
  if (!entry || entry.def[0] !== "CustomTypeDefinition") return null;
  return { fqn: entry.fqn, constructors: entry.def[2].value };
}

// A custom type whose constructors carry no arguments maps to a SQL ENUM.
function isEnum(index, tpe) {
  const ct = customTypeOf(index, tpe);
  return !!ct && ct.constructors.every(([, args]) => args.length === 0);
}

function recordFieldsOf(index, tpe) {
  const resolved = resolveType(index, tpe);
  return resolved[0] === "Record" ? resolved[2] : null;
}

// Name of the alias that a record type was declared with (for table naming).
function aliasName(tpe) {
  return tpe[0] === "Reference" ? tpe[2][2] : null;
}

function sdkTypeKey(index, tpe) {
  const resolved = resolveType(index, tpe);
  return resolved[0] === "Reference" ? fqnKey(resolved[2]) : null;
}

const SDK = {
  decimal: "morphir.sdk:decimal:decimal",
  int: "morphir.sdk:basics:int",
  float: "morphir.sdk:basics:float",
  bool: "morphir.sdk:basics:bool",
  string: "morphir.sdk:string:string",
  char: "morphir.sdk:char:char",
  localDate: "morphir.sdk:local_date:local_date",
  localTime: "morphir.sdk:local_time:local_time",
  maybe: "morphir.sdk:maybe:maybe",
  list: "morphir.sdk:list:list",
};

module.exports = {
  toSnake,
  toCamel,
  toTitle,
  pathToString,
  fqnKey,
  fqnDisplay,
  loadIr,
  indexIr,
  resolveType,
  customTypeOf,
  isEnum,
  recordFieldsOf,
  aliasName,
  sdkTypeKey,
  SDK,
};
