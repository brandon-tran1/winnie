// ============================================================
// Winnie v2.5 — Schema v3 + Sims motives
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
  schemaVersion: 'winnie:schema',
  fingerprint: 'winnie:fp',
  zones: 'winnie:zones',
};

// Default location zones (per-device, pre-seeded with Winnie's home turf).
// Each event captures raw GPS coords; zones are matched at display time, with
// a Nominatim reverse-geocode fallback to a city name when no zone matches.
const DEFAULT_ZONES = [
  { id: 'zone_home',     name: 'Home',                lat: 37.5084434, lng: -122.2612171, radius: 120 },
  { id: 'zone_downtown', name: 'Downtown San Carlos', lat: 37.4957691, lng: -122.2482575, radius: 500 },
];

// ============================================================
// State
// ============================================================
const state = {
  events: [],
  binId: localStorage.getItem(LS.bin) || '',
  mode: localStorage.getItem(LS.mode) || '',
  tab: localStorage.getItem(LS.tab) || 'today',
  zones: loadZones(),
  lastUndo: null,
  undoTimer: null,
  saveDebounce: null,
  editingId: null,
  modalState: blankModalState(),
  calCursor: monthStart(new Date()),
  calSelected: null,
  rangeTickInterval: null,
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

function loadZones() {
  const raw = localStorage.getItem(LS.zones);
  if (raw) try { return JSON.parse(raw); } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_ZONES));
}
function saveZones() { localStorage.setItem(LS.zones, JSON.stringify(state.zones)); }

// ============================================================
// Geolocation + zone resolution
// ============================================================
const GEO_OPTIONS = { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 };

// Fire a GPS fix in the background and attach coords to the event when it arrives.
// Browser caches recent fixes (maximumAge), so back-to-back logs at the same spot
// resolve instantly without re-prompting.
function captureLocationFor(eventId) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      const evt = state.events.find(e => e.id === eventId);
      if (!evt) return;
      evt.coords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: pos.coords.accuracy
      };
      saveDebounced();
      if (state.tab === 'today') renderToday();
    },
    () => { /* denied / timeout — leave event un-located */ },
    GEO_OPTIONS
  );
}

function _haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function resolveZone(coords) {
  if (!coords) return null;
  let best = null, bestD = Infinity;
  for (const z of state.zones) {
    const d = _haversineMeters(coords.lat, coords.lng, z.lat, z.lng);
    if (d <= z.radius && d < bestD) { best = z; bestD = d; }
  }
  return best ? best.name : null;
}

// Reverse-geocode to city via Nominatim. Cached per ~1km bucket so repeat
// queries don't re-hit the network. Returns null on first call, then re-renders
// when the fetch resolves so the label fills in.
const _cityCache = new Map();
const _cityFetching = new Set();
function cityFor(coords) {
  if (!coords) return null;
  const key = coords.lat.toFixed(2) + ',' + coords.lng.toFixed(2);
  if (_cityCache.has(key)) return _cityCache.get(key);
  if (!_cityFetching.has(key)) _fetchCity(coords, key);
  return null;
}
async function _fetchCity(coords, key) {
  _cityFetching.add(key);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json&zoom=10&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    const a = data.address || {};
    const city = a.city || a.town || a.village || a.suburb || a.county || 'elsewhere';
    _cityCache.set(key, city);
    if (state.tab === 'today') renderToday();
  } catch {
    _cityCache.set(key, 'elsewhere');
  } finally {
    _cityFetching.delete(key);
  }
}

function locationLabel(coords) {
  if (!coords) return null;
  return resolveZone(coords) || cityFor(coords);
}

// ============================================================
// Zones — settings UI
// ============================================================
function renderZonesList() {
  const list = document.getElementById('zones-list');
  if (!list) return;
  list.innerHTML = state.zones.map(z => `
    <div class="zone-row" data-zone-id="${z.id}">
      <div class="zone-info">
        <input class="zone-name-input" type="text" value="${escapeHtml(z.name)}" data-zone-id="${z.id}" data-field="name" />
        <div class="zone-meta">
          <input class="zone-radius-input" type="number" min="20" max="2000" step="10" value="${z.radius}" data-zone-id="${z.id}" data-field="radius" />m
          <span class="zone-coords">${z.lat.toFixed(4)}, ${z.lng.toFixed(4)}</span>
        </div>
      </div>
      <button class="zone-action" data-action="recapture" data-zone-id="${z.id}" type="button" title="Update to current location">📍</button>
      <button class="zone-action" data-action="delete" data-zone-id="${z.id}" type="button" title="Delete">×</button>
    </div>
  `).join('');

  // Auto-save inline name + radius edits on change
  list.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const zone = state.zones.find(z => z.id === inp.dataset.zoneId);
      if (!zone) return;
      if (inp.dataset.field === 'name') {
        zone.name = inp.value.trim() || 'Unnamed';
      } else if (inp.dataset.field === 'radius') {
        zone.radius = Math.max(20, Math.min(2000, parseInt(inp.value, 10) || 100));
        inp.value = zone.radius;
      }
      saveZones();
      if (state.tab === 'today') renderToday();
    });
  });

  list.querySelectorAll('.zone-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.zoneId;
      const action = btn.dataset.action;
      if (action === 'delete') {
        const zone = state.zones.find(z => z.id === id);
        if (zone && confirm(`Delete "${zone.name}"?`)) {
          state.zones = state.zones.filter(z => z.id !== id);
          saveZones();
          renderZonesList();
          if (state.tab === 'today') renderToday();
        }
      } else if (action === 'recapture') {
        recaptureZoneCoords(id, btn);
      }
    });
  });
}

function recaptureZoneCoords(id, btn) {
  if (!navigator.geolocation) { alert('GPS not available on this device.'); return; }
  const orig = btn.textContent;
  btn.textContent = '…'; btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    pos => {
      const zone = state.zones.find(z => z.id === id);
      if (zone) {
        zone.lat = pos.coords.latitude;
        zone.lng = pos.coords.longitude;
        saveZones();
      }
      renderZonesList();
      if (state.tab === 'today') renderToday();
    },
    err => {
      alert('Could not get GPS fix: ' + (err.message || 'unknown'));
      btn.textContent = orig; btn.disabled = false;
    },
    { ...GEO_OPTIONS, maximumAge: 0 }
  );
}

function openAddZoneForm() {
  document.getElementById('add-zone-btn').classList.add('hidden');
  const form = document.getElementById('zone-form');
  form.classList.remove('hidden');
  document.getElementById('zone-form-name').value = '';
  document.getElementById('zone-form-radius').value = '100';
  document.getElementById('zone-form-status').textContent = '';
  document.getElementById('zone-form-save').disabled = false;
  document.getElementById('zone-form-name').focus();
}
function closeAddZoneForm() {
  document.getElementById('zone-form').classList.add('hidden');
  document.getElementById('add-zone-btn').classList.remove('hidden');
}
function saveNewZone() {
  const name = document.getElementById('zone-form-name').value.trim();
  const statusEl = document.getElementById('zone-form-status');
  if (!name) { statusEl.textContent = 'Name required.'; return; }
  if (!navigator.geolocation) { statusEl.textContent = 'GPS not available.'; return; }
  const radius = Math.max(20, Math.min(2000, parseInt(document.getElementById('zone-form-radius').value, 10) || 100));
  statusEl.textContent = 'Capturing location…';
  const saveBtn = document.getElementById('zone-form-save');
  saveBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.zones.push({
        id: 'zone_' + Date.now().toString(36),
        name, radius,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
      saveZones();
      closeAddZoneForm();
      renderZonesList();
      if (state.tab === 'today') renderToday();
    },
    err => {
      statusEl.textContent = 'GPS failed: ' + (err.message || 'unknown');
      saveBtn.disabled = false;
    },
    { ...GEO_OPTIONS, maximumAge: 0 }
  );
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
  if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return (m === 0 ? `${h}h` : `${h}h ${m}m`) + ' ago';
  }
  const days = Math.round(mins / 1440);
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

async function fetchRemoteWithRetry(maxAttempts) {
  const delays = [0, 1500, 4000, 8000];
  for (let i = 0; i < maxAttempts; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
    if (state.mode !== 'shared' || !state.binId) return null;
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${state.binId}/latest`, {
        headers: { 'X-Bin-Meta': 'false' }
      });
      if (!res.ok) throw new Error('fetch failed: ' + res.status);
      const data = await res.json();
      return migrateAll(data);
    } catch (e) {
      console.warn(`fetchRemote attempt ${i + 1}/${maxAttempts}:`, e);
      if (i === maxAttempts - 1) {
        setSyncState('error');
        return null;
      }
    }
  }
  return null;
}

function fingerprint(events) {
  if (!events || events.length === 0) return '0:0:0:';
  let maxC = 0, maxM = 0, lastId = '';
  for (const e of events) {
    const c = e.created || 0;
    const m = e.modified || 0;
    if (c >= maxC) { maxC = c; lastId = e.id || ''; }
    if (m > maxM) maxM = m;
  }
  return events.length + ':' + maxC + ':' + maxM + ':' + lastId;
}

function loadFromCache() {
  const cached = localStorage.getItem(LS.local);
  state.events = cached ? migrateAll(JSON.parse(cached)) : [];
  state.events.sort((a, b) => b.time - a.time);
  if (state.mode !== 'shared') {
    state.remoteKnown = true;
    setSyncState('local');
  }
}

async function syncFromRemote({ retries = 0 } = {}) {
  if (state.mode !== 'shared' || !state.binId) return;
  if (state.syncing) return;
  state.syncing = true;
  setSyncState('syncing');
  try {
    const remote = retries > 0
      ? await fetchRemoteWithRetry(retries + 1)
      : await fetchRemote();
    if (remote === null) return; // fetch already set 'error'

    const remoteIds = new Set(remote.map(e => e.id));
    const pending = state.events.filter(e => !remoteIds.has(e.id));
    const merged = [...remote, ...pending].sort((a, b) => b.time - a.time);

    const prevFp = fingerprint(state.events);
    const newFp = fingerprint(merged);

    state.events = merged;
    state.remoteKnown = true;
    localStorage.setItem(LS.local, JSON.stringify(state.events));
    localStorage.setItem(LS.fingerprint, fingerprint(remote));

    if (pending.length > 0) {
      await pushRemote();
    } else {
      setSyncState('ok');
    }

    if (newFp !== prevFp) setTab(state.tab);
  } finally {
    state.syncing = false;
  }
}

async function manualSync() {
  if (state.mode !== 'shared' || !state.binId) {
    setSyncState('local');
    return;
  }
  if (state.syncFlashTimer) {
    clearTimeout(state.syncFlashTimer);
    state.syncFlashTimer = null;
  }
  state.manualSyncFlash = true;
  await syncFromRemote({ retries: 2 });
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
  // Pee/poop get a background GPS fix attached when it resolves.
  if ((type === 'pee' || type === 'poop') && !opts.retroactive) {
    captureLocationFor(evt.id);
  }
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
// Any in-progress sleep, nap or slumber alike. The unified "Sleep" tile and the
// motive-suppression logic both treat naps and slumbers as the same event for live
// purposes — they only differ in *classification at start time* (clock-based).
function activeSleep() {
  return state.events.find(e => (e.type === 'nap' || e.type === 'slumber') && !e.end_time);
}

// Decide nap vs slumber based on when sleep is *starting*. Anything begun between
// 6:30pm and 6am counts as slumber; everything else is a nap. Classification is
// locked at start — a long late-afternoon nap (e.g. 4pm–7pm) stays a nap.
function classifySleepStart(now = Date.now()) {
  const d = new Date(now);
  const mins = d.getHours() * 60 + d.getMinutes();
  const slumberStart = 18 * 60 + 30;  // 18:30
  const slumberEnd = 6 * 60;          // 06:00
  return (mins >= slumberStart || mins < slumberEnd) ? 'slumber' : 'nap';
}

// --- Motive bars (Sims-style) ---
// Each bar is a "level" in [0, 1]; 1 = satisfied (green), 0 = empty (urgent).
// Level can dip slightly negative for "overdue" (urgent zone). Models are driven by
// Winnie's last 14d of events with a sparsity fallback to fixed defaults.
const MOTIVE_WINDOW_DAYS = 14;
const MIN_LEARN_SAMPLES = 5;

// Bladder
const TRIGGER_LOOKBACK_MS = 60 * 60 * 1000;
const BUMP_DECAY_MS = 90 * 60 * 1000;
const PEE_MIN_GAP_MS = 10 * 60 * 1000;
const PEE_MAX_GAP_MS = 4 * 60 * 60 * 1000;
const BLADDER_DEFAULT_CAPACITY_MS = 90 * 60 * 1000;
const DEFAULT_WAKE_BUMP = 0.20;
const DEFAULT_MEAL_BUMP = 0.25;
const BUMP_CLAMP_LO = 0.10;
const BUMP_CLAMP_HI = 0.50;

// Poop (gaps are long & noisy — no upper-end filter beyond a day, no trigger bumps for v1)
const POOP_MIN_GAP_MS = 30 * 60 * 1000;
const POOP_MAX_GAP_MS = 24 * 60 * 60 * 1000;
const POOP_DEFAULT_CAPACITY_MS = 8 * 60 * 60 * 1000;

// Hunger (filter overnight gaps so the slumber gap doesn't dominate the median)
const MEAL_MIN_GAP_MS = 30 * 60 * 1000;
const MEAL_MAX_GAP_MS = 12 * 60 * 60 * 1000;
const HUNGER_DEFAULT_CAPACITY_MS = 6 * 60 * 60 * 1000;

// Energy
const WAKE_MIN_MS = 30 * 60 * 1000;
const WAKE_MAX_MS = 6 * 60 * 60 * 1000;
const SLEEP_MIN_MS = 5 * 60 * 1000;
const ENERGY_DEFAULT_WAKE_CAPACITY_MS = 2.5 * 60 * 60 * 1000;
const ENERGY_DEFAULT_SLEEP_MS = 60 * 60 * 1000;

// Zones: high level = satisfied/green, low level = urgent/red.
function motiveZone(level) {
  if (level < 0) return 'urgent';
  if (level < 0.20) return 'low';
  if (level < 0.50) return 'mid';
  return 'ok';
}

function _median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function _mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

function _wakeTimesInWindow(windowStart) {
  return state.events
    .filter(e => (e.type === 'nap' || e.type === 'slumber') && e.end_time && e.end_time >= windowStart)
    .map(e => e.end_time);
}
function _mealTimesInWindow(windowStart) {
  return state.events
    .filter(e => e.type === 'meal' && e.time >= windowStart)
    .map(e => e.time);
}

function _learnBumps(peeEvents, wakeTimes, mealTimes) {
  // For each pee, classify the gap from the previous pee by which trigger (if any)
  // fell within 60min before it (and after the previous pee).
  const buckets = { none: [], wake: [], meal: [] };
  for (let i = 1; i < peeEvents.length; i++) {
    const gap = peeEvents[i].time - peeEvents[i - 1].time;
    if (gap < PEE_MIN_GAP_MS || gap > PEE_MAX_GAP_MS) continue;
    const winLo = peeEvents[i].time - TRIGGER_LOOKBACK_MS;
    const winHi = peeEvents[i].time;
    const after = peeEvents[i - 1].time;
    const hadWake = wakeTimes.some(t => t > after && t >= winLo && t <= winHi);
    const hadMeal = mealTimes.some(t => t > after && t >= winLo && t <= winHi);
    if (hadMeal) buckets.meal.push(gap);
    else if (hadWake) buckets.wake.push(gap);
    else buckets.none.push(gap);
  }
  const baseAvg = _mean(buckets.none);
  const clamp = v => Math.min(BUMP_CLAMP_HI, Math.max(BUMP_CLAMP_LO, v));
  let wakeBump = DEFAULT_WAKE_BUMP;
  let mealBump = DEFAULT_MEAL_BUMP;
  if (baseAvg > 0 && buckets.wake.length >= MIN_LEARN_SAMPLES) {
    wakeBump = clamp(1 - _mean(buckets.wake) / baseAvg);
  }
  if (baseAvg > 0 && buckets.meal.length >= MIN_LEARN_SAMPLES) {
    mealBump = clamp(1 - _mean(buckets.meal) / baseAvg);
  }
  return { wakeBump, mealBump };
}

// Generic drain model: level = 1 - (time_since_last_event / capacity). Caller computes
// capacity from history with a sparsity fallback. Slumber pauses the bar (UX choice).
function _drainMotive({ now, eventType, minGap, maxGap, defaultCapacity }) {
  if (activeSleep()) return { level: 1, zone: 'ok', suppressed: 'sleep' };

  const windowStart = now - MOTIVE_WINDOW_DAYS * 86400000;
  const events = state.events
    .filter(e => e.type === eventType && e.time >= windowStart && e.time <= now)
    .sort((a, b) => a.time - b.time);

  if (events.length < 1) return { level: 1, zone: 'ok', suppressed: 'no-data' };

  const gaps = [];
  for (let i = 1; i < events.length; i++) {
    const g = events[i].time - events[i - 1].time;
    if (g >= minGap && g <= maxGap) gaps.push(g);
  }
  const capacity = gaps.length >= 3 ? _median(gaps) : defaultCapacity;
  const lastTime = events[events.length - 1].time;
  const fill = (now - lastTime) / capacity;
  const level = Math.max(-0.3, 1 - fill);
  return { level, zone: motiveZone(level), suppressed: null };
}

function bladderState(now = Date.now()) {
  if (activeSleep()) return { level: 1, zone: 'ok', suppressed: 'sleep' };

  const windowStart = now - MOTIVE_WINDOW_DAYS * 86400000;
  const peeEvents = state.events
    .filter(e => e.type === 'pee' && e.time >= windowStart && e.time <= now)
    .sort((a, b) => a.time - b.time);

  if (peeEvents.length < 2) return { level: 1, zone: 'ok', suppressed: 'no-data' };

  const cleanGaps = [];
  for (let i = 1; i < peeEvents.length; i++) {
    const g = peeEvents[i].time - peeEvents[i - 1].time;
    if (g >= PEE_MIN_GAP_MS && g <= PEE_MAX_GAP_MS) cleanGaps.push(g);
  }
  const capacity = cleanGaps.length >= 3 ? _median(cleanGaps) : BLADDER_DEFAULT_CAPACITY_MS;

  const wakeTimes = _wakeTimesInWindow(windowStart);
  const mealTimes = _mealTimesInWindow(windowStart);
  const { wakeBump, mealBump } = _learnBumps(peeEvents, wakeTimes, mealTimes);

  const lastPee = peeEvents[peeEvents.length - 1].time;
  const baseFill = (now - lastPee) / capacity;

  let bumps = 0;
  for (const t of wakeTimes) {
    if (t > lastPee && t <= now) {
      bumps += wakeBump * Math.max(0, 1 - (now - t) / BUMP_DECAY_MS);
    }
  }
  for (const t of mealTimes) {
    if (t > lastPee && t <= now) {
      bumps += mealBump * Math.max(0, 1 - (now - t) / BUMP_DECAY_MS);
    }
  }

  const level = Math.max(-0.3, 1 - (baseFill + bumps));
  return { level, zone: motiveZone(level), suppressed: null };
}

function poopState(now = Date.now()) {
  return _drainMotive({
    now, eventType: 'poop',
    minGap: POOP_MIN_GAP_MS, maxGap: POOP_MAX_GAP_MS,
    defaultCapacity: POOP_DEFAULT_CAPACITY_MS,
  });
}

function hungerState(now = Date.now()) {
  return _drainMotive({
    now, eventType: 'meal',
    minGap: MEAL_MIN_GAP_MS, maxGap: MEAL_MAX_GAP_MS,
    defaultCapacity: HUNGER_DEFAULT_CAPACITY_MS,
  });
}

// Energy is unique: drains while awake, refills during active nap/slumber.
function energyState(now = Date.now()) {
  const windowStart = now - MOTIVE_WINDOW_DAYS * 86400000;
  const sleeps = state.events
    .filter(e => (e.type === 'nap' || e.type === 'slumber') && e.time >= windowStart)
    .sort((a, b) => a.time - b.time);

  // Typical sleep length (median of completed sleeps in window)
  const sleepDurations = sleeps
    .filter(e => e.end_time && e.end_time - e.time >= SLEEP_MIN_MS)
    .map(e => e.end_time - e.time);
  const typicalSleepMs = sleepDurations.length >= 3
    ? _median(sleepDurations) : ENERGY_DEFAULT_SLEEP_MS;

  // Typical wake-window length
  const wakeWindows = [];
  for (let i = 0; i < sleeps.length - 1; i++) {
    if (!sleeps[i].end_time) continue;
    const w = sleeps[i + 1].time - sleeps[i].end_time;
    if (w >= WAKE_MIN_MS && w <= WAKE_MAX_MS) wakeWindows.push(w);
  }
  const wakeCapacity = wakeWindows.length >= 3 ? _median(wakeWindows) : ENERGY_DEFAULT_WAKE_CAPACITY_MS;

  const activeSleepEvt = sleeps.find(e => !e.end_time);
  if (activeSleepEvt) {
    // Estimate level at sleep start from the preceding wake window, then linearly
    // refill toward 1.0 over typicalSleepMs.
    const priorEnd = sleeps
      .filter(e => e.end_time && e.end_time <= activeSleepEvt.time)
      .map(e => e.end_time)
      .sort((a, b) => b - a)[0];
    let levelAtStart = 1;
    if (priorEnd) {
      const wakeBefore = activeSleepEvt.time - priorEnd;
      levelAtStart = Math.max(-0.3, 1 - wakeBefore / wakeCapacity);
    }
    const sleepDur = now - activeSleepEvt.time;
    const refill = Math.min(1, sleepDur / typicalSleepMs);
    const level = Math.min(1, levelAtStart + (1 - levelAtStart) * refill);
    return { level, zone: motiveZone(level), suppressed: null };
  }

  const sleepEnds = sleeps.filter(e => e.end_time).map(e => e.end_time);
  if (sleepEnds.length === 0) return { level: 1, zone: 'ok', suppressed: 'no-data' };
  const lastSleepEnd = Math.max(...sleepEnds);
  const level = Math.max(-0.3, 1 - (now - lastSleepEnd) / wakeCapacity);
  return { level, zone: motiveZone(level), suppressed: null };
}

function renderMotive(rowId, st, textFn) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const fillEl = row.querySelector('.motive-fill');
  const statusEl = row.querySelector('.motive-status');
  if (!fillEl || !statusEl) return;

  row.classList.toggle('suppressed', !!st.suppressed);

  if (st.suppressed) {
    fillEl.style.width = '100%';
    fillEl.className = 'motive-fill';
  } else {
    const pct = Math.max(0, Math.min(1, st.level)) * 100;
    fillEl.style.width = pct + '%';
    fillEl.className = 'motive-fill zone-' + st.zone;
  }
  statusEl.textContent = textFn(st);
}

// Right-column text for the drain motives (bladder/poop/hunger): time since last
// matching event, with a "· sleeping" suffix when slumber has paused the bar.
function drainMotiveText(eventType, st, now) {
  const evt = state.events.find(e => e.type === eventType);
  if (!evt) return 'no data';
  const t = formatDuration(now - evt.time);
  return st.suppressed === 'sleep' ? `${t} · sleeping` : t;
}

// Right-column text for the energy motive: phase-aware (awake / asleep / napping).
function energyMotiveText(now) {
  const evt = activeSleep();
  if (evt) {
    const dur = formatDuration(now - evt.time);
    return evt.type === 'slumber' ? `${dur} asleep` : `${dur} napping`;
  }
  const sleepEnds = state.events
    .filter(e => (e.type === 'slumber' || e.type === 'nap') && e.end_time)
    .map(e => e.end_time);
  if (!sleepEnds.length) return 'no data';
  return `${formatDuration(now - Math.max(...sleepEnds))} awake`;
}

function predictions() {
  const now = Date.now();
  if (activeSleep()) return { restOfDay: null, suppressed: 'sleep' };

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

  return { restOfDay, suppressed: null };
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
  if (tab === 'calendar') {
    // Default to today's expanded view each time the tab opens
    state.calCursor = monthStart(new Date());
    state.calSelected = startOfDay(Date.now());
    renderCalendar();
  }
  if (tab === 'growth') renderGrowth();
}

// ============================================================
// TODAY tab
// ============================================================
function renderToday() {
  const now = Date.now();

  // Motive bars (Sims-style) — right column shows time-since-last; color carries urgency.
  renderMotive('motive-bladder', bladderState(now), st => drainMotiveText('pee', st, now));
  renderMotive('motive-poop',    poopState(now),    st => drainMotiveText('poop', st, now));
  renderMotive('motive-energy',  energyState(now),  ()  => energyMotiveText(now));
  renderMotive('motive-hunger',  hungerState(now),  st => drainMotiveText('meal', st, now));

  const { restOfDay, suppressed } = predictions();

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
    const gpsLabel = locationLabel(e1.coords || e2.coords);
    const displayLoc = gpsLabel || e1.location || e2.location || '';
    const locText = displayLoc ? ` <span class="tag location">📍${escapeHtml(displayLoc)}</span>` : '';
    el.innerHTML = `
      <div class="event-icon">🟨💩</div>
      <div class="event-main">
        <div class="event-type">Pee + poop ${tagPills}${locText}${retroPill}</div>
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
    const gpsLabel = (e.type === 'pee' || e.type === 'poop') ? locationLabel(e.coords) : null;
    const displayLoc = gpsLabel || e.location || '';
    const locText = displayLoc ? ` <span class="tag location">📍${escapeHtml(displayLoc)}</span>` : '';

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
  // 'sleep' is a virtual tile — it represents any active nap or slumber. When the
  // user starts one, classifySleepStart() picks the underlying type by clock.
  renderRangeTile('sleep', activeSleep(), { icon: '💤', startLabel: 'Start sleep' });
}
function renderRangeTile(tileKey, active, opts) {
  const tile = document.getElementById('range-' + tileKey);
  if (!tile) return;
  if (active) {
    const dur = formatDuration(Date.now() - active.time);
    const def = TYPE_DEFS[active.type];
    tile.classList.add('active');
    tile.innerHTML = `
      <span class="icon">${def.icon}</span>
      <div class="label">End ${active.type}</div>
      <div class="sub">${dur}</div>
    `;
    tile.dataset.activeId = active.id;
  } else {
    tile.classList.remove('active');
    tile.innerHTML = `
      <span class="icon">${opts.icon}</span>
      <div class="label">${opts.startLabel}</div>
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
  loadFromCache();
  setTab(state.tab);
  if (state.mode === 'shared') {
    syncFromRemote({ retries: 2 }).catch(e => console.error('initial sync:', e));
  }
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
      const tileKey = tile.dataset.rangeType;
      const activeId = tile.dataset.activeId;
      if (activeId) {
        endRange(activeId);
      } else {
        // 'sleep' is a virtual tile — pick nap or slumber based on clock at start.
        const type = tileKey === 'sleep' ? classifySleepStart() : tileKey;
        startRange(type);
      }
      renderRangeTiles();
      renderToday();
    });
  });

  // Live ticker
  if (!state.rangeTickInterval) {
    state.rangeTickInterval = setInterval(() => {
      if (state.tab === 'today') {
        renderRangeTiles();
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

  // Settings
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-bin').value = state.binId;
    document.getElementById('zone-form').classList.add('hidden');
    document.getElementById('add-zone-btn').classList.remove('hidden');
    renderZonesList();
    document.getElementById('settings-modal').classList.add('visible');
  });
  document.getElementById('add-zone-btn').addEventListener('click', openAddZoneForm);
  document.getElementById('zone-form-cancel').addEventListener('click', closeAddZoneForm);
  document.getElementById('zone-form-save').addEventListener('click', saveNewZone);
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
    loadFromCache();
    setTab(state.tab);
    if (state.mode === 'shared') await syncFromRemote({ retries: 1 });
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
  window.addEventListener('online', () => { if (state.mode === 'shared') syncFromRemote({ retries: 1 }); });
  window.addEventListener('offline', () => setSyncState('offline'));

  // Visibility refresh
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.mode === 'shared') {
      syncFromRemote();
    }
  });

  // Periodic timestamp re-render
  setInterval(() => { if (state.tab === 'today') renderToday(); }, 30000);

  // Periodic remote sync — gentle cadence to stay well under JSONBin rate limits.
  // Visibility-change covers the common case of returning to the app.
  setInterval(() => {
    if (!document.hidden && state.mode === 'shared') syncFromRemote();
  }, 5 * 60 * 1000);

  if (!state.mode) showSetup();
  else showApp();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
