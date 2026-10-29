// Combo and score-multiplier logic. Pure JavaScript with no Phaser dependency so it can be
// reused by other features and unit-tested in Node (`node tests/combo.test.js`).
(function (root) {
  const COMBO_DEFAULTS = { windowMs: 3000, maxMultiplier: 5, basePoints: 1 };

  // Points awarded for one coin at a given multiplier. Use this anywhere a coin's value is needed.
  function pointsForCoin(multiplier, basePoints = COMBO_DEFAULTS.basePoints) {
    return basePoints * multiplier;
  }

  class ComboTracker {
    constructor(options = {}) {
      this.config = Object.assign({}, COMBO_DEFAULTS, options);
      this.reset();
    }

    reset() {
      this.multiplier = 1;
      this.timeLeftMs = 0; // 0 means no combo is active
    }

    get active() { return this.timeLeftMs > 0; }

    // Fraction of the combo window remaining, 0..1 (handy for HUD bars).
    get timeLeftRatio() { return this.timeLeftMs / this.config.windowMs; }

    // Register a collected coin. A coin inside the window raises the multiplier (capped);
    // the first coin of a chain scores at x1. Returns what the caller needs to update score/UI.
    collect() {
      const previous = this.multiplier;
      if (this.active) {
        this.multiplier = Math.min(this.multiplier + 1, this.config.maxMultiplier);
      } else {
        this.multiplier = 1;
      }
      this.timeLeftMs = this.config.windowMs;
      return {
        multiplier: this.multiplier,
        points: pointsForCoin(this.multiplier, this.config.basePoints),
        increased: this.multiplier > previous
      };
    }

    // Advance the combo clock by elapsed milliseconds. Call only while the game is running,
    // so the combo freezes whenever updates stop (pause, game over). Returns true on expiry.
    update(deltaMs) {
      if (!this.active) return false;
      this.timeLeftMs = Math.max(0, this.timeLeftMs - deltaMs);
      if (this.timeLeftMs > 0) return false;
      const hadCombo = this.multiplier > 1;
      this.multiplier = 1;
      return hadCombo;
    }
  }

  const api = { ComboTracker, pointsForCoin, COMBO_DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CoinDashCombo = api;
})(typeof window !== 'undefined' ? window : globalThis);
