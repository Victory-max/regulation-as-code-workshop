#!/usr/bin/env node
// Transpiles Morphir business rules into vectorized SQL views.
//
//   node scripts/morphir-to-sql.js [morphir-ir.json] [--dialect duckdb|ansi] [--materialize]
//                                  [--out rules.sql] [--manifest rules.manifest.json]
//
// Every public rule whose single input is an entity record becomes a projection view
// (one output row per input row); every rule over `List entity` that folds or sums
// becomes an aggregate view. Helper rules (e.g. `isScraProtected : MilitaryStatus -> Bool`)
// are inlined at their call sites, so the SQL is one set-based expression per rule.
//
// Supported Morphir constructs: literals, record field access (nested records are the
// flattened DDL columns), if/then/else, case on enums/literals with wildcard, let,
// record construction, enum constructors, Maybe (Nothing/Just/withDefault/map), and the
// Basics / Decimal / List functions in SDK_FUNCTIONS below. Anything else fails loudly
// with the Morphir function it came from, rather than producing SQL that might drift.
//
// Decimal semantics: every Decimal operation is computed in DECIMAL(38,10), never DOUBLE,
// and Decimal.round is banker's rounding (half to even) to match the Morphir interpreter.

const fs = require("fs");
const path = require("path");
const ir = require("./lib/morphir-ir");
const { loadDecorations, annotationText, typeId, valueId, childId, fieldNodeId } = require("./lib/decorations");
const { findEntities, flattenColumns, entityTables, ruleSource } = require("./morphir-to-ddl");

const WORK = "DECIMAL(38, 10)";
// Wraps in a cast to the working decimal type, unless the expression already is one.
function D(expr) {
  const suffix = ` AS ${WORK})`;
  if (expr.startsWith("CAST(") && expr.endsWith(suffix)) {
    let depth = 0;
    for (let i = 4; i < expr.length; i++) {
      if (expr[i] === "(") depth++;
      else if (expr[i] === ")" && --depth === 0) {
        if (i === expr.length - 1) return expr;
        break;
      }
    }
  }
  return `CAST(${expr}${suffix}`;
}

class Unsupported extends Error {}

function parseArgs(argv) {
  const opts = { irPath: "morphir-ir.json", dialect: "duckdb", out: null, manifest: null, materialize: false, temporal: true, project: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dialect") opts.dialect = argv[++i];
    else if (argv[i] === "--out") opts.out = argv[++i];
    else if (argv[i] === "--manifest") opts.manifest = argv[++i];
    else if (argv[i] === "--materialize") opts.materialize = true;
    else if (argv[i] === "--no-temporal") opts.temporal = false;
    else if (argv[i] === "--project") opts.project = argv[++i];
    else opts.irPath = argv[i];
  }
  if (!["duckdb", "ansi"].includes(opts.dialect)) throw new Error(`Unknown dialect ${opts.dialect}`);
  return opts;
}

// ---------------------------------------------------------------------------
// Compiled values
//   { kind: "sql", sql }                 scalar SQL expression
//   { kind: "row", alias, path, tpe }    a (possibly nested) record of the current row
//   { kind: "rows", alias, tpe }         the entity table, for aggregate rules
//   { kind: "record", fields: Map }      a record built by the rule (multi-column output)
//   { kind: "null" }                     Maybe.Nothing
//   { kind: "fn", apply(args) }          a function value awaiting arguments
// ---------------------------------------------------------------------------

const sql = (s) => ({ kind: "sql", sql: s });

function asSql(v, where) {
  if (v.kind === "sql") return v.sql;
  if (v.kind === "null") return "NULL";
  throw new Unsupported(`${where}: expected a scalar value, got a ${v.kind}`);
}

// CASE over compiled branch values; records are merged field by field.
// Branches are either { cond, val } (searched CASE, from if/then/else) or { match, val } with a
// shared `subject` (from `case subject of`), which emits a simple CASE so the subject, often a
// whole earlier hop of the calculation, appears only once.
function caseOf(subject, whens, elseVal, where) {
  const all = [...whens.map((w) => w.val), ...(elseVal ? [elseVal] : [])];
  if (all.every((v) => v.kind === "record")) {
    const fields = new Map();
    for (const name of all[0].fields.keys()) {
      fields.set(
        name,
        caseOf(subject, whens.map((w) => ({ ...w, val: w.val.fields.get(name) })), elseVal && elseVal.fields.get(name), where)
      );
    }
    return { kind: "record", fields };
  }
  if (subject === null) {
    const parts = whens.map((w) => `WHEN ${w.cond} THEN ${asSql(w.val, where)}`);
    if (elseVal) parts.push(`ELSE ${asSql(elseVal, where)}`);
    return sql(`(CASE ${parts.join(" ")} END)`);
  }
  // Group the labels that lead to the same result.
  const groups = [];
  for (const w of whens) {
    const v = asSql(w.val, where);
    const g = groups.find((x) => x.val === v);
    if (g) g.matches.push(w.match);
    else groups.push({ val: v, matches: [w.match] });
  }
  // An exhaustive case that only answers TRUE/FALSE is a membership test.
  if (!elseVal && groups.every((g) => g.val === "TRUE" || g.val === "FALSE")) {
    const trues = groups.filter((g) => g.val === "TRUE").flatMap((g) => g.matches);
    return sql(trues.length ? `(${subject} IN (${trues.join(", ")}))` : "FALSE");
  }
  if (!elseVal && groups.length === 1) return sql(groups[0].val);
  const parts = groups.flatMap((g) => g.matches.map((m) => `WHEN ${m} THEN ${g.val}`));
  if (elseVal) parts.push(`ELSE ${asSql(elseVal, where)}`);
  return sql(`(CASE ${subject} ${parts.join(" ")} END)`);
}

function makeCompiler(index, dialect) {
  const roundEven = (x) =>
    dialect === "duckdb"
      ? `morphir_round_even(${x})`
      : `(CASE WHEN ${x} - FLOOR(${x}) > 0.5 THEN FLOOR(${x}) + 1 WHEN ${x} - FLOOR(${x}) < 0.5 THEN FLOOR(${x}) ` +
        `WHEN MOD(FLOOR(${x}), 2) = 0 THEN FLOOR(${x}) ELSE FLOOR(${x}) + 1 END)`;

  const isDecimal = (tpe) => tpe && ir.sdkTypeKey(index, tpe) === ir.SDK.decimal;
  const lit = (n) => D(`'${n}'`);
  const bin = (op) => (a, b) => sql(`(${a} ${op} ${b})`);
  const dec = (op) => (a, b) => sql(D(`${a} ${op} ${b}`));

  // SDK functions over scalar arguments: key -> (sqlArgs..., types) => compiled value.
  const SCALAR = {
    "morphir.sdk:basics:add": (a, b, t) => (isDecimal(t) ? dec("+")(a, b) : bin("+")(a, b)),
    "morphir.sdk:basics:subtract": (a, b, t) => (isDecimal(t) ? dec("-")(a, b) : bin("-")(a, b)),
    "morphir.sdk:basics:multiply": (a, b, t) => (isDecimal(t) ? dec("*")(a, b) : bin("*")(a, b)),
    "morphir.sdk:basics:divide": bin("/"),
    "morphir.sdk:basics:integer_divide": (a, b) => sql(dialect === "duckdb" ? `(${a} // ${b})` : `CAST(${a} / ${b} AS BIGINT)`),
    "morphir.sdk:basics:negate": (a) => sql(`(- ${a})`),
    "morphir.sdk:basics:abs": (a) => sql(`ABS(${a})`),
    "morphir.sdk:basics:min": (a, b) => sql(`LEAST(${a}, ${b})`),
    "morphir.sdk:basics:max": (a, b) => sql(`GREATEST(${a}, ${b})`),
    "morphir.sdk:basics:equal": bin("="),
    "morphir.sdk:basics:not_equal": bin("<>"),
    "morphir.sdk:basics:less_than": bin("<"),
    "morphir.sdk:basics:greater_than": bin(">"),
    "morphir.sdk:basics:less_than_or_equal": bin("<="),
    "morphir.sdk:basics:greater_than_or_equal": bin(">="),
    "morphir.sdk:basics:and": bin("AND"),
    "morphir.sdk:basics:or": bin("OR"),
    "morphir.sdk:basics:not": (a) => sql(`(NOT ${a})`),
    "morphir.sdk:basics:to_float": (a) => sql(`CAST(${a} AS DOUBLE)`),
    "morphir.sdk:basics:round": (a) => sql(`CAST(ROUND(${a}) AS BIGINT)`),
    "morphir.sdk:basics:floor": (a) => sql(`CAST(FLOOR(${a}) AS BIGINT)`),
    "morphir.sdk:basics:ceiling": (a) => sql(`CAST(CEIL(${a}) AS BIGINT)`),

    "morphir.sdk:decimal:from_int": (a) => sql(D(a)),
    "morphir.sdk:decimal:from_float": (a) => sql(D(a)),
    "morphir.sdk:decimal:hundred": (a) => sql(D(`${a} * 100`)),
    "morphir.sdk:decimal:thousand": (a) => sql(D(`${a} * 1000`)),
    "morphir.sdk:decimal:million": (a) => sql(D(`${a} * 1000000`)),
    "morphir.sdk:decimal:tenth": (a) => sql(D(`${D(a)} * ${lit("0.1")}`)),
    "morphir.sdk:decimal:hundredth": (a) => sql(D(`${D(a)} * ${lit("0.01")}`)),
    "morphir.sdk:decimal:thousandth": (a) => sql(D(`${D(a)} * ${lit("0.001")}`)),
    "morphir.sdk:decimal:bps": (a) => sql(D(`${D(a)} * ${lit("0.0001")}`)),
    "morphir.sdk:decimal:millionth": (a) => sql(D(`${D(a)} * ${lit("0.000001")}`)),
    "morphir.sdk:decimal:add": dec("+"),
    "morphir.sdk:decimal:sub": dec("-"),
    "morphir.sdk:decimal:mul": dec("*"),
    // Decimal.div returns Maybe: division by zero is Nothing (NULL).
    "morphir.sdk:decimal:div": (a, b) => sql(D(`${a} / NULLIF(${b}, 0)`)),
    "morphir.sdk:decimal:div_with_default": (d, a, b) => sql(`COALESCE(${D(`${a} / NULLIF(${b}, 0)`)}, ${d})`),
    "morphir.sdk:decimal:negate": (a) => sql(D(`- ${a}`)),
    "morphir.sdk:decimal:abs": (a) => sql(D(`ABS(${a})`)),
    "morphir.sdk:decimal:round": (a) => sql(D(roundEven(D(a)))),
    "morphir.sdk:decimal:truncate": (a) => sql(D(`(CASE WHEN ${a} < 0 THEN CEIL(${a}) ELSE FLOOR(${a}) END)`)),
    "morphir.sdk:decimal:shift_decimal_left": (n, a) => sql(D(`${D(a)} / POWER(10, ${n})`)),
    "morphir.sdk:decimal:shift_decimal_right": (n, a) => sql(D(`${D(a)} * CAST(POWER(10, ${n}) AS BIGINT)`)),
    "morphir.sdk:decimal:eq": bin("="),
    "morphir.sdk:decimal:neq": bin("<>"),
    "morphir.sdk:decimal:lt": bin("<"),
    "morphir.sdk:decimal:lte": bin("<="),
    "morphir.sdk:decimal:gt": bin(">"),
    "morphir.sdk:decimal:gte": bin(">="),
    "morphir.sdk:decimal:zero": () => sql(lit("0")),
    "morphir.sdk:decimal:one": () => sql(lit("1")),
    "morphir.sdk:decimal:minus_one": () => sql(lit("-1")),

    "morphir.sdk:string:append": (a, b) => sql(`(${a} || ${b})`),
    "morphir.sdk:string:to_upper": (a) => sql(`UPPER(${a})`),
    "morphir.sdk:string:to_lower": (a) => sql(`LOWER(${a})`),
    "morphir.sdk:string:length": (a) => sql(`LENGTH(${a})`),
  };

  // shiftDecimalLeft by a literal is exact division by a power of ten; emit it as multiplication.
  const shiftLeftLiteral = (n, a) => sql(D(`${D(a)} * ${lit((1 / 10 ** n).toFixed(n))}`));

  // Decimal.hundredth 5 -> 0.05 etc., computed exactly on the literal's digits.
  const DECIMAL_EXPONENT = {
    "morphir.sdk:decimal:from_int": 0,
    "morphir.sdk:decimal:hundred": 2,
    "morphir.sdk:decimal:thousand": 3,
    "morphir.sdk:decimal:million": 6,
    "morphir.sdk:decimal:tenth": -1,
    "morphir.sdk:decimal:hundredth": -2,
    "morphir.sdk:decimal:thousandth": -3,
    "morphir.sdk:decimal:bps": -4,
    "morphir.sdk:decimal:millionth": -6,
  };
  function foldDecimalConstant(key, args) {
    if (!(key in DECIMAL_EXPONENT) || args.length !== 1) return null;
    const a = args[0];
    if (a.kind || a[0] !== "Literal" || a[2][0] !== "WholeNumberLiteral") return null;
    const exp = DECIMAL_EXPONENT[key];
    const n = BigInt(a[2][1]);
    const neg = n < 0n;
    let digits = (neg ? -n : n).toString();
    if (exp >= 0) digits += "0".repeat(exp);
    else {
      digits = digits.padStart(-exp + 1, "0");
      digits = `${digits.slice(0, exp)}.${digits.slice(exp)}`.replace(/\.?0+$/, "");
    }
    return sql(lit(`${neg ? "-" : ""}${digits}`));
  }

  const ARITY = {
    "morphir.sdk:basics:add": 2,
    "morphir.sdk:basics:subtract": 2,
    "morphir.sdk:basics:multiply": 2,
    "morphir.sdk:decimal:zero": 0,
    "morphir.sdk:decimal:one": 0,
    "morphir.sdk:decimal:minus_one": 0,
  };

  function flattenApply(expr) {
    const args = [];
    while (expr[0] === "Apply") {
      args.unshift(expr[3]);
      expr = expr[2];
    }
    return { head: expr, args };
  }

  function bindPattern(pattern, val, env) {
    switch (pattern[0]) {
      case "WildcardPattern":
        return env;
      case "AsPattern":
        return bindPattern(pattern[2], val, { ...env, [ir.toSnake(pattern[3])]: val });
      case "UnitPattern":
        return env;
      default:
        throw new Unsupported(`pattern ${pattern[0]} in a binding`);
    }
  }

  // Calls a package-defined function by inlining its body with the arguments bound.
  function callDefinition(def, args, where, depth) {
    if (depth > 50) throw new Unsupported(`${where}: recursion is not supported in SQL`);
    if (args.length < def.inputTypes.length) {
      return { kind: "fn", apply: (more) => callDefinition(def, [...args, ...more], where, depth) };
    }
    let env = {};
    def.inputTypes.forEach(([name], i) => (env[ir.toSnake(name)] = args[i]));
    const result = compile(def.body, env, where, depth + 1);
    const extra = args.slice(def.inputTypes.length);
    return extra.length ? applyValue(result, extra, where) : result;
  }

  function applyValue(fnVal, args, where) {
    if (fnVal.kind !== "fn") throw new Unsupported(`${where}: applying a non-function value`);
    return fnVal.apply(args);
  }

  // min/max written as `if Decimal.lt a b then a else b` becomes LEAST/GREATEST.
  function minMaxPattern(expr, env, where, depth) {
    const [, , cond, thenE, elseE] = expr;
    const { head, args } = flattenApply(cond);
    if (head[0] !== "Reference" || args.length !== 2) return null;
    const key = ir.fqnKey(head[2]);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const lessish = ["morphir.sdk:decimal:lt", "morphir.sdk:decimal:lte", "morphir.sdk:basics:less_than", "morphir.sdk:basics:less_than_or_equal"];
    const greaterish = ["morphir.sdk:decimal:gt", "morphir.sdk:decimal:gte", "morphir.sdk:basics:greater_than", "morphir.sdk:basics:greater_than_or_equal"];
    if (!lessish.includes(key) && !greaterish.includes(key)) return null;
    const [a, b] = args.map((x) => asSql(compile(x, env, where, depth), where));
    if (same(args[0], thenE) && same(args[1], elseE)) return sql(`${lessish.includes(key) ? "LEAST" : "GREATEST"}(${a}, ${b})`);
    if (same(args[1], thenE) && same(args[0], elseE)) return sql(`${lessish.includes(key) ? "GREATEST" : "LEAST"}(${a}, ${b})`);
    return null;
  }

  // List.foldl (\item acc -> acc + f item) init rows   ->   init + SUM(f item)
  function foldlAggregate(args, env, where, depth) {
    const [lambda, init, list] = args;
    const rows = compile(list, env, where, depth);
    if (rows.kind !== "rows") throw new Unsupported(`${where}: List.foldl is only supported over an entity list`);
    if (lambda[0] !== "Lambda" || lambda[3][0] !== "Lambda") throw new Unsupported(`${where}: List.foldl needs an inline \\item acc -> ... lambda`);
    const itemPat = lambda[2];
    const accPat = lambda[3][2];
    const body = lambda[3][3];
    if (accPat[0] !== "AsPattern") throw new Unsupported(`${where}: fold accumulator must be a named variable`);
    const accName = accPat[3];
    const { head, args: bodyArgs } = flattenApply(body);
    const adds = ["morphir.sdk:decimal:add", "morphir.sdk:basics:add"];
    if (head[0] !== "Reference" || !adds.includes(ir.fqnKey(head[2])) || bodyArgs.length !== 2) {
      throw new Unsupported(`${where}: only additive folds (acc + f item) map to SQL SUM`);
    }
    const isAcc = (e) => e[0] === "Variable" && JSON.stringify(e[2]) === JSON.stringify(accName);
    const term = isAcc(bodyArgs[0]) ? bodyArgs[1] : isAcc(bodyArgs[1]) ? bodyArgs[0] : null;
    if (!term) throw new Unsupported(`${where}: fold body must add to the accumulator`);
    const itemEnv = bindPattern(itemPat, { kind: "row", alias: rows.alias, path: [], tpe: rows.tpe }, env);
    const termSql = asSql(compile(term, itemEnv, where, depth), where);
    const initSql = asSql(compile(init, env, where, depth), where);
    const decimal = isDecimal(body[1]);
    const sum = `COALESCE(SUM(${termSql}), 0)`;
    return sql(decimal ? D(`${initSql} + ${sum}`) : `(${initSql} + ${sum})`);
  }

  function rowsFrom(list, env, where, depth) {
    const rows = compile(list, env, where, depth);
    if (rows.kind !== "rows") throw new Unsupported(`${where}: list functions are only supported over an entity list`);
    return rows;
  }

  // List / Maybe functions that need unevaluated arguments.
  const STRUCTURAL = {
    "morphir.sdk:list:foldl": { arity: 3, fn: foldlAggregate },
    "morphir.sdk:list:length": {
      arity: 1,
      fn: (args, env, where, depth) => (rowsFrom(args[0], env, where, depth), sql("COUNT(*)")),
    },
    "morphir.sdk:list:sum": {
      arity: 1,
      fn: (args, env, where, depth) => {
        const { head, args: mapArgs } = flattenApply(args[0]);
        if (head[0] !== "Reference" || ir.fqnKey(head[2]) !== "morphir.sdk:list:map") {
          throw new Unsupported(`${where}: List.sum is supported as List.sum (List.map f entities)`);
        }
        const rows = rowsFrom(mapArgs[1], env, where, depth);
        const f = compile(mapArgs[0], env, where, depth);
        const term = asSql(applyValue(f, [{ kind: "row", alias: rows.alias, path: [], tpe: rows.tpe }], where), where);
        return sql(`COALESCE(SUM(${term}), 0)`);
      },
    },
    "morphir.sdk:maybe:with_default": {
      arity: 2,
      fn: (args, env, where, depth) => {
        const [d, m] = args.map((a) => asSql(compile(a, env, where, depth), where));
        return sql(`COALESCE(${m}, ${d})`);
      },
    },
    "morphir.sdk:maybe:map": {
      arity: 2,
      fn: (args, env, where, depth) => {
        const m = compile(args[1], env, where, depth);
        if (m.kind === "null") return m;
        const f = compile(args[0], env, where, depth);
        const mapped = asSql(applyValue(f, [m], where), where);
        return sql(`(CASE WHEN ${asSql(m, where)} IS NULL THEN NULL ELSE ${mapped} END)`);
      },
    },
  };

  function compileReference(fqn, args, env, where, depth) {
    const key = ir.fqnKey(fqn);
    const local = index.values.get(key);
    if (local) return callDefinition(local.def, args.map((a) => compile(a, env, where, depth)), ir.fqnDisplay(fqn), depth);

    if (STRUCTURAL[key]) {
      const { arity, fn } = STRUCTURAL[key];
      if (args.length < arity) throw new Unsupported(`${where}: partial application of ${ir.fqnDisplay(fqn)}`);
      return fn(args, env, where, depth);
    }

    const folded = foldDecimalConstant(key, args);
    if (folded) return folded;

    if (key in SCALAR) {
      const handler = SCALAR[key];
      const arity = key in ARITY ? ARITY[key] : handler.length;
      const toVal = (argExprs) => {
        const sqls = argExprs.map((a) => (a.kind ? asSql(a, where) : asSql(compile(a, env, where, depth), where)));
        if (key === "morphir.sdk:decimal:shift_decimal_left" && !argExprs[0].kind && argExprs[0][0] === "Literal") {
          return shiftLeftLiteral(argExprs[0][2][1], sqls[1]);
        }
        // Basics arithmetic needs the operand type to choose Decimal vs numeric semantics.
        const tpe = argExprs.length > 0 && !argExprs[0].kind && argExprs[0][1];
        return handler(...sqls, tpe);
      };
      if (args.length < arity) {
        return { kind: "fn", apply: (more) => toVal([...args, ...more]) };
      }
      return toVal(args);
    }
    throw new Unsupported(`${where}: ${ir.fqnDisplay(fqn)} has no SQL translation yet`);
  }

  function compileConstructor(fqn, args, env, where, depth) {
    const key = ir.fqnKey(fqn);
    if (key === "morphir.sdk:maybe:nothing") return { kind: "null" };
    if (key === "morphir.sdk:maybe:just") return compile(args[0], env, where, depth);
    if (args.length > 0) throw new Unsupported(`${where}: constructor ${ir.fqnDisplay(fqn)} with arguments has no column representation`);
    return sql(`'${ir.toTitle(fqn[2])}'`);
  }

  function compileLiteral([tag, value]) {
    switch (tag) {
      case "BoolLiteral":
        return sql(value ? "TRUE" : "FALSE");
      case "StringLiteral":
      case "CharLiteral":
        return sql(`'${String(value).replace(/'/g, "''")}'`);
      case "WholeNumberLiteral":
        return sql(String(value));
      case "FloatLiteral":
        return sql(String(value));
      case "DecimalLiteral":
        return sql(lit(value));
      default:
        throw new Unsupported(`literal ${tag}`);
    }
  }

  function compile(expr, env, where, depth = 0) {
    switch (expr[0]) {
      case "Literal":
        return compileLiteral(expr[2]);

      case "Variable": {
        const v = env[ir.toSnake(expr[2])];
        if (!v) throw new Unsupported(`${where}: unbound variable ${ir.toCamel(expr[2])}`);
        return v;
      }

      case "Reference":
        return compileReference(expr[2], [], env, where, depth);

      case "Constructor":
        return compileConstructor(expr[2], [], env, where, depth);

      case "Apply": {
        const { head, args } = flattenApply(expr);
        if (head[0] === "Reference") return compileReference(head[2], args, env, where, depth);
        if (head[0] === "Constructor") return compileConstructor(head[2], args, env, where, depth);
        const fnVal = compile(head, env, where, depth);
        return applyValue(fnVal, args.map((a) => compile(a, env, where, depth)), where);
      }

      case "Lambda":
        return { kind: "fn", apply: ([arg, ...rest]) => {
          const result = compile(expr[3], bindPattern(expr[2], arg, env), where, depth);
          return rest.length ? applyValue(result, rest, where) : result;
        } };

      case "Field": {
        const subject = compile(expr[2], env, where, depth);
        const field = expr[3];
        if (subject.kind === "record") return subject.fields.get(ir.toSnake(field));
        if (subject.kind !== "row") throw new Unsupported(`${where}: field access on a ${subject.kind}`);
        const path = [...subject.path, field];
        const fieldType = expr[1];
        if (ir.recordFieldsOf(index, fieldType)) return { kind: "row", alias: subject.alias, path, tpe: fieldType };
        return sql(`${subject.alias}.${ir.toSnake(path.flat())}`);
      }

      case "FieldFunction":
        return { kind: "fn", apply: ([subject]) => compile(["Field", expr[1], ["__Value", subject], expr[2]], env, where, depth) };

      case "__Value": // internal: an already-compiled value smuggled through compile()
        return expr[1];

      case "Record": {
        const fields = new Map();
        for (const [name, value] of expr[2]) fields.set(ir.toSnake(name), compile(value, env, where, depth));
        return { kind: "record", fields };
      }

      case "IfThenElse": {
        const mm = minMaxPattern(expr, env, where, depth);
        if (mm) return mm;
        const cond = asSql(compile(expr[2], env, where, depth), where);
        return caseOf(null, [{ cond, val: compile(expr[3], env, where, depth) }], compile(expr[4], env, where, depth), where);
      }

      case "PatternMatch": {
        const subjectVal = compile(expr[2], env, where, depth);
        const subject = asSql(subjectVal, where);
        const whens = [];
        let elseVal = null;
        for (const [pattern, body] of expr[3]) {
          let p = pattern;
          let caseEnv = env;
          if (p[0] === "AsPattern") {
            caseEnv = { ...env, [ir.toSnake(p[3])]: subjectVal };
            p = p[2];
          }
          if (p[0] === "WildcardPattern") {
            elseVal = compile(body, caseEnv, where, depth);
            break; // later branches are unreachable
          }
          let match;
          if (p[0] === "ConstructorPattern" && p[3].length === 0) match = `'${ir.toTitle(p[2][2])}'`;
          else if (p[0] === "LiteralPattern") match = compileLiteral(p[2]).sql;
          else throw new Unsupported(`${where}: case pattern ${p[0]} has no SQL translation`);
          whens.push({ match, val: compile(body, caseEnv, where, depth) });
        }
        return caseOf(subject, whens, elseVal, where);
      }

      case "LetDefinition": {
        const [, , name, def, inValue] = expr;
        const bound =
          def.inputTypes.length === 0
            ? compile(def.body, env, where, depth)
            : { kind: "fn", apply: (args) => {
                let fenv = { ...env };
                def.inputTypes.forEach(([n], i) => (fenv[ir.toSnake(n)] = args[i]));
                return compile(def.body, fenv, where, depth + 1);
              } };
        return compile(inValue, { ...env, [ir.toSnake(name)]: bound }, where, depth);
      }

      case "Destructure": {
        const [, , pattern, value, inValue] = expr;
        return compile(inValue, bindPattern(pattern, compile(value, env, where, depth), env), where, depth);
      }

      default:
        throw new Unsupported(`${where}: ${expr[0]} expressions have no SQL translation`);
    }
  }

  return { compile, callDefinition };
}

// ---------------------------------------------------------------------------
// Rule discovery and SQL emission
// ---------------------------------------------------------------------------

function outputColumns(index, outputType, ruleName) {
  const fields = ir.recordFieldsOf(index, outputType);
  if (fields) return fields.map(({ name, tpe }) => ({ field: ir.toSnake(name), name: ir.toSnake(name), morphirField: ir.toCamel(name), tpe }));
  return [{ field: null, name: ruleName, morphirField: null, tpe: outputType }];
}

// Description, spec links and value descriptions of one rule output.
function outputAnnotation(index, deco, r, o) {
  const fields = ir.recordFieldsOf(index, r.outputType);
  const field = fields && fields.find((f) => ir.toSnake(f.name) === o.field);
  const fieldId = field && r.outputType[0] === "Reference" ? childId(typeId(r.outputType[2]), field.name) : null;
  const tpe = field ? field.tpe : r.outputType;
  const ct = ir.isEnum(index, tpe) ? ir.customTypeOf(index, tpe) : null;
  return {
    description: (fieldId && deco.descriptionFor(fieldId)) || (fieldId ? null : r.doc.split("\n\n")[0]) || null,
    specLinks: fieldId ? deco.specLinksFor(fieldId) : [],
    values: ct ? ct.constructors.map(([n]) => ({ name: ir.toTitle(n), description: deco.descriptionFor(childId(typeId(ct.fqn), n)) })) : [],
  };
}

function emitSql(index, { dialect, materialize, temporal = true, decorations = null }) {
  const deco = decorations || loadDecorations("/nonexistent");
  const { compile, callDefinition } = makeCompiler(index, dialect);
  const entities = findEntities(index);
  const entityKeys = new Map(entities.map((t) => [ir.fqnKey(t[2]), t]));
  const rules = [];
  const skipped = [];

  for (const { fqn, access, def, doc } of index.values.values()) {
    if (access !== "Public" || def.inputTypes.length !== 1) continue;
    const [, , inputType] = def.inputTypes[0];
    const isList = inputType[0] === "Reference" && ir.fqnKey(inputType[2]) === ir.SDK.list;
    const entityType = isList ? inputType[3][0] : inputType;
    if (entityType[0] !== "Reference" || !entityKeys.has(ir.fqnKey(entityType[2]))) continue;

    const ruleName = ir.toSnake(fqn[2]);
    const table = ir.toSnake(ir.aliasName(entityType));
    const where = ir.fqnDisplay(fqn);
    const arg = isList ? { kind: "rows", alias: "t", tpe: entityType } : { kind: "row", alias: "t", path: [], tpe: entityType };
    try {
      const result = callDefinition(def, [arg], where, 0);
      const outputs = outputColumns(index, def.outputType, ruleName);
      const exprs = outputs.map((o) => {
        const v = o.field ? result.fields.get(o.field) : result;
        if (!v) throw new Unsupported(`${where}: output field ${o.field} was not produced`);
        if (v.kind === "row") throw new Unsupported(`${where}: returning a whole record of the input is not supported`);
        return v.kind === "null" ? "NULL" : v.sql;
      });
      rules.push({ fqn, ruleName, doc: doc.trim(), table, entityType, aggregate: isList, outputType: def.outputType, outputs, exprs });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      skipped.push({ rule: where, reason: e.message });
    }
  }

  const out = [];
  out.push(`-- Generated by morphir-to-sql.js from Morphir IR (package ${ir.pathToString(index.packagePath)}).`);
  out.push(`-- Each view is one SME-verified Morphir rule, evaluated set-based over its entity table.`);
  out.push("");
  if (dialect === "duckdb") {
    out.push("-- Morphir Decimal.round: banker's rounding (half to even), computed exactly in DECIMAL.");
    out.push(
      "CREATE OR REPLACE MACRO morphir_round_even(x) AS (CASE WHEN x - FLOOR(x) > 0.5 THEN FLOOR(x) + 1 " +
        "WHEN x - FLOOR(x) < 0.5 THEN FLOOR(x) WHEN FLOOR(x) % 2 = 0 THEN FLOOR(x) ELSE FLOOR(x) + 1 END);"
    );
    out.push("");
  }

  const createKw = materialize ? "CREATE OR REPLACE TABLE" : dialect === "duckdb" ? "CREATE OR REPLACE VIEW" : "CREATE VIEW";
  for (const r of rules) {
    const viewName = r.ruleName.startsWith("rule_") ? r.ruleName : `rule_${r.ruleName}`;
    const inputCols = flattenColumns(index, ir.recordFieldsOf(index, r.entityType)).map((c) => c.name);
    r.view = viewName;
    r.inputColumns = r.aggregate ? [] : inputCols;
    for (const o of r.outputs) if (!r.aggregate && inputCols.includes(o.name)) o.name = `${o.name}_result`;
    const select = r.outputs.map((o, i) => `    ${r.exprs[i]} AS ${o.name}`);
    out.push(`-- ${ir.fqnDisplay(r.fqn)}${r.aggregate ? " (aggregate)" : ""}`);
    if (r.doc) out.push(...r.doc.split("\n").map((l) => `--   ${l}`));
    r.source = ruleSource(r.table, temporal);
    const body = (from) => (r.aggregate ? `SELECT\n${select.join(",\n")}\nFROM ${from} t` : `SELECT\n    t.*,\n${select.join(",\n")}\nFROM ${from} t`);
    out.push(`${createKw} ${viewName} AS\n${body(r.source)};`);
    if (dialect === "duckdb" && !materialize) {
      const q = (text) => `'${text.replace(/'/g, "''")}'`;
      const viewText = annotationText({ description: `${r.doc ? `${r.doc} ` : ""}Policy rule ${ir.fqnDisplay(r.fqn)}.`, specLinks: deco.specLinksFor(valueId(r.fqn)) });
      out.push(`COMMENT ON VIEW ${viewName} IS ${q(viewText)};`);
      for (const o of r.outputs) {
        const text = annotationText(outputAnnotation(index, deco, r, o));
        if (text) out.push(`COMMENT ON COLUMN ${viewName}.${o.name} IS ${q(text)};`);
      }
    }
    if (temporal && dialect === "duckdb") {
      out.push(`-- The same rule over ${r.table} as of a business date, as known at a point in time.`);
      out.push(`CREATE OR REPLACE MACRO ${viewName}_as_of(valid_date, known_at) AS TABLE\n${body(`${r.table}_as_of(valid_date, known_at)`)};`);
    }
    out.push("");
  }
  // Calculation tables: entities with fields the model says are calculated by a rule (the
  // calculatedFrom decoration). <table>_feed is the next version of each record: calculated
  // fields from their rules' current results, reported fields as currently recorded.
  // Recalculating is `INSERT INTO <table> (...) SELECT ... FROM <table>_feed`.
  const feeds = [];
  if (dialect === "duckdb" && !materialize) {
    for (const t of entityTables(index)) {
      const sources = t.columns.map((c) => {
        const id = c.generated ? null : fieldNodeId(index, t.entityType, c.path);
        const ruleName = id && deco.calculatedFromFor ? deco.calculatedFromFor(id) : null;
        const rule = ruleName && rules.find((r) => r.aggregate && ir.fqnDisplay(r.fqn) === ruleName);
        return { column: c.name, rule: ruleName, view: rule && rule.view, output: rule && rule.outputs[0].name };
      });
      if (!sources.some((x) => x.rule)) continue;
      for (const x of sources.filter((y) => y.rule && !y.view)) out.push(`-- ${t.name}.${x.column}: calculated from ${x.rule}, which is not an aggregate rule of this model`);
      const select = sources.map((x) => (x.view ? `    (SELECT ${x.output} FROM ${x.view}) AS ${x.column}` : `    c.${x.column}`));
      out.push(`-- The next version of each ${t.name} record: calculated fields from their rules, reported fields as recorded.`);
      out.push(`CREATE OR REPLACE VIEW ${t.name}_feed AS\nSELECT\n${select.join(",\n")}\nFROM ${t.name}_current c;`);
      out.push("");
      feeds.push({ table: t.name, columns: sources.map((x) => x.column), calculated: sources.filter((x) => x.view).map((x) => ({ column: x.column, rule: x.rule, view: x.view, output: x.output })) });
    }
  }
  for (const s of skipped) out.push(`-- SKIPPED ${s.rule}: ${s.reason}`);

  const manifest = {
    package: ir.pathToString(index.packagePath),
    dialect,
    rules: rules.map((r) => ({
      rule: ir.fqnDisplay(r.fqn),
      fqn: r.fqn,
      view: r.view,
      table: r.table,
      source: r.source,
      key: (entityTables(index).find((t) => t.name === r.table) || {}).key || null,
      aggregate: r.aggregate,
      keyColumn: r.aggregate ? null : (entityTables(index).find((t) => t.name === r.table) || {}).key || null,
      outputIsRecord: !!ir.recordFieldsOf(index, r.outputType),
      doc: r.doc,
      // inputs: the entity columns each output is computed from (column-level lineage).
      outputs: r.outputs.map((o, i) => ({
        column: o.name,
        morphirField: o.morphirField,
        type: r.outputType && o.tpe,
        inputs: [...new Set([...r.exprs[i].matchAll(/\bt\.([a-z0-9_]+)/g)].map((m) => m[1]))],
        sql: r.exprs[i],
      })),
    })),
    skipped,
    // Calculation tables: their calculated columns and the aggregate rule views that fill them.
    feeds,
  };
  return { sql: out.join("\n"), manifest };
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const decorations = loadDecorations(opts.project || path.dirname(opts.irPath));
    const { sql: text, manifest } = emitSql(ir.indexIr(ir.loadIr(opts.irPath)), { ...opts, decorations });
    if (opts.out) fs.writeFileSync(opts.out, text);
    else process.stdout.write(text);
    if (opts.manifest) fs.writeFileSync(opts.manifest, JSON.stringify(manifest, null, 2));
    for (const s of manifest.skipped) console.error(`morphir-to-sql: skipped ${s.rule}: ${s.reason}`);
  } catch (e) {
    console.error(`morphir-to-sql: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { emitSql };
