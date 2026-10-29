// Difficulty configuration for Coin Dash.
//
// Plain browser script (no bundler, no modules): it exposes window.COIN_DASH_DIFFICULTY.
// Load it after settings.js and before any scene that needs it.
//
// Design goals:
//   * One place that defines every mode and what it changes.
//   * Scenes, enemy types and future levels ask this module for scaled values instead of
//     hard-coding multipliers, e.g. `COIN_DASH_DIFFICULTY.enemySpeed(baseSpeed)`.
//   * The last choice is remembered in localStorage (safely ignored when storage is blocked).
(function (global) {
  'use strict';

  const STORAGE_KEY = 'coinDash.difficulty';
  const DEFAULT_MODE = 'NORMAL';

  // Add a new field here (e.g. coinValue, spawnInterval) and every mode gets it; new enemy
  // types and levels then read it through `get(key)` or a helper below.
  const MODES = {
    EASY: {
      key: 'EASY',
      label: 'Easy',
      tagline: 'Drones move 30% slower',
      enemySpeedMultiplier: 0.7,
      color: 0x71e8ce,
      colorCss: '#71e8ce'
    },
    NORMAL: {
      key: 'NORMAL',
      label: 'Normal',
      tagline: 'The original Coin Dash',
      enemySpeedMultiplier: 1.0,
      color: 0xffd166,
      colorCss: '#ffd166'
    },
    HARD: {
      key: 'HARD',
      label: 'Hard',
      tagline: 'Drones move 50% faster',
      enemySpeedMultiplier: 1.5,
      color: 0xff657a,
      colorCss: '#ff657a'
    }
  };
  const ORDER = ['EASY', 'NORMAL', 'HARD'];
  Object.keys(MODES).forEach((k) => Object.freeze(MODES[k]));
  Object.freeze(MODES);
  Object.freeze(ORDER);

  let currentKey = null;
  const listeners = [];

  function normalize(key) {
    if (typeof key !== 'string') return null;
    const upper = key.trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(MODES, upper) ? upper : null;
  }

  function storage() {
    try {
      return global.localStorage || null;
    } catch (_err) {
      return null; // Access can throw in sandboxed or privacy-restricted contexts.
    }
  }

  function load() {
    const store = storage();
    if (!store) return null;
    try {
      return normalize(store.getItem(STORAGE_KEY));
    } catch (_err) {
      return null;
    }
  }

  function save(key) {
    const store = storage();
    if (!store) return false;
    try {
      store.setItem(STORAGE_KEY, key);
      return true;
    } catch (_err) {
      return false;
    }
  }

  /** Returns the frozen config object for a mode (defaults to the current mode). */
  function get(key) {
    const k = key === undefined ? getCurrentKey() : normalize(key);
    if (!k) throw new Error(`Unknown difficulty "${key}". Valid: ${ORDER.join(', ')}`);
    return MODES[k];
  }

  /** All modes, in display order. */
  function list() {
    return ORDER.map((k) => MODES[k]);
  }

  function isValid(key) {
    return normalize(key) !== null;
  }

  function getCurrentKey() {
    if (currentKey === null) currentKey = load() || DEFAULT_MODE;
    return currentKey;
  }

  function getCurrent() {
    return MODES[getCurrentKey()];
  }

  /**
   * Selects a mode. Persists to localStorage unless `persist === false`.
   * Returns the mode config. Throws on an unknown key so typos surface early.
   */
  function setCurrent(key, options) {
    const k = normalize(key);
    if (!k) throw new Error(`Unknown difficulty "${key}". Valid: ${ORDER.join(', ')}`);
    const changed = k !== currentKey;
    currentKey = k;
    if (!options || options.persist !== false) save(k);
    if (changed) listeners.forEach((fn) => fn(MODES[k]));
    return MODES[k];
  }

  /** Key of the mode after/before the given one, wrapping around (handy for menus). */
  function next(key, step) {
    const k = normalize(key === undefined ? getCurrentKey() : key) || DEFAULT_MODE;
    const i = ORDER.indexOf(k);
    const n = ORDER.length;
    return ORDER[(i + (step === undefined ? 1 : step) + n * 1000) % n];
  }

  /** Multiplier applied to enemy movement speed for a mode (current mode by default). */
  function multiplier(key) {
    return get(key).enemySpeedMultiplier;
  }

  /**
   * Scales a base enemy speed for the given (or current) mode. Use this for every enemy type:
   *   body.setVelocity(cos * COIN_DASH_DIFFICULTY.enemySpeed(base), sin * COIN_DASH_DIFFICULTY.enemySpeed(base))
   */
  function enemySpeed(baseSpeed, key) {
    return baseSpeed * multiplier(key);
  }

  /** Scales an existing Arcade body's velocity in place (useful for enemies spawned at base speed). */
  function applyToBody(body, key) {
    const m = multiplier(key);
    body.setVelocity(body.velocity.x * m, body.velocity.y * m);
    return body;
  }

  /** Subscribe to mode changes; returns an unsubscribe function. */
  function onChange(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /** Forgets the in-memory choice and the stored one (mostly for tests). */
  function reset() {
    currentKey = null;
    const store = storage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch (_err) { /* ignore */ }
    }
  }

  global.COIN_DASH_DIFFICULTY = Object.freeze({
    STORAGE_KEY,
    DEFAULT_MODE,
    MODES,
    ORDER,
    get,
    list,
    isValid,
    getCurrentKey,
    getCurrent,
    setCurrent,
    next,
    multiplier,
    enemySpeed,
    applyToBody,
    onChange,
    reset
  });
})(typeof window !== 'undefined' ? window : globalThis);
