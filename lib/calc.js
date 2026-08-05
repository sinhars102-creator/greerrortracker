// Small recursive-descent arithmetic evaluator — deliberately not eval()/
// Function() since the calculator's expression string is built entirely
// from button presses, but a hand-rolled parser keeps it that way even if
// the expression logic changes later. Supports +, -, *, /, parens, and
// unary +/-.
export function evaluateExpression(expr) {
  const tokens = expr.match(/(\d+\.?\d*|\.\d+|[+\-*/()])/g) || [];
  if (tokens.length === 0) return 0;
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let val = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = parseTerm();
      val = op === "+" ? val + rhs : val - rhs;
    }
    return val;
  }
  function parseTerm() {
    let val = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const rhs = parseFactor();
      val = op === "*" ? val * rhs : val / rhs;
    }
    return val;
  }
  function parseFactor() {
    if (peek() === "-") { next(); return -parseFactor(); }
    if (peek() === "+") { next(); return parseFactor(); }
    if (peek() === "(") {
      next();
      const val = parseExpr();
      if (peek() === ")") next();
      return val;
    }
    const t = next();
    const val = parseFloat(t);
    if (Number.isNaN(val)) throw new Error("Malformed expression");
    return val;
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("Malformed expression");
  return result;
}
