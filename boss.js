/* global Phaser, COIN_DASH */
// Coin Dash — final boss module (self-contained, no external assets).
//
// Usage from the scene:   if (window.CoinDashBoss) CoinDashBoss.attach(this);
// Force the boss:         spawnBoss()            (or CoinDashBoss.spawnBoss(scene), or press the debug key)
// Tuning:                 window.COIN_DASH.boss = { ... }   (see DEFAULTS; any key can be overridden)
//
// Trigger: the boss appears when `getLevel(scene) >= triggerLevel`. If the scene has no level
// system yet, the level is derived from the score (`floor(score / coinsPerLevel) + 1`). A level
// feature can later pass `getLevel` in the options or set `scene.level`, nothing else changes.
(function () {
  'use strict';

  const HUD_HEIGHT = 44; // top strip reserved by the game for the HUD (physics bounds start there)

  const DEFAULTS = {
    triggerLevel: 5,            // boss appears when the level reaches this value
    coinsPerLevel: 3,           // fallback level = floor(score / coinsPerLevel) + 1 when no level system exists
    getLevel: null,             // optional function(scene) -> number; overrides the level lookup
    getDifficulty: null,        // optional function(scene) -> multiplier; defaults to scene.difficulty if numeric
    difficulty: 1,              // static multiplier applied to boss speed, projectile speed and fire rate
    debugKey: 'B',              // keyboard key that spawns the boss immediately (null disables)
    warningMs: 2400,            // duration of the "WARNING: BOSS INCOMING!" sequence
    size: 64,                   // boss hull size in px (normal drones are 26)
    speed: 80,                  // boss chase speed (player is 240)
    enrageAt: 2,                // boss becomes faster and fires spreads at/below this health
    fireIntervalMs: 2600,       // time between volleys
    projectileSpeed: 190,
    projectileRadius: 7,
    hitsToDefeat: 5,            // attack coins needed to defeat the boss
    attackCoinRespawnMs: 700,   // delay before the next attack coin appears
    hitCooldownMs: 800,         // ignore repeated player hits inside this window (for future lives systems)
    bonusPoints: 100,           // awarded on defeat
    afterDefeat: 'continue',    // 'continue' keeps playing, 'victory' ends the round with a victory message
    onPlayerHit: null,          // optional function(scene, reason); defaults to scene.finish(reason)
    onDefeated: null,           // optional function(scene, bonus); defaults to scene.score += bonus
    colors: {
      hull: 0xd62839, hullStroke: 0xff8fa0, core: 0x7a0f1f, rotor: 0xffb3c0,
      eye: 0xfff176, eyeGlow: 0xffe14d, pupil: 0x2a0000, enragedEye: 0xff4d4d,
      projectile: 0xff3b3b, projectileStroke: 0xffc2c2,
      attackCoin: 0x4da6ff, attackCoinCore: 0xe3f2ff,
      health: 0xff2e4d, healthBg: 0x3a0c14, healthStroke: 0xffffff
    }
  };

  function merged(...sources) {
    const out = Object.assign({}, DEFAULTS);
    out.colors = Object.assign({}, DEFAULTS.colors);
    for (const src of sources) {
      if (!src) continue;
      for (const key of Object.keys(src)) {
        if (key === 'colors') Object.assign(out.colors, src.colors);
        else out[key] = src[key];
      }
    }
    return out;
  }

  class BossFight {
    constructor(scene, options) {
      this.scene = scene;
      this.cfg = merged(window.COIN_DASH && window.COIN_DASH.boss, options);
      this.player = options.player || scene.player;
      this.state = 'idle'; // idle -> warning -> active -> defeated
      this.paused = false;
      this.health = this.cfg.hitsToDefeat;
      this.boss = null;
      this.fireTimer = null;
      this.lastHitAt = -Infinity;
      this.timers = [];
      this.projectiles = scene.physics.add.group();
      this.buildHealthBar();
      this.buildAttackCoin();

      scene.physics.add.overlap(this.player, this.projectiles, (_player, projectile) => {
        projectile.destroy();
        this.hitPlayer('A boss projectile hit you!');
      });
      scene.physics.add.overlap(this.player, this.attackCoin, () => this.collectAttackCoin());

      this.onWorldBounds = (body) => {
        const go = body.gameObject;
        if (go && go.getData && go.getData('bossProjectile')) go.destroy();
      };
      scene.physics.world.on('worldbounds', this.onWorldBounds);
      scene.events.on('update', this.update, this);
      scene.events.once('shutdown', this.destroy, this);
      if (this.cfg.debugKey) {
        this.debugEvent = 'keydown-' + this.cfg.debugKey;
        scene.input.keyboard.on(this.debugEvent, this.spawn, this);
      }
    }

    // ---------- public API ----------
    spawn() {
      if (this.state !== 'idle' || this.scene.finished) return this;
      this.state = 'warning';
      this.showWarning(() => this.createBoss());
      return this;
    }

    pause() {
      if (this.paused) return this;
      this.paused = true;
      this.timers.forEach((t) => { t.paused = true; });
      if (this.fireTimer) this.fireTimer.paused = true;
      const freeze = (go) => {
        if (!go || !go.body) return;
        go.setData('savedVelocity', go.body.velocity.clone());
        go.body.setVelocity(0, 0);
      };
      freeze(this.boss);
      this.projectiles.getChildren().forEach(freeze);
      return this;
    }

    resume() {
      if (!this.paused) return this;
      this.paused = false;
      this.timers.forEach((t) => { t.paused = false; });
      if (this.fireTimer) this.fireTimer.paused = false;
      const thaw = (go) => {
        const v = go && go.getData && go.getData('savedVelocity');
        if (v && go.body) go.body.setVelocity(v.x, v.y);
      };
      thaw(this.boss);
      this.projectiles.getChildren().forEach(thaw);
      return this;
    }

    setDifficulty(multiplier) {
      this.cfg.difficulty = Number(multiplier) || 1;
      if (this.fireTimer) this.fireTimer.delay = this.fireDelay();
      return this;
    }

    isActive() { return this.state === 'active'; }
    isDefeated() { return this.state === 'defeated'; }

    // ---------- helpers ----------
    currentLevel() {
      const s = this.scene, cfg = this.cfg;
      if (typeof cfg.getLevel === 'function') return Number(cfg.getLevel(s)) || 0;
      if (typeof s.level === 'number') return s.level;
      return Math.floor((s.score || 0) / cfg.coinsPerLevel) + 1;
    }

    difficultyMultiplier() {
      const s = this.scene, cfg = this.cfg;
      let dynamic = 1;
      if (typeof cfg.getDifficulty === 'function') dynamic = Number(cfg.getDifficulty(s)) || 1;
      else if (typeof s.difficulty === 'number') dynamic = s.difficulty;
      return Math.max(0.1, cfg.difficulty * dynamic);
    }

    enraged() { return this.health <= this.cfg.enrageAt; }
    chaseSpeed() { return this.cfg.speed * this.difficultyMultiplier() * (this.enraged() ? 1.3 : 1); }
    fireDelay() { return this.cfg.fireIntervalMs / this.difficultyMultiplier() * (this.enraged() ? 0.8 : 1); }
    frozen() { return this.paused || this.scene.finished || this.scene.physics.world.isPaused; }

    delayed(ms, fn) {
      const t = this.scene.time.delayedCall(ms, () => {
        this.timers = this.timers.filter((x) => x !== t);
        fn();
      });
      this.timers.push(t);
      return t;
    }

    // ---------- per-frame ----------
    update() {
      if (this.frozen()) return;
      if (this.state === 'idle') {
        if (this.currentLevel() >= this.cfg.triggerLevel) this.spawn();
        return;
      }
      if (this.state !== 'active' || !this.boss) return;
      const boss = this.boss, player = this.player;
      this.scene.physics.moveToObject(boss, player, this.chaseSpeed());
      // Spin the rotors and make the eyes track the player.
      const angle = Phaser.Math.Angle.Between(boss.x, boss.y, player.x, player.y);
      this.rotors.forEach((r, i) => { r.rotation += (i % 2 ? -0.35 : 0.35); });
      this.pupils.forEach((p, i) => {
        p.x = this.eyeBase[i].x + Math.cos(angle) * 3;
        p.y = this.eyeBase[i].y + Math.sin(angle) * 3;
      });
      // Safety net: anything that slipped past the world-bounds event disappears here.
      const c = window.COIN_DASH;
      this.projectiles.getChildren().slice().forEach((p) => {
        if (p.x < -20 || p.x > c.width + 20 || p.y < HUD_HEIGHT - 20 || p.y > c.height + 20) p.destroy();
      });
    }

    // ---------- warning ----------
    showWarning(done) {
      const s = this.scene, c = window.COIN_DASH, cfg = this.cfg;
      const overlay = s.add.rectangle(c.width / 2, c.height / 2, c.width, c.height, 0xff2e4d, 0.12).setDepth(19);
      const text = s.add.text(c.width / 2, c.height / 2, 'WARNING: BOSS INCOMING!', {
        font: 'bold 38px monospace', color: '#ff3b3b', stroke: '#2a0000', strokeThickness: 8
      }).setOrigin(0.5).setDepth(20).setScale(0.6);
      s.tweens.add({ targets: text, scale: 1, duration: 350, ease: 'Back.Out' });
      s.tweens.add({ targets: text, alpha: { from: 1, to: 0.25 }, duration: 260, yoyo: true, repeat: -1 });
      s.tweens.add({ targets: overlay, alpha: { from: 0.12, to: 0 }, duration: 320, yoyo: true, repeat: -1 });
      s.cameras.main.shake(cfg.warningMs * 0.7, 0.004);
      this.delayed(cfg.warningMs, () => {
        s.tweens.killTweensOf([text, overlay]);
        text.destroy();
        overlay.destroy();
        if (s.finished) { this.state = 'idle'; return; }
        done();
      });
    }

    // ---------- boss ----------
    createBoss() {
      const s = this.scene, c = window.COIN_DASH, cfg = this.cfg, size = cfg.size, col = cfg.colors;
      const hull = s.add.rectangle(0, 0, size, size, col.hull).setStrokeStyle(3, col.hullStroke);
      const core = s.add.rectangle(0, 0, size * 0.55, size * 0.55, col.core);
      const grill = s.add.rectangle(0, size * 0.24, size * 0.5, 5, col.pupil, 0.85);
      this.rotors = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) =>
        s.add.rectangle(sx * size * 0.5, sy * size * 0.5, size * 0.45, 6, col.rotor, 0.9));
      const eyeOffset = size * 0.19, eyeY = -size * 0.08;
      this.eyeBase = [{ x: -eyeOffset, y: eyeY }, { x: eyeOffset, y: eyeY }];
      this.eyeGlows = this.eyeBase.map((e) => s.add.circle(e.x, e.y, size * 0.17, col.eyeGlow, 0.35));
      this.eyes = this.eyeBase.map((e) => s.add.circle(e.x, e.y, size * 0.1, col.eye));
      this.pupils = this.eyeBase.map((e) => s.add.circle(e.x, e.y, size * 0.045, col.pupil));
      this.hull = hull;

      const boss = s.add.container(c.width / 2, HUD_HEIGHT + size,
        [...this.rotors, hull, core, grill, ...this.eyeGlows, ...this.eyes, ...this.pupils]);
      boss.setSize(size, size).setDepth(5).setScale(0.1).setAlpha(0);
      s.physics.add.existing(boss);
      boss.body.setCircle(size / 2);
      boss.body.setCollideWorldBounds(true);
      this.boss = boss;

      s.tweens.add({ targets: boss, scale: 1, alpha: 1, duration: 600, ease: 'Back.Out' });
      this.glowTween = s.tweens.add({
        targets: this.eyeGlows, scale: { from: 1, to: 1.7 }, alpha: { from: 0.25, to: 0.65 },
        duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut'
      });
      s.cameras.main.flash(300, 255, 40, 60);

      this.health = cfg.hitsToDefeat;
      this.state = 'active';
      this.healthBar.setVisible(true);
      this.drawHealth();
      this.bossCollider = s.physics.add.overlap(this.player, boss, () => this.hitPlayer('The boss drone crushed you!'));
      this.fireTimer = s.time.addEvent({ delay: this.fireDelay(), loop: true, callback: this.fire, callbackScope: this });
      this.placeAttackCoin();
    }

    fire() {
      if (this.state !== 'active' || this.frozen() || !this.boss) return;
      const s = this.scene, boss = this.boss, player = this.player;
      const base = Phaser.Math.Angle.Between(boss.x, boss.y, player.x, player.y);
      const angles = this.enraged() ? [base - 0.32, base, base + 0.32] : [base];
      angles.forEach((a) => this.launchProjectile(a));
      this.fireTimer.delay = this.fireDelay();
      s.tweens.add({ targets: boss, scaleX: 1.12, scaleY: 0.9, duration: 90, yoyo: true });
    }

    launchProjectile(angle) {
      const s = this.scene, c = window.COIN_DASH, cfg = this.cfg, boss = this.boss, r = cfg.projectileRadius;
      const x = Phaser.Math.Clamp(boss.x + Math.cos(angle) * cfg.size * 0.6, r + 1, c.width - r - 1);
      const y = Phaser.Math.Clamp(boss.y + Math.sin(angle) * cfg.size * 0.6, HUD_HEIGHT + r + 1, c.height - r - 1);
      const p = s.add.circle(x, y, r, cfg.colors.projectile).setStrokeStyle(2, cfg.colors.projectileStroke).setDepth(4);
      p.setData('bossProjectile', true);
      this.projectiles.add(p);
      p.body.setCircle(r);
      p.body.setCollideWorldBounds(true, 0, 0, true); // last arg: emit 'worldbounds' so we can remove it
      const speed = cfg.projectileSpeed * this.difficultyMultiplier();
      p.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      s.tweens.add({ targets: p, alpha: { from: 1, to: 0.6 }, scale: { from: 1, to: 1.3 }, duration: 200, yoyo: true, repeat: -1 });
      p.once('destroy', () => s.tweens.killTweensOf(p));
    }

    hitPlayer(reason) {
      const s = this.scene;
      if (this.state !== 'active' || s.finished) return;
      if (s.time.now - this.lastHitAt < this.cfg.hitCooldownMs) return;
      this.lastHitAt = s.time.now;
      if (typeof this.cfg.onPlayerHit === 'function') this.cfg.onPlayerHit(s, reason);
      else if (typeof s.finish === 'function') s.finish(reason);
    }

    // ---------- attack coins ----------
    buildAttackCoin() {
      const s = this.scene, col = this.cfg.colors, r = 11;
      const halo = s.add.circle(0, 0, r * 1.7, col.attackCoin, 0.25);
      const disc = s.add.circle(0, 0, r, col.attackCoin).setStrokeStyle(2, 0xffffff, 0.9);
      const spark = s.add.star(0, 0, 4, 3, r * 0.62, col.attackCoinCore);
      const coin = s.add.container(-100, -100, [halo, disc, spark]).setSize(r * 2, r * 2).setDepth(3);
      s.physics.add.existing(coin);
      coin.body.setCircle(r);
      coin.body.enable = false;
      coin.setActive(false).setVisible(false);
      this.attackCoin = coin;
      s.tweens.add({ targets: halo, scale: { from: 0.8, to: 1.35 }, alpha: { from: 0.4, to: 0.1 }, duration: 600, yoyo: true, repeat: -1 });
      s.tweens.add({ targets: spark, angle: 360, duration: 1800, repeat: -1 });
    }

    placeAttackCoin() {
      if (this.state !== 'active') return;
      const c = window.COIN_DASH, coin = this.attackCoin;
      let x, y, tries = 0;
      do {
        x = Phaser.Math.Between(40, c.width - 40);
        y = Phaser.Math.Between(HUD_HEIGHT + 45, c.height - 40);
        tries++;
      } while (tries < 40 && (
        Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 90 ||
        (this.boss && Phaser.Math.Distance.Between(x, y, this.boss.x, this.boss.y) < 130)));
      coin.setPosition(x, y).setActive(true).setVisible(true).setScale(0);
      coin.body.reset(x, y);
      coin.body.enable = true;
      this.scene.tweens.add({ targets: coin, scale: 1, duration: 260, ease: 'Back.Out' });
    }

    hideAttackCoin() {
      const coin = this.attackCoin;
      coin.body.enable = false;
      coin.setActive(false).setVisible(false).setPosition(-100, -100);
      coin.body.reset(-100, -100);
    }

    collectAttackCoin() {
      if (this.state !== 'active' || !this.attackCoin.active || this.frozen()) return;
      this.hideAttackCoin();
      this.damageBoss(1);
    }

    damageBoss(amount) {
      const s = this.scene, cfg = this.cfg, boss = this.boss;
      if (this.state !== 'active' || !boss) return;
      this.health = Math.max(0, this.health - amount);
      this.drawHealth();
      this.hull.setFillStyle(0xffffff);
      this.delayed(90, () => { if (this.hull && this.hull.active) this.hull.setFillStyle(this.enraged() ? 0xff1f3d : cfg.colors.hull); });
      s.cameras.main.shake(120, 0.004);
      s.tweens.add({ targets: boss, scale: { from: 1.25, to: 1 }, duration: 220, ease: 'Quad.Out' });
      const pop = s.add.text(boss.x, boss.y - cfg.size * 0.8, 'HIT!', {
        font: 'bold 22px monospace', color: '#4da6ff', stroke: '#06203a', strokeThickness: 5
      }).setOrigin(0.5).setDepth(21);
      s.tweens.add({ targets: pop, y: pop.y - 36, alpha: 0, duration: 650, onComplete: () => pop.destroy() });
      if (this.enraged() && this.glowTween) {
        this.glowTween.timeScale = 2.2;
        this.eyes.forEach((e) => e.setFillStyle(cfg.colors.enragedEye));
        this.eyeGlows.forEach((e) => e.setFillStyle(cfg.colors.enragedEye, 0.4));
      }
      if (this.health <= 0) this.defeat();
      else this.delayed(cfg.attackCoinRespawnMs, () => this.placeAttackCoin());
    }

    // ---------- health bar ----------
    buildHealthBar() {
      const s = this.scene, c = window.COIN_DASH;
      const w = 260, h = 14;
      this.bar = { x: c.width - 16 - w, y: 22, w, h };
      const label = s.add.text(this.bar.x - 8, this.bar.y, 'BOSS', {
        font: 'bold 13px monospace', color: '#ff3b3b'
      }).setOrigin(1, 0.5);
      this.healthGfx = s.add.graphics();
      this.healthBar = s.add.container(0, 0, [label, this.healthGfx]).setDepth(15).setVisible(false);
    }

    drawHealth() {
      const g = this.healthGfx, { x, y, w, h } = this.bar, col = this.cfg.colors;
      const max = this.cfg.hitsToDefeat, frac = Phaser.Math.Clamp(this.health / max, 0, 1);
      g.clear();
      g.fillStyle(col.healthBg, 1).fillRoundedRect(x, y - h / 2, w, h, 4);
      if (frac > 0) g.fillStyle(col.health, 1).fillRoundedRect(x + 2, y - h / 2 + 2, (w - 4) * frac, h - 4, 3);
      for (let i = 1; i < max; i++) {
        const tx = x + (w * i) / max;
        g.lineStyle(1, 0x000000, 0.45).lineBetween(tx, y - h / 2, tx, y + h / 2);
      }
      g.lineStyle(2, col.healthStroke, 0.9).strokeRoundedRect(x, y - h / 2, w, h, 4);
    }

    // ---------- defeat ----------
    defeat() {
      const s = this.scene, c = window.COIN_DASH, cfg = this.cfg, boss = this.boss;
      this.state = 'defeated';
      if (this.fireTimer) { this.fireTimer.remove(false); this.fireTimer = null; }
      if (this.bossCollider) { this.bossCollider.destroy(); this.bossCollider = null; }
      if (this.glowTween) this.glowTween.stop();
      boss.body.setVelocity(0, 0);
      boss.body.enable = false;
      this.projectiles.clear(true, true);
      this.hideAttackCoin();

      // Shock rings, debris and the boss blowing apart.
      for (let i = 0; i < 3; i++) {
        const ring = s.add.circle(boss.x, boss.y, 12).setStrokeStyle(5, i % 2 ? 0xffd166 : 0xff3b3b).setDepth(6);
        s.tweens.add({ targets: ring, scale: 9 + i * 3, alpha: 0, delay: i * 140, duration: 750, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
      }
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2, d = 120 + Phaser.Math.Between(0, 90);
        const bit = s.add.rectangle(boss.x, boss.y, 10, 10, i % 3 ? cfg.colors.hull : 0xffd166).setDepth(6);
        s.tweens.add({ targets: bit, x: boss.x + Math.cos(a) * d, y: boss.y + Math.sin(a) * d, angle: 540, alpha: 0, duration: 800, ease: 'Cubic.Out', onComplete: () => bit.destroy() });
      }
      s.tweens.add({ targets: boss, x: { from: boss.x - 6, to: boss.x + 6 }, duration: 45, yoyo: true, repeat: 6 });
      s.tweens.add({ targets: boss, angle: 540, scale: 1.9, alpha: 0, delay: 350, duration: 800, ease: 'Cubic.In', onComplete: () => { boss.destroy(); this.boss = null; } });
      s.cameras.main.shake(500, 0.012);
      s.cameras.main.flash(450, 255, 230, 120);

      const title = s.add.text(c.width / 2, c.height / 2 - 28, 'BOSS DEFEATED!', {
        font: 'bold 46px monospace', color: '#ffd166', stroke: '#7a0f1f', strokeThickness: 10
      }).setOrigin(0.5).setDepth(20).setScale(0);
      const bonus = s.add.text(c.width / 2, c.height / 2 + 40, `+${cfg.bonusPoints} BONUS`, {
        font: 'bold 28px monospace', color: '#ffffff', stroke: '#06203a', strokeThickness: 6
      }).setOrigin(0.5).setDepth(20).setAlpha(0);
      s.tweens.add({ targets: title, scale: 1, delay: 300, duration: 550, ease: 'Back.Out' });
      s.tweens.add({ targets: title, scale: 1.06, delay: 900, duration: 300, yoyo: true, repeat: 3 });
      s.tweens.add({ targets: bonus, alpha: 1, y: c.height / 2 + 30, delay: 750, duration: 400 });

      if (typeof cfg.onDefeated === 'function') cfg.onDefeated(s, cfg.bonusPoints);
      else s.score = (s.score || 0) + cfg.bonusPoints;

      this.delayed(2600, () => {
        s.tweens.add({ targets: [title, bonus], alpha: 0, duration: 400, onComplete: () => { title.destroy(); bonus.destroy(); } });
        this.healthBar.setVisible(false);
        if (cfg.afterDefeat === 'victory' && typeof s.finish === 'function') s.finish('VICTORY! You defeated the boss!');
      });
    }

    // ---------- cleanup (scene restart / shutdown) ----------
    destroy() {
      const s = this.scene;
      // Phaser tears down plugins in registration order, so physics/keyboard may already be gone here.
      s.events.off('update', this.update, this);
      if (s.physics && s.physics.world) s.physics.world.off('worldbounds', this.onWorldBounds);
      if (this.debugEvent && s.input && s.input.keyboard) s.input.keyboard.off(this.debugEvent, this.spawn, this);
      this.timers.forEach((t) => t.remove(false));
      this.timers = [];
      if (this.fireTimer) { this.fireTimer.remove(false); this.fireTimer = null; }
      this.state = 'destroyed';
      if (api.current === this) api.current = null;
      if (s.bossFight === this) s.bossFight = null;
    }
  }

  const api = {
    DEFAULTS,
    current: null,
    // Wire the boss encounter into a running scene. Returns the BossFight controller.
    attach(scene, options) {
      const fight = new BossFight(scene, options || {});
      api.current = fight;
      scene.bossFight = fight;
      return fight;
    },
    // Force the boss to appear now (used by the debug key, tests, or a future level system).
    spawnBoss(scene) {
      const fight = (scene && scene.bossFight) || api.current;
      if (!fight) { console.warn('CoinDashBoss: no scene attached yet'); return null; }
      return fight.spawn();
    }
  };
  window.CoinDashBoss = api;
  window.spawnBoss = (scene) => api.spawnBoss(scene);
})();
