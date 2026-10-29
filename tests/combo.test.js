// Run with: node tests/combo.test.js
const assert = require('node:assert/strict');
const { ComboTracker, pointsForCoin } = require('../combo.js');

const tests = {
  'first coin scores x1'() {
    const combo = new ComboTracker();
    assert.deepEqual(combo.collect(), { multiplier: 1, points: 1, increased: false });
  },
  'coins within the window climb x1..x5 and cap at x5'() {
    const combo = new ComboTracker();
    const points = [];
    for (let i = 0; i < 7; i++) { points.push(combo.collect().points); combo.update(2999); }
    assert.deepEqual(points, [1, 2, 3, 4, 5, 5, 5]);
    assert.equal(combo.multiplier, 5);
  },
  'increased flag only set when the multiplier rises'() {
    const combo = new ComboTracker({ maxMultiplier: 2 });
    assert.equal(combo.collect().increased, false);
    assert.equal(combo.collect().increased, true);
    assert.equal(combo.collect().increased, false);
  },
  'combo resets to x1 after 3 seconds without a coin'() {
    const combo = new ComboTracker();
    combo.collect(); combo.collect(); combo.collect();
    assert.equal(combo.update(2000), false);
    assert.equal(combo.multiplier, 3);
    assert.equal(combo.update(1000), true);
    assert.equal(combo.multiplier, 1);
    assert.equal(combo.collect().points, 1);
  },
  'each coin refreshes the full window'() {
    const combo = new ComboTracker();
    combo.collect(); combo.update(2500);
    combo.collect(); combo.update(2500);
    assert.equal(combo.multiplier, 2);
    assert.equal(combo.timeLeftMs, 500);
  },
  'no updates means the combo is frozen (pause)'() {
    const combo = new ComboTracker();
    combo.collect(); combo.collect(); combo.update(1000);
    // Paused for a long time: update() is not called.
    assert.equal(combo.timeLeftMs, 2000);
    assert.equal(combo.multiplier, 2);
  },
  'reset clears state (restart)'() {
    const combo = new ComboTracker();
    combo.collect(); combo.collect();
    combo.reset();
    assert.equal(combo.multiplier, 1);
    assert.equal(combo.active, false);
  },
  'total score sums multiplied points'() {
    const combo = new ComboTracker();
    let score = 0;
    for (let i = 0; i < 6; i++) score += combo.collect().points;
    assert.equal(score, 1 + 2 + 3 + 4 + 5 + 5);
    assert.equal(pointsForCoin(3), 3);
  }
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exitCode = failed ? 1 : 0;
