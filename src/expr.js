// Безопасный язык выражений: любые уравнения уровня (движение, условия, правила)
// компилируются в замыкания — без eval. Новые функции добавляются через registerFunction().

const CONST = { pi: Math.PI, tau: Math.PI * 2, e: Math.E, true: 1, false: 0, inf: 1e9 };

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
const fract = (x) => x - Math.floor(x);

export const Fns = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, abs: Math.abs, sqrt: Math.sqrt, cbrt: Math.cbrt,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign,
  exp: Math.exp, log: Math.log, ln: Math.log, log2: Math.log2, pow: Math.pow, hypot: Math.hypot,
  min: Math.min, max: Math.max,
  clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
  lerp: (a, b, t) => a + (b - a) * t,
  mix: (a, b, t) => a + (b - a) * t,
  fract,
  mod: (a, b) => (b === 0 ? 0 : a - b * Math.floor(a / b)),
  step: (e, x) => (x < e ? 0 : 1),
  smoothstep: (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
  ease: (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); },
  saw: (t, p = 1) => fract(t / (p || 1)),
  tri: (t, p = 1) => 1 - Math.abs(2 * fract(t / (p || 1)) - 1),
  sq: (t, p = 1) => (fract(t / (p || 1)) < 0.5 ? 1 : 0),
  pulse: (t, p = 1, d = 0.5) => (fract(t / (p || 1)) < d ? 1 : 0),
  bounce: (t) => Math.abs(Math.sin(t * Math.PI)),
  noise, rand: hash,
  deg: (x) => (x * 180) / Math.PI, rad: (x) => (x * Math.PI) / 180,
  if: (c, a, b) => (c ? a : b),
};

export function registerFunction(name, fn) { Fns[name] = fn; }

function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    let m;
    if ((m = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/.exec(src.slice(i)))) { toks.push({ k: 'num', v: parseFloat(m[1]) }); i += m[1].length; continue; }
    if ((m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i)))) {
      const w = m[0];
      const lw = w.toLowerCase();
      if (lw === 'and') toks.push({ k: 'op', v: '&&' });
      else if (lw === 'or') toks.push({ k: 'op', v: '||' });
      else if (lw === 'not') toks.push({ k: 'op', v: '!' });
      else toks.push({ k: 'id', v: w });
      i += w.length; continue;
    }
    const two = src.slice(i, i + 2);
    if (['**', '<=', '>=', '==', '!=', '&&', '||'].includes(two)) { toks.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/%^()<>,?:!'.includes(c)) { toks.push({ k: 'op', v: c }); i++; continue; }
    throw new Error(`Неожиданный символ «${c}»`);
  }
  return toks;
}

let depth = 0;

function parse(toks, vars) {
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p] && toks[p].k === 'op' && toks[p].v === v;
  const eat = (v) => { if (!isOp(v)) throw new Error(`Ожидалось «${v}»`); p++; };

  function ternary() {
    const c = orExpr();
    if (isOp('?')) {
      p++; const a = ternary(); eat(':'); const b = ternary();
      return (s) => (c(s) ? a(s) : b(s));
    }
    return c;
  }
  function orExpr() { let l = andExpr(); while (isOp('||')) { p++; const a = l, r = andExpr(); l = (s) => (a(s) || r(s) ? 1 : 0); } return l; }
  function andExpr() { let l = eqExpr(); while (isOp('&&')) { p++; const a = l, r = eqExpr(); l = (s) => (a(s) && r(s) ? 1 : 0); } return l; }
  function eqExpr() {
    let l = relExpr();
    while (isOp('==') || isOp('!=')) {
      const op = toks[p++].v; const a = l, r = relExpr();
      l = op === '==' ? (s) => (Math.abs(a(s) - r(s)) < 1e-9 ? 1 : 0) : (s) => (Math.abs(a(s) - r(s)) >= 1e-9 ? 1 : 0);
    }
    return l;
  }
  function relExpr() {
    let l = addExpr();
    while (isOp('<') || isOp('>') || isOp('<=') || isOp('>=')) {
      const op = toks[p++].v; const a = l, r = addExpr();
      l = op === '<' ? (s) => (a(s) < r(s) ? 1 : 0) : op === '>' ? (s) => (a(s) > r(s) ? 1 : 0)
        : op === '<=' ? (s) => (a(s) <= r(s) ? 1 : 0) : (s) => (a(s) >= r(s) ? 1 : 0);
    }
    return l;
  }
  function addExpr() {
    let l = mulExpr();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v; const a = l, r = mulExpr();
      l = op === '+' ? (s) => a(s) + r(s) : (s) => a(s) - r(s);
    }
    return l;
  }
  function mulExpr() {
    let l = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = toks[p++].v; const a = l, r = unary();
      l = op === '*' ? (s) => a(s) * r(s) : op === '/' ? (s) => { const d = r(s); return d === 0 ? 0 : a(s) / d; }
        : (s) => { const d = r(s); return d === 0 ? 0 : a(s) - d * Math.floor(a(s) / d); };
    }
    return l;
  }
  function unary() {
    if (isOp('-')) { p++; const a = unary(); return (s) => -a(s); }
    if (isOp('+')) { p++; return unary(); }
    if (isOp('!')) { p++; const a = unary(); return (s) => (a(s) ? 0 : 1); }
    return power();
  }
  function power() {
    const base = primary();
    if (isOp('^') || isOp('**')) { p++; const ex = unary(); return (s) => { const v = Math.pow(base(s), ex(s)); return Number.isFinite(v) ? v : 0; }; }
    return base;
  }
  function primary() {
    const t = peek();
    if (!t) throw new Error('Неожиданный конец выражения');
    if (t.k === 'num') { p++; const v = t.v; return () => v; }
    if (t.k === 'op' && t.v === '(') { p++; const e = ternary(); eat(')'); return e; }
    if (t.k === 'id') {
      p++;
      const name = t.v;
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) { do { args.push(ternary()); if (isOp(',')) p++; else break; } while (true); }
        eat(')');
        return (s) => {
          const f = (s.$f && s.$f[name]) || Fns[name];
          if (!f) return 0;
          const vals = args.map((a) => a(s));
          if (f.$user) { if (depth > 24) return 0; depth++; try { return f(s, vals); } finally { depth--; } }
          const v = f(...vals);
          return Number.isFinite(v) ? v : 0;
        };
      }
      vars.add(name);
      return (s) => {
        const v = s[name];
        if (v === undefined) { const c = CONST[name]; return c === undefined ? 0 : c; }
        return v === true ? 1 : v === false ? 0 : v;
      };
    }
    throw new Error(`Неожиданно «${t.v}»`);
  }

  const root = ternary();
  if (p < toks.length) throw new Error(`Лишнее «${toks[p].v}»`);
  return root;
}

export function compile(src) {
  const vars = new Set();
  const text = String(src ?? '').trim();
  if (text === '') return { fn: () => 0, vars, error: null };
  try {
    const fn = parse(tokenize(text), vars);
    return { fn, vars, error: null };
  } catch (err) {
    return { fn: () => 0, vars, error: err.message };
  }
}

const cache = new Map();
export function getExpr(src) {
  const key = String(src ?? '');
  let c = cache.get(key);
  if (!c) { c = compile(key); if (cache.size > 2000) cache.clear(); cache.set(key, c); }
  return c;
}

// Пользовательская функция из defs: "f(a,b)" : "выражение"
export function makeUserFn(params, body) {
  const c = getExpr(body);
  const f = (scope, vals) => {
    const s = Object.create(scope);
    params.forEach((nm, i) => { s[nm] = vals[i] ?? 0; });
    const v = c.fn(s);
    return Number.isFinite(v) ? v : 0;
  };
  f.$user = true;
  return f;
}
