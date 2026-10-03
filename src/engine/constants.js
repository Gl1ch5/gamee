export const DT = 1 / 60;
export const GRAVITY = 40;
export const EPS = 1e-4;
export const HISTORY_SECONDS = 60;

/** Биты ввода, которые записываются в петлю времени и воспроизводятся эхо-копиями. */
export const BIT = { LEFT: 1, RIGHT: 2, JUMP: 4, DOWN: 8 };

export const CHANNEL_COLORS = ['#e4572e', '#2a9d8f', '#e9b44c', '#7d5ba6', '#4c956c', '#d1495b', '#3d7cc9', '#c46d2b'];

export function channelColor(name) {
  if (!name) return '#8a8172';
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CHANNEL_COLORS[h % CHANNEL_COLORS.length];
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
