/**
 * A tiny, safe arithmetic language for derived report rows, e.g.
 *   formula: syringes_in / syringes_out * 100
 * Supports numbers, row ids, + - * /, unary minus and parentheses.
 * No eval, no function calls, no property access.
 */

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; id: string }
  | { kind: 'neg'; arg: Expr }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr };

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`Bad number at ${i}`);
      tokens.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-z_]/i.test(c)) {
      const m = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i))!;
      tokens.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if ('+-*/()'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
    } else {
      throw new Error(`Unexpected character "${c}"`);
    }
  }
  return tokens;
}

export function parseFormula(src: string): Expr {
  if (src.length > 500) throw new Error('Formula is too long');
  const tokens = tokenize(src);
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;

  function primary(): Expr {
    const tok = tokens[pos++];
    if (!tok) throw new Error('Unexpected end of formula');
    if (tok.t === 'num') return { kind: 'num', value: tok.v };
    if (tok.t === 'id') return { kind: 'ref', id: tok.v };
    if (tok.v === '(') {
      if (++depth > 32) throw new Error('Formula is nested too deeply');
      const e = additive();
      if (!isOp(')')) throw new Error('Missing ")"');
      pos++;
      depth--;
      return e;
    }
    if (tok.v === '-') return { kind: 'neg', arg: primary() };
    throw new Error(`Unexpected "${tok.v}"`);
  }
  function multiplicative(): Expr {
    let left = primary();
    while (isOp('*') || isOp('/')) {
      const op = tokens[pos++].v as '*' | '/';
      left = { kind: 'bin', op, left, right: primary() };
    }
    return left;
  }
  function additive(): Expr {
    let left = multiplicative();
    while (isOp('+') || isOp('-')) {
      const op = tokens[pos++].v as '+' | '-';
      left = { kind: 'bin', op, left, right: multiplicative() };
    }
    return left;
  }
  const expr = additive();
  if (pos !== tokens.length) throw new Error(`Unexpected "${String(tokens[pos].v)}"`);
  return expr;
}

export function formulaRefs(e: Expr, out: Set<string> = new Set()): Set<string> {
  if (e.kind === 'ref') out.add(e.id);
  else if (e.kind === 'neg') formulaRefs(e.arg, out);
  else if (e.kind === 'bin') {
    formulaRefs(e.left, out);
    formulaRefs(e.right, out);
  }
  return out;
}

/** Evaluates; returns null when any input is null or a division by zero occurs. */
export function evaluateFormula(e: Expr, lookup: (id: string) => number | null): number | null {
  switch (e.kind) {
    case 'num':
      return e.value;
    case 'ref':
      return lookup(e.id);
    case 'neg': {
      const v = evaluateFormula(e.arg, lookup);
      return v === null ? null : -v;
    }
    case 'bin': {
      const l = evaluateFormula(e.left, lookup);
      const r = evaluateFormula(e.right, lookup);
      if (l === null || r === null) return null;
      switch (e.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return r === 0 ? null : l / r;
      }
    }
  }
}
