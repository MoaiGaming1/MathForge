const GREEK = {
  pi: "π", alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ϵ",
  zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
  infinity: "∞", Infinity: "∞", inf: "∞",
};

const FUNCTIONS = new Map([
  ["sqrt", 1], ["sin", 1], ["cos", 1], ["tan", 1],
  ["asin", 1], ["acos", 1], ["atan", 1], ["arcsin", 1], ["arccos", 1], ["arctan", 1],
  ["exp", 1], ["log", 1], ["nthroot", 2], ["transpose", 1], ["piecewise", null],
  ["det", 1], ["inverse", 1], ["trace", 1], ["dot", 2], ["cross", 2],
  ["norm", 1], ["normalize", 1], ["entry", 3],
]);

function tokenize(source) {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:([eE][+-]?\d+))?|([A-Za-z][A-Za-z0-9_]*|_)|(<=|>=|==|!=|\*\*|[+\-*/^<>=(),\[\];]))/gy;
  let position = 0;
  while (position < source.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(source);
    if (!match) return null;
    position = pattern.lastIndex;
    if (match[1]) tokens.push({ type: "number", value: match[1] + (match[2] ?? "") });
    else if (match[3]) tokens.push({ type: "name", value: match[3] });
    else if (match[4] !== " ") tokens.push({ type: "operator", value: match[4] === "**" ? "^" : match[4] });
  }
  return tokens;
}

function latexGroup(source, start) {
  if (source[start] !== "{") return null;
  let depth = 1;
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return { value: source.slice(start + 1, index), end: index + 1 };
    }
  }
  return null;
}

function topLevelEquals(source) {
  let parentheses = 0, brackets = 0, braces = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parentheses += 1;
    else if (char === ")") parentheses = Math.max(0, parentheses - 1);
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets = Math.max(0, brackets - 1);
    else if (char === "{") braces += 1;
    else if (char === "}") braces = Math.max(0, braces - 1);
    else if (char === "=" && parentheses === 0 && brackets === 0 && braces === 0
      && !"<>!=".includes(source[index - 1] ?? "") && source[index + 1] !== "=") return index;
  }
  return -1;
}

function convertLatex(source) {
  const outerMatrix = /^\\left([\[(])\\begin\{matrix\}([\s\S]*?)\\end\{matrix\}\\right[\])]/.exec(source.trim());
  if (outerMatrix) return convertMatrixBody(outerMatrix[2]);
  const commands = new Map([
    ["pi", "pi"], ["alpha", "alpha"], ["beta", "beta"], ["gamma", "gamma"], ["theta", "theta"],
    ...["delta", "epsilon", "varepsilon", "zeta", "eta", "iota", "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau", "phi", "varphi", "chi", "psi", "omega"].map((name) => [name, name]),
    ["infty", "infinity"], ["cdot", "*"], ["times", "*"], ["div", "/"], ["le", "<="], ["leq", "<="], ["ge", ">="], ["geq", ">="], ["ne", "!="],
    ["log", "log"], ["ln", "log"], ["sin", "sin"], ["cos", "cos"], ["tan", "tan"],
    ["arcsin", "asin"], ["arccos", "acos"], ["arctan", "atan"],
    ["asin", "asin"], ["acos", "acos"], ["atan", "atan"],
    ["exp", "exp"], ["det", "det"], ["transpose", "transpose"],
    ["lbrack", "["], ["rbrack", "]"],
  ]);
  let result = "";
  for (let index = 0; index < source.length;) {
    if (source[index] === "\\") {
      const matrix = convertMatrixEnvironment(source, index);
      if (matrix) {
        result += matrix.value;
        index = matrix.end;
        continue;
      }
      const match = /^\\([A-Za-z]+|.)/.exec(source.slice(index));
      if (!match) return null;
      const command = match[1];
      index += match[0].length;
      if (command === "left" || command === "right" || command === "," || command === ";" || command === "!") continue;
      if (command === "frac") {
        const numerator = latexGroup(source, index);
        const denominator = numerator && latexGroup(source, numerator.end);
        if (!numerator || !denominator) return null;
        const top = convertLatex(numerator.value);
        const bottom = convertLatex(denominator.value);
        if (top === null || bottom === null) return null;
        result += `((${top})/(${bottom}))`;
        index = denominator.end;
        continue;
      }
      if (command === "sqrt") {
        let rootIndex = null;
        if (source[index] === "[") {
          const close = source.indexOf("]", index + 1);
          if (close < 0) return null;
          rootIndex = source.slice(index + 1, close);
          index = close + 1;
        }
        const radicand = latexGroup(source, index);
        if (!radicand) return null;
        const inner = convertLatex(radicand.value);
        if (inner === null) return null;
        result += rootIndex === null ? `sqrt(${inner})` : `nthroot(${inner},${rootIndex})`;
        index = radicand.end;
        continue;
      }
      const mapped = commands.get(command);
      if (mapped === undefined) return null;
      result += mapped;
      continue;
    }
    if (source[index] === "{") {
      const group = latexGroup(source, index);
      if (!group) return null;
      const inner = convertLatex(group.value);
      if (inner === null) return null;
      result += `(${inner})`;
      index = group.end;
      continue;
    }
    if (source[index] === "_") {
      const subscript = source[index + 1] === "{"
        ? latexGroup(source, index + 1)
        : source[index + 1] ? { value: source[index + 1], end: index + 2 } : null;
      if (!subscript) return null;
      const inner = convertLatex(subscript.value);
      if (inner === null) return null;
      if (inner.includes(",")) result += `[${inner}]`;
      else if (/^[A-Za-z0-9]+$/.test(inner)) result += `_${inner}`;
      else return null;
      index = subscript.end;
      continue;
    }
    if (source[index] === "}") return null;
    result += source[index++];
  }
  return result;
}

function convertMatrixEnvironment(source, start) {
  const begin = /^\\begin\{(bmatrix|pmatrix|matrix)\}/.exec(source.slice(start));
  if (!begin) return null;
  const environment = begin[1];
  const bodyStart = start + begin[0].length;
  const endMarker = `\\end{${environment}}`;
  const bodyEnd = source.indexOf(endMarker, bodyStart);
  if (bodyEnd < 0) return null;
  const value = convertMatrixBody(source.slice(bodyStart, bodyEnd));
  return value === null ? null : { value, end: bodyEnd + endMarker.length };
}

function convertMatrixBody(body) {
  const rows = [];
  let row = [];
  let cell = "";
  let depth = 0;
  for (let index = 0; index < body.length;) {
    if (body[index] === "{") depth += 1;
    else if (body[index] === "}") depth -= 1;
    if (depth === 0 && body[index] === "&") { row.push(cell.trim()); cell = ""; index += 1; continue; }
    if (depth === 0 && body.startsWith("\\\\", index)) { row.push(cell.trim()); rows.push(row); row = []; cell = ""; index += 2; continue; }
    cell += body[index++];
  }
  row.push(cell.trim());
  rows.push(row);
  const converted = rows.map((items) => items.map((item) => convertLatex(item)));
  if (!converted.length || converted.some((items) => items.length !== converted[0].length || items.some((item) => item === null))) return null;
  return `[${converted.map((items) => items.join(",")).join(";")}]`;
}

function node(tag, children = []) {
  return { tag, children };
}

function leaf(tag, value) {
  return { tag, children: [String(value)] };
}

function symbolNode(name) {
  if (name === "E") return leaf("mi", "e");
  if (GREEK[name]) return leaf("mi", GREEK[name]);
  const underscore = name.indexOf("_");
  if (underscore > 0 && underscore < name.length - 1) {
    const base = symbolNode(name.slice(0, underscore));
    const subscript = leaf(/^\d+$/.test(name.slice(underscore + 1)) ? "mn" : "mi", name.slice(underscore + 1));
    return node("msub", [base, subscript]);
  }
  return leaf("mi", name);
}

function astToMathML(ast) {
  switch (ast.type) {
    case "number": return leaf("mn", ast.value);
    case "symbol": return symbolNode(ast.name);
    case "group": return node("mrow", [leaf("mo", "("), astToMathML(ast.value), leaf("mo", ")")]);
    case "unary": return node("mrow", [leaf("mo", ast.operator === "-" ? "−" : "+"), astToMathML(ast.value)]);
    case "binary": {
      if (ast.operator === "/") return node("mfrac", [astToMathML(ast.left), astToMathML(ast.right)]);
      if (ast.operator === "^") return node("msup", [astToMathML(ast.left), astToMathML(ast.right)]);
      const operator = ast.operator === "*" ? "·" : ({ "<=" : "≤", ">=" : "≥", "==": "=", "!=": "≠" }[ast.operator] ?? ast.operator);
      return node("mrow", [astToMathML(ast.left), leaf("mo", operator), astToMathML(ast.right)]);
    }
    case "call": {
      if (ast.name === "sqrt") return node("msqrt", [astToMathML(ast.args[0])]);
      if (ast.name === "nthroot") return node("mroot", [astToMathML(ast.args[0]), astToMathML(ast.args[1])]);
      return node("mrow", [leaf("mi", ast.name), node("mfenced", ast.args.flatMap((arg, index) => index ? [leaf("mo", ","), astToMathML(arg)] : [astToMathML(arg)]))]);
    }
    case "matrix": return node("mrow", [leaf("mo", "["), node("mtable", ast.rows.map((row, r) => node("mtr", row.map((entry, c) => node("mtd", [astToMathML(entry)]))))), leaf("mo", "]")]);
    case "index": return node("msub", [astToMathML(ast.target), node("mrow", ast.indices.flatMap((index, position) => position ? [leaf("mo", ","), astToMathML(index)] : [astToMathML(index)]))]);
    default: return null;
  }
}

export function parseExpressionTree(source) {
  source = source.trim();
  if (!source || source.length > 2_000) return null;
  const tokens = tokenize(source);
  if (!tokens?.length) return null;
  let cursor = 0;
  const peek = (value) => tokens[cursor]?.value === value;
  const consume = (value) => {
    if (!peek(value)) throw new Error("Unexpected token");
    cursor += 1;
  };

  function primary() {
    const token = tokens[cursor];
    if (!token) throw new Error("Missing value");
    if (token.type === "number") {
      cursor += 1;
      return { type: "number", value: token.value };
    }
    if (token.type === "name") {
      cursor += 1;
      if (peek("(")) {
        const arity = FUNCTIONS.get(token.value);
        consume("(");
        const args = [expression()];
        while (peek(",")) {
          consume(",");
          args.push(expression());
        }
        consume(")");
        if (arity !== undefined && arity !== null && args.length !== arity) throw new Error("Incorrect number of function arguments");
        if (token.value === "piecewise" && (args.length < 3 || args.length % 2 === 0)) throw new Error("Piecewise expressions require alternating values and conditions followed by a default value");
        return { type: "call", name: token.value, args };
      }
      let value = { type: "symbol", name: token.value };
      if (peek("[")) {
        consume("[");
        const indices = [expression()];
        while (peek(",")) { consume(","); indices.push(expression()); }
        consume("]");
        if (indices.length > 2) throw new Error("Matrix access accepts one or two indices");
        value = { type: "index", target: value, indices };
      }
      return value;
    }
    if (peek("[")) {
      consume("[");
      const rows = [];
      while (true) {
        const row = [expression()];
        while (peek(",")) { consume(","); row.push(expression()); }
        rows.push(row);
        if (!peek(";")) break;
        consume(";");
      }
      consume("]");
      if (rows.some((row) => row.length !== rows[0].length)) throw new Error("Matrix rows must have the same number of entries");
      return { type: "matrix", rows };
    }
    if (peek("(")) {
      consume("(");
      const value = expression();
      consume(")");
      return { type: "group", value };
    }
    throw new Error("Expected a value");
  }

  function power() {
    let left = primary();
    if (peek("^")) {
      consume("^");
      const right = unary();
      const exponent = right.type === "group" ? right.value : right;
      left = exponent.type === "symbol" && exponent.name === "T"
        ? { type: "call", name: "transpose", args: [left] }
        : { type: "binary", operator: "^", left, right };
    }
    return left;
  }

  function unary() {
    if (peek("+") || peek("-")) {
      const operator = tokens[cursor++].value;
      return { type: "unary", operator, value: unary() };
    }
    return power();
  }

  function product() {
    let left = unary();
    while (peek("*") || peek("/") || startsPrimary(tokens[cursor])) {
      const implicit = !peek("*") && !peek("/");
      const operator = implicit ? "*" : tokens[cursor++].value;
      left = { type: "binary", operator, left, right: unary() };
    }
    return left;
  }

  function expression() {
    let left = product();
    while (peek("+") || peek("-")) {
      const operator = tokens[cursor++].value;
      left = { type: "binary", operator, left, right: product() };
    }
    if (["<", ">", "<=", ">=", "==", "!=", "="].includes(tokens[cursor]?.value)) {
      const operator = tokens[cursor++].value;
      left = { type: "binary", operator: operator === "=" ? "==" : operator, left, right: product() };
      if (["<", ">", "<=", ">=", "==", "!=", "="].includes(tokens[cursor]?.value)) throw new Error("Only one comparison is supported at a time");
    }
    return left;
  }

  try {
    const tree = expression();
    return cursor === tokens.length ? tree : null;
  } catch {
    return null;
  }
}

function startsPrimary(token) {
  return token?.type === "number" || token?.type === "name" || token?.value === "(" || token?.value === "[";
}

export function latexToExpression(latex) {
  if (typeof latex !== "string" || latex.length > 8_000) return null;
  const source = convertLatex(latex.trim());
  return source !== null && parseExpressionTree(source) ? source : null;
}

export function expressionToLatex(source) {
  const tree = parseExpressionTree(source);
  if (!tree) return "";
  const greek = Object.fromEntries(Object.keys(GREEK).filter((name) => name !== "Infinity" && name !== "inf")
    .map((name) => [name, `\\${name === "infinity" ? "infty" : name}`]));
  function emit(ast) {
    switch (ast.type) {
      case "number": return ast.value;
      case "symbol": {
        if (greek[ast.name]) return greek[ast.name];
        const match = /^([A-Za-z][A-Za-z0-9]*?)_([A-Za-z0-9]+)$/.exec(ast.name);
        return match ? `${emit({ type: "symbol", name: match[1] })}_{${match[2]}}` : ast.name;
      }
      case "group": return `\\left(${emit(ast.value)}\\right)`;
      case "unary": return `${ast.operator}${emit(ast.value)}`;
      case "binary": {
        if (ast.operator === "/") return `\\frac{${emit(ast.left)}}{${emit(ast.right)}}`;
        if (ast.operator === "^") return `${emit(ast.left)}^{${emit(ast.right)}}`;
        const operator = { "*": "\\cdot ", "==": "=", "!=": "\\ne ", "<=": "\\le ", ">=": "\\ge " }[ast.operator] ?? ast.operator;
        return `${emit(ast.left)}${operator}${emit(ast.right)}`;
      }
      case "call": {
        if (ast.name === "transpose") return `${emit(ast.args[0])}^{T}`;
        if (ast.name === "sqrt") return `\\sqrt{${emit(ast.args[0])}}`;
        if (ast.name === "nthroot") return `\\sqrt[${emit(ast.args[1])}]{${emit(ast.args[0])}}`;
        const aliases = { asin: "arcsin", acos: "arccos", atan: "arctan" };
        const name = FUNCTIONS.has(ast.name) ? `\\${aliases[ast.name] ?? ast.name}` : ast.name;
        return `${name}\\left(${ast.args.map(emit).join(",")}\\right)`;
      }
      case "matrix": return `\\begin{bmatrix}${ast.rows.map((row) => row.map(emit).join(" & ")).join(" \\\\ ")}\\end{bmatrix}`;
      case "index": return `${emit(ast.target)}[${ast.indices.map(emit).join(",")}]`;
      default: return "";
    }
  }
  return emit(tree);
}

export function sourceToMathLiveLatex(source) {
  const definition = topLevelEquals(source);
  if (definition >= 0) {
    const left = source.slice(0, definition).trim().replace(/\\left|\\right/g, "");
    const right = source.slice(definition + 1).trim();
    const validLeft = /^[A-Za-z_]\w*$/.test(left) || /^[A-Za-z_]\w*\s*\(\s*[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\s*\)$/.test(left);
    const normalizedRight = latexToExpression(right);
    if (validLeft && normalizedRight !== null) return `${expressionToLatex(left)}=${expressionToLatex(normalizedRight)}`;
  }
  const expression = latexToExpression(source);
  return expression === null ? source : expressionToLatex(expression);
}

export function compileMath(source) {
  const equals = topLevelEquals(source);
  const sideTree = (side) => {
    const expression = side.includes("\\") ? latexToExpression(side) : side;
    return expression === null ? null : parseExpressionTree(expression);
  };
  if (equals >= 0) {
    const left = sideTree(source.slice(0, equals).trim());
    const right = sideTree(source.slice(equals + 1).trim());
    return left && right ? node("math", [node("mrow", [astToMathML(left), leaf("mo", "="), astToMathML(right)])]) : null;
  }
  const tree = sideTree(source);
  return tree ? node("math", [astToMathML(tree)]) : null;
}
