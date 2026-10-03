import { Body } from '../engine/entity.js';
import { moveX, moveY, overlaps } from '../engine/physics.js';
import { BIT, GRAVITY, approach } from '../engine/constants.js';

const RUN = 6.2;
const JUMP = 14.5;

/**
 * Игрок. Эхо-копии из прошлых петель — это тот же класс, только ввод
 * берётся из записи, а не с клавиатуры. Поэтому эхо ведут себя ровно как
 * вы — но мир вокруг них может измениться (парадоксы!).
 */
export class Player extends Body {
  static state = [...Body.state, 'facing', 'coyote', 'jumpBuf', 'prevBits', 'jumpCut', 'dead', 'frame', 'pushT', 'pushing'];
  static order = 5;

  constructor(world, def, typeDef, opts = {}) {
    super(world, def, typeDef);
    this.w = 0.56;
    this.h = 0.92;
    this.isEcho = !!opts.echo;
    this.isPlayer = !this.isEcho;
    this.recording = opts.recording || null;
    this.echoIndex = opts.echoIndex ?? -1;
    this.canPush = true;
    this.platformTop = true;
    this.timeImmune = true; // способности игрока не замедляют его самого
    this.facing = 1;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.prevBits = 0;
    this.jumpCut = false;
    this.dead = false;
    this.frame = 0;
    this.pushT = 0;
    this.pushing = false;
  }

  bits() {
    if (this.isEcho) return this.frame < this.recording.length ? this.recording[this.frame] : 0;
    return this.world.input;
  }

  update(dt) {
    if (this.dead) return;
    const w = this.world;
    const bits = this.bits();
    this.frame++;
    const jump = bits & BIT.JUMP, down = bits & BIT.DOWN;
    const jumpPressed = jump && !(this.prevBits & BIT.JUMP);
    const downPressed = down && !(this.prevBits & BIT.DOWN);
    this.prevBits = bits;
    const dir = (bits & BIT.RIGHT ? 1 : 0) - (bits & BIT.LEFT ? 1 : 0);
    if (dir) this.facing = dir;

    const max = RUN * (this.pushT > 0 ? 0.6 : 1);
    const accel = this.onGround ? (dir ? 70 : 90) : 45;
    this.vx = approach(this.vx, dir * max, accel * dt);
    this.vy -= GRAVITY * dt * (this.vy < 0 ? 1.25 : 1);
    if (this.vy < -22) this.vy = -22;

    this.coyote = this.onGround ? 0.1 : this.coyote - dt;
    this.jumpBuf = jumpPressed ? 0.13 : this.jumpBuf - dt;
    this.dropT = Math.max(0, this.dropT - dt);
    if (down && jumpPressed && this.onGround && this.groundOneWay) {
      this.dropT = 0.25;
      this.jumpBuf = 0;
    }
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = JUMP * (this.jumpBoost || 1);
      this.jumpBuf = 0;
      this.coyote = 0;
      this.jumpCut = false;
      w.emit('jump', { x: this.x, y: this.y, echo: this.isEcho });
    }
    if (!jump && this.vy > 0 && !this.jumpCut) {
      this.vy *= 0.45;
      this.jumpCut = true;
    }

    this.pushT -= dt;
    this.pushing = false;
    moveX(w, this, this.vx * dt);
    if (this.pushing) this.pushT = 0.12;
    const wasGround = this.onGround;
    const vyBefore = this.vy;
    this.onGround = false;
    moveY(w, this, this.vy * dt);
    if (this.onGround && !wasGround && vyBefore < -6) w.emit('land', { x: this.x, y: this.y, power: -vyBefore, echo: this.isEcho });

    if (downPressed) {
      const r = this.rect();
      for (const e of w.entities) if (e !== this && e.alive && e.interact !== Body.prototype.interact && overlaps(r, e.bounds())) e.interact(this);
    }

    if (w.hazardHit(this.rect()) || this.y < -4) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.vx = this.vy = 0;
    this.world.emit('death', { x: this.x, y: this.y, echo: this.isEcho });
  }

  getState() {
    const s = super.getState();
    return s;
  }

  createView(kit) {
    const ch = this.isEcho
      ? new kit.Character({ coat: '#6ec3d4', scarf: '#bfe9f0', skin: '#d9f3f7', ghost: true })
      : new kit.Character();
    const g = new kit.THREE.Group();
    ch.addTo(g);
    g.userData.ch = ch;
    g.userData.trailT = 0;
    g.userData.dispose = () => ch.dispose();
    return g;
  }

  updateView(g, kit, dt) {
    const ch = g.userData.ch;
    ch.animate(this, dt, this.timeScale || 0);
    if (this.isEcho && !this.dead) {
      g.userData.trailT -= dt;
      if (g.userData.trailT < 0 && (Math.abs(this.vx) > 0.5 || Math.abs(this.vy) > 0.5)) {
        g.userData.trailT = 0.05;
        kit.particles.spawn({ x: this.x + (Math.random() - 0.5) * 0.3, y: this.y + 0.2 + Math.random() * 0.6, z: 0.2, life: 0.5, size: 0.14, color: '#8fd3e0', kind: 4, vy: 0.3 });
      }
    }
  }
}
