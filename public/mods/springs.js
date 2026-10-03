/**
 * Пример мода «Пружины» для Хроноскетча.
 * Мод — обычный ES-модуль: экспортирует функцию, получающую api.
 * Он добавляет новый тайл и новую сущность — без единой правки кода игры.
 * Сущность сразу появляется в палитре редактора, сохраняется в JSON,
 * перематывается и работает в петлях (состояние перечислено в static state).
 */
export default function setup(api) {
  const { THREE, Entity, registerEntity, registerTile } = api;

  registerTile('W', { name: 'Дерево (мод)', solid: true, render: 'block', color: '#b07b4f', top: '#d9a066' });

  class Spring extends Entity {
    static state = ['squash'];
    static order = -6;
    constructor(world, def, typeDef) {
      super(world, def, typeDef);
      this.squash = 0;
    }
    solid() {
      return { l: this.cx + 0.1, r: this.cx + 0.9, b: this.cy, t: this.cy + 0.45, oneWay: false, ent: this };
    }
    bounds() {
      return { l: this.cx, b: this.cy, r: this.cx + 1, t: this.cy + 1 };
    }
    // хук физики: вызывается, когда тело приземлилось на эту сущность
    onLanded(body) {
      body.vy = this.props.power;
      body.onGround = false;
      if ('jumpCut' in body) body.jumpCut = true;
      if ('coyote' in body) body.coyote = 0;
      this.squash = 1;
      this.world.emit('spring', { x: this.cx + 0.5, y: this.cy + 0.45, particles: { count: 10, speed: 3, size: 0.25, life: 0.5, color: '#e76f51', kind: 2 } });
    }
    update(dt) {
      this.squash = Math.max(0, this.squash - dt * 4);
    }
    createView(kit) {
      const g = new THREE.Group();
      g.position.set(this.cx + 0.5, this.cy, 0);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.8), kit.sketchMaterial({ color: '#8a8172' }));
      base.position.y = 0.06;
      const coil = new THREE.Mesh(new THREE.TorusKnotGeometry(0.18, 0.04, 48, 6, 1, 6), kit.sketchMaterial({ color: '#9aa1a8', edges: false }));
      coil.rotation.x = Math.PI / 2;
      kit.addOutline(coil, { thickness: 0.015 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.7), kit.sketchMaterial({ color: '#e76f51' }));
      g.add(base, coil, top);
      g.userData = { coil, top };
      return g;
    }
    updateView(g, kit) {
      const s = this.squash;
      const k = 1 - Math.sin(s * Math.PI) * 0.5 + s * 0.4;
      g.userData.coil.position.y = 0.12 + 0.13 * k;
      g.userData.coil.scale.z = k;
      g.userData.top.position.y = 0.12 + 0.3 * k;
    }
  }

  registerEntity('spring', {
    cls: Spring,
    editor: {
      label: 'Пружина (мод)',
      category: 'Мод: пружины',
      icon: '🌀',
      color: '#e76f51',
      props: { power: { type: 'number', default: 18, min: 5, max: 40, step: 0.5, label: 'Сила' } },
    },
  });

  // звук из мода тоже можно добавить
  const play = api.sfx.play.bind(api.sfx);
  api.sfx.play = (name, data) => (name === 'spring' ? api.sfx.tone(300, 0.25, { type: 'sine', slide: 600, vol: 0.15 }) : play(name, data));
}
