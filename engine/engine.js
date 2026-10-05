// Cooked Books — puzzle engine (generator + solver). No dependencies. Runs in browser (ESM) and node.
// Model: n×n ledger. Each entry is genuine or forged. Each entry carries one note.
// Genuine entries' notes are TRUE; forged entries' notes are FALSE. Exactly K entries are forged (K shown).
// Entries start hidden except a few audited ones. Judging an entry correctly audits it and opens its note.
// The generator guarantees that at every step at least one unjudged entry is logically determined
// from the open notes + K, which also guarantees a unique solution.

// ---------- deterministic RNG ----------
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function shuffle(rng, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- geometry ----------
const DIRS = { above: [-1, 0], below: [1, 0], left: [0, -1], right: [0, 1] };
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const COLS = 'ABCDEFGH';
export const cellName = (n, i) => `${COLS[i % n]}${Math.floor(i / n) + 1}`;

// ---------- clue evaluation on a partial assignment ----------
// a: array of true (forged) / false (genuine) / undefined (unknown). Returns true/false/undefined.
function countKnown(a, idxs) {
  let t = 0, u = 0;
  for (const j of idxs) { if (a[j] === true) t++; else if (a[j] === undefined) u++; }
  return [t, u];
}
function evalExact(a, idxs, k) {
  const [t, u] = countKnown(a, idxs);
  if (t > k || t + u < k) return false;
  if (u === 0) return t === k;
  return undefined;
}
function evalParity(a, idxs, even) {
  const [t, u] = countKnown(a, idxs);
  if (u > 0) return undefined;
  return (t % 2 === 0) === even;
}
function evalAll(a, idxs, forged) { // all entries in idxs are `forged`
  let und = false;
  for (const j of idxs) { if (a[j] === undefined) und = true; else if (a[j] !== forged) return false; }
  return und ? undefined : true;
}

const word = (k) => ['none', 'exactly one', 'exactly two', 'exactly three', 'exactly four', 'exactly five', 'exactly six'][k];
const kind = (f) => (f ? 'forged' : 'genuine');
const AXIS = { row: 'row', col: 'column' };
const DIRTXT = { above: 'directly above', below: 'directly below', left: 'to the left of', right: 'to the right of' };

// Each clue: { type, params, refs:[indices], text, eval(a) }
function makeClue(n, i, type, p, geo) {
  const r = Math.floor(i / n), c = i % n;
  const { row, col, rowOthers, colOthers, nb4, diag, above, below } = geo;
  switch (type) {
    case 'DIR_STATUS': { const j = p.j; return { type, params: p, refs: [j], text: `The entry ${DIRTXT[p.dir]} this one is ${kind(p.forged)}.`, eval: (a) => (a[j] === undefined ? undefined : a[j] === p.forged) }; }
    case 'DIR_SAME': { const j = p.j; return { type, params: p, refs: [i, j], text: p.same ? `The entry ${DIRTXT[p.dir]} this one is the same kind as this one.` : `The entry ${DIRTXT[p.dir]} this one is a different kind from this one.`, eval: (a) => (a[j] === undefined || a[i] === undefined ? undefined : (a[i] === a[j]) === p.same) }; }
    case 'LINE_COUNT': { const idxs = p.axis === 'row' ? row : col; return { type, params: p, refs: idxs, text: `${cap(word(p.k))} of the entries in this ${AXIS[p.axis]} ${p.k === 1 ? 'is' : 'are'} forged.`, eval: (a) => evalExact(a, idxs, p.k) }; }
    case 'LINE_PARITY': { const idxs = p.axis === 'row' ? row : col; return { type, params: p, refs: idxs, text: `An ${p.even ? 'even' : 'odd'} number of entries in this ${AXIS[p.axis]} are forged.`, eval: (a) => evalParity(a, idxs, p.even) }; }
    case 'NEIGH_COUNT': return { type, params: p, refs: nb4, text: `${cap(word(p.k))} of the entries touching this one (up, down, left, right) ${p.k === 1 ? 'is' : 'are'} forged.`, eval: (a) => evalExact(a, nb4, p.k) };
    case 'DIAG_COUNT': return { type, params: p, refs: diag, text: `${cap(word(p.k))} of the entries diagonal to this one ${p.k === 1 ? 'is' : 'are'} forged.`, eval: (a) => evalExact(a, diag, p.k) };
    case 'OTHERS_ALL': { const idxs = p.axis === 'row' ? rowOthers : colOthers; return { type, params: p, refs: idxs, text: `Every other entry in this ${AXIS[p.axis]} is ${kind(p.forged)}.`, eval: (a) => evalAll(a, idxs, p.forged) }; }
    case 'SEG_COUNT': { const idxs = p.side === 'above' ? above : below; return { type, params: p, refs: idxs, text: `${cap(word(p.k))} of the entries ${p.side} this one in this column ${p.k === 1 ? 'is' : 'are'} forged.`, eval: (a) => evalExact(a, idxs, p.k) }; }
    case 'EXTREME': { const j = p.j; return { type, params: p, refs: [j], text: `The ${p.max ? 'largest' : 'smallest'} amount in this ${AXIS[p.axis]} belongs to a ${kind(p.forged)} entry.`, eval: (a) => (a[j] === undefined ? undefined : a[j] === p.forged) }; }
    case 'CORNERS': return { type, params: p, refs: p.idxs, text: `${cap(word(p.k))} of the four corner entries ${p.k === 1 ? 'is' : 'are'} forged.`, eval: (a) => evalExact(a, p.idxs, p.k) };
    default: throw new Error('unknown clue ' + type);
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function geometry(n, i, amounts) {
  const r = Math.floor(i / n), c = i % n;
  const row = [], col = [], rowOthers = [], colOthers = [], nb4 = [], diag = [], above = [], below = [];
  for (let k = 0; k < n; k++) { row.push(r * n + k); col.push(k * n + c); if (k !== c) rowOthers.push(r * n + k); if (k !== r) colOthers.push(k * n + c); if (k < r) above.push(k * n + c); if (k > r) below.push(k * n + c); }
  for (const [dr, dc] of Object.values(DIRS)) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < n && cc >= 0 && cc < n) nb4.push(rr * n + cc); }
  for (const [dr, dc] of DIAG) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < n && cc >= 0 && cc < n) diag.push(rr * n + cc); }
  const dirs = {};
  for (const [name, [dr, dc]] of Object.entries(DIRS)) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < n && cc >= 0 && cc < n) dirs[name] = rr * n + cc; }
  const argExt = (idxs, max) => idxs.reduce((b, j) => (b === -1 || (max ? amounts[j] > amounts[b] : amounts[j] < amounts[b]) ? j : b), -1);
  return { r, c, row, col, rowOthers, colOthers, nb4, diag, above, below, dirs, rowMax: argExt(row, true), rowMin: argExt(row, false), colMax: argExt(col, true), colMin: argExt(col, false) };
}

// All candidate clues for cell i (as factories), to be filtered by truth value.
function candidateClues(n, i, geo, corners) {
  const out = [];
  for (const [dir, j] of Object.entries(geo.dirs)) {
    out.push(['DIR_STATUS', { dir, j, forged: true }]); out.push(['DIR_STATUS', { dir, j, forged: false }]);
    out.push(['DIR_SAME', { dir, j, same: true }]); out.push(['DIR_SAME', { dir, j, same: false }]);
  }
  for (const axis of ['row', 'col']) {
    for (let k = 0; k <= n; k++) out.push(['LINE_COUNT', { axis, k }]);
    out.push(['LINE_PARITY', { axis, even: true }]); out.push(['LINE_PARITY', { axis, even: false }]);
    out.push(['OTHERS_ALL', { axis, forged: true }]); out.push(['OTHERS_ALL', { axis, forged: false }]);
    for (const max of [true, false]) {
      const j = axis === 'row' ? (max ? geo.rowMax : geo.rowMin) : (max ? geo.colMax : geo.colMin);
      if (j !== i) { out.push(['EXTREME', { axis, max, j, forged: true }]); out.push(['EXTREME', { axis, max, j, forged: false }]); }
    }
  }
  for (let k = 0; k <= geo.nb4.length; k++) out.push(['NEIGH_COUNT', { k }]);
  for (let k = 0; k <= geo.diag.length; k++) if (geo.diag.length) out.push(['DIAG_COUNT', { k }]);
  if (geo.above.length >= 2) for (let k = 0; k <= geo.above.length; k++) out.push(['SEG_COUNT', { side: 'above', k }]);
  if (geo.below.length >= 2) for (let k = 0; k <= geo.below.length; k++) out.push(['SEG_COUNT', { side: 'below', k }]);
  if (!corners.includes(i)) for (let k = 0; k <= 4; k++) out.push(['CORNERS', { k, idxs: corners }]);
  return out;
}

// ---------- SAT: is there an assignment consistent with constraints, with cell u forced to value v? ----------
// constraints: array of { eval(a) }, plus total forged count K over all n*n cells.
function satisfiable(a0, constraints, total, N) {
  const a = a0.slice();
  // variables referenced by constraints
  const refSet = new Set();
  for (const c of constraints) for (const j of c.refs) if (a[j] === undefined) refSet.add(j);
  const vars = [...refSet];
  // order by number of constraints referencing (desc)
  const deg = new Map(vars.map((v) => [v, 0]));
  for (const c of constraints) for (const j of c.refs) if (deg.has(j)) deg.set(j, deg.get(j) + 1);
  vars.sort((x, y) => deg.get(y) - deg.get(x));
  const check = () => { for (const c of constraints) if (c.eval(a) === false) return false; return true; };
  const countOK = () => { let t = 0, u = 0; for (let j = 0; j < N; j++) { if (a[j] === true) t++; else if (a[j] === undefined) u++; } return t <= total && t + u >= total; };
  if (!check() || !countOK()) return false;
  const rec = (k) => {
    if (k === vars.length) return true; // remaining unreferenced vars only need the count, already feasible
    const v = vars[k];
    for (const val of [false, true]) {
      a[v] = val;
      if (check() && countOK() && rec(k + 1)) { a[v] = undefined; return true; }
    }
    a[v] = undefined;
    return false;
  };
  return rec(0);
}

// ---------- progressive solvability ----------
// cells: [{forged, clue}], K, revealed: Set of indices (status known, note open).
// Returns { ok, steps:[{determined:[i..], hard:bool}], reveals:[...] } simulating "add all determinable cells each step".
export function progressiveSolve(n, cells, K, revealedInit, opts = {}) {
  const N = n * n;
  const known = new Set(revealedInit);
  const extraReveals = [];
  const maxReveals = opts.maxReveals ?? 0;
  const steps = [];
  const assignOf = () => { const a = new Array(N).fill(undefined); for (const j of known) a[j] = cells[j].forged; return a; };
  const constraintsOf = () => [...known].map((j) => { const cl = cells[j].clue; const truth = !cells[j].forged; return { refs: cl.refs, eval: (a) => { const v = cl.eval(a); return v === undefined ? undefined : v === truth; } }; });
  const determinable = () => {
    const a = assignOf(); const cons = constraintsOf(); const D = [];
    for (let u = 0; u < N; u++) if (!known.has(u)) { const b = a.slice(); b[u] = !cells[u].forged; if (!satisfiable(b, cons, K, N)) D.push(u); }
    return { D, a, cons };
  };
  // level-1: contradiction visible from a single open note or the K count without any further case analysis
  const isLevel1 = (u, a, cons) => {
    const b = a.slice(); b[u] = !cells[u].forged;
    for (const c of cons) if (c.eval(b) === false) return true;
    let t = 0, un = 0; for (let j = 0; j < N; j++) { if (b[j] === true) t++; else if (b[j] === undefined) un++; }
    return t > K || t + un < K;
  };
  let guard = 0;
  while (known.size < N && guard++ < N + 5) {
    let { D, a, cons } = determinable();
    if (D.length === 0) {
      if (extraReveals.length >= maxReveals) return { ok: false, steps, reveals: extraReveals, stuckAt: known.size, known: [...known] };
      // reveal the unknown cell that unlocks the most next
      let best = -1, bestN = -1;
      for (let u = 0; u < N; u++) if (!known.has(u)) { known.add(u); const d2 = determinable().D.length; known.delete(u); if (d2 > bestN) { bestN = d2; best = u; } }
      extraReveals.push(best); known.add(best);
      continue;
    }
    steps.push({ determined: D, easy: D.filter((u) => isLevel1(u, a, cons)).length }); steps[steps.length - 1].hard = steps[steps.length - 1].easy === 0;
    for (const u of D) known.add(u);
  }
  return { ok: known.size === N, steps, reveals: extraReveals, known: [...known] };
}

// ---------- generator ----------
const TYPE_WEIGHT = { DIR_STATUS: 3, DIR_SAME: 2, LINE_COUNT: 3, LINE_PARITY: 1, NEIGH_COUNT: 2, DIAG_COUNT: 1, OTHERS_ALL: 1, SEG_COUNT: 1, EXTREME: 2, CORNERS: 1 };

export function generate(seedStr, n, target = {}) {
  const N = n * n;
  const corners = [0, n - 1, N - n, N - 1];
  const maxReveals = target.maxReveals ?? (n <= 4 ? 1 : n === 5 ? 2 : 3);
  // difficulty score = 3 × hard steps (no single-note move available) + narrow steps (at most one such move)
  const scoreMin = target.scoreMin ?? 0, scoreMax = target.scoreMax ?? 99;
  const dist = (x) => (x < scoreMin ? scoreMin - x : x > scoreMax ? x - scoreMax : 0);
  let fallback = null;
  for (let attempt = 0; attempt < (target.attempts ?? 300); attempt++) {
    const rng = mulberry32(hashSeed(`${seedStr}#${attempt}`));
    const K = target.K ?? Math.max(2, Math.round(N * (0.3 + rng() * 0.12)));
    const forged = new Array(N).fill(false);
    for (const j of shuffle(rng, [...Array(N).keys()]).slice(0, K)) forged[j] = true;
    // distinct amounts
    const amounts = shuffle(rng, [...Array(N).keys()]).map((k) => 40 + k * 7 + Math.floor(rng() * 6)).map((v) => v * 10 + Math.floor(rng() * 10));
    const full = forged.slice();
    const cells = [];
    let bad = false;
    for (let i = 0; i < N; i++) {
      const geo = geometry(n, i, amounts);
      const cands = candidateClues(n, i, geo, corners).map(([t, p]) => makeClue(n, i, t, p, geo)).filter((cl) => cl.eval(full) === !forged[i]);
      if (!cands.length) { bad = true; break; }
      // weighted pick by type
      const W = target.weights || TYPE_WEIGHT; const w = cands.map((cl) => W[cl.type] ?? 1); const tot = w.reduce((x, y) => x + y, 0);
      let r = rng() * tot, chosen = cands[0];
      for (let k = 0; k < cands.length; k++) { r -= w[k]; if (r <= 0) { chosen = cands[k]; break; } }
      cells.push({ amount: amounts[i], forged: forged[i], clue: chosen, cands });
    }
    if (bad) continue;
    // starting reveal: one genuine cell, prefer informative (many refs)
    const genuine = [...Array(N).keys()].filter((j) => !forged[j]);
    const start = pick(rng, genuine);
    let res = progressiveSolve(n, cells, K, [start], { maxReveals });
    // repair: when the deduction chain stalls, swap the note of one already-open entry for another true note
    // that makes some hidden entry deducible, then re-verify from the start. Raises the solvable rate on 6x6
    // from ~1% of random boards, so the difficulty target has a real pool to choose from.
    for (let fix = 0; !res.ok && fix < (target.repairs ?? 8); fix++) {
      const known = res.known; let done = false, tries = 0;
      for (const j of shuffle(rng, known)) {
        for (const alt of shuffle(rng, cells[j].cands)) {
          if (alt === cells[j].clue || ++tries > 80) continue;
          const old = cells[j].clue; cells[j].clue = alt;
          if (progressiveSolve(n, cells, K, known, { maxReveals: 0 }).steps.length) { done = true; break; }
          cells[j].clue = old;
        }
        if (done || tries > 80) break;
      }
      if (!done) break;
      res = progressiveSolve(n, cells, K, [start], { maxReveals });
    }
    if (!res.ok) continue;
    const hard = res.steps.filter((s) => s.hard).length;
    const score = 3 * hard + res.steps.filter((s) => s.easy <= 1).length;
    if (target.onCandidate) target.onCandidate(res);
    const puzzle = { n, K, cells: cells.map((c) => ({ amount: c.amount, forged: c.forged, clue: { type: c.clue.type, params: c.clue.params, refs: c.clue.refs, text: c.clue.text } })), revealed: [start, ...res.reveals], steps: res.steps.map((s) => s.determined), hardSteps: hard, score, attempt };
    if (!dist(score)) return puzzle;
    if (!fallback || dist(score) < dist(fallback.score)) fallback = puzzle;
  }
  return fallback;
}

// Rebuild clue eval functions from a serialized puzzle (for the UI, which gets plain JSON).
export function hydrate(puzzle) {
  const { n } = puzzle; const N = n * n; const corners = [0, n - 1, N - n, N - 1];
  const amounts = puzzle.cells.map((c) => c.amount);
  return { ...puzzle, cells: puzzle.cells.map((c, i) => ({ ...c, clue: makeClue(n, i, c.clue.type, c.clue.params, geometry(n, i, amounts)) })) };
}

// ---------- daily schedule ----------
export const EPOCH = '2026-10-02'; // puzzle #1 (dev epoch; renumber at launch if desired)
export function dayInfo(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const size = [6, 4, 4, 5, 5, 5, 6][dow];
  // score ranges measured 2026-10-05 (p10/p50/p90 ≈ 2/4/9 for every size): Mon easiest → Sun hardest
  const score = [[8, 99], [0, 2], [1, 3], [2, 4], [3, 6], [4, 8], [5, 9]][dow];
  const num = Math.round((d - new Date(EPOCH + 'T00:00:00Z')) / 86400000) + 1;
  return { size, scoreMin: score[0], scoreMax: score[1], number: num, dow };
}
export function daily(dateStr) {
  const info = dayInfo(dateStr);
  const p = generate(`cooked-books:${dateStr}`, info.size, { scoreMin: info.scoreMin, scoreMax: info.scoreMax, attempts: 400 });
  return { ...p, date: dateStr, number: info.number };
}
