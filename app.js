'use strict';

const STEPS = { work: 'Work', break: 'Break', long: 'Long break' };
const DEFAULTS = {
  cycle: 4,
  showTodos: false,
  autoStart: false,
  timer: { weight: '300', italic: false, underline: false },
  font: 'system-ui, sans-serif',
  fontCustom: '',
  sound: { resume: 600, pause: 500, skip: 400 },
  volume: { master: 80, alarm: 100, button: 100 }, // percent
  work: { min: 25, sec: 0, color: '#a65d4e', hz: 880 },
  break: { min: 5, sec: 0, color: '#47705a', hz: 660 },
  long: { min: 20, sec: 0, color: '#4f6488', hz: 520 },
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { alert('Could not save: browser storage is full or disabled.'); }
}

// Merge nested groups too, so settings saved by an older version still get new default keys.
const saved = load('pomo.settings', {});
const settings = { ...DEFAULTS, ...saved };
for (const k in DEFAULTS) if (typeof DEFAULTS[k] === 'object') settings[k] = { ...DEFAULTS[k], ...saved[k] };

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
// At least 1 s, so 0 min 0 s can't make a step that ends instantly forever.
const durMs = kind => Math.max(1, settings[kind].min * 60 + settings[kind].sec) * 1000;
const label = s => `${STEPS[s.kind]} ${s.pos}/${settings.cycle} · Cycle ${s.cycle}`;
const remaining = () => state.endsAt ? state.endsAt - Date.now() : state.left ?? durMs(stepOf(state.idx).kind);

// Light or dark text for the user's chosen color, tinted with that color so it sits softly on it.
function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 150
    ? `color-mix(in oklab, ${hex} 25%, #1c1917)`
    : `color-mix(in oklab, ${hex} 12%, #fff)`;
}

const $ = sel => document.querySelector(sel);

function render() {
  const s = stepOf(state.idx);
  const secs = Math.ceil(Math.max(0, remaining()) / 1000);
  const time = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const running = !!state.endsAt;
  $('#time').textContent = time;
  $('#step-name').textContent = STEPS[s.kind];
  $('#step').textContent = `Pair ${s.pos}/${settings.cycle} · Cycle ${s.cycle}`;
  document.title = `${time} · ${STEPS[s.kind]}`;
  // Set on <html> so the page scrollbar can take its tint from currentColor too.
  const root = document.documentElement.style;
  root.backgroundColor = settings[s.kind].color;
  root.color = textOn(settings[s.kind].color);
  root.fontFamily = settings.fontCustom || settings.font;
  const t = $('#time').style;
  t.fontWeight = settings.timer.weight;
  t.fontStyle = settings.timer.italic ? 'italic' : 'normal';
  t.textDecorationLine = settings.timer.underline ? 'underline' : 'none';
  $('#toggle').classList.toggle('running', running);
  $('#toggle').ariaLabel = running ? 'Pause' : 'Continue';
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
// Squared so the sliders feel even to the ear (perceived loudness isn't linear in gain).
const gainFor = kind => (settings.volume.master / 100) ** 2 * (settings.volume[kind] / 100) ** 2;
function click(hz) {
  audio();
  beep(ctx.destination, hz, ctx.currentTime, 0.04, 'sine', 0.05 * gainFor('button'));
}
function alarm(hz) {
  stopAlarm();
  audio();
  alarmBus = ctx.createGain();
  alarmBus.connect(ctx.destination);
  for (let group = 0; group < 4; group++)
    for (let b = 0; b < 4; b++)
      beep(alarmBus, hz, ctx.currentTime + group + b * 0.12, 0.07, 'square', 0.15 * gainFor('alarm'));
}
function stopAlarm() {
  alarmBus?.disconnect();
  alarmBus = null;
}

// ---- Actions ----
function toggle() {
  click(state.endsAt ? settings.sound.pause : settings.sound.resume);
  if (state.endsAt) setState({ endsAt: null, left: remaining() });
  else setState({ endsAt: Date.now() + remaining(), left: null });
}
function jump(delta) {
  click(settings.sound.skip);
  const idx = Math.max(0, state.idx + delta);
  setState({ idx, endsAt: state.endsAt && Date.now() + durMs(stepOf(idx).kind), left: null });
}
function finish(sound) {
  if (sound) alarm(settings[stepOf(state.idx).kind].hz);
  const idx = state.idx + 1;
  setState({ idx, endsAt: settings.autoStart ? Date.now() + durMs(stepOf(idx).kind) : null, left: null });
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
const fields = () => form.querySelectorAll('[name]');
const valueOf = el => el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
// Range readout and the filled part of its track.
function showRange(el) {
  el.nextElementSibling.textContent = `${el.value}%`;
  el.style.setProperty('--fill', `${el.value}%`);
}
function setField(el, v) {
  const [k, f] = el.name.split('.');
  if (f) settings[k][f] = v; else settings[k] = v;
}
function fillForm() {
  for (const el of fields()) {
    const [k, f] = el.name.split('.');
    const v = f ? settings[k][f] : settings[k];
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
    if (el.type === 'range') showRange(el);
  }
}

const dialog = $('#settings');
$('#open-settings').addEventListener('click', () => {
  fillForm();
  dialog.showModal();
});
// Close on backdrop click. Track pointerdown too, so a text drag that ends outside doesn't close it.
let downOnBackdrop = false;
dialog.addEventListener('pointerdown', e => { downOnBackdrop = e.target === dialog; });
dialog.addEventListener('click', e => { if (downOnBackdrop && e.target === dialog) dialog.close(); });
form.addEventListener('input', e => {
  const el = e.target;
  if (!el.name || !el.checkValidity()) return;
  setField(el, valueOf(el));
  if (el.type === 'range') showRange(el);
  save('pomo.settings', settings);
  render();
});
// Preview a volume when the slider is released.
form.addEventListener('change', e => {
  const name = e.target.name;
  if (name === 'volume.button') click(settings.sound.resume);
  else if (name === 'volume.alarm' || name === 'volume.master') { stopAlarm(); audio(); alarmBus = ctx.createGain(); alarmBus.connect(ctx.destination); for (let b = 0; b < 2; b++) beep(alarmBus, settings.work.hz, ctx.currentTime + b * 0.12, 0.07, 'square', 0.15 * gainFor('alarm')); }
});

function download(name, type, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Read a picked file, then clear the input so picking the same file again still fires.
const onFile = (sel, handle) => $(sel).addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) handle(await file.text());
});

$('#settings-export').addEventListener('click', () => download('pomodoro-settings.json', 'application/json', JSON.stringify(settings, null, 2)));
$('#settings-import').addEventListener('click', () => $('#settings-file').click());
// Imported files are untrusted: each value goes through its form field and is kept only if the field accepts it as-is.
function importSettings(obj) {
  let applied = 0;
  for (const el of fields()) {
    const [k, f] = el.name.split('.');
    const v = f ? obj?.[k]?.[f] : obj?.[k];
    if (v == null || typeof v === 'object') continue;
    if (el.type === 'checkbox') {
      if (typeof v !== 'boolean') continue;
      el.checked = v;
    } else {
      el.value = String(v);
      if (!el.checkValidity() || el.value.toLowerCase() !== String(v).toLowerCase()) continue;
    }
    setField(el, valueOf(el));
    applied++;
  }
  fillForm(); // rejected values show the current setting again
  return applied;
}
onFile('#settings-file', text => {
  let obj;
  try { obj = JSON.parse(text); } catch { return alert('That file is not valid JSON.'); }
  if (!importSettings(obj)) return alert('No usable settings found in that file.');
  save('pomo.settings', settings);
  render();
});

// Two-step confirm: the first press arms the button for 4 s, the second runs the action.
function confirmable(btn, action) {
  const lbl = btn.querySelector('.lbl') ?? btn; // keep any icon, swap only the text
  const text = lbl.textContent;
  let timer;
  const disarm = () => { clearTimeout(timer); btn.classList.remove('armed'); lbl.textContent = text; };
  btn.addEventListener('click', () => {
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      lbl.textContent = 'Confirm';
      timer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    action();
  });
}
confirmable($('#settings-reset'), () => {
  const showTodos = settings.showTodos; // UI state, not a preference
  for (const k in DEFAULTS) settings[k] = typeof DEFAULTS[k] === 'object' ? { ...DEFAULTS[k] } : DEFAULTS[k];
  settings.showTodos = showTodos;
  save('pomo.settings', settings);
  fillForm();
  render();
});

// ---- To-do list ----
let todos = load('pomo.todos', []);
if (!Array.isArray(todos)) todos = [];
const list = $('#todo-list');
const X_ICON = '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/></svg>';

// Item: { text, done } where done is null (open) or the completion note, e.g. "2026-10-16 14:32 · Work 3/4 · Cycle 2".
// Each <li> keeps a reference to its item, so single adds/edits/deletes can animate without re-rendering the list.
function todoEl(t, animate) {
  const li = document.createElement('li');
  li.todo = t;
  if (animate) li.className = 'new';
  li.innerHTML = `<div class="todo"><label><input type="checkbox"><span class="text"></span></label><button class="icon" aria-label="Delete task">${X_ICON}</button><div class="stamp"><small></small></div></div>`;
  li.querySelector('input').checked = t.done != null;
  li.querySelector('.todo').classList.toggle('done', t.done != null);
  li.querySelector('.text').textContent = t.text; // textContent: imported files are untrusted
  li.querySelector('small').textContent = t.done ?? '';
  return li;
}
function leave(li) {
  li.classList.add('leaving');
  li.addEventListener('animationend', () => li.remove(), { once: true });
}
const renderTodos = () => list.replaceChildren(...todos.map(t => todoEl(t)));
function renderTodoPanel() {
  $('#todos').classList.toggle('open', settings.showTodos);
  $('#todos').inert = !settings.showTodos; // collapsed list stays out of tab order and screen readers
  $('#toggle-todos').ariaPressed = String(settings.showTodos);
  $('#toggle-todos').ariaLabel = settings.showTodos ? 'Hide to-do list' : 'Show to-do list';
}
const saveTodos = () => save('pomo.todos', todos);
function addTodos(items) {
  todos.push(...items);
  saveTodos();
  for (const t of items) list.append(todoEl(t, true));
  list.lastElementChild?.scrollIntoView({ block: 'nearest' });
}
// Data is removed and saved first; the animation only follows.
function deleteTodos(match) {
  todos = todos.filter(t => !match(t));
  saveTodos();
  for (const li of list.children) if (match(li.todo)) leave(li);
}

$('#toggle-todos').addEventListener('click', () => {
  settings.showTodos = !settings.showTodos;
  save('pomo.settings', settings);
  renderTodoPanel();
});
$('#todo-add').addEventListener('submit', e => {
  e.preventDefault();
  const input = e.target.text, text = input.value.trim();
  input.value = '';
  if (text) addTodos([{ text, done: null }]);
});
list.addEventListener('change', e => {
  const li = e.target.closest('li');
  // sv-SE locale formats as "YYYY-MM-DD HH:MM:SS" in local time.
  const stamp = new Date().toLocaleString('sv-SE').slice(0, 16);
  li.todo.done = e.target.checked ? `${stamp} · ${label(stepOf(state.idx))}` : null;
  saveTodos();
  // Keep the old stamp text while it collapses; only write it when showing.
  if (e.target.checked) li.querySelector('small').textContent = li.todo.done;
  li.querySelector('.todo').classList.toggle('done', e.target.checked);
});
list.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (btn) deleteTodos(t => t === btn.closest('li').todo);
});
// Task options menu (popover: light-dismiss and Esc for free; positioned under its button by hand).
const menu = $('#todo-menu'), menuBtn = $('#todo-menu-btn');
const matcher = kind => t => kind === 'all' || (kind === 'done') === (t.done != null);
menu.addEventListener('beforetoggle', e => {
  if (e.newState !== 'open') return;
  const r = menuBtn.getBoundingClientRect();
  menu.style.right = `${innerWidth - r.right}px`;
  menu.style.top = `${r.bottom + 6}px`;
  for (const b of menu.querySelectorAll('[data-delete]')) b.disabled = !todos.some(matcher(b.dataset.delete));
});
menu.addEventListener('toggle', e => {
  if (e.newState !== 'open') return;
  // Flip above the button if it would run off the bottom of the screen.
  const r = menuBtn.getBoundingClientRect(), h = menu.offsetHeight;
  if (r.bottom + 6 + h > innerHeight) menu.style.top = `${Math.max(6, r.top - 6 - h)}px`;
});
for (const btn of menu.querySelectorAll('[data-delete]')) {
  confirmable(btn, () => { deleteTodos(matcher(btn.dataset.delete)); menu.hidePopover(); });
}

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

$('#todo-export').addEventListener('click', () => download('todos.md', 'text/markdown', toMarkdown(todos)));
$('#todo-import').addEventListener('click', () => $('#todo-file').click());
onFile('#todo-file', text => {
  const items = fromMarkdown(text);
  if (!items.length) return alert('No "- [ ] task" lines found in that file.');
  addTodos(items); // append, never overwrite
});

// ---- Self-check for the sequence logic (failures show in the console) ----
function selfTest() {
  const seq = [...Array(10)].map((_, i) => stepOf(i, 4).kind[0]).join('');
  console.assert(seq === 'wbwbwbwlwb', 'sequence', seq);
  console.assert(stepOf(7, 4).pos === 4 && stepOf(8, 4).cycle === 2, 'pos/cycle');
  console.assert(stepOf(1, 1).kind === 'long' && stepOf(2, 1).cycle === 2, 'cycle of 1');
  console.assert(textOn('#ffffff').includes('#1c1917') && textOn('#000000').includes('#fff)'), 'textOn');
  const sample = [{ text: 'a — b', done: null }, { text: 'Write — report', done: '2026-10-16 14:32 · Work 3/4 · Cycle 2' }];
  console.assert(JSON.stringify(fromMarkdown(toMarkdown(sample))) === JSON.stringify(sample), 'markdown round-trip');
}
selfTest();

// Step ended while the page was closed: catch up quietly. Auto-start replays the steps that passed; otherwise wait.
if (state.endsAt && remaining() <= 0) {
  if (settings.autoStart) {
    let { idx, endsAt } = state;
    while (endsAt <= Date.now()) endsAt += durMs(stepOf(++idx).kind);
    setState({ idx, endsAt });
  } else finish(false);
}
render();
renderTodos();
renderTodoPanel();
setInterval(() => (state.endsAt && remaining() <= 0 ? finish(true) : render()), 250);
