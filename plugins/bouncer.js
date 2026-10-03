// Пример плагина: новый тип объекта «Батут» + новая функция для формул.
// Подключается через plugins/index.json — движок менять не нужно.
export default function (api) {
  const INK = api.INK;
  api.registerType('bouncer', {
    label: 'Батут', icon: '⤴',
    defaults: { w: 1.6, h: 0.35, power: 22, color: '#ff8fb1' },
    props: { power: { type: 'number', label: 'сила подброса' }, color: { type: 'color' } },
    reset(e) { e.s.x = e.x; e.s.y = e.y; e.s.sq = 0; },
    sense(e, w, bodies, dt) {
      e.s.sq = Math.max(0, e.s.sq - dt * 4);
      const p = w.player;
      if (!p.alive || w.G < 0) return;
      const onTop = Math.abs(p.x - e.x) < (p.w + e.w) / 2 && p.y - p.h / 2 <= e.y + e.h / 2 + 0.08 && p.y > e.y && p.vy <= 0.5;
      if (onTop) {
        p.vy = e.num('power'); p.grounded = false; p.jumping = false; e.s.sq = 1;
        w.emit('jump', { x: e.x, y: e.y + e.h / 2 });
        w.emit('collect', { x: e.x, y: e.y + 0.3, color: e.get('color') });
      }
    },
    draw(e, w, g) {
      const k = e.s.sq, h = e.h * (1 - 0.5 * k);
      g.rect(e.x, e.y - (e.h - h) / 2, e.w, h, { fill: e.get('color'), ink: INK, z: 2, seed: e.i });
      const n = 4;
      for (let i = 0; i < n; i++) {
        const x = e.x - e.w / 2 + (i + 0.5) * (e.w / n);
        g.line(x - 0.15, e.y - e.h / 2 - 0.08, x + 0.15, e.y - e.h / 2 - 0.08 - 0.2 * k, { ink: INK, lw: 0.05, z: 2.2, seed: i });
      }
    },
  });
  // zig(x) — зигзаг с периодом 2, значения 0..1 (пример пользовательской функции)
  api.registerFunction('zig', (x) => Math.abs((((x % 2) + 2) % 2) - 1));
}
