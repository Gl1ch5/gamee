import { api } from '../api.js';
import { normalizeLevel } from './format.js';

export { normalizeLevel };

const CUSTOM_KEY = 'chrono.customLevels';
const PROGRESS_KEY = 'chrono.progress';
const MODS_KEY = 'chrono.userMods';

const base = () => new URL('./', document.baseURI);

function readJSON(key, def) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? def;
  } catch {
    return def;
  }
}
function writeJSON(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    console.warn('localStorage недоступен', e);
  }
}

export function emptyLevel(w = 32, h = 16) {
  const tiles = [];
  for (let r = 0; r < h; r++) {
    if (r >= h - 2) tiles.push('#'.repeat(w));
    else tiles.push('#' + '.'.repeat(w - 2) + '#');
  }
  return normalizeLevel({
    name: 'Новый уровень',
    tiles,
    abilities: ['rewind'],
    entities: [
      { type: 'player', x: 2, y: h - 3 },
      { type: 'goal', x: w - 4, y: h - 3 },
    ],
  });
}

let manifestCache = null;
export async function loadManifest() {
  if (manifestCache) return manifestCache;
  try {
    const res = await fetch(new URL('levels/index.json', base()));
    manifestCache = await res.json();
  } catch (e) {
    console.error('Не удалось загрузить levels/index.json', e);
    manifestCache = { packs: [], mods: [] };
  }
  return manifestCache;
}

export async function loadLevelFile(path) {
  const res = await fetch(new URL(`levels/${path}`, base()));
  if (!res.ok) throw new Error(`Уровень ${path}: ${res.status}`);
  return normalizeLevel(await res.json());
}

// ---------- свои уровни ----------
export function customLevels() {
  return readJSON(CUSTOM_KEY, {});
}
export function saveCustomLevel(level) {
  const all = customLevels();
  const id = level.id || `custom-${Date.now().toString(36)}`;
  level.id = id;
  all[id] = { ...level, savedAt: Date.now() };
  writeJSON(CUSTOM_KEY, all);
  return id;
}
export function deleteCustomLevel(id) {
  const all = customLevels();
  delete all[id];
  writeJSON(CUSTOM_KEY, all);
}

// ---------- прогресс ----------
export function progress() {
  return readJSON(PROGRESS_KEY, {});
}
export function markDone(key, { shards = 0 } = {}) {
  const p = progress();
  const prev = p[key] || {};
  p[key] = { done: true, shards: Math.max(prev.shards || 0, shards) };
  writeJSON(PROGRESS_KEY, p);
}

// ---------- ссылки на уровни ----------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function encodeLevel(level) {
  const { id, savedAt, ...rest } = level;
  const data = new TextEncoder().encode(JSON.stringify(rest));
  if (typeof CompressionStream === 'undefined') return 'j' + b64url(data);
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return 'z' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeLevel(str) {
  const kind = str[0];
  const bytes = unb64url(str.slice(1));
  let text;
  if (kind === 'z') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    text = await new Response(stream).text();
  } else text = new TextDecoder().decode(bytes);
  return normalizeLevel(JSON.parse(text));
}

// ---------- моды ----------
const loadedMods = new Set();
export async function loadMod(url) {
  const full = new URL(url, base()).href;
  if (loadedMods.has(full)) return true;
  const mod = await import(/* @vite-ignore */ full);
  const setup = mod.default || mod.setup;
  if (typeof setup !== 'function') throw new Error(`Мод ${url} должен экспортировать функцию по умолчанию`);
  await setup(api);
  loadedMods.add(full);
  return true;
}

export function userMods() {
  return readJSON(MODS_KEY, []);
}
export function setUserMods(list) {
  writeJSON(MODS_KEY, list);
}

export async function loadAllMods() {
  const m = await loadManifest();
  const urls = [...(m.mods || []), ...userMods()];
  const errors = [];
  for (const u of urls) {
    try {
      await loadMod(u);
    } catch (e) {
      console.error('Мод не загрузился:', u, e);
      errors.push(`${u}: ${e.message}`);
    }
  }
  return errors;
}

export function downloadJSON(level, name = 'level') {
  const { savedAt, ...rest } = level;
  const blob = new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickJSONFile() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const f = inp.files[0];
        if (!f) return resolve(null);
        resolve(normalizeLevel(JSON.parse(await f.text())));
      } catch (e) {
        reject(e);
      }
    };
    inp.click();
  });
}
