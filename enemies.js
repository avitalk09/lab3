// Enemy behaviour module for Coin Dash.
//
// Everything about enemies lives here: how each type looks, how it moves, how
// it is kept inside the arena, and how new types are introduced over time.
// game.js only has to create a manager, call update() every frame, and use the
// manager's physics group for collisions.
//
// Public API (window.COIN_DASH_ENEMIES):
//   ENEMY_TYPES                     frozen map of the built-in type names
//   DEFAULT_ENEMY_CONFIG            defaults merged under COIN_DASH.enemies
//   createEnemyManager(scene, opts) builds the manager for one scene/round
//   registerEnemyType(name, impl)   lets other modules add their own type
//
// Manager API:
//   group                 Phaser physics group holding every live enemy
//   spawn(type, opts)     spawn one enemy; returns it or null if capped
//   spawnMany(type, n)    spawn several; returns the array that fit the cap
//   update(time, delta)   drive behaviours and the introduction schedule
//   setDifficulty(mods)   { speed, spawnRate, maxEnemies } multipliers/limits
//   getModifiers()        current normalised modifiers
//   isArmed(enemy)        false during the short spawn grace period
//   describe(enemy)       'A chaser', 'A drone', ... for end-of-round text
//   count(type?)          live enemy count, optionally for one type
//   clear()               destroy every enemy
//
// Difficulty modules can pass modifiers via createEnemyManager(scene, { modifiers })
// or COIN_DASH.difficulty.enemies, or call manager.setDifficulty() at any time.
(function (root) {
  'use strict';

  const ENEMY_TYPES = Object.freeze({
    DRONE: 'drone',
    CHASER: 'chaser',
    SPEED: 'speed',
    PATROL: 'patrol'
  });

  const DEFAULT_ENEMY_CONFIG = Object.freeze({
    // Hard cap on live enemies. Spawns beyond it are refused, never queued.
    maxEnemies: 9,
    // New enemies never appear closer than this to the player.
    spawnMinDistance: 150,
    // Freshly spawned enemies are harmless and translucent for this long.
    spawnGraceMs: 700,
    types: {
      drone: { label: 'drone', color: 0xff657a, size: 26, speed: 105 },
      chaser: { label: 'chaser', color: 0xe63946, size: 24, speed: 125, turnRate: 3, retargetMs: 100 },
      speed: { label: 'speeder', color: 0xff9f1c, size: 14, speed: 240 },
      patrol: { label: 'patrol', color: 0x9b5de5, size: 26, speed: 150, waypointRadius: 6 }
    },
    // Patrol routes as [x, y] waypoint lists. null means "derive from arena size".
    patrolRoutes: null,
    // Introduction schedule, in seconds since the round started.
    //   at      when the entry first fires
    //   type    which enemy to spawn
    //   count   how many (drone defaults to COIN_DASH.droneCount)
    //   every   optional repeat interval in seconds
    //   until   optional last second a repeating entry may fire
    //   layout  'classic' reproduces the original starter drone placement
    schedule: [
      { at: 0, type: 'drone', layout: 'classic' },
      { at: 8, type: 'chaser', count: 1 },
      { at: 16, type: 'speed', count: 1 },
      { at: 24, type: 'patrol', count: 1 },
      { at: 32, type: 'speed', count: 1 },
      { at: 38, type: 'chaser', count: 1 }
    ]
  });

  // ---------------------------------------------------------------- helpers

  const DEG = Math.PI / 180;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  // scene.time.now is stale during create() when a scene is started from
  // another scene (menu, game over), so prefer the live game loop clock.
  function nowOf(scene) {
    return scene.game && scene.game.loop && scene.game.loop.time != null ? scene.game.loop.time : scene.time.now;
  }
  function randomBetween(lo, hi) { return lo + Math.random() * (hi - lo); }
  function distanceSq(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  function pointAwayFromAxes() {
    // Heading between 20 and 70 degrees inside a random quadrant, so bouncing
    // enemies never get stuck sliding exactly along a wall.
    const quadrant = Math.floor(Math.random() * 4);
    return (quadrant * 90 + randomBetween(20, 70)) * DEG;
  }

  function normaliseModifiers(mods) {
    mods = mods || {};
    const pick = (...keys) => { for (const k of keys) if (mods[k] != null) return mods[k]; return undefined; };
    return {
      speed: Number(pick('speed', 'enemySpeed', 'enemySpeedMultiplier', 'speedMultiplier')) || 1,
      spawnRate: Number(pick('spawnRate', 'enemySpawnRate', 'spawnRateMultiplier')) || 1,
      maxEnemies: pick('maxEnemies', 'enemyCap') != null ? Number(pick('maxEnemies', 'enemyCap')) : null
    };
  }

  function buildConfig(settings, overrides) {
    const user = Object.assign({}, settings.enemies || {}, overrides || {});
    const types = {};
    const allTypeNames = new Set([
      ...Object.keys(DEFAULT_ENEMY_CONFIG.types),
      ...Object.keys(user.types || {})
    ]);
    for (const name of allTypeNames) {
      types[name] = Object.assign({}, DEFAULT_ENEMY_CONFIG.types[name] || {}, (user.types || {})[name] || {});
    }
    // Preserve the original tuning knobs for the original enemy.
    if (settings.droneSpeed != null && !(user.types && user.types.drone && user.types.drone.speed != null)) {
      types.drone.speed = settings.droneSpeed;
    }
    if (settings.colors && settings.colors.drone != null && !(user.types && user.types.drone && user.types.drone.color != null)) {
      types.drone.color = settings.colors.drone;
    }
    return {
      maxEnemies: user.maxEnemies != null ? user.maxEnemies : DEFAULT_ENEMY_CONFIG.maxEnemies,
      spawnMinDistance: user.spawnMinDistance != null ? user.spawnMinDistance : DEFAULT_ENEMY_CONFIG.spawnMinDistance,
      spawnGraceMs: user.spawnGraceMs != null ? user.spawnGraceMs : DEFAULT_ENEMY_CONFIG.spawnGraceMs,
      types,
      patrolRoutes: user.patrolRoutes || null,
      schedule: (user.schedule || DEFAULT_ENEMY_CONFIG.schedule).map(e => Object.assign({}, e)),
      droneCount: settings.droneCount != null ? settings.droneCount : 3
    };
  }

  function readArena(scene, settings) {
    const b = scene.physics && scene.physics.world && scene.physics.world.bounds;
    if (b && b.width > 0) {
      return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
    }
    return { left: 0, top: 0, right: settings.width || 800, bottom: settings.height || 500 };
  }

  function defaultPatrolRoutes(arena) {
    const w = arena.right - arena.left, h = arena.bottom - arena.top;
    const ix = arena.left + w * 0.15, ax = arena.right - w * 0.15;
    const iy = arena.top + h * 0.18, ay = arena.bottom - h * 0.18;
    const cx = (arena.left + arena.right) / 2, cy = (arena.top + arena.bottom) / 2;
    return [
      [[ix, iy], [ax, iy], [ax, ay], [ix, ay]],            // outer loop, clockwise
      [[cx, iy], [ax, cy], [cx, ay], [ix, cy]],            // diamond through the middle
      [[ix, cy], [ax, cy]]                                  // horizontal sweep
    ];
  }

  // -------------------------------------------------------------- behaviours

  const BEHAVIORS = {};

  function registerEnemyType(name, behavior) {
    if (!behavior || typeof behavior.create !== 'function') {
      throw new Error(`Enemy type "${name}" needs a create(scene, x, y, cfg) function`);
    }
    BEHAVIORS[name] = behavior;
  }

  function rescaleVelocity(enemy, state) {
    const v = enemy.body.velocity;
    const len = Math.hypot(v.x, v.y);
    if (len > 0) enemy.body.setVelocity(v.x / len * state.speed, v.y / len * state.speed);
  }

  function setVelocityTowards(enemy, tx, ty, speed) {
    const dx = tx - enemy.x, dy = ty - enemy.y;
    const len = Math.hypot(dx, dy) || 1;
    enemy.body.setVelocity(dx / len * speed, dy / len * speed);
  }

  // Original enemy: bounces around the arena in a straight line.
  registerEnemyType(ENEMY_TYPES.DRONE, {
    create(scene, x, y, cfg) {
      return scene.add.rectangle(x, y, cfg.size, cfg.size, cfg.color);
    },
    init(enemy, state) {
      enemy.body.setCollideWorldBounds(true).setBounce(1, 1);
      const heading = state.heading != null ? state.heading : pointAwayFromAxes();
      enemy.body.setVelocity(Math.cos(heading) * state.speed, Math.sin(heading) * state.speed);
    },
    rescale: rescaleVelocity
  });

  // Chaser: red triangle that steers towards the player.
  registerEnemyType(ENEMY_TYPES.CHASER, {
    create(scene, x, y, cfg) {
      const s = cfg.size;
      return scene.add.triangle(x, y, 0, s, s / 2, 0, s, s, cfg.color);
    },
    init(enemy, state) {
      enemy.body.setCollideWorldBounds(true);
      state.nextRetarget = 0;
      state.tx = 0;
      state.ty = 0;
    },
    update(enemy, state, ctx, time, dt) {
      const player = ctx.player;
      if (!player) return;
      // Re-aim at a fixed interval rather than every frame; steering below
      // keeps motion smooth between retargets.
      if (time >= state.nextRetarget) {
        const dx = player.x - enemy.x, dy = player.y - enemy.y;
        const len = Math.hypot(dx, dy) || 1;
        state.tx = dx / len * state.speed;
        state.ty = dy / len * state.speed;
        state.nextRetarget = time + state.cfg.retargetMs;
      }
      const v = enemy.body.velocity;
      const k = Math.min(1, state.cfg.turnRate * dt);
      const vx = v.x + (state.tx - v.x) * k;
      const vy = v.y + (state.ty - v.y) * k;
      enemy.body.setVelocity(vx, vy);
      if (vx !== 0 || vy !== 0) enemy.rotation = Math.atan2(vy, vx) + Math.PI / 2;
    }
  });

  // Speeder: small orange diamond, fast straight lines, bounces off walls.
  registerEnemyType(ENEMY_TYPES.SPEED, {
    create(scene, x, y, cfg) {
      const s = cfg.size, h = s / 2;
      return scene.add.polygon(x, y, [[h, 0], [s, h], [h, s], [0, h]], cfg.color);
    },
    init(enemy, state) {
      const half = state.cfg.size / 2;
      enemy.body.setCircle(half);
      enemy.body.setCollideWorldBounds(true).setBounce(1, 1);
      const heading = state.heading != null ? state.heading : pointAwayFromAxes();
      enemy.body.setVelocity(Math.cos(heading) * state.speed, Math.sin(heading) * state.speed);
    },
    rescale: rescaleVelocity
  });

  // Patrol: purple hexagon that walks a fixed waypoint loop.
  registerEnemyType(ENEMY_TYPES.PATROL, {
    create(scene, x, y, cfg) {
      const r = cfg.size / 2, c = r;
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = i * 60 * DEG;
        pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
      }
      return scene.add.polygon(x, y, pts, cfg.color);
    },
    init(enemy, state) {
      enemy.body.setCollideWorldBounds(true);
      state.waypoint = state.startIndex != null ? state.startIndex : 0;
      state.recalcAt = 0;
      this.advance(enemy, state, 0);
    },
    advance(enemy, state, time) {
      const route = state.route;
      state.waypoint = (state.waypoint + 1) % route.length;
      const [tx, ty] = route[state.waypoint];
      setVelocityTowards(enemy, tx, ty, state.speed);
      state.recalcAt = time + 250;
    },
    update(enemy, state, ctx, time, dt) {
      const route = state.route;
      const [tx, ty] = route[state.waypoint];
      const r = state.cfg.waypointRadius;
      // Reached the waypoint (or would overshoot it this frame): turn.
      const step = state.speed * dt;
      if (distanceSq(enemy.x, enemy.y, tx, ty) <= Math.max(r * r, step * step)) {
        enemy.setPosition(tx, ty);
        this.advance(enemy, state, time);
      } else if (time >= state.recalcAt) {
        // Periodic correction keeps the path straight after any wall contact.
        setVelocityTowards(enemy, tx, ty, state.speed);
        state.recalcAt = time + 250;
      }
      enemy.rotation += dt * 1.5;
    }
  });

  // ---------------------------------------------------------------- manager

  function createEnemyManager(scene, options) {
    options = options || {};
    const settings = options.settings || root.COIN_DASH || {};
    const config = buildConfig(settings, options.config);
    const arena = readArena(scene, settings);
    const routes = (config.patrolRoutes || defaultPatrolRoutes(arena)).map(route =>
      route.map(([x, y]) => [clamp(x, arena.left + 20, arena.right - 20), clamp(y, arena.top + 20, arena.bottom - 20)])
    );
    const group = options.group || scene.physics.add.group();
    const player = options.player || null;
    const startTime = options.startTime != null ? options.startTime : nowOf(scene);
    let modifiers = normaliseModifiers(
      options.modifiers || (settings.difficulty && settings.difficulty.enemies) || settings.enemyModifiers
    );

    const schedule = config.schedule.map(entry => ({
      entry,
      nextAt: entry.at || 0,
      fired: 0
    }));
    const spawnedByType = {};
    const introduced = new Set();
    const ctx = { scene, player, arena, config };

    function effectiveMax() {
      return modifiers.maxEnemies != null ? modifiers.maxEnemies : config.maxEnemies;
    }

    function liveEnemies() {
      return group.getChildren().filter(e => e.active);
    }

    function count(type) {
      const live = liveEnemies();
      return type ? live.filter(e => e.enemyState && e.enemyState.type === type).length : live.length;
    }

    function farFromPlayer(x, y) {
      if (!player) return true;
      const d = config.spawnMinDistance;
      return distanceSq(x, y, player.x, player.y) >= d * d;
    }

    function pickSpawnPoint(size) {
      const inset = Math.max(50, size);
      const xs = [arena.left + inset, (arena.left + arena.right) / 2, arena.right - inset];
      const ys = [arena.top + inset, (arena.top + arena.bottom) / 2, arena.bottom - inset];
      const candidates = [];
      for (const x of xs) for (const y of ys) {
        if (x === xs[1] && y === ys[1]) continue; // never the centre
        candidates.push([x, y]);
      }
      // Shuffle so repeated spawns do not always pick the same corner.
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      const safe = candidates.filter(([x, y]) => farFromPlayer(x, y));
      if (safe.length) return safe[0];
      // Player is near every candidate (tiny arena): take the farthest one.
      let best = candidates[0], bestD = -1;
      for (const [x, y] of candidates) {
        const d = player ? distanceSq(x, y, player.x, player.y) : 0;
        if (d > bestD) { bestD = d; best = [x, y]; }
      }
      return best;
    }

    function classicDronePlacement(index) {
      // Reproduces the starter's layout: x = 90 + i * 270, y = 100, heading 35 + i * 105 deg.
      const span = Math.max(1, arena.right - arena.left - 60);
      const x = arena.left + 30 + ((90 + index * 270 - 30) % span);
      const y = clamp(100, arena.top + 20, arena.bottom - 20);
      return { x, y, heading: (35 + index * 105) * DEG };
    }

    function spawn(type, opts) {
      opts = opts || {};
      const behavior = BEHAVIORS[type];
      const cfg = config.types[type];
      if (!behavior || !cfg) {
        console.warn(`[enemies] unknown enemy type "${type}"`);
        return null;
      }
      if (count() >= effectiveMax()) return null;

      const typeIndex = spawnedByType[type] || 0;
      const state = {
        type,
        cfg,
        label: cfg.label || type,
        baseSpeed: cfg.speed,
        speed: cfg.speed * modifiers.speed,
        heading: opts.heading,
        armedAt: nowOf(scene) + (opts.graceMs != null ? opts.graceMs : config.spawnGraceMs)
      };

      let x = opts.x, y = opts.y;
      if (type === ENEMY_TYPES.PATROL) {
        const route = opts.route || routes[typeIndex % routes.length];
        state.route = route;
        if (x == null || y == null) {
          // Start at the route point farthest from the player.
          let bestI = 0, bestD = -1;
          route.forEach(([px, py], i) => {
            const d = player ? distanceSq(px, py, player.x, player.y) : -i;
            if (d > bestD) { bestD = d; bestI = i; }
          });
          [x, y] = route[bestI];
          state.startIndex = bestI;
        }
      } else if (opts.layout === 'classic' && type === ENEMY_TYPES.DRONE) {
        const p = classicDronePlacement(opts.layoutIndex != null ? opts.layoutIndex : typeIndex);
        if (x == null) x = p.x;
        if (y == null) y = p.y;
        if (state.heading == null) state.heading = p.heading;
      }
      if (x == null || y == null) [x, y] = pickSpawnPoint(cfg.size);
      x = clamp(x, arena.left + cfg.size / 2, arena.right - cfg.size / 2);
      y = clamp(y, arena.top + cfg.size / 2, arena.bottom - cfg.size / 2);

      const enemy = behavior.create(scene, x, y, cfg);
      group.add(enemy);
      enemy.enemyState = state;
      if (typeof enemy.setData === 'function') enemy.setData('enemyType', type);
      if (behavior.init) behavior.init(enemy, state, ctx);

      // Spawn telegraph: fade and grow in while harmless.
      if (scene.tweens && typeof scene.tweens.add === 'function' && state.armedAt > nowOf(scene)) {
        enemy.setAlpha(0.25);
        enemy.setScale(0.4);
        scene.tweens.add({ targets: enemy, alpha: 1, scale: 1, duration: state.armedAt - nowOf(scene), ease: 'Quad.out' });
      }

      spawnedByType[type] = typeIndex + 1;
      if (scene.events && typeof scene.events.emit === 'function') {
        if (!introduced.has(type)) {
          introduced.add(type);
          scene.events.emit('enemy-type-introduced', type, state.label, enemy);
        }
        scene.events.emit('enemy-spawned', enemy, type);
      } else {
        introduced.add(type);
      }
      return enemy;
    }

    function spawnMany(type, n, opts) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const e = spawn(type, Object.assign({ layoutIndex: i }, opts || {}));
        if (!e) break; // cap reached; stop instead of looping uselessly
        out.push(e);
      }
      return out;
    }

    function runSchedule(elapsedSec) {
      for (const item of schedule) {
        const e = item.entry;
        if (item.nextAt == null) continue;
        // spawnRate > 1 brings every milestone forward; < 1 pushes them back.
        while (item.nextAt != null && elapsedSec >= item.nextAt / modifiers.spawnRate) {
          const n = e.count != null ? e.count : (e.type === ENEMY_TYPES.DRONE ? config.droneCount : 1);
          spawnMany(e.type, n, { layout: e.layout });
          item.fired++;
          if (e.every > 0 && (e.until == null || item.nextAt + e.every <= e.until) && (e.limit == null || item.fired < e.limit)) {
            item.nextAt += e.every;
          } else {
            item.nextAt = null;
          }
        }
      }
    }

    function keepInside(enemy) {
      const half = enemy.enemyState.cfg.size / 2;
      const nx = clamp(enemy.x, arena.left + half, arena.right - half);
      const ny = clamp(enemy.y, arena.top + half, arena.bottom - half);
      const movedX = nx !== enemy.x, movedY = ny !== enemy.y;
      if (movedX || movedY) {
        const v = enemy.body.velocity;
        const vx = v.x, vy = v.y;
        enemy.body.reset(nx, ny); // also moves the game object
        enemy.setPosition(nx, ny);
        // Point bouncers back into the arena; chaser/patrol recompute on their own.
        enemy.body.setVelocity(movedX ? -vx : vx, movedY ? -vy : vy);
      }
    }

    let boundsCheckAt = 0;

    function update(time, delta) {
      const dt = Math.min(0.1, (delta || 16) / 1000);
      runSchedule((time - startTime) / 1000);
      const checkBounds = time >= boundsCheckAt;
      if (checkBounds) boundsCheckAt = time + 500;
      const children = group.getChildren();
      for (let i = 0; i < children.length; i++) {
        const enemy = children[i];
        const state = enemy.enemyState;
        if (!enemy.active || !state) continue;
        const behavior = BEHAVIORS[state.type];
        if (behavior.update) behavior.update(enemy, state, ctx, time, dt);
        if (checkBounds) keepInside(enemy);
      }
    }

    function setDifficulty(mods) {
      modifiers = normaliseModifiers(Object.assign({}, modifiers, mods || {}));
      for (const enemy of liveEnemies()) {
        const state = enemy.enemyState;
        if (!state) continue;
        state.speed = state.baseSpeed * modifiers.speed;
        state.recalcAt = 0;
        state.nextRetarget = 0;
        const behavior = BEHAVIORS[state.type];
        if (behavior.rescale) behavior.rescale(enemy, state);
      }
      return getModifiers();
    }

    function getModifiers() { return Object.assign({}, modifiers); }

    function isArmed(enemy) {
      return !!(enemy && enemy.enemyState) && nowOf(scene) >= enemy.enemyState.armedAt;
    }

    function describe(enemy) {
      const label = enemy && enemy.enemyState ? enemy.enemyState.label : 'drone';
      return (/^[aeiou]/i.test(label) ? 'An ' : 'A ') + label;
    }

    function clear() {
      group.clear(true, true);
    }

    return {
      group, config, arena, routes, types: ENEMY_TYPES,
      spawn, spawnMany, update, setDifficulty, getModifiers,
      isArmed, describe, count, clear,
      introducedTypes: () => Array.from(introduced)
    };
  }

  const api = { ENEMY_TYPES, DEFAULT_ENEMY_CONFIG, createEnemyManager, registerEnemyType };
  root.COIN_DASH_ENEMIES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
