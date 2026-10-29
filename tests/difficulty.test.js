// Run with:  node --test tests/difficulty.test.js
// Unit tests for difficulty.js (pure logic + localStorage persistence). No dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshModule(storage) {
  // difficulty.js attaches to `window` when present; give it a minimal fake one.
  const win = { localStorage: storage };
  global.window = win;
  delete require.cache[require.resolve(path.join(__dirname, '..', 'difficulty.js'))];
  require(path.join(__dirname, '..', 'difficulty.js'));
  delete global.window;
  return win.COIN_DASH_DIFFICULTY;
}

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map
  };
}

test('defines EASY, NORMAL and HARD with the required speed multipliers', () => {
  const D = freshModule(memoryStorage());
  assert.deepEqual(D.ORDER, ['EASY', 'NORMAL', 'HARD']);
  assert.equal(D.multiplier('EASY'), 0.7);
  assert.equal(D.multiplier('NORMAL'), 1);
  assert.equal(D.multiplier('HARD'), 1.5);
});

test('enemySpeed scales a base speed per mode (30% slower, unchanged, 50% faster)', () => {
  const D = freshModule(memoryStorage());
  assert.equal(D.enemySpeed(105, 'EASY'), 73.5);
  assert.equal(D.enemySpeed(105, 'NORMAL'), 105);
  assert.equal(D.enemySpeed(105, 'HARD'), 157.5);
  assert.equal(D.enemySpeed(105), 105, 'defaults to the current (NORMAL) mode');
});

test('defaults to NORMAL when nothing is stored', () => {
  const D = freshModule(memoryStorage());
  assert.equal(D.getCurrentKey(), 'NORMAL');
  assert.equal(D.getCurrent().label, 'Normal');
});

test('restores the last saved difficulty from localStorage (case-insensitive)', () => {
  const D = freshModule(memoryStorage({ 'coinDash.difficulty': 'hard' }));
  assert.equal(D.getCurrentKey(), 'HARD');
});

test('ignores garbage in localStorage', () => {
  const D = freshModule(memoryStorage({ 'coinDash.difficulty': 'IMPOSSIBLE' }));
  assert.equal(D.getCurrentKey(), 'NORMAL');
});

test('setCurrent persists, persist:false does not, reset clears', () => {
  const store = memoryStorage();
  const D = freshModule(store);
  D.setCurrent('easy');
  assert.equal(D.getCurrentKey(), 'EASY');
  assert.equal(store.getItem(D.STORAGE_KEY), 'EASY');
  D.setCurrent('HARD', { persist: false });
  assert.equal(D.getCurrentKey(), 'HARD');
  assert.equal(store.getItem(D.STORAGE_KEY), 'EASY');
  D.reset();
  assert.equal(store.getItem(D.STORAGE_KEY), null);
  assert.equal(D.getCurrentKey(), 'NORMAL');
});

test('rejects unknown modes loudly', () => {
  const D = freshModule(memoryStorage());
  assert.throws(() => D.setCurrent('NIGHTMARE'), /Unknown difficulty/);
  assert.throws(() => D.get('x'), /Unknown difficulty/);
  assert.equal(D.isValid('normal'), true);
  assert.equal(D.isValid(42), false);
});

test('next() cycles through modes in both directions', () => {
  const D = freshModule(memoryStorage());
  assert.equal(D.next('EASY'), 'NORMAL');
  assert.equal(D.next('HARD'), 'EASY');
  assert.equal(D.next('EASY', -1), 'HARD');
  assert.equal(D.next(), 'HARD', 'from the current NORMAL');
});

test('applyToBody scales an existing velocity and onChange fires once per change', () => {
  const D = freshModule(memoryStorage());
  const body = { velocity: { x: 100, y: -50 }, setVelocity(x, y) { this.velocity = { x, y }; } };
  D.applyToBody(body, 'HARD');
  assert.deepEqual(body.velocity, { x: 150, y: -75 });
  const seen = [];
  const off = D.onChange((m) => seen.push(m.key));
  D.setCurrent('EASY');
  D.setCurrent('EASY');
  D.setCurrent('HARD');
  off();
  D.setCurrent('NORMAL');
  assert.deepEqual(seen, ['EASY', 'HARD']);
});

test('works when localStorage is unavailable or throws', () => {
  const D = freshModule(undefined);
  assert.equal(D.getCurrentKey(), 'NORMAL');
  assert.equal(D.setCurrent('HARD').key, 'HARD');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  const D2 = freshModule(throwing);
  assert.equal(D2.getCurrentKey(), 'NORMAL');
  assert.doesNotThrow(() => D2.setCurrent('EASY'));
});
