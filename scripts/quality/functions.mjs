import parser from "@typescript-eslint/parser";

const functionTypes = new Set(["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"]);

function callbackName(node, parent, source) {
  const text = (part) => source.slice(...part.range);
  switch (parent?.type) {
    case "VariableDeclarator": return text(parent.id);
    case "MethodDefinition":
    case "PropertyDefinition":
    case "Property": return text(parent.key);
    case "AssignmentExpression": return text(parent.left);
    case "JSXAttribute": return text(parent.name);
    case "CallExpression":
    case "NewExpression": return `${text(parent.callee)} callback #${parent.arguments.indexOf(node) + 1}`;
    case "ReturnStatement": return "returned callback";
    default: return "anonymous callback";
  }
}

function compare(a, b) {
  return a.line - b.line || a.column - b.column;
}

function contains({ start, end }, position) {
  return compare(start, position) <= 0 && compare(position, end) < 0;
}

function functionLocations(source, filePath) {
  const { ast, visitorKeys } = parser.parseForESLint(source, { filePath, jsx: filePath.endsWith(".tsx") });
  const functions = [];
  function walk(node, parents, functionNames) {
    const [parent, grandparent] = parents;
    if (functionTypes.has(node.type)) {
      const context = parent?.type === "JSXExpressionContainer" ? grandparent : parent;
      const name = node.id?.name ?? callbackName(node, context, source);
      functionNames = [...functionNames, name];
      const headStart = ["MethodDefinition", "Property", "VariableDeclarator"].includes(parent?.type)
        ? parent.loc.start : node.loc.start;
      functions.push({
        name: functionNames.join(" › "),
        loc: node.loc,
        head: { start: headStart, end: node.body.loc.start },
        body: node.body.loc,
        returnsFunction: functionTypes.has(node.body.type),
        kind: "function",
      });
    }
    if (node.type === "StaticBlock" || (node.type === "PropertyDefinition" && node.value)) {
      const loc = node.value?.loc ?? node.loc;
      const kind = node.type === "StaticBlock" ? "class static block" : "class field initializer";
      functions.push({ name: [...functionNames, kind].join(" › "), loc, head: loc, body: loc, kind });
    }
    for (const key of visitorKeys[node.type] ?? []) {
      for (const child of [].concat(node[key] ?? [])) {
        if (child) walk(child, [node, parent], functionNames);
      }
    }
  }
  walk(ast, [], []);
  return functions;
}

function findFunction(functions, message, filePath) {
  const point = { line: message.line, column: message.column - 1 };
  const implicit = /^(Class field initializer|Class static block) has a complexity/.exec(message.message);
  const kind = implicit ? implicit[1].toLowerCase() : "function";
  const candidates = functions.filter((fn) => fn.kind === kind && contains(fn.head, point));
  // Headers can nest in a default argument. The last one to begin owns the token.
  const [owner, other] = candidates.sort((a, b) => compare(b.head.start, a.head.start));
  if (!owner || (other && compare(owner.head.start, other.head.start) === 0)) {
    throw new Error(`${filePath}:${message.line}:${message.column} cannot locate ${message.message}`);
  }
  return owner;
}

export function complexityByFunction(source, messages, filePath) {
  const functions = functionLocations(source, filePath);
  for (const message of messages) {
    const cc = / has a complexity of (\d+)\./.exec(message.message);
    const cognitive = /Cognitive Complexity from (\d+) to/.exec(message.message);
    if (message.ruleId === "complexity" && cc) {
      const fn = findFunction(functions, message, filePath);
      if (fn.cc !== undefined) throw new Error(`${filePath}:${message.line} duplicate CC for ${fn.name}`);
      fn.cc = Number(cc[1]);
    } else if (message.ruleId === "sonarjs/cognitive-complexity" && cognitive) {
      const fn = findFunction(functions, message, filePath);
      if (fn.cognitive !== undefined) throw new Error(`${filePath}:${message.line} duplicate Cognitive Complexity for ${fn.name}`);
      fn.cognitive = Number(cognitive[1]);
    } else {
      throw new Error(`${filePath}:${message.line}:${message.column} ${message.message}`);
    }
  }
  if (functions.some((fn) => fn.cc === undefined)) {
    throw new Error(`${filePath} has functions without ESLint complexity records: ${functions.filter((fn) => fn.cc === undefined).map((fn) => fn.name).join(", ")}`);
  }
  return functions.map((fn) => ({ cognitive: 0, ...fn }));
}

function samePoint(a, b) {
  return a?.line === b.line && a.column === b.column;
}

function mergedOwner(functions, { decl, loc }) {
  // V8 can merge `effect(() => () => work())` into one function entry spanning
  // the call. The declaration's end still maps to the returned arrow's body.
  const inner = functions.find((fn) => samePoint(decl?.end, fn.body.start));
  if (!inner || compare(loc.start, inner.loc.start) >= 0
      || compare({ ...loc.end, column: loc.end.column ?? Infinity }, inner.body.end) < 0) return undefined;
  return functions.find((fn) => fn.returnsFunction && samePoint(fn.body.start, inner.loc.start)
    && compare(loc.start, fn.loc.start) < 0);
}

export function coverageByFunction(functions, fileCoverage) {
  const lines = new Map(functions.map((fn) => [fn, new Map()]));
  const { statementMap, s: hits, fnMap, f: calls } = fileCoverage.data;
  const statements = Object.entries(statementMap);
  const mergedStatements = new Map();
  const counters = new Map();
  for (const [key, entry] of Object.entries(fnMap)) {
    const { loc } = entry;
    const merged = mergedOwner(functions, entry);
    if (merged) {
      const matching = statements.filter(([, stmt]) => samePoint(loc.start, stmt.start) && samePoint(loc.end, stmt.end));
      if (matching.length !== 1) throw new Error(`${fileCoverage.path}:${merged.loc.start.line} cannot separate V8 callback coverage for ${merged.name}`);
      mergedStatements.set(matching[0][0], merged);
      continue;
    }
    // V8 can map a parenthesized arrow body back to its arrow token.
    const owner = functions.findLast((fn) => fn.kind === "function" && contains(fn.loc, loc.start));
    if (owner) {
      if (counters.has(owner)) throw new Error(`${fileCoverage.path}:${owner.loc.start.line} ambiguous V8 function entry for ${owner.name}`);
      counters.set(owner, { key, start: loc.start });
    }
  }
  const bodies = functions.map((fn) => ({ ...fn.body, start: counters.get(fn)?.start ?? fn.body.start }));
  for (const [key, { start }] of statements) {
    // The parser lists outer functions before their children.
    const index = bodies.findLastIndex((body) => contains(body, start));
    const owner = mergedStatements.get(key) ?? functions[index];
    if (owner) {
      const owned = lines.get(owner);
      owned.set(start.line, Math.max(owned.get(start.line) ?? 0, hits[key]));
    }
  }
  return functions.map((fn) => {
    const owned = [...lines.get(fn).values()];
    if (owned.length) return owned.filter((hits) => hits > 0).length / owned.length;
    const counter = counters.get(fn);
    if (!counter) throw new Error(`${fileCoverage.path}:${fn.loc.start.line} missing V8 function entry for ${fn.name}`);
    return Number(calls[counter.key] > 0);
  });
}
