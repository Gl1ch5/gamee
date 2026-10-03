/** Привести уровень к каноническому виду (поддержка рукописных JSON). Без зависимостей — работает и в Node. */
export function normalizeLevel(raw) {
  const L = { format: 1, name: 'Без названия', author: '', abilities: ['rewind'], loop: null, entities: [], tiles: [], ...raw };
  L.tiles = (L.tiles || []).map((r) => String(r));
  L.height = L.tiles.length || L.height || 12;
  L.width = Math.max(L.width || 0, ...L.tiles.map((r) => r.length), 8);
  while (L.tiles.length < L.height) L.tiles.push('');
  L.tiles = L.tiles.map((r) => r.padEnd(L.width, '.').slice(0, L.width));
  L.entities = (L.entities || []).map((e) => ({ ...e, props: { ...(e.props || {}) } }));
  if (L.loop && !L.loop.duration) L.loop = null;
  return L;
}
