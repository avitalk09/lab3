/* global Phaser, COIN_DASH */
// Arena manager: purely visual themes for the play field.
// It never creates physics bodies, walls or obstacles, so gameplay is untouched.
//
// Usage from the scene (see game.js):
//   this.arena = new ArenaManager(this);      // draws the starting arena
//   this.setArena(1);                         // jump to NEON CITY (0 = CLASSIC, 2 = LAVA ZONE)
//   this.nextArena();                         // cycle to the next arena
//   this.events.emit('levelchange', { level }); // the level system (levels.js) emits this on level up
//
// With levels.js present, the arena changes on every level up (arena = (level - 1) % 3).
// Without it, arenas cycle every `fallbackCoinsPerArena` coins (0 disables) and the N key
// cycles manually. Walls of `wallThickness` px line the play field; the physics world bounds
// are inset to their inner face so the player and drones stop against them. Each arena also
// has its own layout of solid obstacles inside the field (static Arcade bodies): the player
// is blocked by them, drones bounce off them, and a coin that lands inside one is relocated.
(function () {
  const defaults = {
    startIndex: 0,
    fallbackCoinsPerArena: 5,
    nameDuration: 1500,
    transitionDuration: 420,
    cycleKey: 'N',
    wallThickness: 16
  };
  window.COIN_DASH.arenas = Object.assign({}, defaults, window.COIN_DASH.arenas);

  const DEPTH = { background: -30, decor: -20, border: -10, walls: -5, haze: 30, overlay: 40, label: 50 };
  const TWO_PI = Math.PI * 2;

  function lerpColor(a, b, t) {
    const ca = Phaser.Display.Color.ValueToColor(a);
    const cb = Phaser.Display.Color.ValueToColor(b);
    const o = Phaser.Display.Color.Interpolate.ColorWithColor(ca, cb, 1, Phaser.Math.Clamp(t, 0, 1));
    return Phaser.Display.Color.GetColor(o.r, o.g, o.b);
  }

  // Draws a glowing frame around the canvas: several strokes, wide and faint to thin and bright.
  function glowBorder(gfx, color, alpha, passes) {
    const c = COIN_DASH;
    for (let i = passes; i >= 1; i--) {
      const width = 2 + i * 3;
      const a = alpha * (0.12 + 0.88 * (1 - i / (passes + 1)));
      gfx.lineStyle(width, color, a);
      gfx.strokeRoundedRect(width / 2, width / 2, c.width - width, c.height - width, 6);
    }
  }

  // The four wall rectangles lining the play field (HUD strip at the top stays clear).
  function wallRects() {
    const c = COIN_DASH, t = COIN_DASH.arenas.wallThickness, top = 44;
    return [
      { x: 0, y: top, w: c.width, h: t },                    // top
      { x: 0, y: c.height - t, w: c.width, h: t },           // bottom
      { x: 0, y: top, w: t, h: c.height - top },             // left
      { x: c.width - t, y: top, w: t, h: c.height - top }    // right
    ];
  }

  // Strokes the inner face of the walls (the edge the player bumps into).
  function innerFace(gfx, width, color, alpha) {
    const c = COIN_DASH, t = COIN_DASH.arenas.wallThickness;
    gfx.lineStyle(width, color, alpha);
    gfx.strokeRect(t, 44 + t, c.width - 2 * t, c.height - 44 - 2 * t);
  }

  // Brick walls: mortar background, two staggered rows of bricks, a bright bevel on the
  // inner face and a soft shadow cast onto the play field.
  function drawWalls(gfx, pal) {
    const c = COIN_DASH, t = COIN_DASH.arenas.wallThickness, top = 44;
    const rows = 2, bh = t / rows, bl = 34, gap = 2;
    for (const r of wallRects()) {
      gfx.fillStyle(pal.mortar, 1); gfx.fillRect(r.x, r.y, r.w, r.h);
      const horizontal = r.w > r.h;
      for (let row = 0; row < rows; row++) {
        const off = row % 2 ? bl / 2 : 0;
        const len = horizontal ? r.w : r.h, start = horizontal ? r.x : r.y;
        for (let a = start - off; a < start + len; a += bl) {
          const a0 = Math.max(a, start), a1 = Math.min(a + bl - gap, start + len);
          if (a1 <= a0) continue;
          gfx.fillStyle(pal.brick, 1);
          if (horizontal) gfx.fillRect(a0, r.y + row * bh + gap / 2, a1 - a0, bh - gap);
          else gfx.fillRect(r.x + row * bh + gap / 2, a0, bh - gap, a1 - a0);
          gfx.fillStyle(pal.light, 0.18);                      // brick top highlight
          if (horizontal) gfx.fillRect(a0, r.y + row * bh + gap / 2, a1 - a0, 2);
          else gfx.fillRect(r.x + row * bh + gap / 2, a0, 2, a1 - a0);
        }
      }
    }
    innerFace(gfx, 2, pal.light, 1);
    gfx.lineStyle(1, 0xffffff, 0.35);
    gfx.strokeRect(t - 2, top + t - 2, c.width - 2 * t + 4, c.height - top - 2 * t + 4);
    // Shadow on the field just inside the wall face.
    gfx.lineStyle(4, 0x000000, 0.28);
    gfx.strokeRect(t + 3, top + t + 3, c.width - 2 * t - 6, c.height - top - 2 * t - 6);
  }

  // ---------------------------------------------------------------- ARENA 1: CLASSIC
  const CLASSIC = {
    name: 'CLASSIC',
    accent: '#71e8ce',
    obstacleStyle: { fill: 0x3e5578, stroke: 0x9db6dd, glow: 0x9db6dd },
    obstacles: [
      { x: 250, y: 200, w: 22, h: 90 }, { x: 550, y: 200, w: 22, h: 90 },
      { x: 190, y: 360, w: 150, h: 22 }, { x: 610, y: 360, w: 150, h: 22 },
      { x: 400, y: 420, w: 22, h: 90 }
    ],
    bg: COIN_DASH.colors.background,
    pageBorder: '#34445e',
    pageGlow: 'none',
    create(m) {
      const c = COIN_DASH;
      // Identical to the original Coin Dash backdrop.
      m.keep(m.scene.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
        c.colors.background, 1, 0x24334b, 0.45).setDepth(DEPTH.background));
      // Plain slate walls in the original palette.
      const w = m.keep(m.scene.add.graphics().setDepth(DEPTH.walls));
      drawWalls(w, { brick: 0x3e5578, mortar: 0x16233a, light: 0x9db6dd });
    },
    update() {}
  };

  // ---------------------------------------------------------------- ARENA 2: NEON CITY
  const NEON = {
    name: 'NEON CITY',
    accent: '#8b5cf6',
    obstacleStyle: { fill: 0x1f1b4a, stroke: 0xc084fc, glow: 0x8b5cf6 },
    obstacles: [
      { x: 200, y: 250, w: 22, h: 170 }, { x: 600, y: 250, w: 22, h: 170 },
      { x: 400, y: 150, w: 130, h: 22 }, { x: 400, y: 400, w: 130, h: 22 },
      { x: 90, y: 440, w: 70, h: 22 }, { x: 710, y: 440, w: 70, h: 22 }
    ],
    bg: 0x05060f,
    pageBorder: '#6d5dfc',
    pageGlow: '0 0 24px rgba(99, 102, 241, .45)',
    create(m) {
      const s = m.scene;
      m.lights = m.keep(s.add.graphics().setDepth(DEPTH.background).setBlendMode(Phaser.BlendModes.ADD));
      m.grid = m.keep(s.add.graphics().setDepth(DEPTH.decor));
      m.border = m.keep(s.add.graphics().setDepth(DEPTH.border));
      m.walls = m.keep(s.add.graphics().setDepth(DEPTH.walls));
      drawWalls(m.walls, { brick: 0x1f1b4a, mortar: 0x07071a, light: 0xc084fc });
      m.wallGlow = m.keep(s.add.graphics().setDepth(DEPTH.walls));
      m.obstacleGlow = m.keep(s.add.graphics().setDepth(DEPTH.walls));
      m.lightSpots = [
        { x: 0.2, y: 0.3, r: 150, color: 0x3b82f6, speed: 0.11, phase: 0 },
        { x: 0.75, y: 0.65, r: 180, color: 0x7c3aed, speed: 0.08, phase: 2.1 },
        { x: 0.55, y: 0.2, r: 120, color: 0x06b6d4, speed: 0.14, phase: 4.0 }
      ];
    },
    update(m, t) {
      const c = COIN_DASH;
      const cell = 40;
      const scroll = (t * 18) % cell;             // grid drifts slowly downwards
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);

      // Animated grid: blue verticals, purple horizontals, a bright scan line sweeping down.
      const g = m.grid;
      g.clear();
      g.lineStyle(1, 0x3b82f6, 0.14 + 0.08 * pulse);
      for (let x = 0; x <= c.width; x += cell) g.lineBetween(x, 44, x, c.height);
      g.lineStyle(1, 0xa855f7, 0.14 + 0.08 * (1 - pulse));
      for (let y = 44 + scroll - cell; y <= c.height; y += cell) {
        if (y >= 44) g.lineBetween(0, y, c.width, y);
      }
      const scanY = 44 + ((t * 55) % (c.height - 44));
      g.lineStyle(2, 0x22d3ee, 0.35);
      g.lineBetween(0, scanY, c.width, scanY);
      g.lineStyle(10, 0x22d3ee, 0.06);
      g.lineBetween(0, scanY, c.width, scanY);

      // Subtle drifting light pools (additive blend, a few soft rings each).
      const l = m.lights;
      l.clear();
      for (const sp of m.lightSpots) {
        const x = c.width * (sp.x + 0.08 * Math.sin(t * sp.speed * TWO_PI + sp.phase));
        const y = c.height * (sp.y + 0.06 * Math.cos(t * sp.speed * 1.3 * TWO_PI + sp.phase));
        for (let i = 4; i >= 1; i--) {
          l.fillStyle(sp.color, 0.035);
          l.fillCircle(x, y, sp.r * i / 4);
        }
      }

      // Glowing frame that breathes between blue and purple.
      const b = m.border;
      b.clear();
      glowBorder(b, lerpColor(0x3b82f6, 0xa855f7, pulse), 0.75 + 0.25 * pulse, 4);
      b.lineStyle(1, 0xe9d5ff, 0.5 + 0.3 * pulse);
      b.strokeRoundedRect(3, 3, c.width - 6, c.height - 6, 6);

      // Neon tube running along the inner face of the walls.
      const wg = m.wallGlow;
      wg.clear();
      const tube = lerpColor(0xa855f7, 0x3b82f6, pulse);
      innerFace(wg, 6, tube, 0.18 + 0.1 * pulse);
      innerFace(wg, 2, tube, 0.9);
      innerFace(wg, 1, 0xffffff, 0.35 + 0.25 * pulse);
      m.drawObstacleGlow(m.obstacleGlow, tube, 0.25 + 0.2 * pulse);
    }
  };

  // ---------------------------------------------------------------- ARENA 3: LAVA ZONE
  const LAVA = {
    name: 'LAVA ZONE',
    accent: '#fb923c',
    obstacleStyle: { fill: 0x4a1c12, stroke: 0xfb923c, glow: 0xf97316 },
    obstacles: [
      { x: 180, y: 190, w: 44, h: 44 }, { x: 620, y: 190, w: 44, h: 44 },
      { x: 180, y: 400, w: 44, h: 44 }, { x: 620, y: 400, w: 44, h: 44 },
      { x: 400, y: 150, w: 160, h: 22 }, { x: 300, y: 330, w: 22, h: 110 },
      { x: 500, y: 330, w: 22, h: 110 }, { x: 400, y: 450, w: 44, h: 44 }
    ],
    bg: 0x1a0606,
    pageBorder: '#f97316',
    pageGlow: '0 0 26px rgba(249, 115, 22, .45)',
    create(m) {
      const s = m.scene;
      const c = COIN_DASH;
      const rng = new Phaser.Math.RandomDataGenerator(['lava-zone']); // same cracks every time
      m.cracks = m.keep(s.add.graphics().setDepth(DEPTH.background));
      m.pools = m.keep(s.add.graphics().setDepth(DEPTH.decor).setBlendMode(Phaser.BlendModes.ADD));
      m.embers = m.keep(s.add.graphics().setDepth(DEPTH.decor));
      m.border = m.keep(s.add.graphics().setDepth(DEPTH.border));
      m.walls = m.keep(s.add.graphics().setDepth(DEPTH.walls));
      drawWalls(m.walls, { brick: 0x4a1c12, mortar: 0x1c0806, light: 0xfb923c });
      m.wallGlow = m.keep(s.add.graphics().setDepth(DEPTH.walls));
      m.obstacleGlow = m.keep(s.add.graphics().setDepth(DEPTH.walls));
      m.haze = m.keep(s.add.rectangle(c.width / 2, c.height / 2, c.width, c.height, 0xf97316, 0.04)
        .setDepth(DEPTH.haze).setBlendMode(Phaser.BlendModes.ADD));

      // Static glowing cracks, drawn once.
      const k = m.cracks;
      for (let i = 0; i < 9; i++) {
        let x = rng.between(0, c.width), y = rng.between(60, c.height);
        const pts = [{ x, y }];
        for (let j = 0; j < rng.between(4, 8); j++) {
          x = Phaser.Math.Clamp(x + rng.between(-70, 70), 0, c.width);
          y = Phaser.Math.Clamp(y + rng.between(-50, 50), 50, c.height);
          pts.push({ x, y });
        }
        for (let p = 1; p < pts.length; p++) {
          k.lineStyle(7, 0xdc2626, 0.10); k.lineBetween(pts[p - 1].x, pts[p - 1].y, pts[p].x, pts[p].y);
          k.lineStyle(2, 0xfb923c, 0.55); k.lineBetween(pts[p - 1].x, pts[p - 1].y, pts[p].x, pts[p].y);
        }
      }

      m.blobs = [];
      for (let i = 0; i < 12; i++) {
        m.blobs.push({
          x: rng.between(30, c.width - 30), y: rng.between(80, c.height - 30),
          r: rng.between(26, 60), phase: rng.frac() * TWO_PI, speed: 0.25 + rng.frac() * 0.4,
          dx: rng.between(10, 30), dy: rng.between(6, 18)
        });
      }
      m.sparks = [];
      for (let i = 0; i < 28; i++) {
        m.sparks.push({ x: rng.between(0, c.width), y: rng.between(44, c.height),
          v: 18 + rng.frac() * 30, sway: rng.frac() * TWO_PI, r: 1 + rng.frac() * 1.8 });
      }
    },
    update(m, t, dt) {
      const c = COIN_DASH;
      const flicker = 0.5 + 0.5 * Math.sin(t * 2.3) * Math.cos(t * 1.1 + 0.7);

      // Pulsing lava pools.
      const p = m.pools;
      p.clear();
      for (const b of m.blobs) {
        const x = b.x + Math.sin(t * b.speed + b.phase) * b.dx;
        const y = b.y + Math.cos(t * b.speed * 0.8 + b.phase) * b.dy;
        const r = b.r * (0.85 + 0.15 * Math.sin(t * 1.4 + b.phase));
        p.fillStyle(0x7f1d1d, 0.22); p.fillCircle(x, y, r);
        p.fillStyle(0xea580c, 0.16); p.fillCircle(x, y, r * 0.65);
        p.fillStyle(0xfbbf24, 0.14); p.fillCircle(x, y, r * 0.3);
      }
      m.cracks.setAlpha(0.7 + 0.3 * flicker);

      // Rising embers (recycled when they leave the top of the play field).
      const e = m.embers;
      e.clear();
      for (const sp of m.sparks) {
        sp.y -= sp.v * dt;
        sp.x += Math.sin(t * 2 + sp.sway) * 0.3;
        if (sp.y < 48) { sp.y = c.height + 4; sp.x = Phaser.Math.Between(0, c.width); }
        const fade = Phaser.Math.Clamp((sp.y - 44) / 160, 0, 1);
        e.fillStyle(0xfdba74, 0.55 * fade);
        e.fillCircle(sp.x, sp.y, sp.r);
      }

      // Heat shimmer: very faint wavy bands drifting upward.
      e.lineStyle(14, 0xf97316, 0.025);
      for (let i = 0; i < 4; i++) {
        const y = c.height - ((t * 22 + i * 115) % (c.height - 44));
        e.beginPath();
        for (let x = 0; x <= c.width; x += 40) {
          const yy = y + Math.sin(x / 60 + t * 2 + i) * 6;
          if (x === 0) e.moveTo(x, yy); else e.lineTo(x, yy);
        }
        e.strokePath();
      }
      m.haze.setAlpha(0.03 + 0.03 * flicker);

      // Fiery frame.
      const b = m.border;
      b.clear();
      glowBorder(b, lerpColor(0xdc2626, 0xf97316, flicker), 0.8 + 0.2 * flicker, 4);
      b.lineStyle(1, 0xfde68a, 0.45 + 0.35 * flicker);
      b.strokeRoundedRect(3, 3, c.width - 6, c.height - 6, 6);

      // Molten seam glowing along the inner face of the rock walls.
      const wg = m.wallGlow;
      wg.clear();
      innerFace(wg, 6, 0xea580c, 0.15 + 0.15 * flicker);
      innerFace(wg, 2, lerpColor(0xf97316, 0xfbbf24, flicker), 0.85);
      m.drawObstacleGlow(m.obstacleGlow, lerpColor(0xdc2626, 0xf97316, flicker), 0.25 + 0.25 * flicker);
    }
  };

  const ARENAS = [CLASSIC, NEON, LAVA];

  class ArenaManager {
    constructor(scene) {
      this.scene = scene;
      this.index = -1;
      this.theme = null;
      this.objects = [];
      this.elapsed = 0;
      this.switching = false;
      // With a level system (levels.js) the arena follows the level; the coin fallback is off.
      this.externallyDriven = !!(scene.levels || window.CoinDashLevels);
      this.lastScore = scene.score || 0;

      const cfg = COIN_DASH.arenas;
      scene.setArena = (i, opts) => this.setArena(i, opts);
      scene.nextArena = () => this.next();
      scene.events.on('update', this.update, this);
      scene.events.on('levelchange', this.onLevelChanged, this);   // emitted by levels.js integration
      scene.events.on('level-changed', this.onLevelChanged, this); // generic alias
      scene.events.once('shutdown', this.destroy, this);
      // Physics world bounds hug the inner face of the walls (same inset for every arena).
      const t = cfg.wallThickness;
      if (t > 0 && scene.physics && scene.physics.world) {
        scene.physics.world.setBounds(t, 44 + t, COIN_DASH.width - 2 * t, COIN_DASH.height - 44 - 2 * t);
      }
      if (cfg.cycleKey && scene.input.keyboard) {
        this.keyHandler = () => this.next();
        scene.input.keyboard.on('keydown-' + cfg.cycleKey, this.keyHandler);
      }
      // Solid obstacles inside the field. Colliders are attached on the first update,
      // once the scene has created the player and the drones.
      this.obstacles = scene.physics.add.staticGroup();
      this.obstacleRects = [];
      this.colliders = null;
      this.setArena(cfg.startIndex, { announce: false, instant: true });
    }

    get count() { return ARENAS.length; }
    get current() { return this.theme; }

    keep(obj) { this.objects.push(obj); return obj; }

    next() { return this.setArena(this.index + 1); }

    // Public entry point. index wraps, so setArena(level) works for any level number.
    setArena(index, opts = {}) {
      const n = ARENAS.length;
      index = ((Math.floor(Number(index) || 0) % n) + n) % n;
      if (!this.scene.cameras || !this.scene.cameras.main) return this.index; // scene not running
      if (this.switching) { this.pending = index; return this.index; }
      if (index === this.index && this.theme) return this.index;
      const announce = opts.announce !== false;
      if (opts.instant || !this.theme) {
        this.apply(index);
        if (announce) this.showName();
        return this.index;
      }
      // Smooth transition: fade to the new arena's colour, swap, fade back in.
      const c = COIN_DASH;
      const d = COIN_DASH.arenas.transitionDuration;
      this.switching = true;
      const cover = this.scene.add.rectangle(c.width / 2, c.height / 2, c.width, c.height, ARENAS[index].bg)
        .setDepth(DEPTH.overlay).setAlpha(0);
      this.scene.tweens.add({
        targets: cover, alpha: 1, duration: d, ease: 'Quad.easeIn',
        onComplete: () => {
          this.apply(index);
          if (announce) this.showName();
          this.scene.tweens.add({
            targets: cover, alpha: 0, duration: d * 1.4, ease: 'Quad.easeOut',
            onComplete: () => {
              cover.destroy();
              this.switching = false;
              if (this.pending !== undefined) { const p = this.pending; this.pending = undefined; this.setArena(p); }
            }
          });
        }
      });
      return index;
    }

    apply(index) {
      for (const o of this.objects) o.destroy();
      this.objects = [];
      this.index = index;
      this.theme = ARENAS[index];
      this.scene.cameras.main.setBackgroundColor(this.theme.bg);
      this.theme.create(this);
      this.buildObstacles();
      this.theme.update(this, this.elapsed, 0);
      const el = document.getElementById('game');
      if (el) { el.style.borderColor = this.theme.pageBorder; el.style.boxShadow = this.theme.pageGlow; }
    }

    // Creates this arena's obstacles as static bodies. An obstacle that would land on top of
    // the player when switching arenas is skipped, so the player is never trapped inside one.
    buildObstacles() {
      this.obstacles.clear(true, true);
      this.obstacleRects = [];
      const s = this.scene, style = this.theme.obstacleStyle;
      const player = s.player;
      for (const o of this.theme.obstacles || []) {
        const rect = new Phaser.Geom.Rectangle(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
        if (player && Phaser.Geom.Intersects.RectangleToRectangle(
          rect, new Phaser.Geom.Rectangle(player.x - 24, player.y - 24, 48, 48))) continue;
        const block = s.add.rectangle(o.x, o.y, o.w, o.h, style.fill)
          .setStrokeStyle(2, style.stroke, 0.9).setDepth(DEPTH.walls);
        this.obstacles.add(block);
        this.obstacleRects.push(rect);
      }
    }

    ensureColliders() {
      if (this.colliders) return;
      const s = this.scene;
      if (!s.player || !s.player.body) return;
      this.colliders = [s.physics.add.collider(s.player, this.obstacles)];
      if (s.drones) this.colliders.push(s.physics.add.collider(s.drones, this.obstacles));
    }

    // The scene places coins at random; if one lands inside an obstacle, ask for another spot.
    keepCoinClear() {
      const s = this.scene, coin = s.coin;
      if (!coin || !coin.body || s.finished || typeof s.placeCoin !== 'function') return;
      const area = new Phaser.Geom.Rectangle(coin.x - 18, coin.y - 18, 36, 36);
      for (const r of this.obstacleRects) {
        if (Phaser.Geom.Intersects.RectangleToRectangle(area, r)) { s.placeCoin(); return; }
      }
    }

    drawObstacleGlow(gfx, color, alpha) {
      gfx.clear();
      for (const r of this.obstacleRects) {
        gfx.lineStyle(8, color, alpha * 0.35); gfx.strokeRect(r.x - 4, r.y - 4, r.width + 8, r.height + 8);
        gfx.lineStyle(3, color, alpha); gfx.strokeRect(r.x - 1, r.y - 1, r.width + 2, r.height + 2);
      }
    }

    showName() {
      const c = COIN_DASH;
      const hold = COIN_DASH.arenas.nameDuration;
      const style = { font: 'bold 36px monospace', color: this.theme.accent, align: 'center',
        stroke: '#000000', strokeThickness: 6 };
      // Lower third of the field, clear of the centred "LEVEL UP!" label from levels.js.
      const title = this.scene.add.text(c.width / 2, c.height - 92, this.theme.name, style)
        .setOrigin(0.5).setDepth(DEPTH.label).setAlpha(0).setScale(0.7);
      const sub = this.scene.add.text(c.width / 2, c.height - 60, `ARENA ${this.index + 1}`,
        { font: '16px monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 4 })
        .setOrigin(0.5).setDepth(DEPTH.label).setAlpha(0);
      this.scene.tweens.add({ targets: [title, sub], alpha: 1, duration: 250, ease: 'Quad.easeOut' });
      this.scene.tweens.add({ targets: title, scale: 1, duration: 350, ease: 'Back.easeOut' });
      this.scene.tweens.add({
        targets: [title, sub], alpha: 0, y: '-=18', delay: hold, duration: 400, ease: 'Quad.easeIn',
        onComplete: () => { title.destroy(); sub.destroy(); }
      });
    }

    onLevelChanged(level) {
      this.externallyDriven = true;
      const n = typeof level === 'object' && level !== null ? level.level : level;
      this.setArena((Number(n) || 1) - 1);
    }

    update(time, delta) {
      const dt = Math.min(delta, 50) / 1000;
      this.elapsed += dt;
      if (this.theme) this.theme.update(this, this.elapsed, dt);
      this.ensureColliders();
      this.keepCoinClear();

      // Stand-in progression until a level system drives arenas: cycle every N coins.
      const per = COIN_DASH.arenas.fallbackCoinsPerArena;
      const score = this.scene.score;
      if (!this.externallyDriven && per > 0 && typeof score === 'number' && !this.scene.finished) {
        if (Math.floor(score / per) !== Math.floor(this.lastScore / per)) this.next();
      }
      this.lastScore = score;
    }

    destroy() {
      const s = this.scene;
      s.events.off('update', this.update, this);
      s.events.off('levelchange', this.onLevelChanged, this);
      s.events.off('level-changed', this.onLevelChanged, this);
      if (this.keyHandler && s.input.keyboard) {
        s.input.keyboard.off('keydown-' + COIN_DASH.arenas.cycleKey, this.keyHandler);
      }
      for (const o of this.objects) o.destroy();
      this.objects = [];
      this.theme = null;
      const el = document.getElementById('game');
      if (el) { el.style.borderColor = ''; el.style.boxShadow = ''; } // back to the page default
      // The physics system tears down the static group and the colliders itself at shutdown.
      this.colliders = null;
      this.obstacles = null;
      this.obstacleRects = [];
    }
  }

  ArenaManager.ARENAS = ARENAS;
  window.ArenaManager = ArenaManager;
})();
