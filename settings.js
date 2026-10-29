// Keep tuning separate from game behaviour so features can be developed independently.
window.COIN_DASH = {
  width: 800,
  height: 500,
  roundSeconds: 45,
  playerSpeed: 240,
  droneSpeed: 105,
  droneCount: 3,
  colors: { background: 0x101c31, player: 0x71e8ce, coin: 0xffd166, drone: 0xff657a },
  // Enemy roster. Anything omitted here falls back to the defaults in enemies.js.
  // droneSpeed / droneCount above still drive the original drone type.
  enemies: {
    maxEnemies: 9,          // hard cap on live enemies
    spawnMinDistance: 150,  // new enemies keep at least this far from the player
    spawnGraceMs: 700,      // harmless fade-in time after spawning
    types: {
      drone:  { label: 'drone',   color: 0xff657a, size: 26 },                                   // speed: droneSpeed
      chaser: { label: 'chaser',  color: 0xe63946, size: 24, speed: 125, turnRate: 3, retargetMs: 100 },
      speed:  { label: 'speeder', color: 0xff9f1c, size: 14, speed: 240 },
      patrol: { label: 'patrol',  color: 0x9b5de5, size: 26, speed: 150, waypointRadius: 6 }
    },
    // Waypoint loops for patrol enemies; each new patrol takes the next route.
    patrolRoutes: [
      [[120, 120], [680, 120], [680, 440], [120, 440]],
      [[400, 110], [690, 270], [400, 450], [110, 270]],
      [[120, 270], [680, 270]]
    ],
    // When each enemy appears (seconds into the round). Types arrive one by one.
    schedule: [
      { at: 0,  type: 'drone',  layout: 'classic' },   // count defaults to droneCount
      { at: 8,  type: 'chaser', count: 1 },
      { at: 16, type: 'speed',  count: 1 },
      { at: 24, type: 'patrol', count: 1 },
      { at: 32, type: 'speed',  count: 1 },
      { at: 38, type: 'chaser', count: 1 }
    ]
  }
};
