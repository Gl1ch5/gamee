/**
 * Глобальные реестры. Всё, что умеет игра, регистрируется здесь:
 * типы тайлов, сущности и способности. Моды вызывают те же функции,
 * поэтому новые механики добавляются без изменения кода игры.
 */
export const entityTypes = new Map();
export const tileTypes = new Map();
export const abilityTypes = new Map();

const listeners = new Set();
export function onRegistryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

/**
 * @param {string} type
 * @param {{cls: Function, editor?: object}} def
 *  editor: { label, category, icon, color, w, h, props: { name: {type, default, ...} }, unique }
 */
export function registerEntity(type, def) {
  if (!def || typeof def.cls !== 'function') throw new Error(`registerEntity(${type}): нужен cls`);
  const editor = { label: type, category: 'Прочее', icon: '◆', color: '#888', w: 1, h: 1, props: {}, ...(def.editor || {}) };
  entityTypes.set(type, { ...def, type, editor });
  changed();
}

/**
 * @param {string} char один символ в строках tiles
 * @param {{name:string, solid?:boolean, oneWay?:boolean, hazard?:boolean, render?:'block'|'plank'|'spikes'|'none', color?:string, top?:string, ink?:string}} def
 */
export function registerTile(char, def) {
  if (typeof char !== 'string' || char.length !== 1) throw new Error('registerTile: символ должен быть одной буквой');
  tileTypes.set(char, { char, solid: false, oneWay: false, hazard: false, render: 'block', color: '#b9a88a', top: null, ...def });
  changed();
}

/**
 * @param {string} id
 * @param {{name:string, key:string, keyLabel:string, icon:string, desc:string,
 *          init?(vars), onPress?(tc), onRelease?(tc), tick?(tc, held), status?(tc)}} def
 */
export function registerAbility(id, def) {
  abilityTypes.set(id, { id, ...def });
  changed();
}

export function propDefaults(type) {
  const t = entityTypes.get(type);
  const out = {};
  if (!t) return out;
  for (const [k, p] of Object.entries(t.editor.props)) out[k] = p.default;
  return out;
}
