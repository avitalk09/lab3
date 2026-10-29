// Run with: node --test   (from the repository root)
const test = require('node:test');
const assert = require('node:assert/strict');
const Levels = require('../levels.js');
const { LevelManager, difficultyFor } = Levels;

test('starts at level 1 with zero coins', () => {
  const m = new LevelManager();
  assert.equal(m.level, 1);
  assert.equal(m.coins, 0);
  assert.equal(m.coinsToNextLevel, 10);
});

test('every 10 coins advances one level and emits levelchange once', () => {
  const m = new LevelManager({ coinsPerLevel: 10 });
  const changes = [];
  m.on('levelchange', (e) => changes.push(e));
  for (let i = 0; i < 9; i++) assert.equal(m.recordCoin(), false);
  assert.equal(m.level, 1);
  assert.equal(m.recordCoin(), true);          // 10th coin
  assert.equal(m.level, 2);
  assert.deepEqual(changes.map((e) => [e.previousLevel, e.level]), [[1, 2]]);
  assert.equal(changes[0].coins, 10);
  assert.equal(changes[0].difficulty.level, 2);
  for (let i = 0; i < 25; i++) m.recordCoin();  // 35 coins total
  assert.equal(m.level, 4);
  assert.equal(m.coins, 35);
  assert.equal(m.coinsIntoLevel, 5);
  assert.equal(m.coinsToNextLevel, 5);
  assert.equal(changes.length, 3);
});

test('counts coins, not score: coinsPerLevel is configurable', () => {
  const m = new LevelManager({ coinsPerLevel: 3 });
  m.recordCoin(); m.recordCoin();
  assert.equal(m.level, 1);
  m.recordCoin();
  assert.equal(m.level, 2);
});

test('coin event carries progress and fires before levelchange', () => {
  const m = new LevelManager({ coinsPerLevel: 2 });
  const order = [];
  m.on('coin', (e) => order.push(`coin:${e.coins}/${e.level}`));
  m.on('levelchange', (e) => order.push(`level:${e.level}`));
  m.recordCoin(); m.recordCoin();
  assert.deepEqual(order, ['coin:1/1', 'coin:2/1', 'level:2']);
});

test('reset returns to level 1, keeps listeners, emits reset', () => {
  const m = new LevelManager({ coinsPerLevel: 2 });
  let resets = 0, changes = 0;
  m.on('reset', () => resets++);
  m.on('levelchange', () => changes++);
  m.recordCoin(); m.recordCoin(); m.recordCoin();
  assert.equal(m.level, 2);
  m.reset();
  assert.equal(m.level, 1);
  assert.equal(m.coins, 0);
  assert.equal(resets, 1);
  m.recordCoin(); m.recordCoin();
  assert.equal(changes, 2, 'listener survives reset');
});

test('maxLevel caps progression', () => {
  const m = new LevelManager({ coinsPerLevel: 1, maxLevel: 3 });
  for (let i = 0; i < 10; i++) m.recordCoin();
  assert.equal(m.level, 3);
  assert.equal(m.isMaxLevel, true);
});

test('off / once / unsubscribe function work', () => {
  const m = new LevelManager({ coinsPerLevel: 1 });
  let a = 0, b = 0, c = 0;
  const offA = m.on('levelchange', () => a++);
  m.once('levelchange', () => b++);
  const fnC = () => c++;
  m.on('levelchange', fnC);
  m.recordCoin();
  offA(); m.off('levelchange', fnC);
  m.recordCoin();
  assert.deepEqual([a, b, c], [1, 1, 1]);
});

test('a throwing listener does not break the others', () => {
  const m = new LevelManager({ coinsPerLevel: 1 });
  const origError = console.error; console.error = () => {};
  let ok = 0;
  m.on('levelchange', () => { throw new Error('boom'); });
  m.on('levelchange', () => ok++);
  m.recordCoin();
  console.error = origError;
  assert.equal(ok, 1);
});

test('difficulty curve: speed grows and is capped, enemies added, coin timer kicks in', () => {
  const d1 = difficultyFor(1), d2 = difficultyFor(2), d5 = difficultyFor(5), d99 = difficultyFor(99);
  assert.equal(d1.droneSpeedMultiplier, 1);
  assert.equal(d1.extraDrones, 0);
  assert.equal(d1.coinLifetimeMs, 0);
  assert.equal(d1.timeBonusSeconds, 0, 'no bonus at level 1');
  assert.equal(d2.timeBonusSeconds, Levels.DEFAULTS.timeBonusSeconds);
  assert.equal(difficultyFor(3, { timeBonusSeconds: 0 }).timeBonusSeconds, 0);
  assert.ok(d2.droneSpeedMultiplier > d1.droneSpeedMultiplier);
  assert.ok(d5.droneSpeedMultiplier > d2.droneSpeedMultiplier);
  assert.equal(d99.droneSpeedMultiplier, Levels.DEFAULTS.maxDroneSpeedMultiplier);
  assert.equal(d2.extraDrones, 1);
  assert.equal(d5.extraDrones, 4);
  assert.equal(difficultyFor(4).coinLifetimeMs, 4000);
  assert.equal(difficultyFor(5).coinLifetimeMs, 3650);
  assert.equal(d99.coinLifetimeMs, Levels.DEFAULTS.coinLifetimeMinMs);
  // settings override
  assert.equal(difficultyFor(3, { dronesAddedEveryLevels: 2 }).extraDrones, 1);
  assert.equal(difficultyFor(3, { coinTimerFromLevel: 0 }).coinLifetimeMs, 0);
});

test('global registry: onLevelChange follows the current manager across restarts', () => {
  const seen = [];
  const off = Levels.onLevelChange((e) => seen.push(e.level));
  const m1 = Levels.setCurrent(new LevelManager({ coinsPerLevel: 1 }));
  m1.recordCoin();
  const m2 = Levels.setCurrent(new LevelManager({ coinsPerLevel: 1 }));  // "restart"
  m1.recordCoin();   // old manager: must be ignored now
  m2.recordCoin();
  assert.deepEqual(seen, [2, 2]);
  off();
  m2.recordCoin();
  assert.deepEqual(seen, [2, 2]);
  assert.equal(Levels.current, m2);
});
