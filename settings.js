// Keep tuning separate from game behaviour so features can be developed independently.
window.COIN_DASH = {
  width: 800,
  height: 500,
  roundSeconds: 45,
  playerSpeed: 240,
  droneSpeed: 105,
  droneCount: 3,
  // Level progression (see levels.js for every option and its default).
  levels: {
    coinsPerLevel: 10,          // coins collected (not score) per level
    droneSpeedGrowth: 0.12,     // +12% enemy speed per level
    dronesAddedEveryLevels: 1,  // one extra enemy every N levels
    maxDrones: 8,
    coinTimerFromLevel: 4       // from this level, coins relocate if not collected in time
  },
  colors: { background: 0x101c31, player: 0x71e8ce, coin: 0xffd166, drone: 0xff657a }
};
