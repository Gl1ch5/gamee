import { World } from './engine/world.js';
import { normalizeLevel } from './levels/loader.js';
import { WorldView } from './render/worldView.js';
import { BIT, DT } from './engine/constants.js';

const MENU_LEVEL = normalizeLevel({
  name: 'menu',
  tiles: [
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '.........SS...................',
    '......................BB......',
    '..............................',
    '..#######.....######.....####.',
    '..#######^^^^^######.....####.',
    '..##################.....####.',
    '..##################.....####.',
  ],
  entities: [
    { type: 'player', x: 3, y: 11 },
    { type: 'crate', x: 16, y: 11, props: { anchored: true } },
    { type: 'sprout', x: 6, y: 11, props: { height: 3, growTime: 6 } },
    { type: 'zone', x: 9, y: 11, props: { w: 5, h: 4, scale: 0.3 } },
    { type: 'platform', x: 20, y: 12, props: { width: 2, dx: 0, dy: 3, speed: 1.5 } },
    { type: 'shard', x: 12, y: 9 },
    { type: 'goal', x: 26, y: 11 },
  ],
});

/** Живой фон меню: герой бегает туда-сюда по маленькому острову. */
export class MenuScene {
  constructor(app) {
    this.app = app;
    this.view = new WorldView(app.renderer);
    this.t = 0;
    this.acc = 0;
    this.reset();
  }
  reset() {
    this.world = new World(MENU_LEVEL);
    this.simT = 0;
    this.view.setWorld(this.world);
    this.view.zoom = 0.85;
    this.view.dist = 17;
    this.view.follow(15, 6, 1, true);
  }
  frame(dt) {
    this.t += dt;
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.simT += DT;
      const ph = this.simT % 9;
      let bits = ph < 4.5 ? BIT.RIGHT : BIT.LEFT;
      if (ph % 1.1 < 0.25) bits |= BIT.JUMP;
      if (ph > 4 && ph < 4.5) bits = 0;
      this.world.input = bits;
      this.world.step(DT);
      for (const ev of this.world.events) this.view.onEvent(ev);
      this.world.events.length = 0;
      if (this.world.player.dead || this.simT > 27) {
        this.reset();
        break;
      }
    }
    const p = this.world.player;
    this.view.follow(8 + p.x * 0.4, 5.5 + Math.sin(this.t * 0.3) * 0.5, dt);
    this.view.update(dt, { worldTime: this.t, rewind: 0 });
  }
  dispose() {
    this.view.dispose();
  }
}
