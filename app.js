// Cooked Books — UI. Loads today's precomputed puzzle (data/YYYY-MM-DD.json) or generates it on-device.
// Packs (?pack=ID&i=N) are extra ledgers from a pack file the player loads; they live in localStorage, apart from daily stats.
import { hydrate, daily, cellName, EPOCH, findHint } from './engine/engine.js';

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

// ---------- packs ----------
const PACK_LS = 'cooked-books:pack:';
const loadPack = (id) => { try { const p = JSON.parse(localStorage.getItem(PACK_LS + id)); return p && Array.isArray(p.puzzles) ? p : null; } catch { return null; } };
const packIds = () => Object.keys(localStorage).filter((k) => k.startsWith(PACK_LS)).map((k) => k.slice(PACK_LS.length)).sort((a, b) => a - b);
const packHref = (id, i) => `?pack=${id}&i=${i}`;
const qPack = params.get('pack'), qIdx = Number(params.get('i') || 1);
const pack = qPack && /^\d+$/.test(qPack) ? loadPack(qPack) : null;
const inPack = !!pack && Number.isInteger(qIdx) && qIdx >= 1 && qIdx <= pack.puzzles.length;
const packMissing = !!qPack && !inPack; // link to a pack that isn't loaded on this device: fall back to today, open the packs dialog
const gameKey = inPack ? `${qPack}:${qIdx}` : dateKey;
const book = () => (inPack ? (store.packGames ||= {}) : store.games);
const isAway = isArchive || inPack; // not today's ledger
let P = null; // hydrated puzzle
let G = null; // game record for this date
let selected = -1;

async function loadPuzzle(key) {
  if (inPack) return hydrate(pack.puzzles[qIdx - 1]);
  try {
    const r = await fetch(`data/${key}.json`, { cache: 'force-cache' });
    if (r.ok) return hydrate(await r.json());
  } catch {}
  return hydrate(daily(key));
}

function initGame() {
  G = book()[gameKey];
  if (!G) {
    G = { judged: {}, order: [], mistakes: 0, wrong: {}, startedAt: Date.now(), finishedAt: null };
    for (const i of P.revealed) G.judged[i] = true; // pre-audited (not counted in order)
    book()[gameKey] = G; save(store);
  }
}

// ---------- rendering ----------
function render() {
  const n = P.n, N = n * n;
  if (hintNow && G.judged[hintNow.cell]) hintNow = null; // the hinted entry is judged: drop its marks
  document.documentElement.style.setProperty('--n', n);
  $('#puzzle-no').textContent = inPack ? `Pack ${qPack}` : `#${P.number}`;
  $('#puzzle-date').textContent = inPack ? `${qIdx} / ${pack.puzzles.length}` : fmtDate(dateKey);
  $('#archive-tag').textContent = inPack ? 'pack' : 'archive';
  $('#archive-tag').classList.toggle('hidden', !isAway);
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
    el.classList.toggle('why', !!hintNow && hintNow.notes.includes(i));
    el.querySelector('.stamp').innerHTML = j ? `<span>${c.forged ? 'FORGED' : 'OK'}</span>` : '';
    el.setAttribute('aria-label', `${cellName(n, i)}, $${c.amount}${j ? (c.forged ? ', forged' : ', genuine') : ', not audited'}`);
    let dot = el.querySelector('.note-dot'); if (j && !dot) { dot = document.createElement('span'); dot.className = 'note-dot'; el.appendChild(dot); } if (!j && dot) dot.remove();
  }
  board.classList.toggle('finished', !!G.finishedAt || Object.keys(G.judged).length === N);
  renderHint();
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
  $('#pc-hint').classList.toggle('hidden', !(j && hintShown === selected));
  highlightRefs(selected);
}

function renderNotes() {
  const list = $('#notes-list'); list.innerHTML = '';
  const open = Object.keys(G.judged).map(Number).sort((a, b) => a - b);
  $('#notes-count').textContent = `(${open.length})`;
  for (const i of open) {
    const c = P.cells[i];
    const li = document.createElement('li');
    li.className = c.forged ? 'forged' : 'genuine'; if (i === selected) li.classList.add('active'); if (hintNow?.notes.includes(i)) li.classList.add('why');
    li.innerHTML = `<span class="who">${cellName(P.n, i)}</span><span class="what">${c.clue.text}</span>`;
    li.addEventListener('click', () => select(i));
    list.appendChild(li);
  }
}

// first-time hint: explain the blue reference outlines for the first few notes a player opens
const HINT_MAX = 3;
let hintShown = -1;
const hasRefs = (i) => P.cells[i].clue.refs.some((r) => r !== i);
function maybeHint(i) {
  if (i >= 0 && G.judged[i] && hasRefs(i) && (store.refHints || 0) < HINT_MAX && hintShown !== i) { hintShown = i; store.refHints = (store.refHints || 0) + 1; save(store); }
  else if (i !== hintShown) hintShown = -1;
}
function select(i) { selected = i; maybeHint(i); render(); }

// pack hints: point at an entry that can be proven now and the open notes that prove it (not the answer).
// Each new hinted entry is logged in G.hints and shows in the result; asking again for the same entry is free.
let hintNow = null;
const hintsUsed = () => (G.hints || []).length;
function askHint() {
  if (!inPack || G.finishedAt || Object.keys(G.judged).length === P.n * P.n) return;
  const h = findHint(P, Object.keys(G.judged));
  if (!h) return;
  const last = (G.hints ||= []).at(-1);
  if (!last || last.i !== h.cell) { G.hints.push({ i: h.cell, at: Date.now() }); save(store); }
  hintNow = h; selected = h.cell; render();
}
function renderHint() {
  const row = $('#hint-row'), done = !!G.finishedAt || Object.keys(G.judged).length === P.n * P.n;
  row.classList.toggle('hidden', !inPack || (done && !hintsUsed()));
  $('#btn-hint').classList.toggle('hidden', done);
  const msg = $('#hint-msg'), used = hintsUsed();
  if (hintNow) {
    const who = hintNow.notes.map((j) => cellName(P.n, j));
    const from = who.length ? `the note${who.length > 1 ? 's' : ''} of ${who.length > 1 ? who.slice(0, -1).join(', ') + ' and ' + who.at(-1) : who[0]}` : '';
    msg.innerHTML = `<b>${cellName(P.n, hintNow.cell)}</b> can be proven now from ${from}${from && hintNow.count ? ' and ' : ''}${hintNow.count ? `the forgery count (${P.K})` : ''}.${who.length ? ` ${who.length > 1 ? 'Those notes are' : 'That note is'} marked in amber.` : ''}`;
  } else msg.textContent = used ? `Hints used: ${used}.` : 'Stuck? A hint shows an entry you can prove next and the notes that prove it. Hints are counted in your result.';
}

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
  maybeHint(selected);
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
  for (let r = 0; r < n; r++) { for (let c = 0; c < n; c++) { const i = r * n + c; out += P.revealed.includes(i) ? '⬜' : G.wrong[i] ? '🟥' : (G.hints || []).some((h) => h.i === i) ? '🟨' : '🟩'; } out += '\n'; }
  return out.trimEnd();
}
function elapsed() { const ms = (G.finishedAt || Date.now()) - G.startedAt; const s = Math.max(1, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function shareText() {
  const url = location.origin + location.pathname;
  const title = inPack ? `Cooked Books Pack ${qPack} · ${qIdx}/${pack.puzzles.length}` : `Cooked Books #${P.number}${isArchive ? ' (archive)' : ''}`;
  const hints = hintsUsed() ? ` · ${hintsUsed()} hint${hintsUsed() === 1 ? '' : 's'}` : '';
  return `${title} — ${G.mistakes === 0 ? 'clean audit ✓' : `${G.mistakes} mistake${G.mistakes === 1 ? '' : 's'}`}${hints} · ${elapsed()}\n${emojiGrid()}\n${url}`;
}
function finish() {
  if (!G.finishedAt) { G.finishedAt = Date.now(); save(store); }
  $('#done').classList.remove('hidden');
  $('#done-title').textContent = G.mistakes === 0 ? 'Clean audit.' : `Audit complete — ${G.mistakes} mistake${G.mistakes === 1 ? '' : 's'}.`;
  $('#share-grid').textContent = emojiGrid();
  $('#done-summary').textContent = `${P.K} forgeries found in ${elapsed()}. ` + (inPack ? `Hints: ${hintsUsed()}. Pack ${qPack}: ${packSolved(qPack)} of ${pack.puzzles.length} solved.` : `Streak: ${streak().current}.`);
  $('#done-missed').classList.toggle('hidden', G.mistakes === 0);
  $('#done-next').classList.toggle('hidden', isAway);
  $('#done-today').classList.toggle('hidden', !isAway);
  if (inPack) {
    const more = qIdx < pack.puzzles.length;
    $('#link-archive').classList.toggle('hidden', !more);
    if (more) { $('#link-archive').href = packHref(qPack, qIdx + 1); $('#link-archive').textContent = 'Next pack ledger →'; }
  } else {
    const prev = dateKey > EPOCH ? addDays(dateKey, -1) : null;
    $('#link-archive').classList.toggle('hidden', !prev);
    if (prev) $('#link-archive').href = dayHref(prev);
  }
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
const packSolved = (id) => Object.entries(store.packGames || {}).filter(([k, g]) => k.startsWith(id + ':') && g.finishedAt).length;

// A pack file: { format: 'cooked-books-pack', id, title, puzzles: [puzzle JSON, same shape as data/*.json] }.
// Every note is checked against the stored answer so a damaged file can't load an unsolvable ledger.
function checkPack(p) {
  if (!p || p.format !== 'cooked-books-pack' || !/^\d+$/.test(String(p.id)) || !Array.isArray(p.puzzles) || !p.puzzles.length) return 'This is not a Cooked Books pack file.';
  for (const [k, q] of p.puzzles.entries()) {
    try {
      const h = hydrate(q); const a = h.cells.map((c) => c.forged);
      if (!(h.n >= 3 && h.n <= 8 && h.cells.length === h.n * h.n && a.filter(Boolean).length === h.K && h.cells.every((c) => c.clue && c.clue.eval(a) === !c.forged))) throw 0;
    } catch { return `Ledger ${k + 1} in this pack is damaged.`; }
  }
  return '';
}
function renderPacks(msg = '') {
  const ids = packIds();
  $('#packs-list').innerHTML = ids.map((id) => {
    const p = loadPack(id); if (!p) return '';
    const n = p.puzzles.length, solved = packSolved(id);
    let next = 1; while (next <= n && store.packGames?.[`${id}:${next}`]?.finishedAt) next++;
    const esc = String(p.title || `Pack ${id}`).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    return `<li><b>${esc}</b> <span class="small">${solved} / ${n} solved</span> <a href="${packHref(id, next > n ? 1 : next)}">${solved ? (next > n ? 'Replay' : 'Continue') : 'Start'} →</a></li>`;
  }).join('');
  $('#packs-none').classList.toggle('hidden', ids.length > 0);
  $('#packs-msg').textContent = msg;
}
function openPacks(msg) { renderPacks(msg); $('#dlg-packs').showModal(); }
async function importPack(file) {
  let p = null;
  try { p = JSON.parse(await file.text()); } catch {}
  const err = checkPack(p);
  if (err) { renderPacks(err); return; }
  try { localStorage.setItem(PACK_LS + p.id, JSON.stringify({ format: p.format, id: p.id, title: p.title, puzzles: p.puzzles })); }
  catch { renderPacks('Your browser refused to store the pack (storage full or disabled).'); return; }
  renderPacks(`Loaded “${p.title || `Pack ${p.id}`}” — ${p.puzzles.length} ledgers.`);
}

function recordShare() { store.shares = (store.shares || 0) + 1; save(store); }

// ---------- wiring ----------
$('#btn-genuine').addEventListener('click', () => judge(false));
$('#btn-forged').addEventListener('click', () => judge(true));
$('#btn-share').addEventListener('click', share);
$('#btn-hint-ok').addEventListener('click', () => { store.refHints = HINT_MAX; save(store); hintShown = -1; render(); });
$('#btn-copy').addEventListener('click', copy);
$('#btn-hint').addEventListener('click', askHint);
for (const el of document.querySelectorAll('.link-packs')) el.addEventListener('click', (e) => { e.preventDefault(); document.querySelector('dialog[open]')?.close(); openPacks(); });
$('#pack-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importPack(f); e.target.value = ''; });
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
  else if (k === 'h') askHint();
  else if (k === 'escape') select(-1);
  else if (k === '[' && !$('#nav-prev').hidden) location.href = $('#nav-prev').href;
  else if (k === ']' && !$('#nav-next').hidden) location.href = $('#nav-next').href;
});

function renderNav() {
  const prev = $('#nav-prev'), next = $('#nav-next');
  if (inPack) {
    prev.hidden = qIdx <= 1; if (!prev.hidden) prev.href = packHref(qPack, qIdx - 1);
    next.hidden = qIdx >= pack.puzzles.length; if (!next.hidden) next.href = packHref(qPack, qIdx + 1);
    prev.title = 'Previous pack ledger ( [ )'; next.title = 'Next pack ledger ( ] )';
    return;
  }
  prev.hidden = dateKey <= EPOCH; if (!prev.hidden) prev.href = dayHref(addDays(dateKey, -1));
  next.hidden = !isArchive; if (!next.hidden) next.href = dayHref(addDays(dateKey, 1));
}

(async () => {
  renderNav();
  P = await loadPuzzle(dateKey);
  initGame();
  render();
  if (!store.seenHelp) { store.seenHelp = true; save(store); $('#dlg-help').showModal(); }
  else if (packMissing) openPacks(`${pack ? `Pack ${qPack} has no ledger ${params.get('i')}` : 'That pack isn\'t loaded on this device'}. Load its pack file below, or pick a loaded pack.`);
})();
