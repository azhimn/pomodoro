'use strict';

const STEPS = { work: 'Work', break: 'Break', long: 'Long break' };
const DEFAULTS = {
  cycle: 4,
  showTodos: false,
  work: { min: 25, color: '#c0392b', hz: 880 },
  break: { min: 5, color: '#27ae60', hz: 660 },
  long: { min: 20, color: '#2c3e8f', hz: 520 },
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { alert('Could not save: browser storage is full or disabled.'); }
}

// Merge per step so settings saved by an older version still get new default keys.
const saved = load('pomo.settings', {});
const settings = { ...DEFAULTS, ...saved };
for (const k in STEPS) settings[k] = { ...DEFAULTS[k], ...saved[k] };

// endsAt set = running. left = ms remaining while paused; null = step untouched (full length).
const state = { idx: 0, endsAt: null, left: null, ...load('pomo.state', {}) };

// idx counts steps forever: W B W B ... W LB | W B ...
function stepOf(idx, n = settings.cycle) {
  const i = idx % (2 * n);
  return {
    kind: i === 2 * n - 1 ? 'long' : i % 2 ? 'break' : 'work',
    pos: Math.floor(i / 2) + 1,
    cycle: Math.floor(idx / (2 * n)) + 1,
  };
}
const durMs = kind => settings[kind].min * 60000;
const label = s => `${STEPS[s.kind]} ${s.pos}/${settings.cycle} · Cycle ${s.cycle}`;
const remaining = () => state.endsAt ? state.endsAt - Date.now() : state.left ?? durMs(stepOf(state.idx).kind);

// Pick black or white text for readability on the user's chosen color.
function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#111' : '#fff';
}

const $ = sel => document.querySelector(sel);

function render() {
  const s = stepOf(state.idx);
  const secs = Math.ceil(Math.max(0, remaining()) / 1000);
  const time = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const running = !!state.endsAt;
  $('#time').textContent = time;
  $('#step').textContent = label(s);
  document.title = `${time} · ${STEPS[s.kind]}`;
  document.body.style.backgroundColor = settings[s.kind].color;
  document.body.style.color = textOn(settings[s.kind].color);
  $('#toggle .i-play').hidden = running;
  $('#toggle .i-pause').hidden = !running;
  $('#toggle').ariaLabel = running ? 'Pause' : 'Start';
}

function setState(patch) {
  Object.assign(state, patch);
  save('pomo.state', state);
  render();
}

// ---- Sound (Web Audio, no files) ----
let ctx, alarmBus;
function audio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function beep(dest, hz, at, len, type, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.value = hz;
  // 5 ms ramps avoid speaker pops at the edges.
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.005);
  g.gain.setValueAtTime(vol, at + len - 0.005);
  g.gain.linearRampToValueAtTime(0, at + len);
  o.connect(g).connect(dest);
  o.start(at);
  o.stop(at + len);
}
function click(hz) {
  audio();
  beep(ctx.destination, hz, ctx.currentTime, 0.04, 'sine', 0.05);
}
function alarm(hz) {
  stopAlarm();
  audio();
  alarmBus = ctx.createGain();
  alarmBus.connect(ctx.destination);
  for (let group = 0; group < 4; group++)
    for (let b = 0; b < 4; b++)
      beep(alarmBus, hz, ctx.currentTime + group + b * 0.12, 0.07, 'square', 0.15);
}
function stopAlarm() {
  alarmBus?.disconnect();
  alarmBus = null;
}

// ---- Actions ----
function toggle() {
  click(1200);
  if (state.endsAt) setState({ endsAt: null, left: remaining() });
  else setState({ endsAt: Date.now() + remaining(), left: null });
}
function jump(delta) {
  click(900);
  const idx = Math.max(0, state.idx + delta);
  setState({ idx, endsAt: state.endsAt && Date.now() + durMs(stepOf(idx).kind), left: null });
}
function finish(sound) {
  if (sound) alarm(settings[stepOf(state.idx).kind].hz);
  setState({ idx: state.idx + 1, endsAt: null, left: null });
}

$('#toggle').addEventListener('click', toggle);
$('#prev').addEventListener('click', () => jump(-1));
$('#next').addEventListener('click', () => jump(1));
addEventListener('pointerdown', stopAlarm);

addEventListener('keydown', e => {
  if (e.target.matches('input, textarea') || $('#settings').open) return;
  if (e.code === 'Space') { e.preventDefault(); stopAlarm(); toggle(); }
  else if (e.key === 'ArrowLeft') jump(-1);
  else if (e.key === 'ArrowRight') jump(1);
});
// Stop a focused button from also firing its own click on Space release.
addEventListener('keyup', e => { if (e.code === 'Space' && e.target.matches('button')) e.preventDefault(); });

// ---- Settings dialog ----
const form = $('#settings form');
form.querySelector('label').insertAdjacentHTML('beforebegin', Object.entries(STEPS).map(([k, name]) => `
  <fieldset><legend>${name}</legend>
    <label>Minutes <input type="number" name="${k}.min" min="1" max="180" step="1" required></label>
    <label>Color <input type="color" name="${k}.color"></label>
    <label>Pitch (Hz) <input type="number" name="${k}.hz" min="100" max="4000" step="10" required></label>
  </fieldset>`).join(''));

$('#open-settings').addEventListener('click', () => {
  for (const el of form.querySelectorAll('input[name]')) {
    const [k, f] = el.name.split('.');
    el.value = f ? settings[k][f] : settings[k];
  }
  $('#settings').showModal();
});
form.addEventListener('input', e => {
  const el = e.target;
  if (!el.name || !el.checkValidity()) return;
  const [k, f] = el.name.split('.');
  const v = el.type === 'color' ? el.value : Number(el.value);
  if (f) settings[k][f] = v; else settings[k] = v;
  save('pomo.settings', settings);
  render();
});

// ---- To-do list ----
let todos = load('pomo.todos', []);
if (!Array.isArray(todos)) todos = [];
const list = $('#todo-list');
const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

// Item: { text, done } where done is null (open) or the completion note, e.g. "2026-10-16 14:32 · Work 3/4 · Cycle 2".
function renderTodos() {
  list.replaceChildren(...todos.map((t, i) => {
    const li = document.createElement('li');
    li.dataset.i = i;
    li.innerHTML = `<label><input type="checkbox"><span></span></label><small></small><button class="icon" aria-label="Delete task">${X_ICON}</button>`;
    li.querySelector('input').checked = t.done != null;
    li.querySelector('span').textContent = t.text; // textContent: imported files are untrusted
    li.querySelector('small').textContent = t.done ?? '';
    return li;
  }));
  $('#todos').hidden = !settings.showTodos;
  $('#toggle-todos').ariaPressed = String(settings.showTodos);
  $('#toggle-todos').ariaLabel = settings.showTodos ? 'Hide to-do list' : 'Show to-do list';
}
function saveTodos() {
  save('pomo.todos', todos);
  renderTodos();
}

$('#toggle-todos').addEventListener('click', () => {
  settings.showTodos = !settings.showTodos;
  save('pomo.settings', settings);
  renderTodos();
});
$('#todo-add').addEventListener('submit', e => {
  e.preventDefault();
  const input = e.target.text, text = input.value.trim();
  if (text) todos.push({ text, done: null });
  input.value = '';
  saveTodos();
});
list.addEventListener('change', e => {
  // sv-SE locale formats as "YYYY-MM-DD HH:MM:SS" in local time.
  const stamp = new Date().toLocaleString('sv-SE').slice(0, 16);
  todos[e.target.closest('li').dataset.i].done = e.target.checked ? `${stamp} · ${label(stepOf(state.idx))}` : null;
  saveTodos();
});
list.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  todos.splice(btn.closest('li').dataset.i, 1);
  saveTodos();
});

const toMarkdown = items => items.map(t => `- [${t.done != null ? 'x' : ' '}] ${t.text}${t.done ? ' — ' + t.done : ''}`).join('\n') + '\n';
function fromMarkdown(md) {
  const items = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (!m) continue;
    const done = m[1] !== ' ', at = m[2].lastIndexOf(' — ');
    items.push(done && at > 0 ? { text: m[2].slice(0, at), done: m[2].slice(at + 3) } : { text: m[2], done: done ? '' : null });
  }
  return items;
}

$('#todo-export').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toMarkdown(todos)], { type: 'text/markdown' }));
  a.download = 'todos.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#todo-import').addEventListener('click', () => $('#todo-file').click());
$('#todo-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const items = fromMarkdown(await file.text());
  if (!items.length) return alert('No "- [ ] task" lines found in that file.');
  todos.push(...items); // append, never overwrite
  saveTodos();
});

// ---- Self-check for the sequence logic (failures show in the console) ----
function selfTest() {
  const seq = [...Array(10)].map((_, i) => stepOf(i, 4).kind[0]).join('');
  console.assert(seq === 'wbwbwbwlwb', 'sequence', seq);
  console.assert(stepOf(7, 4).pos === 4 && stepOf(8, 4).cycle === 2, 'pos/cycle');
  console.assert(stepOf(1, 1).kind === 'long' && stepOf(2, 1).cycle === 2, 'cycle of 1');
  console.assert(textOn('#ffffff') === '#111' && textOn('#000000') === '#fff', 'textOn');
  const sample = [{ text: 'a — b', done: null }, { text: 'Write — report', done: '2026-10-16 14:32 · Work 3/4 · Cycle 2' }];
  console.assert(JSON.stringify(fromMarkdown(toMarkdown(sample))) === JSON.stringify(sample), 'markdown round-trip');
}
selfTest();

// Step ended while the page was closed: move on quietly and wait.
if (state.endsAt && remaining() <= 0) finish(false);
render();
renderTodos();
setInterval(() => (state.endsAt && remaining() <= 0 ? finish(true) : render()), 250);
