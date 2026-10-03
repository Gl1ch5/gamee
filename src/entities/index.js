import { registerEntity, registerTile } from '../engine/registry.js';
import { Player } from './player.js';
import { Goal, Crate, Plate, TimedButton, Lever, Door, Platform, Saw, Shard, Sign, Crumble } from './objects.js';
import { TimeZone, Sprout } from './timeObjects.js';

// ---------- Тайлы ----------
registerTile('#', { name: 'Земля', solid: true, render: 'block', color: '#c9b48f', top: '#86b45e' });
registerTile('B', { name: 'Кирпич', solid: true, render: 'block', color: '#c98f6b', top: null });
registerTile('S', { name: 'Камень', solid: true, render: 'block', color: '#a7a39a', top: null });
registerTile('M', { name: 'Латунь', solid: true, render: 'block', color: '#d4b26a', top: null });
registerTile('=', { name: 'Доска (сквозная)', oneWay: true, render: 'plank', color: '#b98a5a' });
registerTile('^', { name: 'Шипы', hazard: true, render: 'spikes', color: '#9aa1a8' });

const channel = (def = 'a') => ({ type: 'channel', default: def, label: 'Канал' });
const anchored = { type: 'bool', default: false, label: 'Вне времени (золотой)' };

// ---------- Сущности ----------
registerEntity('player', {
  cls: Player,
  editor: { label: 'Старт игрока', category: 'Основное', icon: '🎩', color: '#c8553d', unique: true, props: {} },
});
registerEntity('goal', {
  cls: Goal,
  editor: { label: 'Портал-выход', category: 'Основное', icon: '🌀', color: '#2a9d8f', h: 2, unique: true,
    props: { require: { type: 'channel', default: '', label: 'Требует канал' } } },
});
registerEntity('sign', {
  cls: Sign,
  editor: { label: 'Табличка', category: 'Основное', icon: '🪧', color: '#b5835a', props: { text: { type: 'text', default: 'Подсказка', label: 'Текст' } } },
});
registerEntity('shard', {
  cls: Shard,
  editor: { label: 'Песочные часы', category: 'Основное', icon: '⏳', color: '#e9c46a', props: {} },
});
registerEntity('crate', {
  cls: Crate,
  editor: { label: 'Ящик', category: 'Объекты', icon: '📦', color: '#c49a6c', props: { anchored } },
});
registerEntity('plate', {
  cls: Plate,
  editor: { label: 'Нажимная плита', category: 'Механизмы', icon: '▁', color: '#e4572e', props: { channel: channel() } },
});
registerEntity('button', {
  cls: TimedButton,
  editor: { label: 'Кнопка-таймер', category: 'Механизмы', icon: '🔘', color: '#e9b44c',
    props: { channel: channel(), duration: { type: 'number', default: 3, min: 0.5, max: 60, step: 0.5, label: 'Секунд' } } },
});
registerEntity('lever', {
  cls: Lever,
  editor: { label: 'Рычаг (↓)', category: 'Механизмы', icon: '🕹', color: '#7d5ba6',
    props: { channel: channel(), startOn: { type: 'bool', default: false, label: 'Включён' } } },
});
registerEntity('door', {
  cls: Door,
  editor: { label: 'Дверь', category: 'Механизмы', icon: '🚪', color: '#6d6a75', h: 3,
    props: { channel: channel(), invert: { type: 'bool', default: false, label: 'Инверсия' }, height: { type: 'number', default: 3, min: 1, max: 10, step: 1, label: 'Высота' } } },
});
registerEntity('platform', {
  cls: Platform,
  editor: { label: 'Платформа', category: 'Механизмы', icon: '▬', color: '#c49a6c', w: 3,
    props: {
      width: { type: 'number', default: 3, min: 1, max: 10, step: 1, label: 'Ширина' },
      dx: { type: 'number', default: 0, min: -40, max: 40, step: 1, label: 'Сдвиг X' },
      dy: { type: 'number', default: 3, min: -40, max: 40, step: 1, label: 'Сдвиг Y (вверх +)' },
      speed: { type: 'number', default: 2, min: 0.2, max: 20, step: 0.1, label: 'Скорость' },
      channel: { type: 'channel', default: '', label: 'Канал (пусто = всегда)' },
      oneWay: { type: 'bool', default: true, label: 'Сквозная снизу' },
    } },
});
registerEntity('saw', {
  cls: Saw,
  editor: { label: 'Пила', category: 'Опасности', icon: '⚙', color: '#d1495b',
    props: {
      dx: { type: 'number', default: 4, min: -40, max: 40, step: 1, label: 'Сдвиг X' },
      dy: { type: 'number', default: 0, min: -40, max: 40, step: 1, label: 'Сдвиг Y (вверх +)' },
      speed: { type: 'number', default: 3, min: 0, max: 30, step: 0.5, label: 'Скорость' },
      radius: { type: 'number', default: 0.5, min: 0.3, max: 2, step: 0.1, label: 'Радиус' },
    } },
});
registerEntity('crumble', {
  cls: Crumble,
  editor: { label: 'Хрупкий блок', category: 'Объекты', icon: '🧱', color: '#c9b48f',
    props: { delay: { type: 'number', default: 0.5, min: 0.1, max: 5, step: 0.1, label: 'Задержка' }, respawn: { type: 'number', default: 0, min: 0, max: 30, step: 0.5, label: 'Восстановление (0 = нет)' } } },
});
registerEntity('zone', {
  cls: TimeZone,
  editor: { label: 'Зона времени', category: 'Время', icon: '⌛', color: '#4f8fd6', resizable: true,
    props: {
      w: { type: 'number', default: 4, min: 1, max: 60, step: 1, label: 'Ширина' },
      h: { type: 'number', default: 3, min: 1, max: 60, step: 1, label: 'Высота' },
      scale: { type: 'number', default: 0.3, min: 0.05, max: 8, step: 0.05, label: 'Скорость времени' },
      channel: { type: 'channel', default: '', label: 'Канал (пусто = всегда)' },
    } },
});
registerEntity('sprout', {
  cls: Sprout,
  editor: { label: 'Росток', category: 'Время', icon: '🌱', color: '#6c9a4b',
    props: {
      height: { type: 'number', default: 4, min: 1, max: 20, step: 1, label: 'Высота' },
      growTime: { type: 'number', default: 30, min: 1, max: 600, step: 1, label: 'Время роста, с' },
      start: { type: 'number', default: 0, min: 0, max: 1, step: 0.05, label: 'Начальный рост' },
      anchored,
    } },
});

export { Player };
