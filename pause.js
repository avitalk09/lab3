/* global Phaser */
// Pause/resume for a scene. It freezes scene-wide systems (arcade physics world, scene clock,
// tweens) rather than individual objects, so future enemies, levels and power-ups that use
// those systems pause automatically. Emits 'pause' and 'resume' (with the paused duration in ms)
// so the scene can adjust anything driven by wall-clock time, such as a round deadline.
class PauseController extends Phaser.Events.EventEmitter {
  constructor(scene, { keys = ['P', 'SPACE'], canPause = () => true } = {}) {
    super();
    this.scene = scene;
    this.keys = keys;
    this.canPause = canPause;
    this.paused = false;
    this.pausedAt = 0;
    scene.input.keyboard.addCapture(keys); // stop SPACE from scrolling the page
    keys.forEach(key => scene.input.keyboard.on(`keydown-${key}`, this.onKey, this));
    this.buildOverlay();
    this.buildButton();
    this.buildIndicator();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  onKey(event) {
    // Holding the key fires repeated keydown events; only a fresh press toggles.
    if (event.repeat) return;
    this.toggle();
  }

  toggle() {
    if (this.paused) this.resume();
    else this.pause();
  }

  pause() {
    if (this.paused || !this.canPause()) return;
    const scene = this.scene;
    this.paused = true;
    this.pausedAt = scene.time.now;
    scene.physics.pause();
    scene.time.paused = true;
    scene.tweens.pauseAll();
    this.overlay.setVisible(true);
    this.indicator.setVisible(true);
    this.setButtonIcon();
    this.emit('pause');
  }

  resume() {
    if (!this.paused) return;
    const scene = this.scene;
    this.paused = false;
    scene.physics.resume();
    scene.time.paused = false;
    scene.tweens.resumeAll();
    this.overlay.setVisible(false);
    this.indicator.setVisible(false);
    this.setButtonIcon();
    this.emit('resume', scene.time.now - this.pausedAt);
  }

  buildOverlay() {
    const { width, height } = this.scene.scale;
    const dim = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55);
    const panel = this.scene.add.rectangle(width / 2, height / 2, 420, 140, 0x0a1120, 0.95)
      .setStrokeStyle(2, 0x71e8ce);
    const title = this.scene.add.text(width / 2, height / 2 - 20, 'GAME PAUSED',
      { font: 'bold 36px monospace', color: '#ffffff' }).setOrigin(0.5);
    const hint = this.scene.add.text(width / 2, height / 2 + 28, 'Press P or SPACE to resume',
      { font: '18px monospace', color: '#9fb3d1' }).setOrigin(0.5);
    this.overlay = this.scene.add.container(0, 0, [dim, panel, title, hint])
      .setDepth(1000).setScrollFactor(0).setVisible(false);
  }

  // Clickable HUD button in the top-right corner: shows pause bars while playing, a play arrow while paused.
  buildButton() {
    const x = this.scene.scale.width - 34;
    const y = 22;
    const bg = this.scene.add.rectangle(x, y, 32, 26, 0x24334b).setStrokeStyle(1, 0x71e8ce);
    this.pauseIcon = this.scene.add.container(0, 0, [
      this.scene.add.rectangle(x - 4, y, 4, 12, 0xffffff),
      this.scene.add.rectangle(x + 4, y, 4, 12, 0xffffff)
    ]);
    this.playIcon = this.scene.add.triangle(x + 1, y, 0, 0, 0, 12, 10, 6, 0xffffff).setVisible(false);
    bg.setInteractive({ useHandCursor: true })
      .on('pointerover', () => bg.setFillStyle(0x34486a))
      .on('pointerout', () => bg.setFillStyle(0x24334b))
      .on('pointerdown', () => this.toggle());
    this.button = this.scene.add.container(0, 0, [bg, this.pauseIcon, this.playIcon])
      .setDepth(1002).setScrollFactor(0);
  }

  setButtonIcon() {
    this.pauseIcon.setVisible(!this.paused);
    this.playIcon.setVisible(this.paused);
  }

  buildIndicator() {
    const x = this.scene.scale.width - 62;
    const label = this.scene.add.text(x, 13, 'PAUSED', { font: '16px monospace', color: '#ffd166' })
      .setOrigin(1, 0);
    const barX = x - label.width - 16;
    const bars = [0, 7].map(offset => this.scene.add.rectangle(barX + offset, 22, 4, 14, 0xffd166));
    this.indicator = this.scene.add.container(0, 0, [...bars, label])
      .setDepth(1001).setScrollFactor(0).setVisible(false);
  }

  shutdown() {
    // The scene clock and tween manager survive a scene restart, so never leave them paused.
    this.scene.time.paused = false;
    this.scene.tweens.resumeAll();
    this.keys.forEach(key => this.scene.input.keyboard.off(`keydown-${key}`, this.onKey, this));
    this.removeAllListeners();
    this.paused = false;
  }
}
window.PauseController = PauseController;
