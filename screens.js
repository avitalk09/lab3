/* global Phaser, COIN_DASH, COIN_DASH_DIFFICULTY */
// Start menu and game-over screens. Kept separate from game.js so gameplay stays untouched.
const NEON = {
  cyan: '#71e8ce', yellow: '#ffd166', pink: '#ff657a', violet: '#b388ff', white: '#f4f8ff',
  font: '"Courier New", Courier, monospace'
};
const BEST_KEY = 'coinDash.best';

function readBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
}
function writeBest(score) {
  try { localStorage.setItem(BEST_KEY, String(score)); } catch (e) { /* storage unavailable */ }
}

function hex(color) { return Phaser.Display.Color.HexStringToColor(color).color; }

function neonText(scene, x, y, text, size, color, extra = {}) {
  return scene.add.text(x, y, text, {
    fontFamily: NEON.font, fontSize: `${size}px`, fontStyle: 'bold', color, align: 'center', ...extra
  }).setOrigin(0.5).setShadow(0, 0, color, 14, true, true);
}

// Scrolling grid, drifting sparks and scanlines shared by both screens.
function drawBackdrop(scene) {
  const c = COIN_DASH;
  scene.cameras.main.setBackgroundColor(c.colors.background);
  const grid = scene.add.grid(c.width / 2, c.height / 2 + 20, c.width + 80, c.height + 80, 40, 40,
    c.colors.background, 1, 0x2a3d5c, 0.5);
  scene.tweens.add({ targets: grid, y: grid.y - 40, duration: 2400, repeat: -1 });
  for (let i = 0; i < 18; i++) {
    const color = [c.colors.coin, c.colors.player, c.colors.drone][i % 3];
    const spark = scene.add.circle(Phaser.Math.Between(0, c.width), Phaser.Math.Between(0, c.height),
      Phaser.Math.Between(1, 3), color, 0.6);
    scene.tweens.add({
      targets: spark, y: spark.y - c.height - 20, alpha: 0, duration: Phaser.Math.Between(5000, 11000),
      repeat: -1, delay: Phaser.Math.Between(0, 4000),
      onRepeat: () => spark.setPosition(Phaser.Math.Between(0, c.width), c.height + 10).setAlpha(0.6)
    });
  }
  const lines = scene.add.graphics().setDepth(100);
  lines.fillStyle(0x000000, 0.12);
  for (let y = 0; y < c.height; y += 4) lines.fillRect(0, y, c.width, 2);
}

// A glowing rounded button; returns the container so callers can position or tween it.
function neonButton(scene, x, y, label, color, onClick, w = 240, h = 64) {
  const tint = hex(color);
  const g = scene.add.graphics();
  const draw = hover => {
    g.clear();
    for (let i = 4; i >= 1; i--) {
      g.lineStyle(i * 4, tint, (hover ? 0.12 : 0.07) * (5 - i));
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
    }
    g.fillStyle(tint, hover ? 0.32 : 0.16).fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    g.lineStyle(3, tint, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
  };
  draw(false);
  const text = neonText(scene, 0, 0, label, Math.round(h * 0.45), NEON.white).setShadow(0, 0, color, 12, true, true);
  const button = scene.add.container(x, y, [g, text]);
  const pulse = scene.tweens.add({ targets: button, scale: 1.05, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  const zone = scene.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
  zone.on('pointerover', () => { draw(true); pulse.pause(); button.setScale(1.08); });
  zone.on('pointerout', () => { draw(false); button.setScale(1); pulse.resume(); });
  zone.on('pointerdown', () => button.setScale(0.96));
  zone.on('pointerup', () => { zone.disableInteractive(); onClick(); });
  button.zone = zone;
  return button;
}

// `target` defaults to the game; the menu passes 'DifficultySelect' so players pick a mode first.
function startRound(scene, target = 'CoinDash') {
  scene.cameras.main.fadeOut(220, 10, 17, 32);
  scene.cameras.main.once('camerafadeoutcomplete', () => scene.scene.start(target, { next: 'CoinDash' }));
}

class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    const c = COIN_DASH;
    const cx = c.width / 2;
    drawBackdrop(this);
    this.cameras.main.fadeIn(300, 10, 17, 32);

    // Title: each letter drops in, then bobs and cycles through neon colours.
    const title = 'COIN DASH';
    const palette = [NEON.yellow, NEON.cyan, NEON.pink, NEON.violet];
    const spacing = 58;
    [...title].forEach((ch, i) => {
      if (ch === ' ') return;
      const x = cx + (i - (title.length - 1) / 2) * spacing;
      const color = palette[i % palette.length];
      const letter = neonText(this, x, -60, ch, 84, color, { stroke: '#ffffff', strokeThickness: 2 });
      this.tweens.add({
        targets: letter, y: 92, duration: 700, delay: 80 * i, ease: 'Bounce.easeOut',
        onComplete: () => this.tweens.add({
          targets: letter, y: 82, duration: 900, delay: 70 * i, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        })
      });
      let step = i;
      this.time.addEvent({
        delay: 650, loop: true, callback: () => {
          const next = palette[++step % palette.length];
          letter.setColor(next).setShadow(0, 0, next, 18, true, true);
        }
      });
    });
    neonText(this, cx, 150, 'GRAB THE GOLD  ·  DODGE THE DRONES', 16, NEON.cyan).setAlpha(0.85);

    // Decorative coin and drone flanking the play button.
    const coin = this.add.circle(cx - 190, 215, 14, c.colors.coin);
    this.tweens.add({ targets: coin, scaleX: 0.15, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const drone = this.add.rectangle(cx + 190, 215, 28, 28, c.colors.drone);
    this.tweens.add({ targets: drone, angle: 360, duration: 3000, repeat: -1 });
    this.tweens.add({ targets: drone, y: 205, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    neonButton(this, cx, 215, '▶ PLAY', NEON.yellow, () => startRound(this, 'DifficultySelect'), 260, 70);

    this.drawHowToPlay(cx, 380);
  }

  drawHowToPlay(cx, cy) {
    const c = COIN_DASH;
    const w = 560, h = 190;
    const panel = this.add.graphics();
    panel.fillStyle(0x0a1120, 0.82).fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 16);
    panel.lineStyle(2, hex(NEON.cyan), 0.7).strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 16);
    neonText(this, cx, cy - h / 2 + 24, 'HOW TO PLAY', 20, NEON.cyan);

    const left = cx - w / 2 + 40;
    const rows = [cy - 22, cy + 22, cy + 66];
    // Row 1: key caps.
    ['W', 'A', 'S', 'D'].forEach((k, i) => this.keyCap(left + i * 26, rows[0], k));
    this.add.text(left + 108, rows[0], '/', { fontFamily: NEON.font, fontSize: '18px', color: '#8fa3c0' }).setOrigin(0.5);
    ['←', '↑', '↓', '→'].forEach((k, i) => this.keyCap(left + 130 + i * 26, rows[0], k));
    this.rowText(left + 250, rows[0], 'Move your ship', NEON.white);
    // Row 2: coin.
    this.add.circle(left + 10, rows[1], 9, c.colors.coin);
    this.rowText(left + 40, rows[1], 'Collect yellow coins to score points', NEON.yellow);
    // Row 3: drone.
    this.add.rectangle(left + 10, rows[2], 22, 22, c.colors.drone);
    this.rowText(left + 40, rows[2], `Avoid red drones · survive ${c.roundSeconds}s`, NEON.pink);
  }

  keyCap(x, y, label) {
    const g = this.add.graphics();
    g.fillStyle(0x1b2a44, 1).fillRoundedRect(x - 11, y - 12, 22, 24, 5);
    g.lineStyle(1.5, hex(NEON.cyan), 0.9).strokeRoundedRect(x - 11, y - 12, 22, 24, 5);
    this.add.text(x, y, label, { fontFamily: NEON.font, fontSize: '14px', fontStyle: 'bold', color: NEON.white }).setOrigin(0.5);
  }

  rowText(x, y, text, color) {
    this.add.text(x, y, text, { fontFamily: NEON.font, fontSize: '17px', fontStyle: 'bold', color })
      .setOrigin(0, 0.5).setShadow(0, 0, color, 6, true, true);
  }
}

class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  init(data) {
    this.finalScore = data.score || 0;
    this.reason = data.reason || '';
    this.difficulty = data.difficulty || COIN_DASH_DIFFICULTY.getCurrentKey();
    this.level = data.level || 0; // level reached (levels.js), if the game scene passed it
    this.previousBest = readBest();
    this.isBest = this.finalScore > this.previousBest;
    if (this.isBest) writeBest(this.finalScore);
  }

  create() {
    const c = COIN_DASH;
    const cx = c.width / 2;
    drawBackdrop(this);
    this.cameras.main.fadeIn(300, 10, 17, 32);

    const panel = this.add.graphics();
    panel.fillStyle(0x0a1120, 0.85).fillRoundedRect(cx - 270, 40, 540, 420, 20);
    panel.lineStyle(2, hex(NEON.pink), 0.8).strokeRoundedRect(cx - 270, 40, 540, 420, 20);

    const heading = neonText(this, cx, 100, 'GAME OVER', 64, NEON.pink, { stroke: '#ffffff', strokeThickness: 2 })
      .setScale(0.2).setAlpha(0);
    this.tweens.add({ targets: heading, scale: 1, alpha: 1, duration: 500, ease: 'Back.easeOut' });
    this.time.addEvent({ delay: 1400, loop: true, callback: () => {
      this.tweens.add({ targets: heading, alpha: 0.35, duration: 70, yoyo: true, repeat: 1 });
    } });

    neonText(this, cx, 152, this.reason.toUpperCase(), 18, NEON.white).setAlpha(0.8);
    const mode = COIN_DASH_DIFFICULTY.get(this.difficulty);
    const levelTag = this.level ? ` \u00b7 LEVEL ${this.level}` : '';
    neonText(this, cx, 176, `DIFFICULTY: ${mode.label.toUpperCase()}${levelTag}`, 14, mode.colorCss).setAlpha(0.9);
    neonText(this, cx, 200, 'FINAL SCORE', 18, NEON.cyan);

    // Count the score up for a bit of arcade drama.
    const scoreText = neonText(this, cx, 255, '0', 72, NEON.yellow);
    const counter = { value: 0 };
    this.tweens.add({
      targets: counter, value: this.finalScore, duration: Math.min(1200, 150 + this.finalScore * 60),
      ease: 'Cubic.easeOut', onUpdate: () => scoreText.setText(String(Math.round(counter.value)))
    });
    neonText(this, cx, 300, this.finalScore === 1 ? 'COIN' : 'COINS', 16, NEON.yellow).setAlpha(0.8);

    if (this.isBest && this.finalScore > 0) {
      const badge = neonText(this, cx, 338, '★ NEW BEST! ★', 22, NEON.violet);
      this.tweens.add({ targets: badge, scale: 1.12, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    } else {
      neonText(this, cx, 338, `BEST: ${Math.max(this.previousBest, this.finalScore)}`, 18, NEON.violet);
    }

    neonButton(this, cx - 95, 400, '↻ PLAY AGAIN', NEON.yellow, () => startRound(this), 230, 56);
    neonButton(this, cx + 140, 400, 'MENU', NEON.cyan, () => {
      this.cameras.main.fadeOut(200, 10, 17, 32);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Menu'));
    }, 130, 56);
  }
}

window.COIN_DASH_SCREENS = { MenuScene, GameOverScene };
