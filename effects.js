/* global Phaser */
// Purely visual effects for Coin Dash. Nothing here touches score, physics bodies or input,
// so the scene works the same with or without this module.
class CoinDashEffects {
  constructor(scene) {
    this.scene = scene;
    this.player = null;
    this.makeTextures();

    // Created before the player so the trail renders underneath it.
    this.trail = scene.add.particles(0, 0, 'fx-dot', {
      lifespan: 320,
      frequency: 28,
      quantity: 1,
      speed: { min: 0, max: 12 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.45, end: 0 },
      tint: 0x71e8ce,
      blendMode: 'ADD',
      emitting: false
    });

    // Reusable burst emitters; explode() recycles particles, so nothing piles up.
    this.goldBurst = scene.add.particles(0, 0, 'fx-dot', {
      lifespan: { min: 350, max: 650 },
      speed: { min: 60, max: 210 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffd166, 0xffe9a8, 0xffb627, 0xffffff],
      gravityY: 140,
      blendMode: 'ADD',
      emitting: false
    }).setDepth(20);

    this.redBurst = scene.add.particles(0, 0, 'fx-dot', {
      lifespan: { min: 400, max: 800 },
      speed: { min: 80, max: 280 },
      scale: { start: 1.1, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xff657a, 0xff2d4b, 0xffa0ad],
      blendMode: 'ADD',
      emitting: false
    }).setDepth(20);
  }

  makeTextures() {
    const textures = this.scene.textures;
    if (!textures.exists('fx-dot')) {
      // Soft round dot: stacked translucent circles fake a radial glow.
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
      for (let r = 8; r > 0; r--) {
        g.fillStyle(0xffffff, 0.12 + (8 - r) * 0.1);
        g.fillCircle(8, 8, r);
      }
      g.generateTexture('fx-dot', 16, 16);
      g.destroy();
    }
    if (!textures.exists('fx-star')) {
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillPoints([
        { x: 8, y: 0 }, { x: 10, y: 6 }, { x: 16, y: 8 }, { x: 10, y: 10 },
        { x: 8, y: 16 }, { x: 6, y: 10 }, { x: 0, y: 8 }, { x: 6, y: 6 }
      ], true);
      g.generateTexture('fx-star', 16, 16);
      g.destroy();
    }
  }

  attachPlayer(player) {
    this.player = player;
    this.trail.startFollow(player);
  }

  // Call once per frame; the trail only emits while the player is actually moving.
  update() {
    const body = this.player && this.player.body;
    this.trail.emitting = Boolean(body && body.enable && body.velocity.lengthSq() > 1);
  }

  coinCollected(x, y, color) {
    const scene = this.scene;
    this.goldBurst.explode(22, x, y);

    // The real coin is immediately moved elsewhere, so a short-lived ghost sparkles in its place.
    const ghost = scene.add.circle(x, y, 9, color).setDepth(19);
    scene.tweens.add({
      targets: ghost, scale: 2.2, alpha: 0, duration: 260, ease: 'Quad.easeOut',
      onComplete: () => ghost.destroy()
    });
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + i * Math.PI / 2;
      const star = scene.add.image(x, y, 'fx-star')
        .setDepth(21).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff3c4).setScale(0.2);
      scene.tweens.add({
        targets: star,
        x: x + Math.cos(angle) * 18,
        y: y + Math.sin(angle) * 18,
        scale: { from: 0.2, to: 1 },
        angle: 90,
        alpha: { from: 1, to: 0 },
        duration: 340,
        delay: i * 30,
        ease: 'Sine.easeOut',
        onComplete: () => star.destroy()
      });
    }
    this.flash(90, 255, 220, 120, 0.18);
  }

  playerHit(x, y) {
    this.redBurst.explode(36, x, y);
    this.trail.emitting = false;
    this.flash(220, 255, 60, 80, 0.55);
    this.scene.cameras.main.shake(180, 0.008);
  }

  roundOver() {
    this.trail.emitting = false;
    this.flash(260, 255, 255, 255, 0.3);
  }

  // Full-screen overlay fade: unlike camera.flash it supports partial strength.
  flash(duration, r, g, b, strength) {
    const scene = this.scene;
    const { width, height } = scene.scale;
    const overlay = scene.add.rectangle(width / 2, height / 2, width, height,
      Phaser.Display.Color.GetColor(r, g, b), strength).setDepth(30).setScrollFactor(0);
    scene.tweens.add({
      targets: overlay, alpha: 0, duration, ease: 'Quad.easeOut',
      onComplete: () => overlay.destroy()
    });
  }
}
window.CoinDashEffects = CoinDashEffects;
