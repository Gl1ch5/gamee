// Записанные решения уровней (см. формат шагов в check-levels.mjs).
export const solutions = {
  'basics/01-first-steps.json': [
    ['run', 13.2], ['leap', 'right'], ['run', 15.6], ['leap', 'right'], ['run', 17.6], ['leap', 'right'],
    ['run', 23.5], ['leap', 'right'], ['run', 27.2], ['leap', 'right'], ['run', 30.5], ['leap', 'right'], ['run', 37],
  ],
};
solutions['basics/02-rewind.json'] = [
  ['run', 7.5], ['leap', 'right:22:10.5'], ['leap', 'right:22:13.5'], ['leap', 'right:22:16.8'], ['run', 17.5],
  ['leap', 'right:22:20.5'], ['leap', 'right:22:23.5'], ['leap', 'right:8:26.5'], ['leap', 'right:22:29.5'], ['leap', 'right:22:32.5'], ['leap', 'right:22:35'], ['run', 41],
];
solutions['basics/03-golden-crate.json'] = [
  ['run', 11.5], ['', 0.6], ['run', 7.2], ['leap', 'left:22:3.5'], ['run', 3.6], ['run', 23], ['rewind', 7], ['', 0.3], ['run', 26],
];
solutions['basics/04-echo.json'] = [['run', 5.5], ['tap', 'loop'], ['', 0.4], ['run', 26]];
solutions['basics/05-echo-ladder.json'] = [
  ['run', 6.5], ['tap', 'loop'],
  ['', 0.5], ['run', 20.5], ['tap', 'loop'],
  ['', 0.8], ['run', 19.2], ['leap', 'right:22:20.3'], ['', 0.2], ['leap', 'right'], ['run', 32],
];
solutions['basics/06-stop.json'] = [
  ['run', 5.5], ['run', 9], ['tap', 'stop'], ['run', 18.4], ['leap', 'right:22:20'], ['run', 26.4], ['leap', 'right:22:28'], ['run', 38],
];
solutions['basics/07-time-garden.json'] = [
  ['run', 5.5], ['tap', 'down'], ['run', 7.6], ['hop', 'right:4:8.6'], ['', 8.5], ['leap', 'right:22:12'],
  ['tap', 'slow'], ['run', 15.7], ['pass', 17], ['run', 21.7], ['pass', 23], ['run', 27.7], ['pass', 29], ['run', 38],
];
solutions['basics/08-recall.json'] = [['run', 13.5], ['', 0.6], ['tap', 'recall'], ['run', 12.4], ['leap', 'right:22:14.5'], ['run', 26]];
solutions['basics/09-loop-gold.json'] = [
  ['run', 11.5], ['', 0.6], ['run', 7.2], ['leap', 'left:22:3.5'], ['run', 3.6], ['run', 27], ['tap', 'loop'],
  ['run', 4.5], ['tap', 'loop'],
  ['', 0.5], ['run', 32],
];
solutions['basics/10-finale.json'] = [
  ['', 2.0], ['run', 3.5], ['', 0.5], ['tap', 'loop'],
  ['run', 8.0], ['hop', 'right:6:9.5'], ['', 4.5], ['run', 13.5], ['run', 16], ['tap', 'stop'], ['run', 46],
];
solutions['mods/springs-1.json'] = [
  ['run', 5.0], ['right+jump', 0.05], ['right', 0.1], ['', 0.4], ['right', 1.2], ['run', 11.4], ['right+jump', 0.05], ['right', 0.08], ['', 0.2], ['right', 1.4], ['run', 19.3], ['right+jump', 0.05], ['right', 1.5], ['run', 29],
];
