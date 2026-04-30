// ============================================================
// Winnie v2.4 — Schema v3 + Ideal Schedule
// ============================================================

const SCHEMA_VERSION = 3;

// All event types in v3
const TYPE_DEFS = {
  pee:         { icon: '🟨', label: 'Pee',        color: 'pee',         kind: 'point' },
  poop:        { icon: '💩', label: 'Poop',       color: 'poop',        kind: 'point' },
  meal:        { icon: '🍽',  label: 'Meal',       color: 'meal',        kind: 'point' },
  enrichment:  { icon: '🦴', label: 'Enrichment', color: 'enrichment',  kind: 'point' },
  medication:  { icon: '💊', label: 'Medication', color: 'medication',  kind: 'point' },
  vomit:       { icon: '🤮', label: 'Vomit',      color: 'vomit',       kind: 'point' },
  nap:         { icon: '💤', label: 'Nap',        color: 'nap',         kind: 'range' },
  slumber:     { icon: '🌙', label: 'Slumber',    color: 'slumber',     kind: 'range' },
  walk:        { icon: '🚶', label: 'Walk',       color: 'walk',        kind: 'range' },
  outing:      { icon: '🎒', label: 'Outing',     color: 'outing',      kind: 'range' },
  episode:     { icon: '⚠️', label: 'Episode',    color: 'episode',     kind: 'range' },
  appointment: { icon: '📋', label: 'Appointment', color: 'appointment', kind: 'range' },
  travel:      { icon: '✈️', label: 'Travel',     color: 'travel',      kind: 'range' },
  covered_gap: { icon: '👤', label: 'Covered gap', color: 'gap',        kind: 'range' },
  note:        { icon: '📝', label: 'Note',       color: 'gap',         kind: 'point' },
};

const POINT_TYPES = Object.keys(TYPE_DEFS).filter(t => TYPE_DEFS[t].kind === 'point');
const RANGE_TYPES = Object.keys(TYPE_DEFS).filter(t => TYPE_DEFS[t].kind === 'range');

// Tag definitions, with applies_to to enable/disable in modal
const TAG_DEFS = [
  // Context — multi-select
  { id: 'accident',      label: 'accident',      group: 'context', appliesTo: ['pee', 'poop'] },
  { id: 'self-signaled', label: 'self-signaled', group: 'context', appliesTo: ['pee', 'poop'] },
  { id: 'tiny',          label: 'tiny',          group: 'context', appliesTo: ['pee'] },
  { id: 'big',           label: 'big',           group: 'context', appliesTo: ['pee', 'poop'] },
  { id: 'wet',           label: 'wet',           group: 'context', appliesTo: ['poop'] },
  { id: 'dry',           label: 'dry',           group: 'context', appliesTo: ['poop'] },
  // Indoor / outdoor — single select within group
  { id: 'indoors',       label: 'indoors',       group: 'where',   appliesTo: ['pee', 'poop'], single: true },
  { id: 'outdoors',      label: 'outdoors',      group: 'where',   appliesTo: ['pee', 'poop'], single: true },
];

const WHO_OPTIONS = [
  { id: 'us',      label: 'us'         },
  { id: 'trainer', label: '👤 trainer' },
  { id: 'sitter',  label: '🧑 sitter'  },
  { id: 'unknown', label: '🤔 unknown' },
];

// Common enrichment kinds (free-form, but suggested)
const ENRICHMENT_SUGGESTIONS = ['kong', 'lick mat', 'snuffle ball', 'snuffle mat', 'bully stick', 'yak chew', 'teething ring', 'rawhide', 'puzzle'];

// Episode kinds
const EPISODE_SUGGESTIONS = ['barking', 'distress', 'tweak', 'alert', 'whining'];

// Appointment kinds
const APPOINTMENT_KINDS = ['vet', 'grooming', 'training_class', 'playgroup'];

// Winnie's birthday
const BIRTHDAY = new Date('2025-07-25T00:00:00').getTime();

// Storage keys
const LS = {
  bin: 'winnie:bin',
  local: 'winnie:local',
  mode: 'winnie:mode',
  tab: 'winnie:tab',
  schedule: 'winnie:schedule',
  scheduleProfile: 'winnie:scheduleProfile',
  schemaVersion: 'winnie:schema',
};

// Default ideal schedules
const DEFAULT_SCHEDULES = {
  wfh: {
    label: 'WFH',
    wake: '07:30',
    slumber: '20:00',
    naps: [{ start: '09:30', end: '13:00' }, { start: '15:00', end: '17:00' }],
    meals: [{ time: '08:00', kind: 'breakfast' }, { time: '17:30', kind: 'dinner' }]
  },
  office: {
    label: 'Office',
    wake: '06:00',
    slumber: '20:00',
    naps: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
    meals: [{ time: '06:30', kind: 'breakfast' }, { time: '17:30', kind: 'dinner' }]
  },
  weekend: {
    label: 'Weekend',
    wake: '08:00',
    slumber: '21:00',
    naps: [{ start: '10:30', end: '13:00' }, { start: '15:00', end: '17:00' }],
    meals: [{ time: '08:30', kind: 'breakfast' }, { time: '18:00', kind: 'dinner' }]
  },
};

// ============================================================
// State
// ============================================================
const state = {
  events: [],
  binId: localStorage.getItem(LS.bin) || '',
  mode: localStorage.getItem(LS.mode) || '',
  tab: localStorage.getItem(LS.tab) || 'today',
  schedules: loadSchedules(),
  lastUndo: null,
  undoTimer: null,
  saveDebounce: null,
  editingId: null,
  modalState: blankModalState(),
  calCursor: monthStart(new Date()),
  calSelected: null,
  rangeTickInterval: null,
  scheduleEditingProfile: 'wfh',
  syncing: false,
  lastSyncOk: 0,
  lastSyncError: false,
  manualSyncFlash: false,
  syncFlashTimer: null,
  remoteKnown: false, // true once we've successfully observed remote at least once
};

function blankModalState() {
  return { type: null, mins: null, customTime: null, customEndTime: null, tags: [], who: 'us', precision: 'exact', subkind: '' };
}

function loadSchedules() {
  const raw = localStorage.getItem(LS.schedule);
  if (raw) try { return { ...DEFAULT_SCHEDULES, ...JSON.parse(raw) }; } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_SCHEDULES));
}
function saveSchedules() {
  localStorage.setItem(LS.schedule, JSON.stringify(state.schedules));
}

// ============================================================
// Utilities
// ============================================================
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); }
function endOfDay(d) { const x = new Date(d); x.setHours(23,59,59,999); return x.getTime(); }
function monthStart(d) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x.getTime(); }
function addMonths(ts, n) { const d = new Date(ts); d.setMonth(d.getMonth() + n); return d.getTime(); }
function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}
function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// Calendar-day attribution: events between midnight and 5am attribute to previous day
const OVERNIGHT_CUTOFF_HOUR = 5;
function attributedDayStart(ts) {
  const d = new Date(ts);
  if (d.getHours() < OVERNIGHT_CUTOFF_HOUR) {
    d.setDate(d.getDate() - 1);
  }
  d.setHours(0,0,0,0);
  return d.getTime();
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 0) return 'in ' + Math.round(-diff / 60000) + 'm';
  if (diff < 60000) return 'just now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  const hours = mins / 60;
  if (hours < 24) return hours.toFixed(hours < 10 ? 1 : 0) + 'h ago';
  const days = Math.round(hours / 24);
  return days + 'd ago';
}
function formatClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function formatClockLong(ts) {
  if (sameDay(ts, Date.now())) return formatClock(ts);
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + formatClock(ts);
}
function formatDuration(ms) {
  const totalMins = Math.round(ms / 60000);
  if (totalMins < 60) return totalMins + 'm';
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (m === 0) return h + 'h';
  return h + 'h ' + m + 'm';
}

function ageAt(ts) {
  const ms = ts - BIRTHDAY;
  const days = ms / (1000 * 60 * 60 * 24);
  const months = days / 30.44;
  if (days < 0) return { months: 0, label: 'pre-birth' };
  if (months < 12) {
    return { months, label: Math.floor(months) + ' months' };
  }
  return { months, label: (months / 12).toFixed(1) + ' years' };
}

function todayProfileAuto() {
  const dow = new Date().getDay();
  if (dow === 0 || dow === 6) return 'weekend';
  // Could later detect office vs WFH from calendar; default weekday → wfh
  return 'wfh';
}

function parseTimeToMins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function timeToTodayTs(hhmm, baseDate = new Date()) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// ============================================================
// Schema migration v1/v2 -> v3
// ============================================================
function migrateEvent(e) {
  if (!e.id) e.id = newId();
  if (!e.created) e.created = e.time || Date.now();

  // v1 -> v2: trainer/sitter/estimated tags -> who
  if (e.who == null) {
    if (Array.isArray(e.tags)) {
      if (e.tags.includes('trainer')) e.who = 'trainer';
      else if (e.tags.includes('sitter')) e.who = 'sitter';
      else if (e.tags.includes('unknown') || e.tags.includes('estimated')) e.who = 'unknown';
      else e.who = 'us';
      e.tags = e.tags.filter(t => !['trainer', 'sitter', 'unknown', 'estimated'].includes(t));
    } else {
      e.who = 'us';
      e.tags = [];
    }
  }
  if (!Array.isArray(e.tags)) e.tags = [];

  // v2 -> v3: add new fields with defaults
  if (e.time_precision == null) e.time_precision = 'exact';
  if (e.retroactive == null) e.retroactive = false;
  if (!e.timezone) e.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  if (!e.source) e.source = 'manual';

  // Renames: 'loose' tag was an early v2 alias for 'wet'
  if (e.tags.includes('loose')) {
    e.tags = e.tags.filter(t => t !== 'loose');
    if (!e.tags.includes('wet')) e.tags.push('wet');
  }

  // Type validation
  if (!TYPE_DEFS[e.type]) {
    // Map old types we no longer have
    if (e.type === 'wake') {
      // Wake events become a tag/note on the next slumber's end_time
      e.type = 'note';
      e.note = (e.note || '') + ' [legacy wake event]';
    }
  }

  return e;
}

function migrateAll(eventsOrPayload) {
  // Could be array of events or wrapper object {events, schemaVersion}
  let events = eventsOrPayload;
  if (eventsOrPayload && !Array.isArray(eventsOrPayload)) {
    events = eventsOrPayload.events || [];
  }
  return events.map(migrateEvent);
}

// ============================================================
// Sync
// ============================================================
async function fetchRemote() {
  if (state.mode !== 'shared' || !state.binId) return null;
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${state.binId}/latest`, {
      headers: { 'X-Bin-Meta': 'false' }
    });
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    const data = await res.json();
    return migrateAll(data);
  } catch (e) {
    console.error('fetchRemote error:', e);
    setSyncState('error');
    return null;
  }
}

async function pushRemote() {
  if (state.mode !== 'shared' || !state.binId) {
    localStorage.setItem(LS.local, JSON.stringify(state.events));
    setSyncState('local');
    return true;
  }
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${state.binId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: state.events, schemaVersion: SCHEMA_VERSION })
    });
    if (!res.ok) throw new Error('push failed: ' + res.status);
    setSyncState('ok');
    return true;
  } catch (e) {
    console.error('pushRemote error:', e);
    setSyncState('error');
    localStorage.setItem(LS.local, JSON.stringify(state.events));
    return false;
  }
}

function setSyncState(s) {
  const btn = document.getElementById('sync-btn');
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-text');
  if (!dot) return;
  dot.classList.remove('offline', 'error', 'syncing', 'flash');
  if (btn) btn.classList.remove('retry');
  if (s === 'offline') {
    dot.classList.add('offline');
    text.textContent = 'offline · tap to retry';
    if (btn) btn.classList.add('retry');
  } else if (s === 'error') {
    dot.classList.add('error');
    text.textContent = 'sync error · tap to retry';
    if (btn) btn.classList.add('retry');
  } else if (s === 'syncing') {
    dot.classList.add('syncing');
    text.textContent = 'syncing…';
  } else if (s === 'local') {
    dot.classList.add('offline');
    text.textContent = 'this device only';
  } else {
    // ok / synced — flash check briefly if user just manually retried or recovered from a failure
    const wasError = state.lastSyncError;
    state.lastSyncError = false;
    state.lastSyncOk = Date.now();
    if (state.manualSyncFlash || wasError) {
      state.manualSyncFlash = false;
      dot.classList.add('flash');
      text.textContent = '✓ up to date';
      clearTimeout(state.syncFlashTimer);
      state.syncFlashTimer = setTimeout(() => {
        if (text) text.textContent = 'synced';
        if (dot) dot.classList.remove('flash');
      }, 1500);
    } else {
      text.textContent = 'synced';
    }
  }
  if (s === 'error' || s === 'offline') state.lastSyncError = true;
}

async function manualSync() {
  if (state.syncing) return; // already in flight
  if (state.mode !== 'shared' || !state.binId) {
    // device-only mode — give a tiny visual ping but no network
    setSyncState('local');
    return;
  }
  state.manualSyncFlash = true;
  state.syncing = true;
  try {
    await loadEvents(); // sets sync state internally (ok / error)
    setTab(state.tab);
  } finally {
    state.syncing = false;
  }
}

async function loadEvents() {
  if (state.mode === 'shared' && state.binId) {
    setSyncState('syncing');
    const remote = await fetchRemote();
    if (remote !== null) {
      // Preserve any events in current state that aren't in remote — these are
      // pending pushes (logged during fetch, or queued from a previous failed sync).
      const remoteIds = new Set(remote.map(e => e.id));
      const pending = state.events.filter(e => !remoteIds.has(e.id));
      state.events = [...remote, ...pending];
      state.remoteKnown = true;
      if (pending.length > 0) {
        // Flush pending events back up so they persist remotely
        await pushRemote();
      } else {
        setSyncState('ok');
      }
    } else {
      const cached = localStorage.getItem(LS.local);
      state.events = cached ? migrateAll(JSON.parse(cached)) : [];
      // fetchRemote already set 'error' state; leave it. remoteKnown stays false
      // so subsequent saves keep deferring until we actually see remote.
    }
  } else {
    const cached = localStorage.getItem(LS.local);
    state.events = cached ? migrateAll(JSON.parse(cached)) : [];
    state.remoteKnown = true;
    setSyncState('local');
  }
  state.events.sort((a, b) => b.time - a.time);
}

function saveDebounced() {
  localStorage.setItem(LS.local, JSON.stringify(state.events));
  if (state.saveDebounce) clearTimeout(state.saveDebounce);
  setSyncState('syncing');
  // Defer push until we've successfully observed remote — pushing partial
  // state.events before initial fetch returns would overwrite remote with
  // a mostly-empty bin.
  if (state.mode === 'shared' && !state.remoteKnown) return;
  state.saveDebounce = setTimeout(async () => { await pushRemote(); }, 600);
}

// ============================================================
// Event CRUD
// ============================================================
function logPoint(type, opts = {}) {
  const evt = {
    id: newId(),
    type: type,
    time: opts.time || Date.now(),
    time_precision: opts.precision || 'exact',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
    tags: opts.tags || [],
    who: opts.who || 'us',
    note: opts.note || '',
    retroactive: opts.retroactive || false,
    source: 'manual',
    created: Date.now()
  };
  if (opts.location) evt.location = opts.location;
  if (opts.description) evt.description = opts.description;
  if (opts.subkind) {
    if (type === 'enrichment') evt.enrichment_kind = opts.subkind;
    if (type === 'medication') evt.medication_name = opts.subkind;
    if (type === 'episode') evt.episode_kind = opts.subkind;
    if (type === 'appointment') evt.appointment_kind = opts.subkind;
    if (type === 'outing') evt.outing_kind = opts.subkind;
    if (type === 'meal') evt.meal_type = opts.subkind;
  }
  state.events.unshift(evt);
  state.events.sort((a, b) => b.time - a.time);
  saveDebounced();
  return evt;
}

function startRange(type, opts = {}) {
  const active = findActiveRange(type);
  if (active) return active;
  return logPoint(type, opts);
}
function endRange(id, endTime = Date.now()) {
  const idx = state.events.findIndex(e => e.id === id);
  if (idx >= 0) {
    state.events[idx].end_time = endTime;
    saveDebounced();
  }
}
function findActiveRange(type) {
  return state.events.find(e => e.type === type && !e.end_time);
}
function deleteEvent(id) {
  state.events = state.events.filter(e => e.id !== id);
  saveDebounced();
}
function updateEvent(id, updates) {
  const idx = state.events.findIndex(e => e.id === id);
  if (idx >= 0) {
    state.events[idx] = { ...state.events[idx], ...updates, modified: Date.now() };
    state.events.sort((a, b) => b.time - a.time);
    saveDebounced();
  }
}

// ============================================================
// Predictions
// ============================================================
function activeSlumber() {
  return state.events.find(e => e.type === 'slumber' && !e.end_time);
}

function predictions() {
  const now = Date.now();

  // If currently in slumber, suppress predictions
  if (activeSlumber()) {
    return { nextPee: null, restOfDay: null, suppressed: 'slumber' };
  }

  const peeEvents = state.events.filter(e => e.type === 'pee').sort((a, b) => a.time - b.time);
  let nextPee = null;
  if (peeEvents.length >= 2) {
    const recent = peeEvents.slice(-8);
    const gaps = [];
    for (let i = 1; i < recent.length; i++) {
      const gap = recent[i].time - recent[i-1].time;
      if (gap < 4 * 3600 * 1000) gaps.push(gap);
    }
    if (gaps.length > 0) {
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const lastPee = peeEvents[peeEvents.length - 1].time;
      const sinceLast = now - lastPee;
      const minsToNext = Math.round((lastPee + avgGap - now) / 60000);
      const avgMins = Math.round(avgGap / 60000);
      let risk = null;
      if (sinceLast > avgGap * 1.2) risk = 'high';
      else if (sinceLast > avgGap * 0.85) risk = 'med';
      nextPee = { minsToNext, avgMins, risk, sinceLast };
    }
  }

  // Rest of day
  let restOfDay = null;
  const todayStart = startOfDay(now);
  const hour = new Date(now).getHours();
  if (hour >= 14) {
    const todayEvents = state.events.filter(e => e.time >= todayStart && e.time <= now);
    const todayPees = todayEvents.filter(e => e.type === 'pee').length;
    const todayPoops = todayEvents.filter(e => e.type === 'poop').length;
    const windows = [];
    for (let i = 1; i <= 30 && windows.length < 14; i++) {
      const dayStart = startOfDay(now - i * 86400000);
      const dayEnd = endOfDay(dayStart);
      const dayEvents = state.events.filter(e => e.time >= dayStart && e.time <= dayEnd);
      if (dayEvents.length === 0) continue;
      const pees = dayEvents.filter(e => e.type === 'pee').length;
      const poops = dayEvents.filter(e => e.type === 'poop').length;
      const lastEvt = Math.max(...dayEvents.map(e => e.time));
      const lastEvtMins = (lastEvt - dayStart) / 60000;
      windows.push({ pees, poops, lastEvtMins });
    }
    if (windows.length >= 3) {
      const avgPees = windows.reduce((a, w) => a + w.pees, 0) / windows.length;
      const avgPoops = windows.reduce((a, w) => a + w.poops, 0) / windows.length;
      const avgLastMins = windows.reduce((a, w) => a + w.lastEvtMins, 0) / windows.length;
      const morePees = Math.max(0, Math.round(avgPees - todayPees));
      const morePoops = Math.max(0, Math.round(avgPoops - todayPoops));
      const lastTime = todayStart + avgLastMins * 60000;
      restOfDay = { morePees, morePoops, lastTime };
    }
  }

  return { nextPee, restOfDay, suppressed: null };
}

// ============================================================
// Schedule logic ("next up")
// ============================================================
function getActiveSchedule() {
  return state.schedules[todayProfileAuto()] || state.schedules.wfh;
}

function nextScheduledEvent(now = Date.now()) {
  // Build today's schedule events, find the next one after `now`
  const sch = getActiveSchedule();
  const baseDate = new Date(now);
  const items = [];
  items.push({ kind: 'wake', label: 'Wake', icon: '☀️', ts: timeToTodayTs(sch.wake, baseDate) });
  for (const meal of sch.meals) {
    items.push({ kind: 'meal', label: meal.kind || 'Meal', icon: '🍽', ts: timeToTodayTs(meal.time, baseDate) });
  }
  for (const nap of sch.naps) {
    items.push({ kind: 'nap-start', label: 'Nap', icon: '💤', ts: timeToTodayTs(nap.start, baseDate) });
  }
  items.push({ kind: 'slumber', label: 'Slumber', icon: '🌙', ts: timeToTodayTs(sch.slumber, baseDate) });
  // Sort and find next after now
  items.sort((a, b) => a.ts - b.ts);
  return items.find(i => i.ts > now);
}

// ============================================================
// Timeline collapse (3-min pee+poop merge)
// ============================================================
function buildTimelineRows(events) {
  const rows = [];
  const used = new Set();
  const sorted = [...events].sort((a, b) => b.time - a.time);
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i].id)) continue;
    const e = sorted[i];
    if (e.type === 'pee' || e.type === 'poop') {
      const partnerType = e.type === 'pee' ? 'poop' : 'pee';
      const partner = sorted.find(p =>
        !used.has(p.id) && p.id !== e.id &&
        p.type === partnerType &&
        Math.abs(p.time - e.time) <= 3 * 60 * 1000
      );
      if (partner) {
        used.add(e.id);
        used.add(partner.id);
        rows.push({ kind: 'combined', primary: e, partner: partner });
        continue;
      }
    }
    used.add(e.id);
    rows.push({ kind: 'single', evt: e });
  }
  return rows;
}

// ============================================================
// Tab routing
// ============================================================
function setTab(tab) {
  state.tab = tab;
  localStorage.setItem(LS.tab, tab);
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  if (tab === 'today') renderToday();
  if (tab === 'calendar') renderCalendar();
  if (tab === 'growth') renderGrowth();
}

// ============================================================
// TODAY tab
// ============================================================
function renderToday() {
  const now = Date.now();
  const lastPee = state.events.find(e => e.type === 'pee');
  const lastPoop = state.events.find(e => e.type === 'poop');
  document.getElementById('last-pee').textContent = lastPee ? timeAgo(lastPee.time) : '—';
  document.getElementById('last-poop').textContent = lastPoop ? timeAgo(lastPoop.time) : '—';

  // Wake window: time since last slumber.end (or last nap.end if no slumber today)
  const lastSlumber = state.events.find(e => e.type === 'slumber' && e.end_time);
  const activeNap = findActiveRange('nap');
  const activeSlumberEvt = activeSlumber();

  const wakeWindowEl = document.getElementById('wake-window');
  if (activeSlumberEvt) {
    wakeWindowEl.textContent = 'sleeping (' + formatDuration(now - activeSlumberEvt.time) + ')';
  } else if (activeNap) {
    wakeWindowEl.textContent = 'napping (' + formatDuration(now - activeNap.time) + ')';
  } else {
    // Find the most recent end of any sleep range
    const sleepEnds = state.events
      .filter(e => (e.type === 'slumber' || e.type === 'nap') && e.end_time)
      .map(e => e.end_time);
    if (sleepEnds.length > 0) {
      const lastWake = Math.max(...sleepEnds);
      wakeWindowEl.textContent = formatDuration(now - lastWake);
    } else {
      wakeWindowEl.textContent = '—';
    }
  }

  // Predictions
  const { nextPee, restOfDay, suppressed } = predictions();
  const nextEl = document.getElementById('next-pee');
  if (suppressed === 'slumber') {
    nextEl.textContent = 'paused (sleeping)';
  } else if (!nextPee) {
    nextEl.textContent = lastPee ? 'gathering data…' : 'no pees logged yet';
  } else {
    const m = Math.max(0, nextPee.minsToNext);
    if (nextPee.risk === 'high') {
      nextEl.innerHTML = `overdue (avg ${nextPee.avgMins}m gap) <span class="risk-pill high">⚠ go now</span>`;
    } else if (nextPee.risk === 'med') {
      nextEl.innerHTML = `~${m}m <span class="risk-pill med">heads up</span>`;
    } else {
      nextEl.textContent = '~' + m + 'm';
    }
  }

  const rodEl = document.getElementById('rest-of-day');
  if (rodEl) {
    if (!restOfDay || suppressed) {
      rodEl.parentElement.style.display = 'none';
    } else {
      rodEl.parentElement.style.display = 'block';
      const lastClock = formatClock(restOfDay.lastTime);
      rodEl.textContent = `~${restOfDay.morePees} more pees, ~${restOfDay.morePoops} more poops, last around ${lastClock}`;
    }
  }

  // "Next up" card from schedule
  const nextUp = nextScheduledEvent(now);
  const nextUpCard = document.getElementById('next-up');
  if (nextUp) {
    const minsAway = Math.round((nextUp.ts - now) / 60000);
    let timeText;
    if (minsAway < 1) timeText = 'now';
    else if (minsAway < 60) timeText = 'in ' + minsAway + 'm';
    else timeText = 'at ' + formatClock(nextUp.ts);
    const profile = state.schedules[todayProfileAuto()].label;
    nextUpCard.innerHTML = `
      <span class="next-up-icon">${nextUp.icon}</span>
      <div>
        <div class="next-up-title">${nextUp.label} ${timeText}</div>
        <div class="next-up-sub">on schedule · <span class="profile-pill">${profile}</span></div>
      </div>
    `;
    nextUpCard.classList.remove('hidden');
  } else {
    nextUpCard.classList.add('hidden');
  }

  // Plan row visualization
  renderPlanRow();

  // Range tiles
  renderRangeTiles();

  // Timeline (today only)
  const today = startOfDay(now);
  const todayEvents = state.events.filter(e => e.time >= today);
  document.getElementById('event-count').textContent = todayEvents.length + ' today';

  const timeline = document.getElementById('timeline');
  if (todayEvents.length === 0) {
    timeline.innerHTML = '<div class="empty-state">No events yet. Tap a tile above to log.</div>';
    return;
  }
  const rows = buildTimelineRows(todayEvents);
  timeline.innerHTML = '';
  rows.forEach(row => timeline.appendChild(renderEventRow(row)));
}

function renderPlanRow() {
  const sch = getActiveSchedule();
  const track = document.getElementById('plan-track');
  if (!track) return;

  const dayStart = startOfDay(Date.now());
  const dayMs = 86400000;

  // Map a clock string to position on track (% of day)
  const pct = (hhmm) => (parseTimeToMins(hhmm) / 1440) * 100;

  let html = '';
  // Naps
  for (const nap of sch.naps) {
    const left = pct(nap.start);
    const w = pct(nap.end) - pct(nap.start);
    html += `<div class="plan-block nap-plan" style="left:${left}%;width:${w}%;">nap</div>`;
  }
  // Meals — narrow blocks ~30min wide
  for (const meal of sch.meals) {
    const startMins = parseTimeToMins(meal.time);
    const left = (startMins / 1440) * 100;
    const w = (30 / 1440) * 100;
    html += `<div class="plan-block meal-plan" style="left:${left}%;width:${w}%;">${(meal.kind || 'meal').slice(0,4)}</div>`;
  }
  // Slumber: from slumber time to end of day
  const slumberLeft = pct(sch.slumber);
  const slumberWidth = 100 - slumberLeft;
  html += `<div class="plan-block slumber-plan" style="left:${slumberLeft}%;width:${slumberWidth}%;">sleep</div>`;
  // Wake: small marker
  const wakeLeft = pct(sch.wake);
  html += `<div class="plan-block wake-plan" style="left:${wakeLeft}%;width:1.5%;"></div>`;

  // Now line
  const now = Date.now();
  const nowMins = (now - dayStart) / 60000;
  const nowPct = (nowMins / 1440) * 100;
  html += `<div class="plan-now" style="left:${Math.max(0, Math.min(100, nowPct))}%;"></div>`;

  track.innerHTML = html;

  // Profile label
  const profile = state.schedules[todayProfileAuto()].label;
  const lblEl = document.getElementById('plan-profile-label');
  if (lblEl) lblEl.textContent = profile + ' schedule';
}

function renderEventRow(row) {
  const el = document.createElement('button');
  el.className = 'event';
  el.type = 'button';

  if (row.kind === 'combined') {
    const e1 = row.primary, e2 = row.partner;
    const earlier = e1.time < e2.time ? e1 : e2;
    const later = e1.time < e2.time ? e2 : e1;
    const gapMin = Math.round((later.time - earlier.time) / 60000);
    const tags = [...new Set([...(e1.tags || []), ...(e2.tags || [])])];
    el.dataset.id = e1.id;

    const tagPills = renderTagPills(tags, e1.who, e1);
    const retroPill = (e1.retroactive || e2.retroactive) ? '<span class="tag retro">added later</span>' : '';
    el.innerHTML = `
      <div class="event-icon">🟨💩</div>
      <div class="event-main">
        <div class="event-type">Pee + poop ${tagPills}${retroPill}</div>
        <div class="event-meta">
          <span>${formatClockLong(earlier.time)}</span><span>·</span>
          <span>${gapMin}m apart</span><span>·</span>
          <span>${timeAgo(earlier.time)}</span>
        </div>
      </div>
    `;
    el.addEventListener('click', () => openEditModal(e1));
  } else {
    const e = row.evt;
    el.dataset.id = e.id;
    const tagPills = renderTagPills(e.tags || [], e.who, e);
    const retroPill = e.retroactive ? '<span class="tag retro">added later</span>' : '';
    const precPill = e.time_precision === 'approx' ? '<span class="tag approx">~approx</span>' :
                     e.time_precision === 'unknown' ? '<span class="tag unknown-time">~unknown</span>' : '';

    let metaText = formatClockLong(e.time);
    if (RANGE_TYPES.includes(e.type)) {
      if (e.end_time) {
        metaText = `${formatClock(e.time)} – ${formatClock(e.end_time)} · ${formatDuration(e.end_time - e.time)}`;
      } else {
        metaText = `${formatClock(e.time)} – now · ${formatDuration(Date.now() - e.time)} (active)`;
      }
    }

    let label = TYPE_DEFS[e.type]?.label || e.type;
    // Append subkind if present
    const subkind = e.enrichment_kind || e.medication_name || e.episode_kind || e.appointment_kind || e.outing_kind || e.meal_type;
    if (subkind) label += ` · ${subkind}`;

    const noteText = e.note ? `<div class="event-note">"${escapeHtml(e.note)}"</div>` :
                     e.description ? `<div class="event-note">${escapeHtml(e.description)}</div>` : '';
    const locText = e.location ? ` <span class="tag location">📍${escapeHtml(e.location)}</span>` : '';

    el.innerHTML = `
      <div class="event-icon">${TYPE_DEFS[e.type]?.icon || '?'}</div>
      <div class="event-main">
        <div class="event-type">${escapeHtml(label)} ${tagPills}${locText}${retroPill}${precPill}</div>
        <div class="event-meta">
          <span>${metaText}</span>${(e.type !== 'note' && !RANGE_TYPES.includes(e.type)) ? `<span>·</span><span>${timeAgo(e.time)}</span>` : ''}
        </div>
        ${noteText}
      </div>
    `;
    el.addEventListener('click', () => openEditModal(e));
  }
  return el;
}

function renderTagPills(tags, who, evt) {
  let pills = (tags || []).map(t => {
    const def = TAG_DEFS.find(d => d.id === t);
    const cls = def ? (def.group === 'context' ? t : 'where') : (t === 'indoors' || t === 'outdoors' ? 'where' : 'location');
    return `<span class="tag ${cls}">${escapeHtml(t)}</span>`;
  });
  if (who && who !== 'us') {
    const whoOpt = WHO_OPTIONS.find(w => w.id === who);
    if (whoOpt) pills.push(`<span class="tag who-${who}">${escapeHtml(whoOpt.label)}</span>`);
  }
  return pills.join(' ');
}

function renderRangeTiles() {
  for (const t of ['nap', 'walk', 'slumber']) {
    renderRangeTile(t, findActiveRange(t));
  }
}
function renderRangeTile(type, active) {
  const tile = document.getElementById('range-' + type);
  if (!tile) return;
  if (active) {
    const dur = formatDuration(Date.now() - active.time);
    tile.classList.add('active');
    tile.innerHTML = `
      <span class="icon">${TYPE_DEFS[type].icon}</span>
      <div class="label">End ${type}</div>
      <div class="sub">${dur}</div>
    `;
    tile.dataset.activeId = active.id;
  } else {
    tile.classList.remove('active');
    const labelMap = { nap: 'Start nap', walk: 'Start walk', slumber: 'Start slumber' };
    tile.innerHTML = `
      <span class="icon">${TYPE_DEFS[type].icon}</span>
      <div class="label">${labelMap[type]}</div>
      <div class="sub">tap to begin</div>
    `;
    delete tile.dataset.activeId;
  }
}

// ============================================================
// CALENDAR tab
// ============================================================
function renderCalendar() {
  const cursor = state.calCursor;
  const monthDate = new Date(cursor);
  document.getElementById('cal-month-label').textContent =
    monthDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const isCurrentMonth = sameDay(monthStart(Date.now()), cursor);
  document.getElementById('cal-next').disabled = isCurrentMonth;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  ['S','M','T','W','T','F','S'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'cal-dow';
    h.textContent = d;
    grid.appendChild(h);
  });

  const firstDow = monthDate.getDay();
  const monthEnd = addMonths(cursor, 1) - 1;
  const daysInMonth = new Date(monthEnd).getDate();

  for (let i = 0; i < firstDow; i++) {
    const e = document.createElement('div');
    e.className = 'cal-day empty';
    grid.appendChild(e);
  }
  const today = startOfDay(Date.now());
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), d).getTime();
    const dayEnd = endOfDay(dayStart);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-day';
    if (dayStart > today) cell.classList.add('future');
    if (dayStart === today) cell.classList.add('today');
    if (state.calSelected === dayStart) cell.classList.add('selected');

    const dayEvents = state.events.filter(e => e.time >= dayStart && e.time <= dayEnd);
    const pees = dayEvents.filter(e => e.type === 'pee').length;
    const poops = dayEvents.filter(e => e.type === 'poop').length;
    const accidents = dayEvents.filter(e => (e.tags || []).includes('accident')).length;
    const episodes = dayEvents.filter(e => e.type === 'episode').length;
    const vomits = dayEvents.filter(e => e.type === 'vomit').length;

    let dotsHtml = '';
    const peeShown = Math.min(pees, 6);
    const poopShown = Math.min(poops, 4);
    for (let i = 0; i < peeShown; i++) dotsHtml += '<span class="cal-dot pee"></span>';
    for (let i = 0; i < poopShown; i++) dotsHtml += '<span class="cal-dot poop"></span>';
    if (accidents > 0) dotsHtml += '<span class="cal-dot accident"></span>';
    if (episodes > 0) dotsHtml += '<span class="cal-dot episode"></span>';
    if (vomits > 0) dotsHtml += '<span class="cal-dot vomit"></span>';

    cell.innerHTML = `
      <span class="cal-day-num">${d}</span>
      <div class="cal-day-dots">${dotsHtml}</div>
    `;
    if (dayStart <= today) {
      cell.addEventListener('click', () => {
        state.calSelected = dayStart;
        renderCalendar();
      });
    }
    grid.appendChild(cell);
  }

  const dayView = document.getElementById('day-view');
  if (state.calSelected != null) {
    dayView.classList.remove('hidden');
    renderDayView(state.calSelected);
  } else {
    dayView.classList.add('hidden');
  }
}

function renderDayView(dayStart) {
  const dayEnd = endOfDay(dayStart);
  const dayEvents = state.events.filter(e => e.time >= dayStart && e.time <= dayEnd)
                                .sort((a, b) => a.time - b.time);
  const labelEl = document.getElementById('day-view-label');
  const dt = new Date(dayStart);
  labelEl.textContent = dt.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  const strip = document.getElementById('day-strip');
  let stripHtml = '';
  for (let h = 0; h <= 24; h += 6) {
    const x = (h / 24) * 100;
    stripHtml += `<div class="day-strip-hour" style="left:${x}%">${h === 0 ? '' : (h > 12 ? (h-12)+'p' : h+'a')}</div>`;
  }
  dayEvents.forEach(e => {
    const offset = (e.time - dayStart) / 86400000;
    const x = Math.max(0, Math.min(1, offset)) * 100;
    if (RANGE_TYPES.includes(e.type) && e.end_time) {
      const xEnd = Math.max(0, Math.min(1, (e.end_time - dayStart) / 86400000)) * 100;
      const w = Math.max(1, xEnd - x);
      const colorVar = `var(--${TYPE_DEFS[e.type].color})`;
      stripHtml += `<div class="day-strip-range" style="left:${x}%;width:${w}%;background:${colorVar};"></div>`;
    } else {
      const colorVar = `var(--${TYPE_DEFS[e.type]?.color || 'gap'})`;
      stripHtml += `<div class="day-strip-mark" style="left:${x}%;background:${colorVar};"></div>`;
    }
  });
  strip.innerHTML = stripHtml;

  const pees = dayEvents.filter(e => e.type === 'pee').length;
  const poops = dayEvents.filter(e => e.type === 'poop').length;
  const accidents = dayEvents.filter(e => (e.tags || []).includes('accident')).length;
  const meals = dayEvents.filter(e => e.type === 'meal').length;
  const napMs = dayEvents.filter(e => e.type === 'nap' && e.end_time)
                        .reduce((sum, e) => sum + (e.end_time - e.time), 0);
  const slumberMs = dayEvents.filter(e => e.type === 'slumber' && e.end_time)
                            .reduce((sum, e) => sum + (e.end_time - e.time), 0);
  const walkMs = dayEvents.filter(e => e.type === 'walk' && e.end_time)
                         .reduce((sum, e) => sum + (e.end_time - e.time), 0);

  document.getElementById('day-pees').textContent = pees;
  document.getElementById('day-poops').textContent = poops + (accidents > 0 ? ` (${accidents}🚨)` : '');
  document.getElementById('day-meals').textContent = meals;
  document.getElementById('day-naps').textContent = napMs > 0 ? formatDuration(napMs) : '—';
  document.getElementById('day-slumber').textContent = slumberMs > 0 ? formatDuration(slumberMs) : '—';
  document.getElementById('day-walks').textContent = walkMs > 0 ? formatDuration(walkMs) : '—';
  document.getElementById('day-events').textContent = dayEvents.length;

  const vsEl = document.getElementById('day-vs');
  const monthAvgPees = avgPerDayOverPast(30, 'pee', dayStart);
  const monthAvgPoops = avgPerDayOverPast(30, 'poop', dayStart);
  if (monthAvgPees > 0) {
    const vsPees = pees - monthAvgPees;
    const vsPoops = poops - monthAvgPoops;
    const arrowPee = vsPees > 0 ? '↑' : (vsPees < 0 ? '↓' : '·');
    const arrowPoop = vsPoops > 0 ? '↑' : (vsPoops < 0 ? '↓' : '·');
    vsEl.textContent = `vs 30-day avg: pees ${arrowPee} (${monthAvgPees.toFixed(1)}), poops ${arrowPoop} (${monthAvgPoops.toFixed(1)})`;
  } else {
    vsEl.textContent = '';
  }

  const list = document.getElementById('day-list');
  if (dayEvents.length === 0) {
    list.innerHTML = '<div class="empty-state">No events on this day.</div>';
    return;
  }
  list.innerHTML = '';
  dayEvents.forEach(e => {
    const row = document.createElement('div');
    row.className = 'day-list-row';
    let timeLabel, icon, label;
    if (RANGE_TYPES.includes(e.type)) {
      const endLabel = e.end_time ? formatClock(e.end_time) : 'now';
      timeLabel = `${formatClock(e.time)}–${endLabel}`;
      icon = TYPE_DEFS[e.type].icon;
      const dur = e.end_time ? formatDuration(e.end_time - e.time) : 'active';
      label = `${TYPE_DEFS[e.type].label} (${dur})`;
    } else {
      timeLabel = formatClock(e.time);
      icon = TYPE_DEFS[e.type]?.icon || '?';
      label = TYPE_DEFS[e.type]?.label || e.type;
    }
    const subkind = e.enrichment_kind || e.medication_name || e.episode_kind || e.appointment_kind || e.outing_kind || e.meal_type;
    if (subkind) label += ` · ${subkind}`;

    let extras = '';
    if (e.tags && e.tags.length) extras += ' ' + e.tags.map(t => `<span class="day-tags">${escapeHtml(t)}</span>`).join('');
    if (e.who && e.who !== 'us') {
      const w = WHO_OPTIONS.find(w => w.id === e.who);
      if (w) extras += ` <span class="day-tags">${escapeHtml(w.label)}</span>`;
    }
    if (e.location) extras += ` <span class="day-tags">📍${escapeHtml(e.location)}</span>`;
    if (e.note) extras += ` <span class="day-tags">"${escapeHtml(e.note)}"</span>`;
    if (e.description) extras += ` <span class="day-tags">${escapeHtml(e.description)}</span>`;

    row.innerHTML = `
      <span class="day-list-time">${timeLabel}</span>
      <span class="day-list-icon">${icon}</span>
      <span class="day-list-text">${escapeHtml(label)}${extras}</span>
    `;
    row.addEventListener('click', () => openEditModal(e));
    list.appendChild(row);
  });
}

function avgPerDayOverPast(days, type, beforeTs) {
  const cutoff = beforeTs - days * 86400000;
  const counts = {};
  state.events.forEach(e => {
    if (e.type !== type) return;
    if (e.time < cutoff || e.time >= beforeTs) return;
    const day = startOfDay(e.time);
    counts[day] = (counts[day] || 0) + 1;
  });
  const dayCount = Object.keys(counts).length;
  if (dayCount === 0) return 0;
  return Object.values(counts).reduce((a, b) => a + b, 0) / dayCount;
}

// ============================================================
// GROWTH tab
// ============================================================
function renderGrowth() {
  const ageNow = ageAt(Date.now());
  document.getElementById('growth-age').textContent = ageNow.label + ' old';
  const days = new Set(state.events.map(e => startOfDay(e.time))).size;
  document.getElementById('growth-days').textContent = days + ' days of data';
  const progressPct = Math.min(100, Math.round((ageNow.months / 18) * 100));
  document.getElementById('growth-progress-bar').style.width = progressPct + '%';

  const buckets = bucketByMonthOfLife();
  renderStatCard('stat-pees',     buckets, 'pees per day',     'count', d => d.pees);
  renderStatCard('stat-accidents',buckets, 'accidents per week','count', d => d.accidents * 7);
  renderStatCard('stat-hold',     buckets, 'longest pee gap',  'hours', d => d.longestPeeGapHrs);
  renderStatCard('stat-sleep',    buckets, 'sleep per day',    'hours', d => d.sleepHrs);
  renderStatCard('stat-active',   buckets, 'active hours',     'hours', d => d.activeHrs);
  renderStatCard('stat-bedtime',  buckets, 'avg bedtime',      'clock', d => d.bedtimeHr, true);
  renderMilestones();
}

function bucketByMonthOfLife() {
  const bucketsByMonth = new Map();
  const eventsByDay = new Map();
  state.events.forEach(e => {
    const day = startOfDay(e.time);
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day).push(e);
  });

  for (const [day, events] of eventsByDay) {
    const ageOnDay = ageAt(day);
    const monthOfLife = Math.floor(ageOnDay.months);
    if (monthOfLife < 0) continue;
    if (!bucketsByMonth.has(monthOfLife)) {
      bucketsByMonth.set(monthOfLife, { pees: [], poops: [], accidents: [], napHrs: [], slumberHrs: [], activeHrs: [], longestPeeGapHrs: [], bedtimeHr: [] });
    }
    const b = bucketsByMonth.get(monthOfLife);
    const pees = events.filter(e => e.type === 'pee').sort((x, y) => x.time - y.time);
    const poops = events.filter(e => e.type === 'poop');
    const accidents = events.filter(e => (e.tags || []).includes('accident'));
    b.pees.push(pees.length);
    b.poops.push(poops.length);
    b.accidents.push(accidents.length);
    const napMs = events.filter(e => e.type === 'nap' && e.end_time).reduce((s, e) => s + (e.end_time - e.time), 0);
    const slumberMs = events.filter(e => e.type === 'slumber' && e.end_time).reduce((s, e) => s + (e.end_time - e.time), 0);
    b.napHrs.push(napMs / 3600000);
    b.slumberHrs.push(slumberMs / 3600000);

    // Active hours: between slumber.end and slumber.start, fall back to first→last event
    const slumberOn = events.find(e => e.type === 'slumber');
    if (slumberOn && slumberOn.end_time) {
      const startTs = slumberOn.end_time;
      const endTs = events.filter(e => e.type === 'slumber').slice(-1)[0]?.time || slumberOn.end_time;
      if (endTs > startTs) {
        b.activeHrs.push((endTs - startTs) / 3600000);
        const ld = new Date(endTs);
        b.bedtimeHr.push(ld.getHours() + ld.getMinutes() / 60);
      }
    } else if (events.length >= 2) {
      const firstT = Math.min(...events.map(e => e.time));
      const lastT = Math.max(...events.map(e => e.time));
      b.activeHrs.push((lastT - firstT) / 3600000);
      const lastDate = new Date(lastT);
      b.bedtimeHr.push(lastDate.getHours() + lastDate.getMinutes() / 60);
    }
    if (pees.length >= 2) {
      let maxGap = 0;
      for (let i = 1; i < pees.length; i++) {
        const gap = pees[i].time - pees[i-1].time;
        if (gap < 8 * 3600 * 1000) maxGap = Math.max(maxGap, gap);
      }
      if (maxGap > 0) b.longestPeeGapHrs.push(maxGap / 3600000);
    }
  }

  const arr = [];
  const months = [...bucketsByMonth.keys()].sort((a, b) => a - b);
  for (const m of months) {
    const b = bucketsByMonth.get(m);
    arr.push({
      month: m,
      pees: avg(b.pees),
      poops: avg(b.poops),
      accidents: avg(b.accidents),
      napHrs: avg(b.napHrs),
      slumberHrs: avg(b.slumberHrs),
      sleepHrs: avg(b.napHrs) + avg(b.slumberHrs),
      activeHrs: avg(b.activeHrs),
      longestPeeGapHrs: b.longestPeeGapHrs.length ? Math.max(...b.longestPeeGapHrs) : 0,
      bedtimeHr: avg(b.bedtimeHr),
      days: b.pees.length
    });
  }
  return arr;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function renderStatCard(id, buckets, title, unit, accessor, isClock) {
  const card = document.getElementById(id);
  if (!card) return;
  const points = buckets.map(b => ({ x: b.month, y: accessor(b), days: b.days })).filter(p => p.y > 0);
  card.querySelector('.stat-card-title').textContent = title;
  const currentEl = card.querySelector('.stat-card-current');
  const trendEl = card.querySelector('.stat-card-trend');
  const chartEl = card.querySelector('.stat-chart');

  if (points.length === 0) {
    currentEl.textContent = '—';
    trendEl.textContent = 'need more data';
    chartEl.innerHTML = '';
    return;
  }
  const last = points[points.length - 1];
  if (isClock) {
    const h = Math.floor(last.y);
    const m = Math.round((last.y - h) * 60);
    currentEl.textContent = `${h % 12 === 0 ? 12 : h % 12}:${m.toString().padStart(2,'0')}${h < 12 ? 'am' : 'pm'}`;
  } else {
    currentEl.innerHTML = `${last.y.toFixed(1)}<span class="unit"> ${unit === 'count' ? '' : unit}</span>`;
  }
  if (points.length >= 2) {
    const first = points[0];
    const delta = last.y - first.y;
    if (Math.abs(delta) < 0.1) {
      trendEl.textContent = 'stable';
      trendEl.classList.remove('up', 'down');
    } else {
      const sign = delta > 0 ? '+' : '';
      trendEl.textContent = `${sign}${delta.toFixed(1)} since ${first.x}mo`;
      trendEl.classList.toggle('up', delta > 0);
      trendEl.classList.toggle('down', delta < 0);
    }
  } else {
    trendEl.textContent = `at ${last.x} months old`;
  }

  const w = 240, h = 40;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const xRange = maxX - minX || 1;
  const yRange = maxY - minY || 1;
  const px = points.map(p => ({
    x: ((p.x - minX) / xRange) * (w - 8) + 4,
    y: h - 4 - ((p.y - minY) / yRange) * (h - 12)
  }));
  let path = '';
  px.forEach((p, i) => path += (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ' ');
  const dots = px.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="var(--info-strong)"/>`).join('');
  chartEl.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none">
      <path d="${path}" stroke="var(--info-strong)" stroke-width="1.5" fill="none" />
      ${dots}
    </svg>
  `;
}

function renderMilestones() {
  const list = document.getElementById('milestone-list');
  const milestones = [];

  // First clean day
  const dayMap = new Map();
  state.events.forEach(e => {
    const d = startOfDay(e.time);
    if (!dayMap.has(d)) dayMap.set(d, { pees: 0, accidents: 0 });
    const day = dayMap.get(d);
    if (e.type === 'pee' || e.type === 'poop') day.pees++;
    if ((e.tags || []).includes('accident')) day.accidents++;
  });
  const days = [...dayMap.entries()].sort((a, b) => a[0] - b[0]);
  const firstAccidentDay = days.find(([, v]) => v.accidents > 0);
  if (firstAccidentDay) {
    const cleanDay = days.find(([d, v]) => d > firstAccidentDay[0] && v.pees > 0 && v.accidents === 0);
    if (cleanDay) {
      milestones.push({ title: 'First clean day', when: new Date(cleanDay[0]).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) });
    }
  }
  // Longest pee gap
  const peeEvents = state.events.filter(e => e.type === 'pee').sort((a, b) => a.time - b.time);
  let bestGap = 0, bestGapAt = null;
  for (let i = 1; i < peeEvents.length; i++) {
    const gap = peeEvents[i].time - peeEvents[i-1].time;
    if (gap < 12 * 3600 * 1000 && gap > bestGap) {
      bestGap = gap;
      bestGapAt = peeEvents[i].time;
    }
  }
  if (bestGap > 0) {
    milestones.push({ title: `Longest pee hold (${formatDuration(bestGap)})`, when: new Date(bestGapAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) });
  }
  // Longest slumber
  const slumbers = state.events.filter(e => e.type === 'slumber' && e.end_time);
  if (slumbers.length > 0) {
    const longest = slumbers.reduce((a, b) => (a.end_time - a.time > b.end_time - b.time) ? a : b);
    milestones.push({ title: `Longest slumber (${formatDuration(longest.end_time - longest.time)})`, when: new Date(longest.time).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) });
  }
  // First event
  if (state.events.length > 0) {
    const first = state.events[state.events.length - 1];
    milestones.push({ title: 'Tracking started', when: new Date(first.time).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) });
  }

  if (milestones.length === 0) {
    list.innerHTML = '<div class="empty-state">Milestones will appear as data builds up.</div>';
  } else {
    list.innerHTML = milestones.map(m => `
      <div class="milestone-row">
        <span>${escapeHtml(m.title)}</span>
        <span class="when">${escapeHtml(m.when)}</span>
      </div>
    `).join('');
  }
}

// ============================================================
// Modal: Add/Edit (manual add now covers everything)
// ============================================================
function resetModal() {
  state.modalState = blankModalState();
  state.editingId = null;
  document.querySelectorAll('#type-grid-v3 .type-btn-v3').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('#preset-row .preset-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('#tag-row .tag-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('#who-row .who-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector('#who-row .who-btn[data-who="us"]').classList.add('selected');
  document.querySelectorAll('#precision-row .precision-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector('#precision-row .precision-btn[data-prec="exact"]').classList.add('selected');
  document.getElementById('custom-time-row').classList.add('hidden');
  document.getElementById('end-time-row').classList.add('hidden');
  document.getElementById('subkind-row').classList.add('hidden');
  document.getElementById('location-row').classList.add('hidden');
  document.getElementById('event-note').value = '';
  document.getElementById('event-subkind').value = '';
  document.getElementById('event-location').value = '';
  document.getElementById('modal-delete').classList.add('hidden');
}

function openTagSheet(forType) {
  resetModal();
  document.getElementById('modal-title').textContent = `Log ${TYPE_DEFS[forType].label} with tags`;
  state.modalState.type = forType;
  document.querySelector(`#type-grid-v3 .type-btn-v3[data-type="${forType}"]`).classList.add('selected');
  refreshTagAvailability();
  toggleTypeSpecificFields();
  document.getElementById('modal-backdrop').classList.add('visible');
}

function openManualAdd() {
  resetModal();
  document.getElementById('modal-title').textContent = 'Manual add';
  refreshTagAvailability();
  document.getElementById('modal-backdrop').classList.add('visible');
}

function openEditModal(evt) {
  resetModal();
  state.editingId = evt.id;
  document.getElementById('modal-title').textContent = 'Edit event';
  document.getElementById('modal-delete').classList.remove('hidden');
  state.modalState.type = evt.type;
  state.modalState.tags = [...(evt.tags || [])];
  state.modalState.who = evt.who || 'us';
  state.modalState.precision = evt.time_precision || 'exact';
  document.querySelector(`#type-grid-v3 .type-btn-v3[data-type="${evt.type}"]`)?.classList.add('selected');
  state.modalState.tags.forEach(t => {
    document.querySelector(`#tag-row .tag-btn[data-tag="${t}"]`)?.classList.add('selected');
  });
  document.querySelectorAll('#who-row .who-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector(`#who-row .who-btn[data-who="${state.modalState.who}"]`)?.classList.add('selected');
  document.querySelectorAll('#precision-row .precision-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector(`#precision-row .precision-btn[data-prec="${state.modalState.precision}"]`)?.classList.add('selected');
  document.querySelector('#preset-row .preset-btn[data-mins="custom"]').classList.add('selected');
  state.modalState.mins = 'custom';
  document.getElementById('custom-time').value = toLocalISO(evt.time);
  document.getElementById('custom-time-row').classList.remove('hidden');
  if (RANGE_TYPES.includes(evt.type)) {
    document.getElementById('end-time-row').classList.remove('hidden');
    document.getElementById('end-time').value = evt.end_time ? toLocalISO(evt.end_time) : '';
  }
  document.getElementById('event-note').value = evt.note || '';
  document.getElementById('event-location').value = evt.location || '';
  const subkind = evt.enrichment_kind || evt.medication_name || evt.episode_kind || evt.appointment_kind || evt.outing_kind || evt.meal_type;
  document.getElementById('event-subkind').value = subkind || '';
  refreshTagAvailability();
  toggleTypeSpecificFields();
  document.getElementById('modal-backdrop').classList.add('visible');
}

function toLocalISO(ts) {
  const d = new Date(ts);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function closeModal() { document.getElementById('modal-backdrop').classList.remove('visible'); }

function refreshTagAvailability() {
  const type = state.modalState.type;
  document.querySelectorAll('#tag-row .tag-btn').forEach(btn => {
    const tag = btn.dataset.tag;
    const def = TAG_DEFS.find(t => t.id === tag);
    if (!type || !def) {
      btn.classList.remove('dim'); btn.disabled = false;
    } else if (def.appliesTo.includes(type)) {
      btn.classList.remove('dim'); btn.disabled = false;
    } else {
      btn.classList.add('dim'); btn.disabled = true;
      btn.classList.remove('selected');
      state.modalState.tags = state.modalState.tags.filter(t => t !== tag);
    }
  });
}

function toggleTypeSpecificFields() {
  const type = state.modalState.type;
  const endTimeRow = document.getElementById('end-time-row');
  const subkindRow = document.getElementById('subkind-row');
  const subkindLabel = document.getElementById('subkind-label');
  const subkindInput = document.getElementById('event-subkind');
  const locationRow = document.getElementById('location-row');

  if (type && RANGE_TYPES.includes(type)) {
    endTimeRow.classList.remove('hidden');
  } else {
    endTimeRow.classList.add('hidden');
  }

  if (type === 'enrichment') {
    subkindRow.classList.remove('hidden');
    subkindLabel.textContent = 'Enrichment kind';
    subkindInput.placeholder = 'e.g. kong, lick mat, snuffle ball';
  } else if (type === 'medication') {
    subkindRow.classList.remove('hidden');
    subkindLabel.textContent = 'Medication name';
    subkindInput.placeholder = 'e.g. trazodone, CBD';
  } else if (type === 'episode') {
    subkindRow.classList.remove('hidden');
    subkindLabel.textContent = 'Episode kind';
    subkindInput.placeholder = 'e.g. barking, distress, tweak';
  } else if (type === 'appointment') {
    subkindRow.classList.remove('hidden');
    subkindLabel.textContent = 'Appointment kind';
    subkindInput.placeholder = 'e.g. vet, grooming, training class';
  } else if (type === 'outing') {
    subkindRow.classList.remove('hidden');
    subkindLabel.textContent = 'Outing kind';
    subkindInput.placeholder = 'e.g. puppy class, park, shopping';
  } else if (type === 'meal') {
    subkindRow.classList.remove('hidden');
    subkindLabel.textContent = 'Meal kind (optional)';
    subkindInput.placeholder = 'breakfast, dinner, snack';
  } else {
    subkindRow.classList.add('hidden');
  }

  // Location row: applies to anything physical
  if (type && ['pee', 'poop', 'walk', 'outing', 'appointment', 'meal'].includes(type)) {
    locationRow.classList.remove('hidden');
  } else {
    locationRow.classList.add('hidden');
  }
}

// ============================================================
// Schedule editor
// ============================================================
function openScheduleEditor() {
  state.scheduleEditingProfile = todayProfileAuto();
  renderScheduleEditor();
  document.getElementById('schedule-modal').classList.add('visible');
}

function renderScheduleEditor() {
  const profile = state.scheduleEditingProfile;
  const sch = state.schedules[profile];
  document.querySelectorAll('.profile-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.profile === profile);
  });

  const list = document.getElementById('schedule-list');
  list.innerHTML = '';

  // Wake
  list.innerHTML += `
    <div class="schedule-row">
      <span class="ico">☀️</span>
      <span class="lbl">Wake</span>
      <input type="time" data-sch-field="wake" value="${sch.wake}">
    </div>
  `;
  // Meals
  sch.meals.forEach((meal, i) => {
    list.innerHTML += `
      <div class="schedule-row">
        <span class="ico">🍽</span>
        <span class="lbl">${escapeHtml(meal.kind || 'meal')}</span>
        <input type="time" data-sch-field="meal" data-sch-idx="${i}" value="${meal.time}">
        <button class="delete-btn" data-sch-del="meal" data-sch-idx="${i}">×</button>
      </div>
    `;
  });
  // Naps
  sch.naps.forEach((nap, i) => {
    list.innerHTML += `
      <div class="schedule-row">
        <span class="ico">💤</span>
        <span class="lbl">Nap ${i+1}</span>
        <input type="time" data-sch-field="nap-start" data-sch-idx="${i}" value="${nap.start}" style="width:78px;flex:0 0 78px;margin-right:4px;">
        <span style="font-size:11px;color:var(--text-tertiary);">to</span>
        <input type="time" data-sch-field="nap-end" data-sch-idx="${i}" value="${nap.end}" style="width:78px;flex:0 0 78px;margin-left:4px;">
        <button class="delete-btn" data-sch-del="nap" data-sch-idx="${i}">×</button>
      </div>
    `;
  });
  // Slumber
  list.innerHTML += `
    <div class="schedule-row">
      <span class="ico">🌙</span>
      <span class="lbl">Slumber</span>
      <input type="time" data-sch-field="slumber" value="${sch.slumber}">
    </div>
  `;

  list.innerHTML += `
    <button class="schedule-add" id="add-meal-btn">+ Add meal</button>
    <button class="schedule-add" id="add-nap-btn">+ Add nap</button>
  `;

  // Wire up changes
  list.querySelectorAll('input[type="time"]').forEach(inp => {
    inp.addEventListener('change', () => {
      const field = inp.dataset.schField;
      const idx = parseInt(inp.dataset.schIdx);
      if (field === 'wake') sch.wake = inp.value;
      else if (field === 'slumber') sch.slumber = inp.value;
      else if (field === 'meal') sch.meals[idx].time = inp.value;
      else if (field === 'nap-start') sch.naps[idx].start = inp.value;
      else if (field === 'nap-end') sch.naps[idx].end = inp.value;
      saveSchedules();
    });
  });
  list.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const what = btn.dataset.schDel;
      const idx = parseInt(btn.dataset.schIdx);
      if (what === 'meal') sch.meals.splice(idx, 1);
      else if (what === 'nap') sch.naps.splice(idx, 1);
      saveSchedules();
      renderScheduleEditor();
    });
  });
  document.getElementById('add-meal-btn').addEventListener('click', () => {
    sch.meals.push({ time: '12:00', kind: 'snack' });
    saveSchedules();
    renderScheduleEditor();
  });
  document.getElementById('add-nap-btn').addEventListener('click', () => {
    sch.naps.push({ start: '14:00', end: '16:00' });
    saveSchedules();
    renderScheduleEditor();
  });
}

// ============================================================
// Undo / Setup / Diagnostics
// ============================================================
function showUndo(evt) {
  state.lastUndo = evt;
  const bar = document.getElementById('undo-bar');
  const text = document.getElementById('undo-text');
  text.textContent = `Logged ${TYPE_DEFS[evt.type].icon} ${TYPE_DEFS[evt.type].label}`;
  bar.classList.add('visible');
  if (state.undoTimer) clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(() => {
    bar.classList.remove('visible');
    state.lastUndo = null;
  }, 6000);
}

function showSetup() {
  document.getElementById('setup').classList.remove('hidden');
  document.getElementById('main').classList.add('hidden');
}
async function showApp() {
  document.getElementById('setup').classList.add('hidden');
  document.getElementById('main').classList.remove('hidden');
  await loadEvents();
  setTab(state.tab);
}

async function runDiagnostics() {
  const out = document.getElementById('diag-output');
  out.classList.remove('hidden');
  out.textContent = 'Running tests...\n';
  const log = (m) => { out.textContent += m + '\n'; };
  const ok = (m) => log('✅ ' + m);
  const bad = (m) => log('❌ ' + m);
  const info = (m) => log('ℹ️  ' + m);

  log('--- Setup ---');
  info('Mode: ' + (state.mode || 'not set'));
  info('Bin ID: ' + (state.binId ? state.binId.slice(0,8) + '...' + state.binId.slice(-4) : 'none'));
  info('Online: ' + (navigator.onLine ? 'yes' : 'no'));
  info('Schema version: v' + SCHEMA_VERSION);
  info('Local cached events: ' + (JSON.parse(localStorage.getItem(LS.local) || '[]')).length);
  log('');
  if (state.mode === 'local') { info("Device-only mode — backend tests skipped."); return; }
  if (!state.binId) { bad('No bin ID set.'); return; }
  if (!navigator.onLine) { bad('Phone is offline.'); return; }

  log('--- Read test ---');
  let remoteEvents = null;
  try {
    const t0 = Date.now();
    const res = await fetch(`https://api.jsonbin.io/v3/b/${state.binId}/latest`, { headers: { 'X-Bin-Meta': 'false' } });
    info('Response: ' + res.status + ' (' + (Date.now() - t0) + 'ms)');
    if (!res.ok) { bad('Read failed.'); return; }
    const data = await res.json();
    remoteEvents = data.events || [];
    ok('Read OK. Remote has ' + remoteEvents.length + ' events.');
  } catch (e) { bad('Read threw: ' + e.message); return; }
  log('');
  log('--- Write test ---');
  const probeId = 'diag-' + Date.now().toString(36);
  const probeEvents = [...remoteEvents, { id: probeId, type: 'meal', time: Date.now(), tags: ['_diagnostic'], who: 'us', note: '__diagnostic_probe__', retroactive: false, created: Date.now() }];
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${state.binId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: probeEvents, schemaVersion: SCHEMA_VERSION })
    });
    if (!res.ok) { bad('Write failed.'); return; }
    ok('Write OK.');
  } catch (e) { bad('Write threw: ' + e.message); return; }
  log('--- Read-back ---');
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${state.binId}/latest`, { headers: { 'X-Bin-Meta': 'false' } });
    const data = await res.json();
    if ((data.events || []).find(e => e.id === probeId)) ok('Round-trip works!');
    else { bad('Probe NOT found.'); return; }
  } catch (e) { bad('Read-back threw: ' + e.message); return; }
  log('--- Cleanup ---');
  try {
    await fetch(`https://api.jsonbin.io/v3/b/${state.binId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: remoteEvents, schemaVersion: SCHEMA_VERSION })
    });
    ok('Probe removed.');
  } catch (e) { bad('Cleanup failed: ' + e.message); }
  log('--- All tests passed. ---');
}

// ============================================================
// Init: wire up all handlers
// ============================================================
function init() {
  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  // Point tile clicks
  document.querySelectorAll('.point-tile').forEach(tile => {
    tile.addEventListener('click', (e) => {
      if (e.target.closest('.tag-pill')) return;
      const type = tile.dataset.type;
      const evt = logPoint(type);
      showUndo(evt);
      renderToday();
    });
  });
  document.querySelectorAll('.tag-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      openTagSheet(pill.dataset.type);
    });
  });

  // Range tiles
  document.querySelectorAll('[data-range-type]').forEach(tile => {
    tile.addEventListener('click', () => {
      const type = tile.dataset.rangeType;
      const activeId = tile.dataset.activeId;
      if (activeId) endRange(activeId);
      else startRange(type);
      renderRangeTiles();
      renderToday();
    });
  });

  // Live ticker
  if (!state.rangeTickInterval) {
    state.rangeTickInterval = setInterval(() => {
      if (state.tab === 'today') {
        renderRangeTiles();
        renderPlanRow();
      }
    }, 30000);
  }

  // Undo
  document.getElementById('undo-btn').addEventListener('click', () => {
    if (state.lastUndo) {
      deleteEvent(state.lastUndo.id);
      document.getElementById('undo-bar').classList.remove('visible');
      state.lastUndo = null;
      if (state.undoTimer) clearTimeout(state.undoTimer);
      renderToday();
    }
  });

  // Manual add (single button now, no separate covered-gap)
  document.getElementById('manual-add-btn').addEventListener('click', openManualAdd);

  // Plan-row edit -> schedule editor
  document.getElementById('plan-edit-btn').addEventListener('click', openScheduleEditor);

  // Modal: type buttons
  document.querySelectorAll('#type-grid-v3 .type-btn-v3').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#type-grid-v3 .type-btn-v3').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.modalState.type = btn.dataset.type;
      refreshTagAvailability();
      toggleTypeSpecificFields();
    });
  });

  // Modal: time presets
  document.querySelectorAll('#preset-row .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#preset-row .preset-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.modalState.mins = btn.dataset.mins;
      const customRow = document.getElementById('custom-time-row');
      const customInput = document.getElementById('custom-time');
      if (btn.dataset.mins === 'custom') {
        customRow.classList.remove('hidden');
        if (!customInput.value) customInput.value = toLocalISO(Date.now());
      } else {
        customRow.classList.add('hidden');
      }
    });
  });

  // Precision buttons
  document.querySelectorAll('#precision-row .precision-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#precision-row .precision-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.modalState.precision = btn.dataset.prec;
    });
  });

  // Tags
  document.querySelectorAll('#tag-row .tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const tag = btn.dataset.tag;
      const def = TAG_DEFS.find(t => t.id === tag);
      // Single-select within group (where group)
      if (def && def.single) {
        const groupTags = TAG_DEFS.filter(t => t.group === def.group).map(t => t.id);
        const wasSelected = state.modalState.tags.includes(tag);
        state.modalState.tags = state.modalState.tags.filter(t => !groupTags.includes(t));
        document.querySelectorAll('#tag-row .tag-btn').forEach(b => {
          if (groupTags.includes(b.dataset.tag)) b.classList.remove('selected');
        });
        if (!wasSelected) {
          state.modalState.tags.push(tag);
          btn.classList.add('selected');
        }
      } else {
        if (state.modalState.tags.includes(tag)) {
          state.modalState.tags = state.modalState.tags.filter(t => t !== tag);
          btn.classList.remove('selected');
        } else {
          state.modalState.tags.push(tag);
          btn.classList.add('selected');
        }
      }
    });
  });

  // Who
  document.querySelectorAll('#who-row .who-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#who-row .who-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.modalState.who = btn.dataset.who;
    });
  });

  // Modal save / cancel / delete
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
  document.getElementById('modal-delete').addEventListener('click', () => {
    if (state.editingId && confirm('Delete this event?')) {
      deleteEvent(state.editingId);
      closeModal();
      renderToday();
      if (state.tab === 'calendar') renderCalendar();
    }
  });
  document.getElementById('modal-save').addEventListener('click', () => {
    if (!state.modalState.type) { alert('Pick an event type'); return; }
    let time;
    if (state.modalState.mins === 'custom') {
      const v = document.getElementById('custom-time').value;
      if (!v) { alert('Pick a time'); return; }
      time = new Date(v).getTime();
    } else if (state.modalState.mins) {
      time = Date.now() - parseInt(state.modalState.mins) * 60000;
    } else if (state.editingId) {
      time = state.events.find(e => e.id === state.editingId).time;
    } else {
      time = Date.now();
    }
    let endTime = null;
    if (RANGE_TYPES.includes(state.modalState.type)) {
      const v = document.getElementById('end-time').value;
      if (v) endTime = new Date(v).getTime();
    }
    const note = document.getElementById('event-note').value.trim();
    const subkind = document.getElementById('event-subkind').value.trim();
    const location = document.getElementById('event-location').value.trim();
    const isRetro = state.modalState.mins === 'custom' || (state.modalState.mins && state.modalState.mins !== 'now');

    if (state.editingId) {
      const updates = {
        type: state.modalState.type, time,
        time_precision: state.modalState.precision,
        tags: state.modalState.tags, who: state.modalState.who, note
      };
      if (location) updates.location = location;
      else updates.location = null;
      if (subkind) {
        if (state.modalState.type === 'enrichment') updates.enrichment_kind = subkind;
        if (state.modalState.type === 'medication') updates.medication_name = subkind;
        if (state.modalState.type === 'episode') updates.episode_kind = subkind;
        if (state.modalState.type === 'appointment') updates.appointment_kind = subkind;
        if (state.modalState.type === 'outing') updates.outing_kind = subkind;
        if (state.modalState.type === 'meal') updates.meal_type = subkind;
      }
      if (RANGE_TYPES.includes(state.modalState.type)) {
        updates.end_time = endTime;
      }
      updateEvent(state.editingId, updates);
    } else {
      const evt = {
        id: newId(),
        type: state.modalState.type,
        time,
        time_precision: state.modalState.precision,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
        tags: state.modalState.tags,
        who: state.modalState.who,
        note,
        retroactive: isRetro,
        source: 'manual',
        created: Date.now()
      };
      if (location) evt.location = location;
      if (subkind) {
        if (state.modalState.type === 'enrichment') evt.enrichment_kind = subkind;
        if (state.modalState.type === 'medication') evt.medication_name = subkind;
        if (state.modalState.type === 'episode') evt.episode_kind = subkind;
        if (state.modalState.type === 'appointment') evt.appointment_kind = subkind;
        if (state.modalState.type === 'outing') evt.outing_kind = subkind;
        if (state.modalState.type === 'meal') evt.meal_type = subkind;
      }
      if (RANGE_TYPES.includes(state.modalState.type) && endTime) evt.end_time = endTime;
      state.events.push(evt);
      state.events.sort((a, b) => b.time - a.time);
      saveDebounced();
    }
    closeModal();
    renderToday();
    if (state.tab === 'calendar') renderCalendar();
    if (state.tab === 'growth') renderGrowth();
  });

  // Calendar nav
  document.getElementById('cal-prev').addEventListener('click', () => {
    state.calCursor = addMonths(state.calCursor, -1);
    state.calSelected = null;
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    state.calCursor = addMonths(state.calCursor, 1);
    state.calSelected = null;
    renderCalendar();
  });

  // Schedule editor profile tabs
  document.querySelectorAll('.profile-tab').forEach(t => {
    t.addEventListener('click', () => {
      state.scheduleEditingProfile = t.dataset.profile;
      renderScheduleEditor();
    });
  });
  document.getElementById('schedule-cancel').addEventListener('click', () => {
    document.getElementById('schedule-modal').classList.remove('visible');
    if (state.tab === 'today') renderToday();
  });
  document.getElementById('schedule-modal').addEventListener('click', (e) => {
    if (e.target.id === 'schedule-modal') {
      document.getElementById('schedule-modal').classList.remove('visible');
      if (state.tab === 'today') renderToday();
    }
  });

  // Settings
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-bin').value = state.binId;
    document.getElementById('settings-modal').classList.add('visible');
  });
  document.getElementById('settings-cancel').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('visible');
  });
  document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') document.getElementById('settings-modal').classList.remove('visible');
  });
  document.getElementById('settings-save').addEventListener('click', async () => {
    const newBin = document.getElementById('settings-bin').value.trim();
    if (newBin) {
      state.binId = newBin;
      state.mode = 'shared';
      localStorage.setItem(LS.bin, state.binId);
      localStorage.setItem(LS.mode, state.mode);
    } else {
      state.mode = 'local';
      localStorage.setItem(LS.mode, state.mode);
    }
    document.getElementById('settings-modal').classList.remove('visible');
    await loadEvents();
    setTab(state.tab);
  });
  document.getElementById('export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ events: state.events, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'winnie-export-' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('clear-btn').addEventListener('click', async () => {
    if (confirm('Delete ALL events? This cannot be undone.')) {
      state.events = [];
      saveDebounced();
      setTab(state.tab);
      document.getElementById('settings-modal').classList.remove('visible');
    }
  });
  document.getElementById('diag-btn').addEventListener('click', runDiagnostics);

  // Setup
  document.getElementById('setup-help-btn').addEventListener('click', () => {
    const h = document.getElementById('setup-help');
    h.style.display = h.style.display === 'block' ? 'none' : 'block';
  });
  document.getElementById('setup-skip-btn').addEventListener('click', () => {
    state.mode = 'local';
    localStorage.setItem(LS.mode, 'local');
    showApp();
  });
  document.getElementById('setup-save').addEventListener('click', () => {
    const v = document.getElementById('setup-bin').value.trim();
    if (!v) { alert('Paste a bin ID or tap "Just use this device only"'); return; }
    state.binId = v;
    state.mode = 'shared';
    localStorage.setItem(LS.bin, state.binId);
    localStorage.setItem(LS.mode, 'shared');
    showApp();
  });

  // Manual sync retry — tap the sync indicator
  const syncBtn = document.getElementById('sync-btn');
  if (syncBtn) syncBtn.addEventListener('click', manualSync);

  // Online/offline
  window.addEventListener('online', () => { if (state.mode === 'shared') manualSync(); });
  window.addEventListener('offline', () => setSyncState('offline'));

  // Visibility refresh
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && state.mode === 'shared') {
      await loadEvents();
      setTab(state.tab);
    }
  });

  // Periodic timestamp re-render
  setInterval(() => { if (state.tab === 'today') renderToday(); }, 30000);

  // Periodic remote sync
  setInterval(async () => {
    if (!document.hidden && state.mode === 'shared') {
      const remote = await fetchRemote();
      if (remote !== null) {
        const byId = new Map();
        [...state.events, ...remote].forEach(e => {
          const cur = byId.get(e.id);
          if (!cur || (e.created || 0) >= (cur.created || 0)) byId.set(e.id, e);
        });
        const remoteIds = new Set(remote.map(e => e.id));
        const merged = [];
        for (const [id, e] of byId) {
          if (remoteIds.has(id)) merged.push(e);
          else if ((Date.now() - (e.created || 0)) < 5000) merged.push(e);
        }
        state.events = merged.sort((a, b) => b.time - a.time);
        if (state.tab === 'today') renderToday();
      }
    }
  }, 60000);

  if (!state.mode) showSetup();
  else showApp();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
