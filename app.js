import { DRINKS, PARAMS, HOUR, MIN, grams, simulate, currentSession, dayKey, gramsPerDay } from './engine.js';

const KEY = 'promille.v1';
const $ = sel => document.querySelector(sel);

// ---------- Speicher ----------
function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.entries)) return data;
  } catch {}
  return { profile: { sex: 'm', weight: null, height: null, age: null }, entries: [] };
}
let state = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const drinkById = id => DRINKS.find(d => d.id === id);

// ---------- Formatierung ----------
const fmtBac = v => v.toFixed(2).replace('.', ',');
const fmtTime = t => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtG = g => `${Math.round(g)} g`;
// Uhrzeit, bei mehr als 18 h Abstand mit Wochentag
function fmtClock(t, now) {
  const wd = new Date(t).toLocaleDateString('de-DE', { weekday: 'short' });
  return fmtTime(t) + (t - now > 18 * HOUR ? ` (${wd})` : '');
}
function fmtDuration(ms) {
  const m = Math.round(ms / MIN);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
function level(bac) {
  if (bac < 0.05) return 0;
  if (bac < 0.3) return 1;
  if (bac < 0.5) return 2;
  if (bac < 1.1) return 3;
  return 4;
}
function entryLabel(e) {
  if (e.type === 'food') return { icon: '🍽️', name: 'Gegessen', size: '' };
  if (e.type === 'vomit') return { icon: '🤮', name: 'Papst', size: 'Magen geleert' };
  const d = drinkById(e.drinkId);
  return d ? { icon: d.icon, name: d.name, size: `${d.size} · ${fmtG(e.g)}` } : { icon: '🥤', name: 'Getränk', size: fmtG(e.g) };
}

// ---------- Aktionen ----------
let toastTimer;
function add(entry, message) {
  const e = { id: uid(), t: Date.now(), ...entry };
  state.entries.push(e);
  save();
  navigator.vibrate?.(15);
  showToast(message, () => {
    state.entries = state.entries.filter(x => x.id !== e.id);
    save();
    render();
  });
  render();
}

function showToast(text, undo) {
  const toast = $('#toast');
  $('#toast-text').textContent = text;
  toast.hidden = false;
  $('#toast-undo').onclick = () => { undo(); toast.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

function flash(btn) {
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 350);
}

// ---------- Jetzt ----------
function renderDrinkGrid() {
  const grid = $('#drink-grid');
  grid.innerHTML = '';
  for (const d of DRINKS) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.innerHTML = `<span class="icon">${d.icon}</span><span class="name">${d.name}</span><span class="size">${d.size}</span>`;
    b.onclick = () => {
      if (!state.profile.weight) return switchView('profile');
      flash(b);
      add({ type: 'drink', drinkId: d.id, g: grams(d.ml, d.abv) }, `${d.name} ${d.size} eingetragen`);
    };
    grid.appendChild(b);
  }
  $('#btn-food').onclick = e => { flash(e.currentTarget); add({ type: 'food' }, 'Essen eingetragen'); };
  $('#btn-vomit').onclick = e => { flash(e.currentTarget); add({ type: 'vomit' }, 'Papst eingetragen. Gute Besserung!'); };
}

function renderNow() {
  const now = Date.now();
  const sim = simulate(state.entries, state.profile, now);
  const bacEl = $('#bac-value');

  if (!state.profile.weight) {
    bacEl.textContent = '–';
    bacEl.className = 'lvl-0';
    $('#bac-sub').textContent = 'Erst Gewicht im Profil eintragen';
  } else if (!sim || (sim.sober && sim.sober <= now && sim.current === 0)) {
    bacEl.textContent = fmtBac(0);
    bacEl.className = 'lvl-0';
    $('#bac-sub').textContent = sim ? 'Wieder nüchtern' : 'Noch nichts getrunken';
  } else {
    bacEl.textContent = fmtBac(sim.current);
    bacEl.className = `lvl-${level(sim.current)}`;
    const rising = sim.trend > 0.005;
    $('#bac-trend').textContent = rising ? '↗' : sim.current > 0 ? '↘' : '';
    $('#bac-sub').textContent = rising && sim.peak.t > now
      ? `Steigt noch · Peak ca. ${fmtBac(sim.peak.bac)} ‰ um ${fmtTime(sim.peak.t)}`
      : `Sinkt · ca. ${fmtBac(PARAMS.elimination)} ‰ pro Stunde`;
  }
  if (!sim || sim.current === 0) $('#bac-trend').textContent = '';

  const active = sim && !(sim.sober && sim.sober <= now);
  $('#fc-05').textContent = !active ? '–' : sim.below05 <= now ? 'jetzt' : fmtClock(sim.below05, now);
  $('#fc-sober').textContent = !active ? '–' : fmtClock(sim.sober, now);
  $('#fc-05').title = active && sim.below05 > now ? `in ${fmtDuration(sim.below05 - now)}` : '';
  $('#fc-sober').title = active ? `in ${fmtDuration(sim.sober - now)}` : '';

  renderChart(active ? sim : null, now);

  // Essens-Button zeigt, ob gerade der "gegessen"-Modus aktiv ist
  const lastFood = state.entries.filter(e => e.type === 'food').reduce((m, e) => Math.max(m, e.t), 0);
  const fedActive = now - lastFood < PARAMS.foodWindowBefore;
  $('#btn-food').classList.toggle('on', fedActive);
  $('#food-hint').textContent = fedActive ? `aktiv bis ${fmtTime(lastFood + PARAMS.foodWindowBefore)}` : 'Aufnahme langsamer';

  // Sitzungsliste
  const session = currentSession(state.entries, now).reverse();
  const total = session.filter(e => e.type === 'drink').reduce((s, e) => s + e.g, 0);
  $('#session-total').textContent = total ? `· ${fmtG(total)} Alkohol` : '';
  const list = $('#session-list');
  list.innerHTML = session.length ? '' : '<li class="empty">Noch keine Einträge. Tippe oben auf ein Getränk.</li>';
  for (const e of session) list.appendChild(entryItem(e));
}

function entryItem(e) {
  const { icon, name, size } = entryLabel(e);
  const li = document.createElement('li');
  const d = new Date(e.t);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  li.innerHTML = `<span class="e-icon">${icon}</span><span class="e-name">${name}<small>${size}</small></span>
    <input type="time" value="${hhmm}" aria-label="Uhrzeit ändern"><button class="del" aria-label="Löschen">×</button>`;
  // Uhrzeit ändern = nachtragen. Liegt die neue Zeit in der Zukunft, ist der Vortag gemeint.
  li.querySelector('input').onchange = ev => {
    const [h, m] = ev.target.value.split(':').map(Number);
    if (Number.isNaN(h)) return;
    const nd = new Date(e.t);
    nd.setHours(h, m, 0, 0);
    let t = nd.getTime();
    if (t > Date.now() + MIN) t -= 24 * HOUR;
    e.t = t;
    save();
    render();
  };
  li.querySelector('.del').onclick = () => {
    const idx = state.entries.indexOf(e);
    state.entries.splice(idx, 1);
    save();
    showToast(`${name} gelöscht`, () => { state.entries.splice(idx, 0, e); save(); render(); });
    render();
  };
  return li;
}

function renderChart(sim, now) {
  const svg = $('#chart');
  if (!sim) { svg.innerHTML = ''; svg.style.display = 'none'; return; }
  svg.style.display = '';
  const W = 340, H = 110, top = 8, bottom = 94;
  const t0 = sim.start, t1 = Math.max(sim.sober, now + 30 * MIN);
  const maxB = Math.max(0.6, sim.peak.bac * 1.15);
  const x = t => ((t - t0) / (t1 - t0)) * W;
  const y = b => bottom - (b / maxB) * (bottom - top);
  const stepN = Math.max(1, Math.floor(sim.points.length / 200));
  const pts = sim.points.filter((_, i) => i % stepN === 0 || i === sim.points.length - 1);
  const path = arr => arr.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.bac).toFixed(1)}`).join('');
  const past = pts.filter(p => p.t <= now);
  const future = pts.filter(p => p.t >= now);
  if (past.length && future.length) future.unshift(past[past.length - 1]);

  let labels = '';
  const firstHour = new Date(t0); firstHour.setMinutes(0, 0, 0);
  const span = (t1 - t0) / HOUR;
  const every = span > 12 ? 4 : span > 6 ? 2 : 1;
  for (let t = firstHour.getTime() + HOUR; t < t1; t += HOUR) {
    if (new Date(t).getHours() % every) continue;
    labels += `<text x="${x(t)}" y="${H - 2}" text-anchor="middle">${new Date(t).getHours()}h</text>`;
  }

  svg.innerHTML = `
    <path class="area" d="${path(pts)}L${W},${bottom}L0,${bottom}Z"/>
    ${maxB > 0.5 ? `<line class="limit" x1="0" x2="${W}" y1="${y(0.5)}" y2="${y(0.5)}"/><text x="2" y="${y(0.5) - 3}">0,5 ‰</text>` : ''}
    <path class="line" d="${path(past)}"/>
    <path class="line future" d="${path(future)}"/>
    <line class="now" x1="${x(now)}" x2="${x(now)}" y1="${top}" y2="${bottom}"/>
    ${labels}`;
}

// ---------- Verlauf ----------
let selectedDay = null;

function renderHistory() {
  const perDay = gramsPerDay(state.entries);
  const now = Date.now();
  const today = dayKey(now);

  // Statistiken
  const sumDays = n => {
    let s = 0, free = 0;
    for (let i = 0; i < n; i++) {
      const g = perDay.get(dayKey(now - i * 24 * HOUR)) || 0;
      s += g; if (!g) free++;
    }
    return { s, free };
  };
  const week = sumDays(7), month = sumDays(30);
  const drinkDays = 30 - month.free;
  $('#stats').innerHTML = `
    <div class="card"><div class="label">Letzte 7 Tage</div><div class="value">${fmtG(week.s)}</div><small>≈ ${(week.s / 20).toFixed(1).replace('.', ',')} Bier 0,5</small></div>
    <div class="card"><div class="label">Letzte 30 Tage</div><div class="value">${fmtG(month.s)}</div><small>${drinkDays} Trinktage</small></div>
    <div class="card"><div class="label">Alkoholfrei (30 T.)</div><div class="value">${month.free}</div><small>Tage</small></div>
    <div class="card"><div class="label">Ø pro Trinktag</div><div class="value">${drinkDays ? fmtG(month.s / drinkDays) : '–'}</div><small>letzte 30 Tage</small></div>`;

  // Heatmap: 26 Wochen, Spalten = Wochen (Mo–So)
  const weeks = 26, cell = 11, gap = 3, left = 18, topPad = 14;
  const svg = $('#heatmap');
  const w = left + weeks * (cell + gap), h = topPad + 7 * (cell + gap);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const base = new Date(now - 6 * HOUR);
  base.setHours(12, 0, 0, 0);
  const dow = (base.getDay() + 6) % 7; // Mo = 0
  const startMs = base.getTime() - (dow + (weeks - 1) * 7) * 864e5;
  const lvl = g => !g ? 0 : g < 25 ? 1 : g < 50 ? 2 : g < 90 ? 3 : 4;

  let out = '';
  ['Mo', '', 'Mi', '', 'Fr', '', 'So'].forEach((l, i) => {
    if (l) out += `<text x="0" y="${topPad + i * (cell + gap) + cell - 2}">${l}</text>`;
  });
  let lastMonth = -1;
  for (let wk = 0; wk < weeks; wk++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(startMs + (wk * 7 + d) * 864e5);
      const key = dayKey(date.getTime() + 6 * HOUR);
      if (key > today) continue;
      if (d === 0 && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        out += `<text x="${left + wk * (cell + gap)}" y="9">${date.toLocaleDateString('de-DE', { month: 'short' })}</text>`;
      }
      const g = perDay.get(key) || 0;
      out += `<rect data-day="${key}" x="${left + wk * (cell + gap)}" y="${topPad + d * (cell + gap)}" width="${cell}" height="${cell}"
        style="fill:var(--heat-${lvl(g)})" class="${key === selectedDay ? 'sel' : ''}"><title>${key}: ${fmtG(g)}</title></rect>`;
    }
  }
  svg.innerHTML = out;
  svg.onclick = ev => {
    const k = ev.target.dataset?.day;
    if (!k) return;
    selectedDay = selectedDay === k ? null : k;
    renderHistory();
  };

  const detail = $('#day-detail');
  detail.hidden = !selectedDay;
  if (selectedDay) detail.innerHTML = dayHtml(selectedDay) || `<div class="d-head">${fmtDay(selectedDay)}</div><div class="d-body">Kein Alkohol</div>`;

  // Log: Tage mit Einträgen, neueste zuerst
  const days = [...new Set(state.entries.map(e => dayKey(e.t)))].sort().reverse().slice(0, 60);
  $('#log').innerHTML = days.length ? days.map(k => `<li>${dayHtml(k)}</li>`).join('') : '<li class="empty">Noch keine Einträge.</li>';
}

function fmtDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function dayHtml(key) {
  const es = state.entries.filter(e => dayKey(e.t) === key).sort((a, b) => a.t - b.t);
  if (!es.length) return '';
  const counts = new Map();
  for (const e of es) {
    const { icon, name } = entryLabel(e);
    const d = e.type === 'drink' ? drinkById(e.drinkId) : null;
    const label = d ? `${icon} ${name} ${d.size}` : `${icon} ${name}`;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const g = es.filter(e => e.type === 'drink').reduce((s, e) => s + e.g, 0);
  const body = [...counts].map(([l, n]) => (n > 1 ? `${n}× ` : '') + l).join(', ');
  return `<div class="d-head"><span>${fmtDay(key)}</span><span>${fmtG(g)}</span></div>
    <div class="d-body">${fmtTime(es[0].t)}–${fmtTime(es[es.length - 1].t)} · ${body}</div>`;
}

// ---------- Profil ----------
function renderProfile() {
  const f = $('#profile-form');
  const p = state.profile;
  f.sex.value = p.sex || 'm';
  f.weight.value = p.weight ?? '';
  f.height.value = p.height ?? '';
  f.age.value = p.age ?? '';
}

$('#profile-form').onsubmit = ev => {
  ev.preventDefault();
  const f = ev.target;
  const num = v => (v === '' ? null : Number(v));
  state.profile = { sex: f.sex.value, weight: num(f.weight.value), height: num(f.height.value), age: num(f.age.value) };
  save();
  switchView('now');
};

$('#btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `promille-backup-${dayKey(Date.now())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('#file-import').onchange = async ev => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.entries)) throw new Error();
    if (!confirm(`${data.entries.length} Einträge importieren? Die aktuellen Daten werden ersetzt.`)) return;
    state = data;
    save();
    render();
    renderProfile();
  } catch {
    alert('Die Datei ist kein gültiges Backup.');
  } finally {
    ev.target.value = '';
  }
};

$('#btn-wipe').onclick = () => {
  if (!confirm('Wirklich alle Einträge und das Profil löschen?')) return;
  localStorage.removeItem(KEY);
  state = load();
  renderProfile();
  render();
};

// ---------- Navigation ----------
let view = 'now';
function switchView(v) {
  view = v;
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== `view-${v}`;
  for (const b of document.querySelectorAll('.tabbar button')) b.classList.toggle('active', b.dataset.view === v);
  if (v === 'profile') renderProfile();
  render();
  document.querySelector('main').scrollTop = 0;
}
for (const b of document.querySelectorAll('.tabbar button')) b.onclick = () => switchView(b.dataset.view);

function render() {
  if (view === 'now') renderNow();
  if (view === 'history') renderHistory();
}

renderDrinkGrid();
switchView(state.profile.weight ? 'now' : 'profile');
setInterval(render, 30 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js');
}
