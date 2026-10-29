/* global Phaser, COIN_DASH, COIN_DASH_DIFFICULTY */
// Difficulty selection UI for Coin Dash.
//
// Two ways to use it:
//
// 1. Standalone scene (default wiring in game.js):
//      this.scene.start('DifficultySelect', { next: 'CoinDash' });
//    `next` is the scene started after the player confirms (defaults to 'CoinDash').
//
// 2. Embedded in another menu (e.g. a start screen made by someone else):
//      const picker = attachDifficultyPicker(this, { y: 300, onConfirm: (mode) => this.scene.start('CoinDash') });
//      // later: picker.getSelected(), picker.select('HARD'), picker.destroy()
//    The picker draws three cards into the calling scene, handles mouse/touch and keyboard,
//    persists the choice through COIN_DASH_DIFFICULTY and never starts a scene by itself.

(function (global) {
  'use strict';

  const CARD_W = 200;
  const CARD_H = 150;
  const CARD_GAP = 28;
  const BASE_PREVIEW_SPEED = 120; // px/s for the little drone in each card (NORMAL mode)

  function hexCss(color) {
    return '#' + color.toString(16).padStart(6, '0');
  }

  function attachDifficultyPicker(scene, options) {
    const opts = options || {};
    const c = global.COIN_DASH;
    const D = global.COIN_DASH_DIFFICULTY;
    const modes = D.list();
    const x = opts.x === undefined ? c.width / 2 : opts.x;
    const y = opts.y === undefined ? c.height / 2 : opts.y;
    const keyboard = opts.keyboard !== false;
    const container = scene.add.container(x, y);
    const cards = [];
    let selectedKey = D.getCurrentKey();
    let destroyed = false;

    const totalW = modes.length * CARD_W + (modes.length - 1) * CARD_GAP;

    if (opts.title !== null) {
      container.add(scene.add.text(0, -CARD_H / 2 - 48, opts.title || 'CHOOSE YOUR DIFFICULTY', {
        font: 'bold 20px monospace', color: '#e5edf7', letterSpacing: 4
      }).setOrigin(0.5));
    }

    modes.forEach((mode, i) => {
      const cx = -totalW / 2 + CARD_W / 2 + i * (CARD_W + CARD_GAP);
      const card = scene.add.container(cx, 0);
      const bg = scene.add.graphics();
      const label = scene.add.text(0, -CARD_H / 2 + 34, mode.label.toUpperCase(), {
        font: 'bold 26px monospace', color: hexCss(mode.color)
      }).setOrigin(0.5);
      const tagline = scene.add.text(0, -CARD_H / 2 + 68, mode.tagline, {
        font: '13px monospace', color: '#b8c4d6', align: 'center', wordWrap: { width: CARD_W - 12 }
      }).setOrigin(0.5, 0);
      const pct = Math.round(mode.enemySpeedMultiplier * 100);
      const stat = scene.add.text(0, CARD_H / 2 - 44, `drone speed ${pct}%`, {
        font: '12px monospace', color: '#7f8ea6'
      }).setOrigin(0.5);
      // Mini preview lane: a drone bouncing left/right at that mode's relative speed.
      const laneY = CARD_H / 2 - 20;
      const lane = scene.add.rectangle(0, laneY, CARD_W - 40, 2, 0x34445e).setOrigin(0.5);
      const drone = scene.add.rectangle(-(CARD_W - 40) / 2, laneY, 10, 10, c.colors.drone);
      const hit = scene.add.zone(0, 0, CARD_W, CARD_H).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const hotkey = scene.add.text(CARD_W / 2 - 12, -CARD_H / 2 + 10, String(i + 1), {
        font: '11px monospace', color: '#55657f'
      }).setOrigin(1, 0);
      card.add([bg, label, tagline, stat, lane, drone, hotkey, hit]);
      container.add(card);
      const entry = {
        mode, card, bg, hit, drone, dir: 1,
        speed: BASE_PREVIEW_SPEED * mode.enemySpeedMultiplier,
        hover: false
      };
      cards.push(entry);

      hit.on('pointerover', () => { entry.hover = true; draw(); });
      hit.on('pointerout', () => { entry.hover = false; draw(); });
      hit.on('pointerdown', () => { select(mode.key); confirm(); });
    });

    const hint = scene.add.text(0, CARD_H / 2 + 34, '', {
      font: '14px monospace', color: '#7f8ea6', align: 'center'
    }).setOrigin(0.5);
    container.add(hint);

    function draw() {
      cards.forEach((e) => {
        const selected = e.mode.key === selectedKey;
        const g = e.bg;
        g.clear();
        if (selected) {
          g.fillStyle(e.mode.color, 0.10);
        } else {
          g.fillStyle(0x0a1120, e.hover ? 0.95 : 0.8);
        }
        g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 14);
        g.lineStyle(selected ? 3 : 1.5, selected ? e.mode.color : (e.hover ? 0x5f7294 : 0x34445e), 1);
        g.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 14);
        if (selected) {
          g.lineStyle(1, e.mode.color, 0.35);
          g.strokeRoundedRect(-CARD_W / 2 - 5, -CARD_H / 2 - 5, CARD_W + 10, CARD_H + 10, 18);
        }
        if (e.tween) { e.tween.stop(); e.tween = null; }
        if (selected) {
          e.tween = scene.tweens.add({ targets: e.card, scale: 1.05, duration: 160, ease: 'Quad.easeOut' });
        } else {
          e.tween = scene.tweens.add({ targets: e.card, scale: 1, duration: 160, ease: 'Quad.easeOut' });
        }
      });
      const sel = D.get(selectedKey);
      hint.setText(`${sel.label}: ${sel.tagline}\n` +
        (keyboard ? '← → or A/D to choose · ENTER or SPACE to start · click a card' : 'click a card'));
    }

    function select(key) {
      if (destroyed) return;
      const k = D.isValid(key) ? key.toUpperCase() : selectedKey;
      selectedKey = k;
      D.setCurrent(k); // persist immediately so a reload remembers it
      draw();
      if (opts.onSelect) opts.onSelect(D.get(k));
    }

    function confirm() {
      if (destroyed) return;
      D.setCurrent(selectedKey);
      if (opts.onConfirm) opts.onConfirm(D.get(selectedKey));
    }

    // Keyboard handling (optional so a host menu can own the keyboard).
    const keyHandlers = [];
    function onKey(name, fn) {
      scene.input.keyboard.on(name, fn);
      keyHandlers.push([name, fn]);
    }
    if (keyboard) {
      const prev = () => select(D.next(selectedKey, -1));
      const nxt = () => select(D.next(selectedKey, 1));
      onKey('keydown-LEFT', prev); onKey('keydown-A', prev);
      onKey('keydown-RIGHT', nxt); onKey('keydown-D', nxt);
      onKey('keydown-ENTER', confirm); onKey('keydown-SPACE', confirm);
      onKey('keydown-ONE', () => select('EASY'));
      onKey('keydown-TWO', () => select('NORMAL'));
      onKey('keydown-THREE', () => select('HARD'));
    }

    // Preview animation.
    const update = (_time, delta) => {
      const half = (CARD_W - 40) / 2 - 5;
      cards.forEach((e) => {
        e.drone.x += e.dir * e.speed * delta / 1000;
        if (e.drone.x > half) { e.drone.x = half; e.dir = -1; }
        if (e.drone.x < -half) { e.drone.x = -half; e.dir = 1; }
      });
    };
    scene.events.on('update', update);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      scene.events.off('update', update);
      keyHandlers.forEach(([name, fn]) => scene.input.keyboard.off(name, fn));
      cards.forEach((e) => { if (e.tween) e.tween.stop(); });
      container.destroy(true);
    }
    scene.events.once('shutdown', destroy);
    scene.events.once('destroy', destroy);

    draw();
    return {
      container,
      select,
      confirm,
      getSelected: () => D.get(selectedKey),
      destroy
    };
  }

  class DifficultySelect extends Phaser.Scene {
    constructor() { super('DifficultySelect'); }

    init(data) {
      this.nextScene = (data && data.next) || 'CoinDash';
      this.nextData = (data && data.nextData) || {};
    }

    create() {
      const c = global.COIN_DASH;
      this.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
        c.colors.background, 1, 0x24334b, 0.45);
      this.add.text(c.width / 2, 72, 'COIN DASH', {
        font: 'bold 44px monospace', color: '#ffffff'
      }).setOrigin(0.5);
      this.add.text(c.width / 2, 112, 'Collect coins. Dodge drones. Pick how fast they chase you.', {
        font: '15px monospace', color: '#b8c4d6'
      }).setOrigin(0.5);

      this.picker = attachDifficultyPicker(this, {
        y: 300,
        onConfirm: (mode) => {
          this.cameras.main.fadeOut(180, 10, 17, 32);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start(this.nextScene, Object.assign({ difficulty: mode.key }, this.nextData));
          });
        }
      });
      this.cameras.main.fadeIn(200, 10, 17, 32);
    }
  }

  global.attachDifficultyPicker = attachDifficultyPicker;
  global.DifficultySelect = DifficultySelect;
})(window);
