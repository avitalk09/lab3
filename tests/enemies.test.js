// Node tests for enemies.js. Run with:  node --test tests/*.test.js
// Phaser is not loaded; a tiny stub scene provides just what the module touches.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

globalThis.window = globalThis;
require(path.join(__dirname, '..', 'settings.js'));
const SETTINGS = globalThis.COIN_DASH;
const { createEnemyManager, ENEMY_TYPES, registerEnemyType } = require(path.join(__dirname, '..', 'enemies.js'));

// ----------------------------------------------------------- stub scene

function makeObject(kind, x, y, w, h, color) {
  const o = {
    kind, color, x, y, width: w, height: h, active: true, alpha: 1, scale: 1, rotation: 0, data: {},
    setPosition(nx, ny) { this.x = nx; this.y = ny; return this; },
    setAlpha(a) { this.alpha = a; return this; },
    setScale(s) { this.scale = s; return this; },
    setData(k, v) { this.data[k] = v; return this; },
    getData(k) { return this.data[k]; },
    destroy() { this.active = false; }
  };
  o.body = {
    velocity: { x: 0, y: 0 }, circle: null, bounce: null, collideWorldBounds: false,
    setVelocity(vx, vy) { this.velocity.x = vx; this.velocity.y = vy; return this; },
    setCollideWorldBounds(v) { this.collideWorldBounds = v; return this; },
    setBounce(bx, by) { this.bounce = [bx, by]; return this; },
    setCircle(r) { this.circle = r; return this; },
    reset(nx, ny) { o.x = nx; o.y = ny; this.velocity.x = 0; this.velocity.y = 0; }
  };
  return o;
}

function makeScene(settings = SETTINGS) {
  const children = [];
  const events = {};
  const scene = {
    time: { now: 1000 },
    tweens: { added: [], add(cfg) { this.added.push(cfg); } },
    events: {
      log: [],
      on(name, fn) { (events[name] = events[name] || []).push(fn); },
      emit(name, ...args) { this.log.push([name, ...args]); (events[name] || []).forEach(fn => fn(...args)); }
    },
    physics: {
      world: { bounds: { x: 0, y: 44, width: settings.width, height: settings.height - 44 } },
      add: {
        group() {
          return {
            add(o) { children.push(o); },
            getChildren() { return children; },
            clear() { children.forEach(c => c.destroy()); children.length = 0; }
          };
        }
      }
    },
    add: {
      rectangle: (x, y, w, h, c) => makeObject('rectangle', x, y, w, h, c),
      triangle: (x, y, x1, y1, x2, y2, x3, y3, c) =>
        makeObject('triangle', x, y, Math.max(x1, x2, x3) - Math.min(x1, x2, x3), Math.max(y1, y2, y3) - Math.min(y1, y2, y3), c),
      polygon: (x, y, pts, c) => {
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        return makeObject('polygon', x, y, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), c);
      }
    }
  };
  return scene;
}

// Advance the simulation: integrate velocities like arcade physics would, then update.
function step(scene, manager, ms, frame = 16) {
  for (let t = 0; t < ms; t += frame) {
    const dt = frame / 1000;
    for (const e of manager.group.getChildren()) {
      e.x += e.body.velocity.x * dt;
      e.y += e.body.velocity.y * dt;
    }
    scene.time.now += frame;
    manager.update(scene.time.now, frame);
  }
}

const speedOf = e => Math.hypot(e.body.velocity.x, e.body.velocity.y);
const player = { x: 400, y: 272 };

// ------------------------------------------------------------------ tests

test('classic drone layout and speed are preserved at round start', () => {
  const scene = makeScene();
  const m = createEnemyManager(scene, { player, settings: SETTINGS });
  m.update(scene.time.now, 16);
  const drones = m.group.getChildren();
  assert.equal(drones.length, SETTINGS.droneCount);
  drones.forEach((d, i) => {
    assert.equal(d.kind, 'rectangle');
    assert.equal(d.width, 26);
    assert.equal(d.color, SETTINGS.colors.drone);
    assert.equal(d.x, 90 + i * 270);
    assert.equal(d.y, 100);
    const a = (35 + i * 105) * Math.PI / 180;
    assert.ok(Math.abs(d.body.velocity.x - Math.cos(a) * SETTINGS.droneSpeed) < 1e-9);
    assert.ok(Math.abs(d.body.velocity.y - Math.sin(a) * SETTINGS.droneSpeed) < 1e-9);
    assert.deepEqual(d.body.bounce, [1, 1]);
    assert.equal(d.body.collideWorldBounds, true);
  });
});

test('enemy types are introduced progressively following the schedule', () => {
  const scene = makeScene();
  const m = createEnemyManager(scene, { player, settings: SETTINGS });
  const seen = [];
  scene.events.on('enemy-type-introduced', type => seen.push(type));
  m.update(scene.time.now, 16);
  assert.deepEqual(m.introducedTypes(), ['drone']);
  step(scene, m, 7000);
  assert.equal(m.count('chaser'), 0, 'no chaser before 8s');
  step(scene, m, 1500);
  assert.equal(m.count('chaser'), 1, 'chaser at 8s');
  assert.equal(m.count('speed'), 0);
  step(scene, m, 8000);
  assert.equal(m.count('speed'), 1, 'speeder at 16s');
  step(scene, m, 8000);
  assert.equal(m.count('patrol'), 1, 'patrol at 24s');
  assert.deepEqual(seen, ['drone', 'chaser', 'speed', 'patrol']);
  step(scene, m, 16000);
  assert.equal(m.count('speed'), 2);
  assert.equal(m.count('chaser'), 2);
  assert.ok(m.count() <= SETTINGS.enemies.maxEnemies);
});

test('every type has a distinct colour and shape', () => {
  const scene = makeScene();
  const m = createEnemyManager(scene, { player, settings: SETTINGS, config: { schedule: [] } });
  const enemies = Object.values(ENEMY_TYPES).map(t => m.spawn(t));
  const colors = new Set(enemies.map(e => e.color));
  assert.equal(colors.size, 4);
  assert.equal(enemies[0].kind, 'rectangle');
  assert.equal(enemies[1].kind, 'triangle');
  assert.equal(enemies[2].kind, 'polygon');
  assert.equal(enemies[3].kind, 'polygon');
  assert.ok(enemies[2].width < enemies[0].width, 'speeder is smaller than a drone');
});

test('spawn cap refuses extra enemies and spawnMany stops early', () => {
  const scene = makeScene();
  const m = createEnemyManager(scene, { player, settings: SETTINGS, config: { schedule: [], maxEnemies: 4 } });
  const got = m.spawnMany('speed', 10);
  assert.equal(got.length, 4);
  assert.equal(m.spawn('chaser'), null);
  assert.equal(m.count(), 4);
  m.setDifficulty({ maxEnemies: 6 });
  assert.ok(m.spawn('chaser'));
  assert.equal(m.count(), 5);
});

test('new enemies spawn away from the player and inside the arena', () => {
  const scene = makeScene();
  const m = createEnemyManager(scene, { player, settings: SETTINGS, config: { schedule: [], maxEnemies: 50 } });
  for (let i = 0; i < 30; i++) {
    const e = m.spawn(['chaser', 'speed', 'patrol', 'drone'][i % 4]);
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    assert.ok(d >= SETTINGS.enemies.spawnMinDistance, `spawn ${i} too close: ${d}`);
    assert.ok(e.x >= 0 && e.x <= 800 && e.y >= 44 && e.y <= 500, `spawn ${i} outside arena`);
  }
});

test('chaser steers towards the player and keeps re-aiming', () => {
  const scene = makeScene();
  const target = { x: 700, y: 272 };
  const m = createEnemyManager(scene, { player: target, settings: SETTINGS, config: { schedule: [] } });
  const c = m.spawn('chaser', { x: 100, y: 272 });
  step(scene, m, 2000);
  assert.ok(c.body.velocity.x > 100, 'moving right towards the player');
  assert.ok(Math.abs(speedOf(c) - SETTINGS.enemies.types.chaser.speed) < 1, `speed ${speedOf(c)}`);
  assert.ok(Math.abs(c.rotation - Math.PI / 2) < 0.05, 'triangle points at the player');
  // Player moves: the chaser must turn without teleporting its velocity.
  target.x = 100; target.y = 100;
  step(scene, m, 48);
  assert.ok(c.body.velocity.x > 0, 'still carrying momentum right after the player moves');
  step(scene, m, 2000);
  assert.ok(c.body.velocity.x < 0, 'turned left after the player moved');
  assert.ok(c.body.velocity.y < 0, 'and upwards');
});

test('speeder is faster, smaller, bounces, and never travels along an axis', () => {
  const scene = makeScene();
  const m = createEnemyManager(scene, { player, settings: SETTINGS, config: { schedule: [], maxEnemies: 50 } });
  for (let i = 0; i < 20; i++) {
    const s = m.spawn('speed');
    assert.ok(Math.abs(speedOf(s) - 240) < 1e-6);
    assert.ok(speedOf(s) > SETTINGS.droneSpeed * 2);
    assert.equal(s.width, 14);
    assert.equal(s.body.circle, 7);
    assert.deepEqual(s.body.bounce, [1, 1]);
    assert.ok(Math.abs(s.body.velocity.x) > 40 && Math.abs(s.body.velocity.y) > 40);
  }
});

test('patrol walks its route and turns at each waypoint', () => {
  const scene = makeScene();
  const m = createEnemyManager(scene, { player, settings: SETTINGS, config: { schedule: [] } });
  const route = SETTINGS.enemies.patrolRoutes[0];
  const p = m.spawn('patrol');
  const start = p.enemyState.waypoint;
  // The first target is the waypoint after the start point.
  const expectTarget = () => route[p.enemyState.waypoint];
  const visited = [];
  for (let i = 0; i < 4; i++) {
    const [tx, ty] = expectTarget();
    const toTarget = Math.atan2(ty - p.y, tx - p.x);
    const heading = Math.atan2(p.body.velocity.y, p.body.velocity.x);
    assert.ok(Math.abs(toTarget - heading) < 0.01, 'velocity aims at current waypoint');
    assert.ok(Math.abs(speedOf(p) - 150) < 1e-6);
    const dist = Math.hypot(tx - p.x, ty - p.y);
    step(scene, m, Math.ceil(dist / 150 * 1000) + 100);
    visited.push(p.enemyState.waypoint);
  }
  // Four legs later the target waypoint has cycled all the way round.
  assert.equal(p.enemyState.waypoint, (start + 4) % route.length);
  assert.equal(new Set(visited).size, 4);
});

test('difficulty modifiers scale speed and bring the schedule forward', () => {
  const scene = makeScene();
  const m = createEnemyManager(scene, { player, settings: SETTINGS, modifiers: { enemySpeedMultiplier: 1.5, spawnRate: 2 } });
  assert.deepEqual(m.getModifiers(), { speed: 1.5, spawnRate: 2, maxEnemies: null });
  m.update(scene.time.now, 16);
  const drone = m.group.getChildren()[0];
  assert.ok(Math.abs(speedOf(drone) - SETTINGS.droneSpeed * 1.5) < 1e-6);
  step(scene, m, 4100); // chaser is scheduled at 8s, spawnRate 2 => 4s
  assert.equal(m.count('chaser'), 1);
  const chaser = m.group.getChildren().find(e => e.enemyState.type === 'chaser');
  assert.ok(Math.abs(chaser.enemyState.speed - 125 * 1.5) < 1e-6);
  m.setDifficulty({ speed: 0.5 });
  assert.ok(Math.abs(speedOf(drone) - SETTINGS.droneSpeed * 0.5) < 1e-6);
  assert.ok(Math.abs(chaser.enemyState.speed - 125 * 0.5) < 1e-6);
});

test('enemies that end up outside the arena are pulled back in', () => {
  const scene = makeScene();
  const m = createEnemyManager(scene, { player, settings: SETTINGS, config: { schedule: [] } });
  const s = m.spawn('speed', { x: 400, y: 100 });
  s.x = 950; s.y = 10;
  const vx = s.body.velocity.x, vy = s.body.velocity.y;
  scene.time.now += 600;
  m.update(scene.time.now, 16);
  assert.ok(s.x <= 800 - 7 && s.y >= 44 + 7, `clamped: ${s.x},${s.y}`);
  assert.equal(s.body.velocity.x, -vx);
  assert.equal(s.body.velocity.y, -vy);
});

test('spawn grace period and collision labels', () => {
  const scene = makeScene();
  const m = createEnemyManager(scene, { player, settings: SETTINGS, config: { schedule: [] } });
  const c = m.spawn('chaser');
  assert.equal(m.isArmed(c), false);
  scene.time.now += SETTINGS.enemies.spawnGraceMs;
  assert.equal(m.isArmed(c), true);
  assert.equal(m.describe(c), 'A chaser');
  assert.equal(m.describe(m.spawn('drone')), 'A drone');
  assert.equal(m.describe(m.spawn('speed')), 'A speeder');
  assert.equal(m.describe(m.spawn('patrol')), 'A patrol');
  assert.equal(m.spawn('nope'), null);
});

test('works with the original settings shape (no enemies block)', () => {
  const legacy = { width: 800, height: 500, droneSpeed: 90, droneCount: 2, colors: { drone: 0x123456 } };
  const scene = makeScene(legacy);
  const m = createEnemyManager(scene, { player, settings: legacy });
  m.update(scene.time.now, 16);
  assert.equal(m.count('drone'), 2);
  const d = m.group.getChildren()[0];
  assert.equal(d.color, 0x123456);
  assert.ok(Math.abs(speedOf(d) - 90) < 1e-6);
  step(scene, m, 30000);
  assert.deepEqual(m.introducedTypes(), ['drone', 'chaser', 'speed', 'patrol']);
  assert.ok(m.routes.length >= 1, 'patrol routes derived from the arena');
});

test('custom enemy types can be registered and scheduled', () => {
  registerEnemyType('blob', {
    create: (scene, x, y, cfg) => scene.add.rectangle(x, y, cfg.size, cfg.size, cfg.color),
    init: (e, state) => e.body.setVelocity(state.speed, 0)
  });
  const scene = makeScene();
  const m = createEnemyManager(scene, {
    player, settings: SETTINGS,
    config: { types: { blob: { color: 0x00ff00, size: 20, speed: 50, label: 'blob' } }, schedule: [{ at: 1, type: 'blob', count: 2 }] }
  });
  step(scene, m, 1200);
  assert.equal(m.count('blob'), 2);
});

test('settings schedule only references known types and routes stay inside the arena', () => {
  for (const e of SETTINGS.enemies.schedule) assert.ok(SETTINGS.enemies.types[e.type], e.type);
  for (const route of SETTINGS.enemies.patrolRoutes) {
    for (const [x, y] of route) assert.ok(x > 0 && x < 800 && y > 44 && y < 500);
  }
});
