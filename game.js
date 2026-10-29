/* global Phaser, COIN_DASH */
class CoinDash extends Phaser.Scene {
  constructor() { super('CoinDash'); }

  create() {
    const c = COIN_DASH;
    this.score = 0;
    this.finished = false;
    // Level progression (levels.js). A fresh manager per round so R resets to level 1.
    this.levels = CoinDashLevels.setCurrent(new CoinDashLevels.LevelManager(c.levels));
    this.levels.on('levelchange', (e) => this.onLevelChange(e));
    this.difficulty = this.levels.difficulty;
    this.deadline = this.time.now + c.roundSeconds * 1000;
    this.physics.world.setBounds(0, 44, c.width, c.height - 44);
    this.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
      c.colors.background, 1, 0x24334b, 0.45);
    this.hud = this.add.text(18, 12, '', { font: '18px monospace', color: '#ffffff' });
    this.levelText = this.add.text(c.width / 2, 12, `LEVEL ${this.levels.level}`,
      { font: 'bold 18px monospace', color: '#ffd166' }).setOrigin(0.5, 0);
    this.player = this.add.rectangle(c.width / 2, c.height / 2, 24, 24, c.colors.player);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.coin = this.add.circle(100, 100, 9, c.colors.coin);
    this.physics.add.existing(this.coin);
    this.coin.body.setCircle(9);
    this.placeCoin();
    this.drones = this.physics.add.group();
    for (let i = 0; i < c.droneCount; i++) {
      this.spawnDrone(90 + i * 270, 100, (35 + i * 105) * Math.PI / 180);
    }
    this.physics.add.overlap(this.player, this.coin, () => {
      if (this.finished) return;
      this.score++;
      this.levels.recordCoin(); // counts coins, not score points (combos may multiply score)
      this.placeCoin();
    });
    this.physics.add.overlap(this.player, this.drones, () => this.finish('A drone caught you!'));
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,R');
    this.input.keyboard.on('keydown-R', () => this.scene.restart());
  }

  placeCoin() {
    const c = COIN_DASH;
    // Avoid spawning the next coin directly underneath the player.
    let x, y;
    do {
      x = Phaser.Math.Between(25, c.width - 25);
      y = Phaser.Math.Between(70, c.height - 25);
    } while (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 60);
    this.coin.setPosition(x, y);
    this.coin.body.reset(x, y);
    this.coinPlacedAt = this.time.now;
  }

  /** Current enemy speed for this level. */
  droneSpeed() {
    return COIN_DASH.droneSpeed * this.difficulty.droneSpeedMultiplier;
  }

  spawnDrone(x, y, angle, speed = this.droneSpeed()) {
    const drone = this.add.rectangle(x, y, 26, 26, COIN_DASH.colors.drone);
    this.drones.add(drone);
    drone.body.setCollideWorldBounds(true).setBounce(1, 1);
    drone.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    return drone;
  }

  /** A random point in the arena at least `minDistance` away from the player. */
  safeSpawnPoint(minDistance = 170) {
    const c = COIN_DASH;
    let x, y, tries = 0;
    do {
      x = Phaser.Math.Between(30, c.width - 30);
      y = Phaser.Math.Between(75, c.height - 30);
    } while (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < minDistance && ++tries < 50);
    return { x, y };
  }

  /** Called by the level manager every time the level advances. */
  onLevelChange({ level, previousLevel, difficulty }) {
    const c = COIN_DASH;
    this.difficulty = difficulty;
    this.levelText.setText(`LEVEL ${level}`);
    // Speed up existing enemies, keeping their direction.
    const speed = this.droneSpeed();
    this.drones.getChildren().forEach((d) => {
      if (d.body && d.body.velocity.length() > 0) d.body.velocity.setLength(speed);
    });
    // Add enemies, spawned away from the player so a level up is never an instant death.
    const target = Math.min(difficulty.maxDrones, c.droneCount + difficulty.extraDrones);
    while (this.drones.getLength() < target) {
      const { x, y } = this.safeSpawnPoint();
      this.spawnDrone(x, y, Phaser.Math.FloatBetween(0, Math.PI * 2), speed);
    }
    this.showLevelUp(level);
    // Scene-level event so other modules (enemies, arenas, boss...) can react:
    //   scene.events.on('levelchange', ({ level, difficulty }) => ...)
    this.events.emit('levelchange', { level, previousLevel, difficulty, scene: this });
  }

  showLevelUp(level) {
    const c = COIN_DASH;
    this.cameras.main.flash(220, 255, 209, 102);
    const label = this.add.text(c.width / 2, c.height / 2, `LEVEL UP!\nLevel ${level}`, {
      font: 'bold 52px monospace', color: '#ffd166', stroke: '#0a1120', strokeThickness: 8,
      align: 'center', lineSpacing: 6
    }).setOrigin(0.5).setScale(0.2).setAlpha(0).setDepth(10);
    this.tweens.add({ targets: label, scale: 1, alpha: 1, duration: 380, ease: 'Back.Out' });
    this.tweens.add({
      targets: label, alpha: 0, y: c.height / 2 - 70, delay: 950, duration: 550, ease: 'Quad.In',
      onComplete: () => label.destroy()
    });
  }

  update() {
    if (this.finished) return;
    const dx = Number(this.cursors.right.isDown || this.keys.D.isDown)
      - Number(this.cursors.left.isDown || this.keys.A.isDown);
    const dy = Number(this.cursors.down.isDown || this.keys.S.isDown)
      - Number(this.cursors.up.isDown || this.keys.W.isDown);
    const direction = new Phaser.Math.Vector2(dx, dy).normalize().scale(COIN_DASH.playerSpeed);
    this.player.body.setVelocity(direction.x, direction.y);
    // Higher levels: an uncollected coin relocates after a while.
    const lifetime = this.difficulty.coinLifetimeMs;
    if (lifetime && this.time.now - this.coinPlacedAt > lifetime) this.placeCoin();
    const seconds = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.hud.setText(`Coins: ${this.score}                       Time: ${seconds}s`);
    if (seconds === 0) this.finish('Time is up!');
  }

  finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    const c = COIN_DASH;
    this.add.rectangle(c.width / 2, c.height / 2, 460, 150, 0x0a1120, 0.95);
    this.add.text(c.width / 2, c.height / 2,
      `${reason}\n${this.score} coins collected · Level ${this.levels.level}\nPress R to try again`,
      { font: '24px monospace', color: '#ffffff', align: 'center', lineSpacing: 12 }
    ).setOrigin(0.5);
  }
}
window.coinDashGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: COIN_DASH.width,
  height: COIN_DASH.height,
  backgroundColor: COIN_DASH.colors.background,
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
  scene: CoinDash
});
