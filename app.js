// Cooked Books — UI. Loads today's precomputed puzzle (data/YYYY-MM-DD.json) or generates it on-device.
import { hydrate, daily, cellName, EPOCH } from './engine/engine.js';

const $ = (s) => document.querySelector(s);
const COLS = 'ABCDEFGH';
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (key, n) => { const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const keyOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = (key) => new Date(key + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// ---------- storage ----------
const LS = 'cooked-books:v1';
const load = () => { try { return JSON.parse(localStorage.getItem(LS)) || { games: {}, seenHelp: false }; } catch { return { games: {}, seenHelp: false }; } };
const save = (s) => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch {} };
let store = load();

// ---------- state ----------
const params = new URLSearchParams(location.search);
const pd = params.get('d');
const dateKey = pd && /^\d{4}-\d{2}-\d{2}$/.test(pd) && pd >= EPOCH && pd <= todayKey() ? pd : todayKey();
const isArchive = dateKey !== todayKey();
const dayHref = (key) => (key === todayKey() ? location.pathname : `?d=${key}`);
let P = null; // hydrated puzzle
let G = null; // game record for this date
let selected = -1;

async function loadPuzzle(key) {
  try {
    const r = await fetch(`data/${key}.json`, { cache: 'force-cache' });
    if (r.ok) return hydrate(await r.json());
  } catch {}
  return hydrate(daily(key));
}

function initGame() {
  G = store.games[dateKey];
  if (!G) {
    G = { judged: {}, order: [], mistakes: 0, wrong: {}, startedAt: Date.now(), finishedAt: null };
    for (const i of P.revealed) G.judged[i] = true; // pre-audited (not counted in order)
    store.games[dateKey] = G; save(store);
  }
}

// ---------- rendering ----------
function render() {
  const n = P.n, N = n * n;
  document.documentElement.style.setProperty('--n', n);
  $('#puzzle-no').textContent = `#${P.number}`;
  $('#puzzle-date').textContent = fmtDate(dateKey);
  $('#archive-tag').classList.toggle('hidden', !isArchive);
  $('#k-total').textContent = P.K;
  let found = 0; for (const i in G.judged) if (P.cells[i].forged) found++;
  $('#k-found').textContent = found;
  $('#mistakes').textContent = G.mistakes;
  $('#col-labels').innerHTML = [...Array(n)].map((_, c) => `<div>${COLS[c]}</div>`).join('');
  $('#row-labels').innerHTML = [...Array(n)].map((_, r) => `<div>${r + 1}</div>`).join('');
  const board = $('#board');
  if (board.children.length !== N) {
    board.innerHTML = '';
    for (let i = 0; i < N; i++) {
      const b = document.createElement('button');
      b.className = 'cell'; b.dataset.i = i; b.setAttribute('role', 'gridcell');
      b.innerHTML = `<span class="tag">${cellName(n, i)}</span><span class="amt">${P.cells[i].amount.toLocaleString('en-US')}</span><span class="stamp"></span>`;
      b.addEventListener('click', () => select(i));
      board.appendChild(b);
    }
  }
  for (let i = 0; i < N; i++) {
    const el = board.children[i]; const c = P.cells[i]; const j = G.judged[i];
    el.classList.toggle('genuine', !!j && !c.forged);
    el.classList.toggle('forged', !!j && c.forged);
    el.classList.toggle('wrong-once', !!G.wrong[i]);
    el.classList.toggle('selected', i === selected);
    el.querySelector('.stamp').innerHTML = j ? `<span>${c.forged ? 'FORGED' : 'OK'}</span>` : '';
    el.setAttribute('aria-label', `${cellName(n, i)}, $${c.amount}${j ? (c.forged ? ', forged' : ', genuine') : ', not audited'}`);
    let dot = el.querySelector('.note-dot'); if (j && !dot) { dot = document.createElement('span'); dot.className = 'note-dot'; el.appendChild(dot); } if (!j && dot) dot.remove();
  }
  renderPanel();
  renderNotes();
  if (Object.keys(G.judged).length === N) finish();
}

function highlightRefs(i) {
  const board = $('#board');
  for (const el of board.children) el.classList.remove('ref', 'ref-self');
  if (i < 0 || !G.judged[i]) return;
  for (const r of P.cells[i].clue.refs) if (r !== i) board.children[r].classList.add('ref');
  board.children[i].classList.add('ref-self');
}

function renderPanel() {
  const empty = $('#panel-empty'), pc = $('#panel-cell');
  if (selected < 0) { empty.classList.remove('hidden'); pc.classList.add('hidden'); highlightRefs(-1); return; }
  empty.classList.add('hidden'); pc.classList.remove('hidden');
  const c = P.cells[selected]; const j = G.judged[selected];
  $('#pc-name').textContent = cellName(P.n, selected);
  $('#pc-amount').textContent = c.amount.toLocaleString('en-US');
  const st = $('#pc-status'); st.className = 'pc-status ' + (j ? (c.forged ? 'forged' : 'genuine') : '');
  st.textContent = j ? (c.forged ? 'FORGED' : 'GENUINE') : 'not audited';
  const note = $('#pc-note');
  if (j) { note.className = 'pc-note'; note.innerHTML = `“${c.clue.text}” <span class="${c.forged ? 'lie' : 'truth'}">${c.forged ? '— a lie' : '— true'}</span>`; }
  else { note.className = 'pc-note sealed'; note.textContent = 'Note sealed until audited.'; }
  $('#pc-judge').classList.toggle('hidden', !!j);
  highlightRefs(selected);
}

function renderNotes() {
  const list = $('#notes-list'); list.innerHTML = '';
  const open = Object.keys(G.judged).map(Number).sort((a, b) => a - b);
  $('#notes-count').textContent = `(${open.length})`;
  for (const i of open) {
    const c = P.cells[i];
    const li = document.createElement('li');
    li.className = c.forged ? 'forged' : 'genuine'; if (i === selected) li.classList.add('active');
    li.innerHTML = `<span class="who">${cellName(P.n, i)}</span><span class="what">${c.clue.text}</span>`;
    li.addEventListener('click', () => select(i));
    list.appendChild(li);
  }
}

function select(i) { selected = i; render(); }

function judge(forged) {
  if (selected < 0 || G.judged[selected] || G.finishedAt) return;
  const c = P.cells[selected];
  const el = $('#board').children[selected];
  if (c.forged === forged) {
    G.judged[selected] = true; G.order.push({ i: selected, ok: !G.wrong[selected] });
  } else {
    G.mistakes++; G.wrong[selected] = true;
    el.classList.remove('mistake'); void el.offsetWidth; el.classList.add('mistake');
    // binary choice: a wrong answer reveals the truth, counted as a mistake
    G.judged[selected] = true; G.order.push({ i: selected, ok: false });
  }
  save(store);
  render();
}

function moveSel(dr, dc) {
  const n = P.n;
  if (selected < 0) { select(0); return; }
  const r = Math.floor(selected / n) + dr, c = (selected % n) + dc;
  if (r < 0 || r >= n || c < 0 || c >= n) return;
  select(r * n + c);
}

// ---------- finish / share ----------
function emojiGrid() {
  const n = P.n; let out = '';
  for (let r = 0; r < n; r++) { for (let c = 0; c < n; c++) { const i = r * n + c; out += P.revealed.includes(i) ? '⬜' : G.wrong[i] ? '🟥' : '🟩'; } out += '\n'; }
  return out.trimEnd();
}
function elapsed() { const ms = (G.finishedAt || Date.now()) - G.startedAt; const s = Math.max(1, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function shareText() {
  const url = location.origin + location.pathname;
  return `Cooked Books #${P.number}${isArchive ? ' (archive)' : ''} — ${G.mistakes === 0 ? 'clean audit ✓' : `${G.mistakes} mistake${G.mistakes === 1 ? '' : 's'}`} · ${elapsed()}\n${emojiGrid()}\n${url}`;
}
function finish() {
  if (!G.finishedAt) { G.finishedAt = Date.now(); save(store); }
  $('#done').classList.remove('hidden');
  $('#done-title').textContent = G.mistakes === 0 ? 'Clean audit.' : `Audit complete — ${G.mistakes} mistake${G.mistakes === 1 ? '' : 's'}.`;
  $('#share-grid').textContent = emojiGrid();
  $('#done-summary').textContent = `${P.K} forgeries found in ${elapsed()}. Streak: ${streak().current}.`;
  $('#done-next').classList.toggle('hidden', isArchive);
  $('#done-today').classList.toggle('hidden', !isArchive);
  const prev = dateKey > EPOCH ? addDays(dateKey, -1) : null;
  $('#link-archive').classList.toggle('hidden', !prev);
  if (prev) $('#link-archive').href = dayHref(prev);
  $('#pc-judge').classList.add('hidden');
  if (!finish.scrolled) { finish.scrolled = true; $('#done').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}
function streak() {
  const keys = Object.keys(store.games).filter((k) => store.games[k].finishedAt).sort();
  const onDay = keys.filter((k) => keyOf(store.games[k].finishedAt) === k); // archive play doesn't count toward streaks
  let cur = 0, best = 0, prev = null;
  for (const k of onDay) { if (prev && addDays(prev, 1) === k) cur++; else cur = 1; best = Math.max(best, cur); prev = k; }
  if (prev && prev !== todayKey() && prev !== addDays(todayKey(), -1)) cur = 0;
  return { current: cur, best, played: keys.length, perfect: keys.filter((k) => store.games[k].mistakes === 0).length };
}
async function share() {
  const text = shareText();
  if (navigator.share) { try { await navigator.share({ text }); recordShare(); return; } catch {} }
  await copy();
}
async function copy() {
  try { await navigator.clipboard.writeText(shareText()); $('#btn-copy').textContent = 'Copied!'; setTimeout(() => ($('#btn-copy').textContent = 'Copy'), 1500); recordShare(); } catch {}
}
function recordShare() { store.shares = (store.shares || 0) + 1; save(store); }

// ---------- wiring ----------
$('#btn-genuine').addEventListener('click', () => judge(false));
$('#btn-forged').addEventListener('click', () => judge(true));
$('#btn-share').addEventListener('click', share);
$('#btn-copy').addEventListener('click', copy);
$('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
$('#btn-stats').addEventListener('click', () => { const s = streak(); $('#st-played').textContent = s.played; $('#st-perfect').textContent = s.perfect; $('#st-streak').textContent = s.current; $('#st-best').textContent = s.best; $('#dlg-stats').showModal(); });
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowup') { e.preventDefault(); moveSel(-1, 0); }
  else if (k === 'arrowdown') { e.preventDefault(); moveSel(1, 0); }
  else if (k === 'arrowleft') { e.preventDefault(); moveSel(0, -1); }
  else if (k === 'arrowright') { e.preventDefault(); moveSel(0, 1); }
  else if (k === 'g') judge(false);
  else if (k === 'f') judge(true);
  else if (k === 'escape') select(-1);
  else if (k === '[' && !$('#nav-prev').hidden) location.href = $('#nav-prev').href;
  else if (k === ']' && !$('#nav-next').hidden) location.href = $('#nav-next').href;
});

function renderNav() {
  const prev = $('#nav-prev'), next = $('#nav-next');
  prev.hidden = dateKey <= EPOCH; if (!prev.hidden) prev.href = dayHref(addDays(dateKey, -1));
  next.hidden = !isArchive; if (!next.hidden) next.href = dayHref(addDays(dateKey, 1));
}

(async () => {
  renderNav();
  P = await loadPuzzle(dateKey);
  initGame();
  render();
  if (!store.seenHelp) { store.seenHelp = true; save(store); $('#dlg-help').showModal(); }
})();
