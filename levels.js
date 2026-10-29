/*
 * Coin Dash — level manager.
 *
 * Modular, browser-only progression logic with no Phaser dependency so other
 * modules (enemy types, arenas, boss, combo multipliers...) can subscribe to
 * level changes without touching the scene.
 *
 * Usage inside the scene:
 *   const levels = new CoinDashLevels.LevelManager(COIN_DASH.levels);
 *   levels.on('levelchange', ({ level, previousLevel, difficulty }) => { ... });
 *   levels.recordCoin();   // call once per coin actually collected (not per score point)
 *
 * From any other module:
 *   CoinDashLevels.current            // the active manager (null before the scene starts)
 *   CoinDashLevels.onLevelChange(fn)  // subscribe to the current manager and to every
 *                                     // future one created after a restart; returns unsubscribe()
 *
 * Events (manager.on(name, fn)):
 *   'coin'        { coins, level, coinsIntoLevel, coinsToNextLevel }
 *   'levelchange' { level, previousLevel, coins, difficulty }
 *   'reset'       { level, coins, difficulty }
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    coinsPerLevel: 10,          // coins collected (not score) needed to advance
    timeBonusSeconds: 5,        // seconds added to the round timer on each level up
    maxLevel: 0,                // 0 = unlimited
    droneSpeedGrowth: 0.12,     // +12% enemy speed per level (compounding)
    maxDroneSpeedMultiplier: 3, // cap so the game stays playable
    dronesAddedEveryLevels: 1,  // add one enemy every N levels
    maxDrones: 8,               // cap on simultaneous enemies spawned by the level system
    coinTimerFromLevel: 4,      // from this level the coin relocates if not collected in time
    coinLifetimeMs: 4000,       // coin lifetime at coinTimerFromLevel ...
    coinLifetimeMinMs: 1800,    // ... shrinking by coinLifetimeStepMs each level down to this
    coinLifetimeStepMs: 350
  };

  /** Minimal synchronous event emitter (no external dependencies). */
  class Emitter {
    constructor() { this._listeners = new Map(); }
    on(event, fn) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event).add(fn);
      return () => this.off(event, fn);
    }
    once(event, fn) {
      const off = this.on(event, (payload) => { off(); fn(payload); });
      return off;
    }
    off(event, fn) {
      const set = this._listeners.get(event);
      if (set) set.delete(fn);
    }
    emit(event, payload) {
      const set = this._listeners.get(event);
      if (!set) return;
      // Copy so listeners may unsubscribe while being notified.
      for (const fn of Array.from(set)) {
        try { fn(payload); } catch (err) { console.error(`[levels] listener for "${event}" threw`, err); }
      }
    }
    removeAllListeners() { this._listeners.clear(); }
  }

  /** Pure function: difficulty parameters for a given level. */
  function difficultyFor(level, settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const n = Math.max(1, Math.floor(level));
    const speedMultiplier = Math.min(
      s.maxDroneSpeedMultiplier,
      Math.pow(1 + s.droneSpeedGrowth, n - 1)
    );
    const extraDrones = Math.floor((n - 1) / Math.max(1, s.dronesAddedEveryLevels));
    let coinLifetimeMs = 0;
    if (s.coinTimerFromLevel > 0 && n >= s.coinTimerFromLevel) {
      coinLifetimeMs = Math.max(
        s.coinLifetimeMinMs,
        s.coinLifetimeMs - (n - s.coinTimerFromLevel) * s.coinLifetimeStepMs
      );
    }
    return {
      level: n,
      timeBonusSeconds: n > 1 ? s.timeBonusSeconds : 0,
      droneSpeedMultiplier: Number(speedMultiplier.toFixed(4)),
      extraDrones,            // enemies to add on top of the base count (before maxDrones cap)
      maxDrones: s.maxDrones,
      coinLifetimeMs          // 0 = coin never expires
    };
  }

  class LevelManager extends Emitter {
    constructor(settings) {
      super();
      this.settings = Object.assign({}, DEFAULTS, settings || {});
      this._level = 1;
      this._coins = 0;
    }

    /** Current level, starting at 1. */
    get level() { return this._level; }
    /** Total coins collected this round (independent of score / multipliers). */
    get coins() { return this._coins; }
    get coinsPerLevel() { return this.settings.coinsPerLevel; }
    get coinsIntoLevel() { return this._coins - (this._level - 1) * this.coinsPerLevel; }
    get coinsToNextLevel() { return Math.max(0, this.coinsPerLevel - this.coinsIntoLevel); }
    get isMaxLevel() { return this.settings.maxLevel > 0 && this._level >= this.settings.maxLevel; }
    get difficulty() { return difficultyFor(this._level, this.settings); }

    difficultyFor(level) { return difficultyFor(level, this.settings); }

    /**
     * Register one collected coin. Returns true if this coin triggered a level up.
     * Count coins here, never score points: score may be multiplied by combos.
     */
    recordCoin() {
      this._coins++;
      this.emit('coin', {
        coins: this._coins,
        level: this._level,
        coinsIntoLevel: this.coinsIntoLevel,
        coinsToNextLevel: this.coinsToNextLevel
      });
      if (!this.isMaxLevel && this.coinsIntoLevel >= this.coinsPerLevel) {
        this._setLevel(this._level + 1);
        return true;
      }
      return false;
    }

    /** Force a level (useful for debugging or a boss module). Emits 'levelchange'. */
    setLevel(level) {
      const n = Math.max(1, Math.floor(level));
      if (n === this._level) return;
      this._coins = (n - 1) * this.coinsPerLevel + Math.min(this.coinsIntoLevel, this.coinsPerLevel - 1);
      this._setLevel(n);
    }

    _setLevel(n) {
      const previousLevel = this._level;
      this._level = n;
      this.emit('levelchange', {
        level: n,
        previousLevel,
        coins: this._coins,
        difficulty: this.difficulty
      });
    }

    /** Back to level 1 with zero coins. Listeners are kept. Emits 'reset'. */
    reset() {
      this._level = 1;
      this._coins = 0;
      this.emit('reset', { level: 1, coins: 0, difficulty: this.difficulty });
    }
  }

  // ---- Global registry so modules can subscribe without a scene reference ----
  const registry = new Emitter();
  const api = {
    LevelManager,
    difficultyFor,
    DEFAULTS,
    /** The active manager for the running scene (set by the scene on create). */
    current: null,
    /** Make `manager` the active one; notifies registry subscribers. */
    setCurrent(manager) {
      api.current = manager;
      registry.emit('manager', manager);
      return manager;
    },
    /**
     * Subscribe to level changes of the current manager and of any manager
     * created later (e.g. after pressing R). Returns an unsubscribe function.
     */
    onLevelChange(fn) {
      let offCurrent = null;
      const attach = (m) => { if (offCurrent) offCurrent(); offCurrent = m ? m.on('levelchange', fn) : null; };
      attach(api.current);
      const offRegistry = registry.on('manager', attach);
      return () => { offRegistry(); if (offCurrent) offCurrent(); };
    },
    /** Same as onLevelChange but for the 'reset' event. */
    onReset(fn) {
      let offCurrent = null;
      const attach = (m) => { if (offCurrent) offCurrent(); offCurrent = m ? m.on('reset', fn) : null; };
      attach(api.current);
      const offRegistry = registry.on('manager', attach);
      return () => { offRegistry(); if (offCurrent) offCurrent(); };
    }
  };

  root.CoinDashLevels = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
