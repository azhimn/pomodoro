'use strict';

// Storage keys stay `work` for compatibility; the user-facing name is Focus.
const STEPS = { work: 'Focus', break: 'Break', long: 'Long break' };
const DEFAULTS = {
  cycle: 4,
  showTodos: false,
  autoStart: false,
  dailyReset: true,
  notify: false,
  report: true,
  timer: { weight: '300', italic: false, underline: false },
  motion: 100, // animation speed in %, 0 = off
  // Shortcut ids: optional Ctrl+/Alt+/Meta+/Shift+ prefixes, then the key ("k", "Space", "ArrowLeft", "?").
  keys: {
    toggle: ['Space', 'k', 's'], prev: ['ArrowLeft', 'j', 'a'], next: ['ArrowRight', 'l', 'd'],
    plus: ['+', '='], minus: ['-'], reset: ['0'], tasks: ['t'],
    settings: ['i'], report: ['r'], help: ['h'], shortcuts: ['?'],
  },
  font: 'system-ui, sans-serif',
  fontCustom: '',
  sound: { resume: 600, pause: 500, skip: 400 },
  volume: { master: 80, alarm: 100, button: 50 }, // percent
  ver: 2,
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
// v2 raised the click ceiling to alarm loudness; scale older saved click volumes so they sound the same as before.
if (saved.volume && saved.ver !== 2) settings.volume.button = Math.round(settings.volume.button * 0.49 / 5) * 5;
settings.ver = 2;
// Own copies of every key list (the merge above shares DEFAULTS' arrays), falling back to defaults for bad data.
settings.keys = Object.fromEntries(Object.keys(DEFAULTS.keys).map(a => [a, Array.isArray(settings.keys[a]) ? settings.keys[a].filter(k => typeof k === 'string') : [...DEFAULTS.keys[a]]]));
// The speed was briefly a select storing a duration multiplier ('0.001' = off); convert it to the slider's percent.
if (saved.animSpeed != null && saved.motion == null) settings.motion = +saved.animSpeed < 0.01 ? 0 : Math.min(200, Math.round(100 / saved.animSpeed / 25) * 25);
delete settings.animSpeed;

// endsAt set = running. left = ms remaining while paused; null = step untouched (full length).
// runFrom = when the current running stretch began (for the report). day = local date the timer last moved.
const state = { idx: 0, endsAt: null, left: null, runFrom: null, day: null, ...load('pomo.state', {}) };
// sv-SE formats dates as YYYY-MM-DD in local time.
const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString('sv-SE');

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

function isLight(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 150;
}
// Light or dark text for the user's chosen color, tinted with that color so it sits softly on it.
function textOn(hex) {
  return isLight(hex)
    ? `color-mix(in oklab, ${hex} 25%, #1c1917)`
    : `color-mix(in oklab, ${hex} 12%, #fff)`;
}

const $ = sel => document.querySelector(sel);


// Favicon: the current step's icon (Phosphor fill) on its background color. Rebuilt only when either changes.
const STEP_ICONS = {
  work: 'M212,76V72a44,44,0,0,0-74.86-31.31,3.93,3.93,0,0,0-1.14,2.8v88.72a4,4,0,0,0,6.2,3.33A47.67,47.67,0,0,1,167.68,128a8.18,8.18,0,0,1,8.31,7.58,8,8,0,0,1-8,8.42,32,32,0,0,0-32,32v33.88a4,4,0,0,0,1.49,3.12,47.92,47.92,0,0,0,74.21-17.16,4,4,0,0,0-4.49-5.56A68.06,68.06,0,0,1,192,192h-7.73a8.18,8.18,0,0,1-8.25-7.47,8,8,0,0,1,8-8.53h8a51.6,51.6,0,0,0,24-5.88v0A52,52,0,0,0,212,76Zm-12,36h-4a36,36,0,0,1-36-36V72a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4a8,8,0,0,1,0,16ZM88,28A44.05,44.05,0,0,0,44,72v4a52,52,0,0,0-4,94.12h0A51.6,51.6,0,0,0,64,176h7.73A8.18,8.18,0,0,1,80,183.47,8,8,0,0,1,72,192H64a67.48,67.48,0,0,1-15.21-1.73,4,4,0,0,0-4.5,5.55A47.93,47.93,0,0,0,118.51,213a4,4,0,0,0,1.49-3.12V176a32,32,0,0,0-32-32,8,8,0,0,1-8-8.42A8.18,8.18,0,0,1,88.32,128a47.67,47.67,0,0,1,25.48,7.54,4,4,0,0,0,6.2-3.33V43.49a4,4,0,0,0-1.14-2.81A43.85,43.85,0,0,0,88,28Zm8,48a36,36,0,0,1-36,36H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,76V72a8,8,0,0,1,16,0Z',
  break: 'M208,80H32a8,8,0,0,0-8,8v48a96.3,96.3,0,0,0,32.54,72H32a8,8,0,0,0,0,16H208a8,8,0,0,0,0-16H183.46a96.59,96.59,0,0,0,27-40.09A40,40,0,0,0,248,128v-8A40,40,0,0,0,208,80Zm24,48a24,24,0,0,1-17.2,23,95.78,95.78,0,0,0,1.2-15V97.38A24,24,0,0,1,232,120ZM112,56V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0Zm32,0V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0ZM80,56V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0Z',
  long: 'M235.54,150.21a104.84,104.84,0,0,1-37,52.91A104,104,0,0,1,32,120,103.09,103.09,0,0,1,52.88,57.48a104.84,104.84,0,0,1,52.91-37,8,8,0,0,1,10,10,88.08,88.08,0,0,0,109.8,109.8,8,8,0,0,1,10,10Z',
};
let faviconKey;
function favicon(kind) {
  const bg = settings[kind].color; // #rrggbb: the color input (and settings import) only accept that shape
  if (faviconKey === kind + bg) return;
  faviconKey = kind + bg;
  const fg = isLight(bg) ? '#1c1917' : '#fff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="60" fill="${bg}"/>` +
    `<path transform="translate(36 36) scale(.72)" fill="${fg}" d="${STEP_ICONS[kind]}"/></svg>`;
  $('#favicon').href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

let paintKey; // last color written to pomo.paint, so render() (4×/s) writes only on change
function render() {
  const s = stepOf(state.idx);
  const secs = Math.ceil(Math.max(0, remaining()) / 1000);
  const time = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const running = !!state.endsAt;
  $('#time').textContent = time;
  $('#step-name').textContent = STEPS[s.kind];
  $('#step').textContent = `Pair ${s.pos}/${settings.cycle} · Cycle ${s.cycle}`;
  document.title = `${time} · ${STEPS[s.kind]}`;
  favicon(s.kind);
  // Set on <html> so the page scrollbar can take its tint from currentColor too.
  const root = document.documentElement.style;
  const bg = settings[s.kind].color, fg = textOn(bg);
  if (paintKey !== bg) {
    paintKey = bg;
    try { localStorage.setItem('pomo.paint', JSON.stringify({ bg, fg })); } catch {} // read by the inline script in <head>
  }
  root.backgroundColor = bg;
  root.color = fg;
  root.fontFamily = settings.fontCustom || settings.font;
  // Durations multiply by --anim; off is a near-zero multiplier rather than 0 so animationend still fires.
  root.setProperty('--anim', settings.motion ? 100 / settings.motion : 0.001);
  const t = $('#time').style;
  t.fontWeight = settings.timer.weight;
  t.fontStyle = settings.timer.italic ? 'italic' : 'normal';
  t.textDecorationLine = settings.timer.underline ? 'underline' : 'none';
  $('#toggle').classList.toggle('running', running);
  $('#minus-min').disabled = remaining() <= 1000;
  $('#reset-step').disabled = !stepTouched();
  $('#toggle').ariaLabel = running ? 'Pause' : 'Continue';
  hint($('#toggle'));
}

function setState(patch) {
  if ('idx' in patch) patch.extra = 0; // minutes added with +1 belong to the step they were added to
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
  // 0.21 ≈ 0.15 × √2: a sine at this peak matches the square-wave alarm's loudness (RMS) at 100 %.
  beep(ctx.destination, hz, ctx.currentTime, 0.04, 'sine', 0.21 * gainFor('button'));
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

// ---- Report data: { 'YYYY-MM-DD': { work, break, pomos, cycles, tasks } }, times in ms ----
let stats = load('pomo.stats', {});
if (typeof stats !== 'object' || Array.isArray(stats) || !stats) stats = {};
const STAT_KEYS = ['work', 'break', 'pomos', 'cycles', 'tasks'];
const statDay = key => stats[key] ??= { work: 0, break: 0, pomos: 0, cycles: 0, tasks: 0 };
// shortcut: a stretch that crosses midnight is credited to the day it ended; split it if per-day accuracy matters.
function credit(kind, ms, end, finished) {
  if (!settings.report || !(ms > 0)) return;
  const d = statDay(dayKey(end));
  d[kind === 'work' ? 'work' : 'break'] += Math.min(ms, durMs(kind) + (state.extra || 0));
  if (finished && kind === 'work') d.pomos++;
  if (finished && kind === 'long') d.cycles++;
  save('pomo.stats', stats);
}
// A task checked off counts on its completion day; unchecking takes it back from that same day.
function countTask(day, delta) {
  if (!settings.report || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const d = statDay(day);
  d.tasks = Math.max(0, (d.tasks || 0) + delta);
  save('pomo.stats', stats);
}
// Credit the running stretch so far (pause, skip).
function creditRun(now = Date.now()) {
  if (state.endsAt && state.runFrom) credit(stepOf(state.idx).kind, now - state.runFrom, now, false);
}

// New day and the timer is idle: start over at the top of a cycle.
function dailyReset() {
  const today = dayKey();
  if (state.day === today || state.endsAt) return;
  if (settings.dailyReset && state.day) setState({ idx: 0, left: null, day: today });
  else setState({ day: today });
}

// Only when the user isn't looking at this tab; the alarm covers the rest.
function notify(endedKind, nextKind) {
  if (!settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  const n = new Notification(`${STEPS[endedKind]} finished`, {
    body: settings.autoStart ? `${STEPS[nextKind]} has started.` : `Up next: ${STEPS[nextKind]}.`,
    tag: 'pomodoro-step', silent: true,
  });
  n.onclick = () => { focus(); n.close(); };
}

// ---- Actions ----
function toggle() {
  click(state.endsAt ? settings.sound.pause : settings.sound.resume);
  if (state.endsAt) {
    creditRun();
    setState({ endsAt: null, left: remaining(), runFrom: null });
  } else {
    dailyReset();
    setState({ endsAt: Date.now() + remaining(), left: null, runFrom: Date.now(), day: dayKey() });
  }
}
function jump(delta) {
  click(settings.sound.skip);
  creditRun();
  const idx = Math.max(0, state.idx + delta);
  setState({ idx, endsAt: state.endsAt && Date.now() + durMs(stepOf(idx).kind), left: null, runFrom: state.endsAt && Date.now() });
}
// ±1 min: move the end while running, or change what's left while paused. Never below 1 s, so −1 can't skip the step.
function addMinutes(n) {
  const delta = Math.max(n * 60000, 1000 - remaining());
  if (!delta) return;
  click(n > 0 ? settings.sound.resume : settings.sound.pause);
  const extra = (state.extra || 0) + delta;
  if (state.endsAt) setState({ endsAt: state.endsAt + delta, extra });
  else setState({ left: remaining() + delta, extra });
  bump();
}
// Restart the current step at full length, keeping it running if it was. Time already run still counts in the report.
function resetStep() {
  if (!stepTouched()) return;
  click(settings.sound.skip);
  creditRun();
  setState({ idx: state.idx, left: null, endsAt: state.endsAt && Date.now() + durMs(stepOf(state.idx).kind), runFrom: state.endsAt && Date.now() });
  bump();
}
const stepTouched = () => !!state.endsAt || state.left != null || !!state.extra;
function bump() {
  const t = $('#time');
  t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump'); // restart the feedback animation
}
function finish(sound) {
  const kind = stepOf(state.idx).kind;
  if (state.runFrom) credit(kind, state.endsAt - state.runFrom, state.endsAt, true);
  if (sound) alarm(settings[kind].hz);
  const newDay = settings.dailyReset && state.day && state.day !== dayKey();
  const idx = newDay ? 0 : state.idx + 1;
  const auto = settings.autoStart;
  setState({ idx, endsAt: auto ? Date.now() + durMs(stepOf(idx).kind) : null, left: null, runFrom: auto ? Date.now() : null, day: dayKey() });
  if (sound) notify(kind, stepOf(idx).kind);
  if ($('#report').open) renderReport();
}

$('#toggle').addEventListener('click', toggle);
$('#prev').addEventListener('click', () => jump(-1));
$('#next').addEventListener('click', () => jump(1));
$('#plus-min').addEventListener('click', () => addMinutes(1));
$('#minus-min').addEventListener('click', () => addMinutes(-1));
$('#reset-step').addEventListener('click', resetStep);
addEventListener('pointerdown', stopAlarm);

// ---- Keyboard shortcuts (editable in Settings, listed in Help) ----
const typing = el => el.matches('textarea, select, input:not([type=checkbox], [type=range], [type=color], [type=file])');
function toggleDialog(d, open) {
  if (d.open) return d.close();
  $('dialog[open]')?.close();
  open();
}
const ACTIONS = {
  toggle: { label: 'Pause / continue', run: () => { stopAlarm(); toggle(); } },
  prev: { label: 'Previous step', run: () => jump(-1) },
  next: { label: 'Next step', run: () => jump(1) },
  plus: { label: 'Add a minute', run: () => addMinutes(1) },
  minus: { label: 'Take off a minute', run: () => addMinutes(-1) },
  reset: { label: 'Restart this step', run: () => resetStep() },
  tasks: { label: 'Show / hide tasks', run: () => {
    if (settings.showTodos) $('#toggle-todos').click();
    else { $('#toggle-todos').click(); $('#todo-add input').focus({ preventScroll: true }); }
  } },
  // Panel actions also work while a panel is open, so the same key closes it.
  settings: { label: 'Open / close settings', panel: true, run: () => toggleDialog($('#settings'), () => $('#open-settings').click()) },
  report: { label: 'Open / close your report', panel: true, run: () => settings.report && toggleDialog($('#report'), () => $('#open-report').click()) },
  help: { label: 'Open / close help', panel: true, run: () => toggleDialog($('#help'), () => $('#open-help').click()) },
  shortcuts: { label: 'Jump to these shortcuts', panel: true, run: () => toggleDialog($('#help'), () => { $('#open-help').click(); $('#g-keys').scrollIntoView({ block: 'start' }); }) },
};
// Keys the editor won't take: they're needed to move around and close things.
const RESERVED = new Set(['Tab', 'Shift+Tab', 'Enter', 'Escape']);

// One id per key press. Shifted symbols ("?", "+") are already in e.key, so Shift is only recorded for letters and named keys.
function keyId(e) {
  let k = e.key === ' ' ? 'Space' : e.key;
  if (k.length === 1) k = k.toLowerCase();
  const shift = e.shiftKey && (k.length > 1 || /\p{L}/u.test(k));
  return (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.metaKey ? 'Meta+' : '') + (shift ? 'Shift+' : '') + k;
}
const KEY_NAMES = { Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Backspace: '⌫', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn' };
function splitId(id) {
  const m = id.match(/^((?:(?:Ctrl|Alt|Meta|Shift)\+)*)(.+)$/);
  return { mods: m[1].split('+').filter(Boolean), key: m[2] };
}
const keyLabel = id => {
  const { mods, key } = splitId(id);
  return [...mods.map(m => (m === 'Meta' ? '⌘' : m)), KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key)].join(' + ');
};
const ariaKey = id => {
  const { mods, key } = splitId(id);
  return [...mods.map(m => (m === 'Ctrl' ? 'Control' : m)), key === '+' ? 'Plus' : key].join('+');
};
const actionFor = id => Object.keys(ACTIONS).find(a => settings.keys[a]?.includes(id));

let recording = null; // { action, button } while the editor waits for a key
let handledSpace = false;
addEventListener('keydown', e => {
  if (recording) return; // the recorder below has it
  if (typing(e.target)) {
    if (e.key === 'Escape' && e.target.closest('#todos')) e.target.blur();
    return;
  }
  const id = keyId(e);
  // Space on a checkbox, switch, slider or picker keeps its normal job.
  if (id === 'Space' && e.target.matches('input, select')) return;
  const action = actionFor(id);
  if (!action || (!ACTIONS[action].panel && $('dialog[open]'))) return;
  e.preventDefault(); // also keeps a typed key out of a field the action focuses
  handledSpace = id === 'Space';
  ACTIONS[action].run();
});
// A focused button would also "click" when Space is released; skip that if Space just ran a shortcut.
addEventListener('keyup', e => { if (e.key === ' ' && handledSpace) { e.preventDefault(); handledSpace = false; } });

// Hover hints: native title = the button's label plus its first shortcut; aria-keyshortcuts lists them all.
const BUTTON_ACTIONS = { 'open-help': 'help', 'open-settings': 'settings', 'open-report': 'report', 'toggle-todos': 'tasks', prev: 'prev', next: 'next', toggle: 'toggle', 'plus-min': 'plus', 'minus-min': 'minus', 'reset-step': 'reset' };
function hint(btn) {
  const keys = settings.keys[BUTTON_ACTIONS[btn.id]] ?? [];
  const title = keys.length ? `${btn.ariaLabel} (${keyLabel(keys[0])})` : btn.ariaLabel;
  if (btn.title !== title) btn.title = title;
  if (keys.length) btn.setAttribute('aria-keyshortcuts', keys.map(ariaKey).join(' '));
  else btn.removeAttribute('aria-keyshortcuts');
}
const hintAll = () => document.querySelectorAll('button[aria-label]').forEach(hint);

// Help: read-only list of the current keys.
function renderHelpKeys() {
  const kbds = keys => keys.map(k => `<kbd></kbd>`).join('');
  const rows = Object.entries(ACTIONS).map(([a, { label }]) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="row-label"></span><span class="keys">${kbds(settings.keys[a])}</span>`;
    row.querySelector('.row-label').textContent = label;
    row.querySelectorAll('kbd').forEach((k, i) => { k.textContent = keyLabel(settings.keys[a][i]); });
    if (!settings.keys[a].length) row.querySelector('.keys').innerHTML = '<span class="none">No key</span>';
    return row;
  });
  const esc = document.createElement('div');
  esc.className = 'row';
  esc.innerHTML = '<span class="row-label">Leave the task box, close a panel or menu</span><span class="keys"><kbd>Esc</kbd></span>';
  $('#help-keys').replaceChildren(...rows, esc);
}

// Settings: editor. Each key is a removable chip; + records a new one.
function renderKeyEditor(note = {}) {
  const rows = Object.entries(ACTIONS).map(([a, { label }]) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span class="row-label"><span class="name"></span><span class="hint" aria-live="polite"></span></span><div class="ctrl key-chips"></div>';
    row.querySelector('.name').textContent = label;
    row.querySelector('.hint').textContent = note[a] ?? '';
    const chips = row.querySelector('.key-chips');
    for (const id of settings.keys[a]) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = '<kbd></kbd><button type="button" class="chip-x"><svg viewBox="0 0 256 256" aria-hidden="true"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/></svg></button>';
      chip.querySelector('kbd').textContent = keyLabel(id);
      const x = chip.querySelector('button');
      x.ariaLabel = x.title = `Remove ${keyLabel(id)} from ${label}`;
      x.addEventListener('click', () => {
        settings.keys[a] = settings.keys[a].filter(k => k !== id);
        keysChanged();
        renderKeyEditor();
        $(`#key-editor [data-add="${a}"]`).focus();
      });
      chips.append(chip);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add-key';
    add.dataset.add = a;
    add.textContent = '+';
    add.ariaLabel = add.title = `Add a key for ${label}`;
    add.addEventListener('click', () => startRecording(a, add));
    chips.append(add);
    return row;
  });
  $('#key-editor').replaceChildren(...rows);
}
function startRecording(action, button) {
  stopRecording();
  recording = { action, button };
  button.classList.add('recording');
  button.textContent = 'Press a key…';
}
function stopRecording() {
  if (!recording) return;
  recording.button.classList.remove('recording');
  recording.button.textContent = '+';
  recording = null;
}
// Capture phase, so the key reaches the recorder before the shortcut handler or the dialog's Esc.
addEventListener('keydown', e => {
  if (!recording) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'Process'].includes(e.key)) return; // wait for the real key
  e.preventDefault();
  e.stopImmediatePropagation();
  const { action, button } = recording;
  if (e.key === 'Escape') { stopRecording(); return button.focus(); }
  const id = keyId(e);
  const note = {};
  if (RESERVED.has(id)) {
    note[action] = `${keyLabel(id)} can't be used: it's needed to move around`;
  } else {
    const owner = actionFor(id);
    if (owner && owner !== action) {
      settings.keys[owner] = settings.keys[owner].filter(k => k !== id);
      note[action] = `${keyLabel(id)} moved here from "${ACTIONS[owner].label}"`;
      note[owner] = `${keyLabel(id)} moved to "${ACTIONS[action].label}"`;
    }
    if (!settings.keys[action].includes(id)) settings.keys[action].push(id);
    keysChanged();
  }
  recording = null;
  renderKeyEditor(note);
  $(`#key-editor [data-add="${action}"]`).focus();
}, true);
// Clicking elsewhere or closing Settings stops a pending recording; Esc while recording must not close the panel.
addEventListener('pointerdown', e => { if (recording && e.target !== recording.button) stopRecording(); });
$('#settings').addEventListener('cancel', e => { if (recording) e.preventDefault(); });
$('#settings').addEventListener('close', stopRecording);

function keysChanged() {
  save('pomo.settings', settings);
  renderHelpKeys();
  hintAll();
}

// ---- Settings dialog ----
const form = $('#settings form');
const fields = () => form.querySelectorAll('[name]');
const valueOf = el => el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
// Range readout and the filled part of its track.
function showRange(el) {
  el.nextElementSibling.textContent = el.name === 'motion' && +el.value === 0 ? 'Off' : `${el.value}%`;
  el.style.setProperty('--fill', `${(el.value - el.min) / (el.max - el.min) * 100}%`);
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
  syncReportUI();
  dialog.showModal();
});
// Close on backdrop click. Track pointerdown too, so a text drag that ends outside doesn't close it.
for (const d of document.querySelectorAll('dialog')) {
  let downOnBackdrop = false;
  d.addEventListener('pointerdown', e => { downOnBackdrop = e.target === d; });
  d.addEventListener('click', e => { if (downOnBackdrop && e.target === d) d.close(); });
}
form.addEventListener('input', e => {
  const el = e.target;
  if (!el.name || !el.checkValidity()) return;
  if (el.name === 'notify' || el.name === 'report') return; // handled below: they need permission / confirmation
  setField(el, valueOf(el));
  if (el.type === 'range') showRange(el);
  save('pomo.settings', settings);
  render();
});

// Notifications need browser permission, asked only when the switch is turned on.
$('#f-notify').addEventListener('change', async e => {
  const on = e.target.checked;
  if (on && !('Notification' in window)) { e.target.checked = false; return alert('This browser does not support notifications.'); }
  if (on && Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') {
    e.target.checked = false;
    return alert('Notifications are blocked for this page. Allow them in your browser\'s site settings, then try again. (Browsers only allow them on https:// or localhost.)');
  }
  settings.notify = on;
  save('pomo.settings', settings);
});
// Preview a volume when the slider is released or nudged with keys. pointerup (not change) so a click
// that leaves the value as-is still plays.
function previewVolume(name) {
  if (name === 'volume.button') return click(settings.sound.resume);
  stopAlarm();
  audio();
  alarmBus = ctx.createGain();
  alarmBus.connect(ctx.destination);
  for (let b = 0; b < 2; b++) beep(alarmBus, settings.work.hz, ctx.currentTime + b * 0.12, 0.07, 'square', 0.15 * gainFor('alarm'));
}
for (const r of form.querySelectorAll('input[type=range][name^="volume."]')) {
  r.addEventListener('pointerup', () => previewVolume(r.name));
  r.addEventListener('keyup', e => { if (/^(Arrow|Page|Home|End)/.test(e.key)) previewVolume(r.name); });
}

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
    if (v == null || typeof v === 'object' || el.hasAttribute('data-noimport')) continue;
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
  const keys = sanitizeKeys(obj?.keys);
  if (keys) settings.keys = keys;
  if (!importSettings(obj) && !keys) return alert('No usable settings found in that file.');
  keysChanged();
  renderKeyEditor();
  save('pomo.settings', settings);
  render();
});

// Closing a panel or menu cancels any half-confirmed button inside it.
const disarmIn = root => root.querySelectorAll('.armed').forEach(b => b.disarm());
for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', () => disarmIn(d));

// Two-step confirm: the first press arms the button for 4 s, the second runs the action.
function confirmable(btn, action) {
  const lbl = btn.querySelector('.lbl') ?? btn; // keep any icon, swap only the text
  const text = lbl.textContent;
  let timer;
  const disarm = btn.disarm = () => { clearTimeout(timer); btn.classList.remove('armed'); lbl.textContent = text; };
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
// Untrusted import: keep only known actions, short plain strings, no reserved keys, each key on one action.
function sanitizeKeys(obj) {
  if (typeof obj !== 'object' || !obj || Array.isArray(obj)) return null;
  const out = {}, seen = new Set();
  for (const a of Object.keys(ACTIONS)) {
    const list = Array.isArray(obj[a]) ? obj[a] : settings.keys[a];
    out[a] = list.filter(k => typeof k === 'string' && k.length > 0 && k.length <= 40 && !RESERVED.has(k) && !seen.has(k) && seen.add(k)).slice(0, 8);
  }
  return out;
}
confirmable($('#keys-reset'), () => {
  settings.keys = structuredClone(DEFAULTS.keys);
  keysChanged();
  renderKeyEditor();
});
confirmable($('#settings-reset'), () => {
  // Kept: to-do visibility (UI state), and the report switch (turning it off must go through its confirmation).
  const { showTodos, report } = settings;
  for (const k in DEFAULTS) settings[k] = typeof DEFAULTS[k] === 'object' ? structuredClone(DEFAULTS[k]) : DEFAULTS[k];
  Object.assign(settings, { showTodos, report });
  keysChanged();
  renderKeyEditor();
  save('pomo.settings', settings);
  fillForm();
  render();
});

// ---- To-do list ----
let todos = load('pomo.todos', []);
if (!Array.isArray(todos)) todos = [];
const list = $('#todo-list');
const PEN_ICON = '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg>';
const X_ICON = '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/></svg>';

// Item: { text, done } where done is null (open) or the completion note, e.g. "2026-10-16 14:32 · Focus 3/4 · Cycle 2".
// Each <li> keeps a reference to its item, so single adds/edits/deletes can animate without re-rendering the list.
function todoEl(t, animate) {
  const li = document.createElement('li');
  li.todo = t;
  if (animate) li.className = 'new';
  li.innerHTML = `<div class="todo"><label><input type="checkbox"><span class="text"></span></label><div class="acts"><button class="icon" data-act="edit" aria-label="Edit task" title="Edit task">${PEN_ICON}</button><button class="icon" data-act="delete" aria-label="Delete task" title="Delete task">${X_ICON}</button></div><div class="stamp"><small></small></div></div>`;
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
  hint($('#toggle-todos'));
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
  input.focus(); // after a click on send, keep typing the next task
  if (text) addTodos([{ text, done: null }]);
});
list.addEventListener('change', e => {
  if (e.target.type !== 'checkbox') return; // the edit field also fires change
  const li = e.target.closest('li');
  // sv-SE locale formats as "YYYY-MM-DD HH:MM:SS" in local time.
  const stamp = new Date().toLocaleString('sv-SE').slice(0, 16);
  countTask(e.target.checked ? stamp.slice(0, 10) : String(li.todo.done ?? '').slice(0, 10), e.target.checked ? 1 : -1);
  li.todo.done = e.target.checked ? `${stamp} · ${label(stepOf(state.idx))}` : null;
  saveTodos();
  // Keep the old stamp text while it collapses; only write it when showing.
  if (e.target.checked) li.querySelector('small').textContent = li.todo.done;
  li.querySelector('.todo').classList.toggle('done', e.target.checked);
});
list.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const li = btn.closest('li');
  if (btn.dataset.act === 'edit') editTodo(li);
  else deleteTodos(t => t === li.todo);
});
// Edit in place: Enter or leaving the field saves, Esc cancels. An empty edit keeps the old text.
function editTodo(li) {
  const span = li.querySelector('.text');
  if (!span.isConnected || li.querySelector('input.edit')) return;
  const input = document.createElement('input');
  input.className = 'edit';
  input.maxLength = 200;
  input.ariaLabel = 'Edit task';
  input.value = li.todo.text;
  span.replaceWith(input);
  input.focus();
  input.select();
  let closed = false;
  const close = keep => {
    if (closed) return;
    closed = true;
    const text = input.value.trim();
    if (keep && text && text !== li.todo.text) { li.todo.text = text; saveTodos(); }
    span.textContent = li.todo.text;
    input.replaceWith(span);
    li.querySelector('[data-act=edit]').focus({ preventScroll: true });
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); close(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
  });
  input.addEventListener('blur', () => close(true));
}
// Task options menu (popover: light-dismiss and Esc for free). Right-aligned under its button, never wider than the task section.
const menu = $('#todo-menu'), menuBtn = $('#todo-menu-btn');
const matcher = kind => t => kind === 'all' || (kind === 'done') === (t.done != null);
menu.addEventListener('beforetoggle', e => {
  if (e.newState !== 'open') return;
  const r = menuBtn.getBoundingClientRect(), section = $('#todos').getBoundingClientRect();
  menu.style.right = `${document.documentElement.clientWidth - r.right}px`; // clientWidth: excludes the page scrollbar
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.width = `${Math.min(272, r.right - section.left)}px`;
  for (const b of menu.querySelectorAll('[data-delete]')) b.disabled = !todos.some(matcher(b.dataset.delete));
});
menu.addEventListener('toggle', e => {
  if (e.newState === 'closed') return disarmIn(menu);
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

// ---- Personal report ----
const fmtDur = ms => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
};
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const shiftDay = (key, n) => { const d = new Date(`${key}T12:00`); d.setDate(d.getDate() + n); return dayKey(d); };
// A day counts toward the streak once it has a finished pomodoro. Today without one yet doesn't break it.
function streaks(data, today = dayKey()) {
  const active = d => data[d]?.pomos > 0;
  let current = 0, day = active(today) ? today : shiftDay(today, -1);
  while (active(day)) { current++; day = shiftDay(day, -1); }
  let best = 0, run = 0, prev = null;
  for (const d of Object.keys(data).filter(active).sort()) {
    run = prev && shiftDay(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current) };
}

function renderReport() {
  const today = dayKey(), t = stats[today] ?? {};
  const sum = k => Object.values(stats).reduce((a, d) => a + (d[k] || 0), 0);
  const { current, best } = streaks(stats, today);
  $('#r-streak').textContent = current;
  $('#r-streak-note').textContent =
    current === 0 ? 'Finish a pomodoro today to start a streak.'
    : !(t.pomos > 0) ? 'Finish a pomodoro today to keep it going.'
    : current >= best && current > 1 ? 'Your longest yet.' : `Best so far: ${plural(best, 'day')}.`;
  $('#r-today-work').textContent = fmtDur(t.work || 0);
  $('#r-today-break').textContent = fmtDur(t.break || 0);
  $('#r-today-pomos').textContent = t.pomos || 0;
  $('#r-today-tasks').textContent = t.tasks || 0;
  $('#r-all-work').textContent = fmtDur(sum('work'));
  $('#r-all-break').textContent = fmtDur(sum('break'));
  $('#r-all-pomos').textContent = sum('pomos');
  $('#r-all-cycles').textContent = sum('cycles');
  $('#r-all-tasks').textContent = sum('tasks');
  $('#r-best').textContent = plural(best, 'day');
  $('#r-days').textContent = Object.values(stats).filter(d => d.pomos > 0).length;

  // 7 bars, heights relative to the busiest day (min 1 h scale so a 5-minute day doesn't fill the chart).
  const days = [...Array(7)].map((_, i) => shiftDay(today, i - 6));
  const max = Math.max(3600000, ...days.map(d => stats[d]?.work || 0));
  const bars = $('#r-bars');
  bars.replaceChildren(...days.map(d => {
    const ms = stats[d]?.work || 0;
    const name = new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'short' });
    const full = d === today ? 'Today' : new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    const col = document.createElement('div');
    col.className = 'bar' + (d === today ? ' today' : '');
    col.tabIndex = 0;
    col.role = 'img'; // a labelled bar; a plain div's aria-label is ignored by screen readers
    col.ariaLabel = `${full}: ${fmtDur(ms)} focus`;
    col.dataset.readout = `${full} · ${fmtDur(ms)}`;
    col.innerHTML = '<span class="track"><span class="fill"></span></span><span class="day"></span>';
    col.querySelector('.fill').style.height = ms ? `max(4px, ${(ms / max) * 100}%)` : '0';
    col.querySelector('.day').textContent = d === today ? 'Today' : name;
    return col;
  }));
  const total = days.reduce((a, d) => a + (stats[d]?.work || 0), 0);
  const idle = `${fmtDur(total)} this week`;
  const readout = $('#r-readout');
  readout.textContent = idle;
  bars.onpointerover = bars.onfocusin = e => { const b = e.target.closest('.bar'); if (b) readout.textContent = b.dataset.readout; };
  bars.onpointerleave = bars.onfocusout = () => { readout.textContent = idle; };
}

function syncReportUI() {
  $('#open-report').hidden = !settings.report;
  $('#report-export').disabled = $('#report-import').disabled = !settings.report;
  $('#report-delete').disabled = !Object.keys(stats).length;
}
$('#open-report').addEventListener('click', () => { renderReport(); $('#report').showModal(); });
$('#open-help').addEventListener('click', () => { $('#help').showModal(); $('#help .dialog-body').scrollTop = 0; }); // after showModal: a closed dialog ignores scrollTop

$('#report-export').addEventListener('click', () =>
  download(`pomodoro-report-${dayKey()}.json`, 'application/json', JSON.stringify({ pomodoroReport: 1, days: stats }, null, 2)));
$('#report-import').addEventListener('click', () => $('#report-file').click());
// Untrusted file: only YYYY-MM-DD keys with finite, non-negative numbers survive. Merge keeps the larger value per field,
// so importing the same file twice changes nothing.
function mergeReport(obj) {
  const days = obj?.days;
  if (typeof days !== 'object' || !days || Array.isArray(days)) return 0;
  let n = 0;
  for (const [key, d] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || typeof d !== 'object' || !d) continue;
    const cur = statDay(key);
    for (const k of STAT_KEYS) {
      const v = d[k];
      if (Number.isFinite(v) && v >= 0 && v < 864e5 * 400) cur[k] = Math.max(cur[k] || 0, k === 'work' || k === 'break' ? v : Math.floor(v));
    }
    n++;
  }
  return n;
}
onFile('#report-file', text => {
  let obj;
  try { obj = JSON.parse(text); } catch { return alert('That file is not valid JSON.'); }
  const n = mergeReport(obj);
  if (!n) return alert('No report days found in that file.');
  save('pomo.stats', stats);
  syncReportUI();
  alert(`Imported ${plural(n, 'day')} into your report.`);
});

// Turning the report off deletes its data, so it asks first when there is any.
const reportOff = $('#report-off');
function clearReport() {
  stats = {};
  localStorage.removeItem('pomo.stats');
  syncReportUI();
  if ($('#report').open) renderReport();
}
confirmable($('#report-delete'), clearReport);
function setReport(on) {
  settings.report = on;
  if (!on) clearReport();
  save('pomo.settings', settings);
  $('#f-report').checked = on;
  syncReportUI();
}
$('#f-report').addEventListener('change', e => {
  if (e.target.checked) return setReport(true);
  const days = Object.keys(stats).length;
  if (!days) return setReport(false);
  e.target.checked = true; // stays on until confirmed
  $('#ro-days').textContent = plural(days, 'day');
  reportOff.showModal();
});
$('#ro-export').addEventListener('click', () => $('#report-export').click());
$('#ro-cancel').addEventListener('click', () => reportOff.close());
$('#ro-delete').addEventListener('click', () => { setReport(false); reportOff.close(); });

// ---- Self-check for the sequence logic (failures show in the console) ----
function selfTest() {
  const seq = [...Array(10)].map((_, i) => stepOf(i, 4).kind[0]).join('');
  console.assert(seq === 'wbwbwbwlwb', 'sequence', seq);
  console.assert(stepOf(7, 4).pos === 4 && stepOf(8, 4).cycle === 2, 'pos/cycle');
  console.assert(stepOf(1, 1).kind === 'long' && stepOf(2, 1).cycle === 2, 'cycle of 1');
  console.assert(textOn('#ffffff').includes('#1c1917') && textOn('#000000').includes('#fff)'), 'textOn');
  const st = { '2026-10-13': { pomos: 1 }, '2026-10-14': { pomos: 2 }, '2026-10-15': { pomos: 1 }, '2026-10-10': { pomos: 1 } };
  console.assert(JSON.stringify(streaks(st, '2026-10-16')) === '{"current":3,"best":3}', 'streak, today not yet done', streaks(st, '2026-10-16'));
  console.assert(streaks(st, '2026-10-17').current === 0, 'streak broken after a missed day');
  console.assert(shiftDay('2026-03-01', -1) === '2026-02-28' && shiftDay('2026-12-31', 1) === '2027-01-01', 'shiftDay');
  console.assert(fmtDur(90 * 60000) === '1 h 30 min' && fmtDur(60 * 60000) === '1 h' && fmtDur(0) === '0 min', 'fmtDur');
  console.assert(keyId({ key: 'K', shiftKey: true }) === 'Shift+k' && keyId({ key: '?', shiftKey: true }) === '?' && keyId({ key: ' ' }) === 'Space' && keyId({ key: 'p', ctrlKey: true, altKey: true }) === 'Ctrl+Alt+p', 'keyId');
  console.assert(keyLabel('Ctrl+Shift+k') === 'Ctrl + Shift + K' && keyLabel('+') === '+' && keyLabel('Ctrl++') === 'Ctrl + +' && keyLabel('ArrowLeft') === '←', 'keyLabel');
  const sample = [{ text: 'a — b', done: null }, { text: 'Write — report', done: '2026-10-16 14:32 · Focus 3/4 · Cycle 2' }];
  console.assert(JSON.stringify(fromMarkdown(toMarkdown(sample))) === JSON.stringify(sample), 'markdown round-trip');
}
selfTest();

// Step ended while the page was closed: catch up quietly. That step counts in the report; with auto-start,
// the steps after it are replayed on the clock but not credited (nobody was necessarily there).
if (state.endsAt && remaining() <= 0) {
  if (settings.autoStart) {
    const kind = stepOf(state.idx).kind;
    if (state.runFrom) credit(kind, state.endsAt - state.runFrom, state.endsAt, true);
    let { idx, endsAt } = state;
    while (endsAt <= Date.now()) endsAt += durMs(stepOf(++idx).kind);
    setState({ idx, endsAt, runFrom: endsAt - durMs(stepOf(idx).kind), day: dayKey() });
  } else finish(false);
}
dailyReset();
syncReportUI();
renderKeyEditor();
renderHelpKeys();
hintAll();
render();
renderTodos();
renderTodoPanel();
setInterval(() => {
  if (state.endsAt && remaining() <= 0) finish(true);
  else { dailyReset(); render(); }
}, 250);
