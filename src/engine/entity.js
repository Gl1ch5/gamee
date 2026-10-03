import { propDefaults } from './registry.js';

/**
 * Базовая сущность. Всё состояние, перечисленное в static state, автоматически
 * попадает в снимки времени — поэтому перематывается, сохраняется в петлях
 * и восстанавливается без дополнительного кода.
 *
 * Координаты в JSON уровня: x — столбец, y — строка сверху (как в tiles).
 * Сущность «стоит» в своей клетке и растёт вправо и вверх.
 */
export class Entity {
  static state = [];
  static order = 0;

  constructor(world, def, typeDef) {
    this.world = world;
    this.def = def;
    this.typeDef = typeDef;
    this.type = def.type;
    this.id = def.id;
    this.props = { ...propDefaults(def.type), ...(def.props || {}) };
    this.cx = def.x;
    this.cy = world.height - 1 - def.y; // нижняя строка клетки в мировых координатах
    this.x = this.cx;
    this.y = this.cy;
    this.alive = true;
    this.anchored = !!this.props.anchored;
    this.timeImmune = false;
    this.ignoreZones = false;
    this.timeScale = 1;
    this.localTime = 0;
    this.isBody = false;
    this.order = this.constructor.order;
  }

  /** вызывается после создания всех сущностей */
  init() {}

  getState() {
    const s = { alive: this.alive, localTime: this.localTime };
    for (const k of this.constructor.state) s[k] = this[k];
    return s;
  }

  setState(s) {
    for (const k in s) this[k] = s[k];
  }

  /** фаза сигналов: нажимные плиты и кнопки включают каналы */
  signal() {}
  /** dt уже умножен на локальную скорость времени */
  update(_dt) {}
  /** твёрдый прямоугольник {l,b,r,t,oneWay} или null */
  solid() { return null; }
  /** опасный прямоугольник или null */
  hazard() { return null; }
  /** игрок нажал «вниз/взаимодействие», стоя в этой сущности */
  interact(_who) {}
  /** игрок/тело касается сущности (для триггеров) */
  bounds() { return { l: this.x, b: this.y, r: this.x + 1, t: this.y + 1 }; }

  // --- визуал (не участвует в симуляции) ---
  /** @returns {THREE.Object3D|null} */
  createView(_kit) { return null; }
  updateView(_view, _kit, _frameDt) {}
}

export class Body extends Entity {
  static state = ['x', 'y', 'vx', 'vy', 'onGround', 'dropT'];
  constructor(world, def, typeDef) {
    super(world, def, typeDef);
    this.isBody = true;
    this.w = 0.9;
    this.h = 0.9;
    this.x = this.cx + 0.5;
    this.y = this.cy;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.dropT = 0;
    this.pushable = false;
    this.canPush = false;
    this.solidToBodies = false;
    this.platformTop = false;
  }
  rect() {
    return { l: this.x - this.w / 2, b: this.y, r: this.x + this.w / 2, t: this.y + this.h };
  }
  bounds() { return this.rect(); }
  solid() {
    if (!this.alive || this.dead) return null;
    if (this.solidToBodies) return { ...this.rect(), oneWay: false, ent: this };
    if (this.platformTop) return { ...this.rect(), oneWay: true, ent: this };
    return null;
  }
}
