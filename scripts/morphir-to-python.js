#!/usr/bin/env node
// Generates readable Python from a verified Morphir model: one function per policy definition,
// with its business description and regulation sections as the docstring, plus a small harness
// that runs every rule over the database's current records and compares the results with the
// database's own rule views (SQL generated from the same model).
//
//   node scripts/morphir-to-python.js [--ir morphir-ir.json] [--project .] [--out out/policy_rules.py]
//
// Library use: const { emitPython } = require("./morphir-to-python")
//
// Mapping: records -> Record (attribute access), choices -> their case name as a string (as stored
// in the database), Decimal -> decimal.Decimal, Maybe -> None or the value, case expressions ->
// match statements. Nothing here is specific to a model.

const fs = require("fs");
const path = require("path");
const ir = require("./lib/morphir-ir");
const { entityTables } = require("./morphir-to-ddl");
const { emitSql } = require("./morphir-to-sql");
const { loadDecorations } = require("./lib/decorations");

class Unsupported extends Error {}

const PY_RESERVED = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield", "match", "case", "type",
  // names the generated module itself uses
  "Decimal", "Record", "foldl", "decimal_from_string", "div_with_default", "div_maybe", "round_half_even", "truncate", "with_default",
  "maybe_map", "sum", "min", "max", "len", "list", "map", "filter", "abs", "float", "int", "str", "round",
]);
const safe = (name) => (PY_RESERVED.has(name) ? `${name}_` : name);
const snake = (name) => safe(ir.toSnake(name));
const pyStr = (s) => JSON.stringify(String(s));

// Decimal.hundredth 5 -> Decimal('0.05'), computed exactly on the literal's digits.
const DECIMAL_EXPONENT = {
  "morphir.sdk:decimal:from_int": 0, "morphir.sdk:decimal:hundred": 2, "morphir.sdk:decimal:thousand": 3,
  "morphir.sdk:decimal:million": 6, "morphir.sdk:decimal:tenth": -1, "morphir.sdk:decimal:hundredth": -2,
  "morphir.sdk:decimal:thousandth": -3, "morphir.sdk:decimal:bps": -4, "morphir.sdk:decimal:millionth": -6,
};
function decimalLiteral(key, arg) {
  if (!(key in DECIMAL_EXPONENT) || arg[0] !== "Literal" || arg[2][0] !== "WholeNumberLiteral") return null;
  const exp = DECIMAL_EXPONENT[key];
  const n = BigInt(arg[2][1]);
  const neg = n < 0n;
  let digits = (neg ? -n : n).toString();
  if (exp >= 0) digits += "0".repeat(exp);
  else {
    digits = digits.padStart(-exp + 1, "0");
    digits = `${digits.slice(0, exp)}.${digits.slice(exp)}`.replace(/\.?0+$/, "");
  }
  return `Decimal(${pyStr(`${neg ? "-" : ""}${digits}`)})`;
}

const op = (o) => (a, b) => `(${a} ${o} ${b})`;
// SDK functions: key -> [arity, (python args...) => python expression].
const SDK = {
  "morphir.sdk:basics:add": [2, op("+")], "morphir.sdk:basics:subtract": [2, op("-")], "morphir.sdk:basics:multiply": [2, op("*")],
  "morphir.sdk:basics:divide": [2, op("/")], "morphir.sdk:basics:integer_divide": [2, op("//")],
  "morphir.sdk:basics:negate": [1, (a) => `(-${a})`], "morphir.sdk:basics:abs": [1, (a) => `abs(${a})`],
  "morphir.sdk:basics:min": [2, (a, b) => `min(${a}, ${b})`], "morphir.sdk:basics:max": [2, (a, b) => `max(${a}, ${b})`],
  "morphir.sdk:basics:equal": [2, op("==")], "morphir.sdk:basics:not_equal": [2, op("!=")],
  "morphir.sdk:basics:less_than": [2, op("<")], "morphir.sdk:basics:greater_than": [2, op(">")],
  "morphir.sdk:basics:less_than_or_equal": [2, op("<=")], "morphir.sdk:basics:greater_than_or_equal": [2, op(">=")],
  "morphir.sdk:basics:and": [2, op("and")], "morphir.sdk:basics:or": [2, op("or")], "morphir.sdk:basics:not": [1, (a) => `(not ${a})`],
  "morphir.sdk:basics:to_float": [1, (a) => `float(${a})`], "morphir.sdk:basics:round": [1, (a) => `round(${a})`],
  "morphir.sdk:basics:floor": [1, (a) => `int(${a} // 1)`], "morphir.sdk:basics:ceiling": [1, (a) => `int(-(-${a} // 1))`],
  "morphir.sdk:decimal:from_int": [1, (a) => `Decimal(${a})`], "morphir.sdk:decimal:from_string": [1, (a) => `decimal_from_string(${a})`],
  "morphir.sdk:decimal:from_float": [1, (a) => `Decimal(str(${a}))`],
  "morphir.sdk:decimal:hundred": [1, (a) => `(Decimal(${a}) * 100)`], "morphir.sdk:decimal:thousand": [1, (a) => `(Decimal(${a}) * 1000)`],
  "morphir.sdk:decimal:million": [1, (a) => `(Decimal(${a}) * 1000000)`], "morphir.sdk:decimal:tenth": [1, (a) => `(Decimal(${a}) / 10)`],
  "morphir.sdk:decimal:hundredth": [1, (a) => `(Decimal(${a}) / 100)`], "morphir.sdk:decimal:thousandth": [1, (a) => `(Decimal(${a}) / 1000)`],
  "morphir.sdk:decimal:bps": [1, (a) => `(Decimal(${a}) / 10000)`], "morphir.sdk:decimal:millionth": [1, (a) => `(Decimal(${a}) / 1000000)`],
  "morphir.sdk:decimal:add": [2, op("+")], "morphir.sdk:decimal:sub": [2, op("-")], "morphir.sdk:decimal:mul": [2, op("*")],
  "morphir.sdk:decimal:div": [2, (a, b) => `div_maybe(${a}, ${b})`],
  "morphir.sdk:decimal:div_with_default": [3, (d, a, b) => `div_with_default(${d}, ${a}, ${b})`],
  "morphir.sdk:decimal:negate": [1, (a) => `(-${a})`], "morphir.sdk:decimal:abs": [1, (a) => `abs(${a})`],
  "morphir.sdk:decimal:round": [1, (a) => `round_half_even(${a})`], "morphir.sdk:decimal:truncate": [1, (a) => `truncate(${a})`],
  "morphir.sdk:decimal:shift_decimal_left": [2, (n, a) => `${a}.scaleb(-${n})`],
  "morphir.sdk:decimal:shift_decimal_right": [2, (n, a) => `${a}.scaleb(${n})`],
  "morphir.sdk:decimal:eq": [2, op("==")], "morphir.sdk:decimal:neq": [2, op("!=")], "morphir.sdk:decimal:lt": [2, op("<")],
  "morphir.sdk:decimal:lte": [2, op("<=")], "morphir.sdk:decimal:gt": [2, op(">")], "morphir.sdk:decimal:gte": [2, op(">=")],
  "morphir.sdk:decimal:zero": [0, () => "Decimal(0)"], "morphir.sdk:decimal:one": [0, () => "Decimal(1)"],
  "morphir.sdk:decimal:minus_one": [0, () => "Decimal(-1)"],
  "morphir.sdk:string:append": [2, op("+")], "morphir.sdk:string:to_upper": [1, (a) => `${a}.upper()`],
  "morphir.sdk:string:to_lower": [1, (a) => `${a}.lower()`], "morphir.sdk:string:length": [1, (a) => `len(${a})`],
  "morphir.sdk:list:foldl": [3, (f, init, xs) => `foldl(${f}, ${init}, ${xs})`], "morphir.sdk:list:length": [1, (xs) => `len(${xs})`],
  "morphir.sdk:list:sum": [1, (xs) => `sum(${xs})`], "morphir.sdk:list:map": [2, (f, xs) => `list(map(${f}, ${xs}))`],
  "morphir.sdk:list:filter": [2, (f, xs) => `list(filter(${f}, ${xs}))`],
  "morphir.sdk:maybe:with_default": [2, (d, m) => `with_default(${d}, ${m})`],
  "morphir.sdk:maybe:map": [2, (f, m) => `maybe_map(${f}, ${m})`],
};

function flattenApply(expr) {
  const args = [];
  while (expr[0] === "Apply") {
    args.unshift(expr[3]);
    expr = expr[2];
  }
  return { head: expr, args };
}

function makeEmitter(index, names) {
  let tmp = 0;
  const fresh = (base) => `_${base}${++tmp}`;

  // A block of Python statements at one indentation.
  const block = (indent) => ({ indent, lines: [] });
  const say = (b, line) => b.lines.push(`${"    ".repeat(b.indent)}${line}`);

  function patternNames(pattern, env) {
    switch (pattern[0]) {
      case "AsPattern": {
        const name = snake(pattern[3]);
        return { env: patternNames(pattern[2], { ...env, [ir.toSnake(pattern[3])]: name }).env, name };
      }
      case "WildcardPattern":
        return { env, name: "_" };
      case "UnitPattern":
        return { env, name: "_" };
      default:
        throw new Unsupported(`pattern ${pattern[0]}`);
    }
  }

  function reference(fqn, argExprs, b, env) {
    const key = ir.fqnKey(fqn);
    const local = index.values.get(key);
    if (local) {
      const fn = names.get(key);
      const arity = local.def.inputTypes.length;
      const args = argExprs.map((a) => expr(a, b, env));
      if (arity === 0) return args.length ? `${fn}()(${args.join(", ")})` : `${fn}()`;
      if (args.length === 0) return fn;
      if (args.length < arity) return `(lambda *rest: ${fn}(${[...args, "*rest"].join(", ")}))`;
      const call = `${fn}(${args.slice(0, arity).join(", ")})`;
      return args.length > arity ? `${call}(${args.slice(arity).join(", ")})` : call;
    }
    if (argExprs.length === 1) {
      const lit = decimalLiteral(key, argExprs[0]);
      if (lit) return lit;
    }
    const sdk = SDK[key];
    if (!sdk) throw new Unsupported(`${ir.fqnDisplay(fqn)} has no Python translation yet`);
    const [arity, f] = sdk;
    if (key === "morphir.sdk:decimal:shift_decimal_left" && argExprs.length === 2 && argExprs[0][0] === "Literal") {
      // Shifting by a literal: an exact power of ten.
      return `${expr(argExprs[1], b, env)}.scaleb(-${argExprs[0][2][1]})`;
    }
    const args = argExprs.map((a) => expr(a, b, env));
    if (args.length < arity) {
      const rest = Array.from({ length: arity - args.length }, (_, i) => `_a${i}`);
      return `(lambda ${rest.join(", ")}: ${f(...args, ...rest)})`;
    }
    return f(...args);
  }

  function constructor(fqn, argExprs, b, env) {
    const key = ir.fqnKey(fqn);
    if (key === "morphir.sdk:maybe:nothing") return "None";
    if (key === "morphir.sdk:maybe:just") return expr(argExprs[0], b, env);
    if (argExprs.length) throw new Unsupported(`constructor ${ir.fqnDisplay(fqn)} with arguments`);
    return pyStr(ir.toTitle(fqn[2]));
  }

  function literal([tag, value]) {
    switch (tag) {
      case "BoolLiteral":
        return value ? "True" : "False";
      case "StringLiteral":
      case "CharLiteral":
        return pyStr(value);
      case "WholeNumberLiteral":
      case "FloatLiteral":
        return String(value);
      case "DecimalLiteral":
        return `Decimal(${pyStr(value)})`;
      default:
        throw new Unsupported(`literal ${tag}`);
    }
  }

  // Compiles a sub-expression in a scratch block; statements it needs go before `b`'s next line.
  function inScratch(e, b, env) {
    const s = block(b.indent);
    const out = expr(e, s, env);
    return { out, lines: s.lines };
  }

  // An expression; may emit statements into `b` first (for case tables and let bindings).
  function expr(e, b, env) {
    switch (e[0]) {
      case "Literal":
        return literal(e[2]);
      case "Variable": {
        const v = env[ir.toSnake(e[2])];
        if (!v) throw new Unsupported(`unbound variable ${ir.toCamel(e[2])}`);
        return v;
      }
      case "Reference":
        return reference(e[2], [], b, env);
      case "Constructor":
        return constructor(e[2], [], b, env);
      case "Apply": {
        const { head, args } = flattenApply(e);
        if (head[0] === "Reference") return reference(head[2], args, b, env);
        if (head[0] === "Constructor") return constructor(head[2], args, b, env);
        return `${expr(head, b, env)}(${args.map((a) => expr(a, b, env)).join(", ")})`;
      }
      case "Lambda": {
        // \a b -> body  ==>  lambda a, b: body   (or a local def when the body needs statements)
        const params = [];
        let fenv = env;
        let body = e;
        while (body[0] === "Lambda") {
          const p = patternNames(body[2], fenv);
          fenv = p.env;
          params.push(p.name);
          body = body[3];
        }
        const inner = inScratch(body, b, fenv);
        if (inner.lines.length === 0) return `(lambda ${params.join(", ")}: ${inner.out})`;
        const name = fresh("f");
        say(b, `def ${name}(${params.join(", ")}):`);
        tail(body, block(b.indent + 1), fenv, b);
        return name;
      }
      case "Field":
        return `${expr(e[2], b, env)}.${snake(e[3])}`;
      case "FieldFunction":
        return `(lambda _r: _r.${snake(e[2])})`;
      case "Record":
        return `Record(${e[2].map(([n, v]) => `${snake(n)}=${expr(v, b, env)}`).join(", ")})`;
      case "IfThenElse": {
        const c = expr(e[2], b, env);
        const t = inScratch(e[3], b, env);
        const f = inScratch(e[4], b, env);
        if (!t.lines.length && !f.lines.length) return `(${t.out} if ${c} else ${f.out})`;
        const v = fresh("v");
        say(b, `if ${c}:`);
        assign(e[3], v, block(b.indent + 1), env, b);
        say(b, "else:");
        assign(e[4], v, block(b.indent + 1), env, b);
        return v;
      }
      case "PatternMatch": {
        const v = fresh("v");
        matchStatement(e, b, env, (body, inner, caseEnv) => assign(body, v, inner, caseEnv || env, null));
        return v;
      }
      case "LetDefinition":
        bindLet(e, b, env);
        return expr(e[4], b, { ...env, [ir.toSnake(e[2])]: snake(e[2]) });
      case "Destructure": {
        const p = patternNames(e[2], env);
        say(b, `${p.name} = ${expr(e[3], b, env)}`);
        return expr(e[4], b, p.env);
      }
      default:
        throw new Unsupported(`${e[0]} expressions`);
    }
  }

  function bindLet(e, b, env) {
    const [, , name, def] = e;
    const py = snake(name);
    if (def.inputTypes.length === 0) {
      say(b, `${py} = ${expr(def.body, b, env)}`);
      return;
    }
    let fenv = { ...env, [ir.toSnake(name)]: py };
    const params = def.inputTypes.map(([n]) => {
      fenv = { ...fenv, [ir.toSnake(n)]: snake(n) };
      return snake(n);
    });
    say(b, `def ${py}(${params.join(", ")}):`);
    tail(def.body, block(b.indent + 1), fenv, b);
  }

  // match <subject>: one case per pattern; `branch(body, innerBlock)` writes each case's body.
  function matchStatement(e, b, env, branch) {
    let subject = expr(e[2], b, env);
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(subject)) {
      const s = fresh("s");
      say(b, `${s} = ${subject}`);
      subject = s;
    }
    say(b, `match ${subject}:`);
    for (const [pattern, body] of e[3]) {
      let p = pattern;
      let caseEnv = env;
      if (p[0] === "AsPattern") {
        caseEnv = { ...env, [ir.toSnake(p[3])]: subject };
        p = p[2];
      }
      let label;
      if (p[0] === "WildcardPattern") label = "_";
      else if (p[0] === "ConstructorPattern" && p[3].length === 0) label = pyStr(ir.toTitle(p[2][2]));
      else if (p[0] === "LiteralPattern") label = literal(p[2]);
      else throw new Unsupported(`case pattern ${p[0]}`);
      b.lines.push(`${"    ".repeat(b.indent + 1)}case ${label}:`);
      const inner = block(b.indent + 2);
      branch(body, inner, caseEnv);
      b.lines.push(...inner.lines);
      if (label === "_") break;
    }
  }

  // Writes `target = <e>` into `inner`, then appends inner's lines to `outer`.
  function assign(e, target, inner, env, outer) {
    const v = expr(e, inner, env);
    say(inner, `${target} = ${v}`);
    if (outer) {
      outer.lines.push(...inner.lines);
      inner.lines.length = 0;
    }
  }

  // Writes the statements that return <e> into `inner`, then appends them to `outer`.
  function tail(e, inner, env, outer) {
    switch (e[0]) {
      case "PatternMatch":
        matchStatement(e, inner, env, (body, caseBlock, caseEnv) => tail(body, caseBlock, caseEnv || env, null));
        break;
      case "IfThenElse": {
        say(inner, `if ${expr(e[2], inner, env)}:`);
        tail(e[3], block(inner.indent + 1), env, inner);
        let rest = e[4];
        while (rest[0] === "IfThenElse") {
          const c = inScratch(rest[2], inner, env);
          if (c.lines.length) break;
          say(inner, `elif ${c.out}:`);
          tail(rest[3], block(inner.indent + 1), env, inner);
          rest = rest[4];
        }
        say(inner, "else:");
        tail(rest, block(inner.indent + 1), env, inner);
        break;
      }
      case "LetDefinition":
        bindLet(e, inner, env);
        tail(e[4], inner, { ...env, [ir.toSnake(e[2])]: snake(e[2]) }, null);
        break;
      case "Destructure": {
        const p = patternNames(e[2], env);
        say(inner, `${p.name} = ${expr(e[3], inner, env)}`);
        tail(e[4], inner, p.env, null);
        break;
      }
      default:
        say(inner, `return ${expr(e, inner, env)}`);
    }
    if (outer) {
      outer.lines.push(...inner.lines);
      inner.lines.length = 0;
    }
  }

  // One module-level function per definition.
  function definition(fqn, def, doc) {
    const key = ir.fqnKey(fqn);
    const env = {};
    const params = def.inputTypes.map(([n]) => {
      env[ir.toSnake(n)] = snake(n);
      return snake(n);
    });
    const b = block(1);
    tail(def.body, b, env, null);
    const sig = `${def.inputTypes.map(([, , t]) => typeText(t)).join(", ") || "()"} -> ${typeText(def.outputType)}`;
    const docLines = [...doc, sig].filter(Boolean);
    return [
      `def ${names.get(key)}(${params.join(", ")}):`,
      `    """${docLines.join("\n\n    ").replace(/"""/g, "'''")}"""`,
      ...b.lines,
    ].join("\n");
  }

  return { definition };
}

function typeText(t) {
  if (!Array.isArray(t)) return "?";
  if (t[0] === "Reference") {
    const name = ir.toTitle(t[2][2]);
    const args = (t[3] || []).map(typeText);
    return args.length ? `${name} ${args.join(" ")}` : name;
  }
  if (t[0] === "Record") return "Record";
  return t[0];
}

const PRELUDE = (pkg) => `"""${pkg} policy rules in Python.

Generated from the verified Morphir model by scripts/morphir-to-python.js; do not edit by hand.
Each function is one policy definition, with its business description and regulation sections.
Choices are their case names (as stored in the database), amounts are Decimals.
"""

from decimal import Decimal, ROUND_DOWN, ROUND_HALF_EVEN, getcontext
from types import SimpleNamespace as Record

getcontext().prec = 50


def foldl(fn, acc, items):
    for item in items:
        acc = fn(item, acc)
    return acc


def div_with_default(default, a, b):
    return default if b == 0 else a / b


def div_maybe(a, b):
    return None if b == 0 else a / b


def round_half_even(x):
    return x.to_integral_value(rounding=ROUND_HALF_EVEN)


def truncate(x):
    return x.to_integral_value(rounding=ROUND_DOWN)


def decimal_from_string(text):
    try:
        return Decimal(text)
    except ArithmeticError:
        return None


def with_default(default, value):
    return default if value is None else value


def maybe_map(fn, value):
    return None if value is None else fn(value)
`;

// The harness: loads current records from the database and compares each rule with its view.
const HARNESS = `

def _record(row, columns):
    """One database row as the policy's record, nested as the model nests it."""
    rec = Record()
    for column, path in columns:
        node = rec
        for part in path[:-1]:
            if not hasattr(node, part):
                setattr(node, part, Record())
            node = getattr(node, part)
        setattr(node, path[-1], row[column])
    return rec


def records(con, source, table):
    """The current records of a table, as the policy's records."""
    cur = con.execute(f"SELECT * FROM {source}")
    names = [d[0] for d in cur.description]
    return [_record(dict(zip(names, row)), COLUMNS[table]) for row in cur.fetchall()]


def _same(a, b):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, Decimal) or isinstance(b, Decimal):
        return abs(Decimal(str(a)) - Decimal(str(b))) <= Decimal("1e-9")
    return a == b


def compare_with_database(con):
    """Runs every rule in Python over the current records and compares each result with the
    database's rule view. Returns one row per rule: results compared and differences."""
    report = []
    for rule in RULES:
        rows = records(con, rule["source"], rule["table"])
        cur = con.execute(f"SELECT * FROM {rule['view']}")
        names = [d[0] for d in cur.description]
        db_rows = [dict(zip(names, r)) for r in cur.fetchall()]
        fn = globals()[rule["function"]]
        pairs = []
        if rule["aggregate"]:
            pairs = [(fn(rows), db_rows[0] if db_rows else {})]
        else:
            by_key = {r[rule["key"]]: r for r in db_rows}
            key_attr = dict(COLUMNS[rule["table"]])[rule["key"]]
            for rec in rows:
                node = rec
                for part in key_attr:
                    node = getattr(node, part)
                pairs.append((fn(rec), by_key.get(node, {})))
        compared = differences = 0
        example = None
        for result, db in pairs:
            for column, field in rule["outputs"]:
                mine = getattr(result, field) if field else result
                compared += 1
                if not _same(mine, db.get(column)):
                    differences += 1
                    example = example or f"{column}: Python {mine!r}, database {db.get(column)!r}"
        report.append({"rule": rule["rule"], "results compared": compared, "differences": differences, "first difference": example})
    return report
`;

function emitPython(index, { decorations = null } = {}) {
  const pkg = ir.pathToString(index.packagePath);
  // Unique Python names: the definition's name, or module_name when two modules share it.
  const values = [...index.values.values()];
  const count = new Map();
  for (const v of values) count.set(snake(v.fqn[2]), (count.get(snake(v.fqn[2])) || 0) + 1);
  const names = new Map(values.map((v) => {
    const base = snake(v.fqn[2]);
    return [ir.fqnKey(v.fqn), count.get(base) > 1 ? safe(`${ir.toSnake(v.fqn[1].flat())}_${ir.toSnake(v.fqn[2])}`) : base];
  }));
  const em = makeEmitter(index, names);
  const linksFor = (fqn) =>
    decorations ? decorations.specLinksFor(`${ir.pathToString(fqn[0])}:${ir.pathToString(fqn[1])}:${ir.toCamel(fqn[2])}.value`) : [];

  const functions = [];
  const skipped = [];
  let currentModule = null;
  // In module order, definitions in source order, so the file reads like the model.
  for (const v of values) {
    const doc = [v.doc.trim().replace(/\s*\n\s*/g, " ")];
    const links = linksFor(v.fqn);
    if (links.length) doc.push(`Regulation: ${links.map((l) => l.section).join("; ")}`);
    try {
      const mod = ir.pathToString(v.fqn[1]);
      const heading = mod !== currentModule ? `# ${"-".repeat(70)}\n# ${mod}\n# ${"-".repeat(70)}\n\n\n` : "";
      currentModule = mod;
      functions.push(`${heading}${em.definition(v.fqn, v.def, doc)}`);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      skipped.push({ rule: ir.fqnDisplay(v.fqn), reason: e.message });
    }
  }

  // Columns of each table: (database column, attribute path on the policy record).
  const columns = {};
  for (const t of entityTables(index)) columns[t.name] = t.columns.filter((c) => !c.generated).map((c) => [c.name, c.path.map((p) => snake(p))]);
  const { manifest } = emitSql(index, { dialect: "duckdb", materialize: false, decorations });
  const skippedNames = new Set(skipped.map((s) => s.rule));
  const rules = manifest.rules
    .filter((r) => !skippedNames.has(ir.fqnDisplay(r.fqn)))
    .map((r) => ({
      rule: r.rule,
      function: names.get(ir.fqnKey(r.fqn)),
      view: r.view,
      source: r.source || r.table,
      table: r.table,
      key: r.keyColumn,
      aggregate: !!r.aggregate,
      outputs: r.outputs.map((o) => [o.column, o.morphirField ? snake(o.morphirField.split(/(?=[A-Z])/).map((w) => w.toLowerCase())) : null]),
    }));

  const py = (v) => JSON.stringify(v, null, 4).replace(/\bnull\b/g, "None").replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False");
  const source = [
    PRELUDE(pkg),
    ...functions.map((f) => `\n\n${f}`),
    `\n\n# The database's tables: (column, attribute path on the policy record).\nCOLUMNS = ${py(columns)}\n`,
    `\n# Every rule the database runs as a view, for compare_with_database.\nRULES = ${py(rules)}\n`,
    HARNESS,
  ].join("");
  return { source, skipped, functions: functions.length, rules: rules.length, nameOf: (fqn) => names.get(ir.fqnKey(fqn)) };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const projectDir = opt("--project", ".");
  const irPath = opt("--ir", path.join(projectDir, "morphir-ir.json"));
  const outPath = opt("--out", path.join(projectDir, "out", "policy_rules.py"));
  const index = ir.indexIr(ir.loadIr(irPath));
  const { source, skipped, functions, rules } = emitPython(index, { decorations: loadDecorations(projectDir) });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, source);
  console.log(`Python: ${outPath} (${functions} functions, ${rules} rules checked against the database)`);
  for (const s of skipped) console.log(`  not translated: ${s.rule} (${s.reason})`);
}

module.exports = { emitPython };
