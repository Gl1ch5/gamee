import { EPS } from './constants.js';

export function overlaps(a, b) {
  return a.l < b.r - EPS && a.r > b.l + EPS && a.b < b.t - EPS && a.t > b.b + EPS;
}

export function rectOf(x, y, w, h) {
  return { l: x, b: y, r: x + w, t: y + h };
}

const MAX_STEP = 0.25;

/** Возвращает тела, стоящие сверху на ent. */
export function ridersOf(world, ent, rect) {
  const out = [];
  for (const e of world.entities) {
    if (e === ent || !e.isBody || !e.alive || e.dead || e.vy > 0.01) continue;
    const r = e.rect();
    if (Math.abs(r.b - rect.t) < 0.06 && r.r > rect.l + 0.02 && r.l < rect.r - 0.02) out.push(e);
  }
  return out;
}

/** Горизонтальное перемещение с толканием ящиков. Возвращает фактическое смещение. */
export function moveX(world, body, dx, depth = 0) {
  if (!dx) return 0;
  const startX = body.x;
  const riders = depth < 4 && body.solidToBodies ? ridersOf(world, body, body.rect()) : null;
  const steps = Math.ceil(Math.abs(dx) / MAX_STEP);
  const sd = dx / steps;
  let blocked = false;
  for (let i = 0; i < steps && !blocked; i++) {
    const before = body.rect();
    body.x += sd;
    for (const s of world.solidsIn(body.rect(), body)) {
      if (s.oneWay || overlaps(before, s)) continue;
      let sr = s;
      if (s.ent && s.ent.pushable && body.canPush && depth < 4) {
        const r = body.rect();
        const need = sd > 0 ? r.r - s.l : r.l - s.r;
        moveX(world, s.ent, need, depth + 1);
        body.pushing = true;
        sr = s.ent.rect();
        if (!overlaps(body.rect(), sr)) continue;
      }
      if (sd > 0) body.x = Math.min(body.x, sr.l - body.w / 2 - EPS);
      else body.x = Math.max(body.x, sr.r + body.w / 2 + EPS);
      blocked = true;
    }
  }
  if (blocked) body.vx = 0;
  const moved = body.x - startX;
  if (riders && moved) for (const r of riders) moveX(world, r, moved, depth + 1);
  return moved;
}

/** Вертикальное перемещение. Выставляет onGround при приземлении. */
export function moveY(world, body, dy) {
  if (!dy) return 0;
  const startY = body.y;
  const steps = Math.ceil(Math.abs(dy) / MAX_STEP);
  const sd = dy / steps;
  let hit = null;
  for (let i = 0; i < steps && !hit; i++) {
    const before = body.rect();
    body.y += sd;
    for (const s of world.solidsIn(body.rect(), body)) {
      if (overlaps(before, s)) continue;
      if (s.oneWay && (sd > 0 || before.b < s.t - 0.02 || body.dropT > 0)) continue;
      if (sd < 0) {
        if (body.y < s.t) { body.y = s.t; hit = s; }
      } else if (body.y + body.h > s.b) {
        body.y = s.b - body.h;
        hit = s;
      }
    }
  }
  if (hit) {
    body.vy = 0;
    if (sd < 0) {
      body.onGround = true;
      body.groundEnt = hit.ent || null;
      body.groundOneWay = !!hit.oneWay;
      // хук для модов: пружины, конвейеры и т.п.
      if (hit.ent && hit.ent.onLanded) hit.ent.onLanded(body);
    }
  }
  return body.y - startY;
}
