/* global Phaser, COIN_DASH, COIN_DASH_DIFFICULTY, COIN_DASH_SCREENS, DifficultySelect,
   PauseController, CoinDashEffects, CoinDashCombo */
const sfx = () => window.CoinDashSound || {};
class CoinDash extends Phaser.Scene {
  constructor() { super('CoinDash'); }

  init(data) {
    // A caller may pass { difficulty: 'HARD' }; otherwise use the saved/current mode.
    if (data && data.difficulty) COIN_DASH_DIFFICULTY.setCurrent(data.difficulty);
    this.difficulty = COIN_DASH_DIFFICULTY.getCurrent();
  }

  create() {
    const c = COIN_DASH;
    this.score = 0; // total points, including combo multipliers
    this.coins = 0;
    this.combo = new CoinDashCombo.ComboTracker(c.combo);
    this.finished = false;
    // Level progression (levels.js). A fresh manager per round so R resets to level 1.
    this.levels = CoinDashLevels.setCurrent(new CoinDashLevels.LevelManager(c.levels));
    this.levels.on('levelchange', (e) => this.onLevelChange(e));
    this.levelDifficulty = this.levels.difficulty;
    // The scene clock is stale until its first update, so read the live game loop time.
    this.deadline = this.game.loop.time + c.roundSeconds * 1000;
    sfx().start?.();
    this.physics.world.setBounds(0, 44, c.width, c.height - 44);
    this.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
      c.colors.background, 1, 0x24334b, 0.45);
    this.effects = new CoinDashEffects(this);
    this.hud = this.add.text(18, 12, '', { font: '18px monospace', color: '#ffffff' });
    this.createComboHud();
    // Difficulty badge sits left of the pause button (top-right); hidden while the PAUSED label is shown there.
    this.difficultyHud = this.add.text(c.width - 62, 12, this.difficulty.label.toUpperCase(),
      { font: 'bold 18px monospace', color: this.difficulty.colorCss }).setOrigin(1, 0).setDepth(10);
    // Level HUD, bottom-left (top-right holds the pause button and difficulty badge, bottom-right the combo):
    // "LEVEL 2 · 7/10" + progress bar towards the next level.
    this.levelText = this.add.text(18, c.height - 16, '',
      { font: 'bold 18px monospace', color: '#ffd166', stroke: '#0a1120', strokeThickness: 4 })
      .setOrigin(0, 1).setDepth(10);
    this.levelBarBg = this.add.rectangle(18, c.height - 9, 180, 4, 0x34445e).setOrigin(0, 0.5).setDepth(10);
    this.levelBar = this.add.rectangle(18, c.height - 9, 0, 4, 0xffd166).setOrigin(0, 0.5).setDepth(10);
    this.refreshLevelHud();
    this.player = this.add.rectangle(c.width / 2, c.height / 2, 24, 24, c.colors.player);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.effects.attachPlayer(this.player);
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
      this.collectCoin();
      this.levels.recordCoin(); // counts coins, not score points (combos multiply score)
      this.refreshLevelHud();
      this.effects.coinCollected(this.coin.x, this.coin.y, c.colors.coin);
      if (this.coins % 10 === 0) sfx().milestone?.(); else sfx().coin?.();
      this.placeCoin();
    });
    this.physics.add.overlap(this.player, this.drones, () => {
      if (!this.finished) {
        this.effects.playerHit(this.player.x, this.player.y);
        sfx().hit?.();
      }
      this.finish('A drone caught you!');
    });
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,R');
    this.input.keyboard.on('keydown-R', () => this.scene.restart());
    this.input.keyboard.on('keydown-ESC', () => this.scene.start('DifficultySelect', { next: 'CoinDash' }));
    this.pauser = new PauseController(this, { canPause: () => !this.finished });
    // The deadline is wall-clock based, so push it back by however long the game was paused.
    this.pauser.on('resume', pausedMs => { this.deadline += pausedMs; });
    this.pauser.on('pause', () => this.difficultyHud.setVisible(false));
    this.pauser.on('resume', () => this.difficultyHud.setVisible(true));
    this.pauser.on('resume', pausedMs => { this.coinPlacedAt += pausedMs; });
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

  /** Shows the level and how many coins remain before the next one. */
  refreshLevelHud() {
    const lv = this.levels;
    const into = Math.min(lv.coinsIntoLevel, lv.coinsPerLevel);
    this.levelText.setText(`LEVEL ${lv.level} \u00b7 ${into}/${lv.coinsPerLevel}`);
    this.levelBar.width = 180 * (into / lv.coinsPerLevel);
  }

  /** Current enemy speed: base speed, scaled by the chosen difficulty mode, then by the level. */
  droneSpeed() {
    const base = COIN_DASH.droneSpeed;
    const modeSpeed = window.COIN_DASH_DIFFICULTY ? COIN_DASH_DIFFICULTY.enemySpeed(base) : base;
    return modeSpeed * this.levelDifficulty.droneSpeedMultiplier;
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
    this.levelDifficulty = difficulty;
    this.refreshLevelHud();
    // Bonus time for finishing a level.
    if (difficulty.timeBonusSeconds) this.deadline += difficulty.timeBonusSeconds * 1000;
    // Speed up existing enemies, keeping their direction.
    const speed = this.droneSpeed();
    this.drones.getChildren().forEach((d) => {
      if (!d.body) return;
      if (d.body.velocity.length() > 0) d.body.velocity.setLength(speed);
      else d.body.velocity.setToPolar(Phaser.Math.FloatBetween(0, Math.PI * 2), speed); // a stalled drone gets moving
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
    const label = this.add.text(c.width / 2, c.height / 2,
      `LEVEL UP!\nLevel ${level}`, {
      font: 'bold 52px monospace', color: '#ffd166', stroke: '#0a1120', strokeThickness: 8,
      align: 'center', lineSpacing: 6
    }).setOrigin(0.5).setScale(0.2).setAlpha(0).setDepth(10);
    const hint = this.add.text(c.width / 2, c.height / 2 + 80,
      (this.levelDifficulty.timeBonusSeconds ? `+${this.levelDifficulty.timeBonusSeconds}s  \u00b7  ` : '')
        + `${this.levels.coinsPerLevel} more coins for level ${level + 1}`,
      { font: '20px monospace', color: '#ffffff', stroke: '#0a1120', strokeThickness: 6 }
    ).setOrigin(0.5).setAlpha(0).setDepth(10);
    this.tweens.add({ targets: label, scale: 1, alpha: 1, duration: 380, ease: 'Back.Out' });
    this.tweens.add({ targets: hint, alpha: 1, delay: 250, duration: 300 });
    this.tweens.add({
      targets: [label, hint], alpha: 0, y: '-=70', delay: 1100, duration: 550, ease: 'Quad.In',
      onComplete: () => { label.destroy(); hint.destroy(); }
    });
  }

  collectCoin() {
    const { points, multiplier, increased } = this.combo.collect();
    this.score += points;
    this.coins++;
    this.showFloatingPoints(this.coin.x, this.coin.y, points, multiplier);
    if (increased) this.showComboBanner(multiplier);
  }

  createComboHud() {
    const c = COIN_DASH;
    this.comboText = this.add.text(c.width - 70, c.height - 34, '', {
      font: 'bold 26px monospace', color: '#ffd166', stroke: '#0a1120', strokeThickness: 4
    }).setOrigin(0.5).setDepth(10);
    this.comboBar = this.add.rectangle(c.width - 110, c.height - 14, 80, 4, c.colors.coin)
      .setOrigin(0, 0.5).setDepth(10);
  }

  updateComboHud() {
    const { multiplier, timeLeftRatio } = this.combo;
    this.comboText.setText(`x${multiplier}`).setAlpha(multiplier > 1 ? 1 : 0.45);
    this.comboBar.setScale(timeLeftRatio, 1).setVisible(this.combo.active);
  }

  showFloatingPoints(x, y, points, multiplier) {
    const text = this.add.text(x, y - 10, `+${points}`, {
      font: `bold ${16 + multiplier * 3}px monospace`,
      color: multiplier > 1 ? '#ffd166' : '#ffffff', stroke: '#0a1120', strokeThickness: 3
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({
      targets: text, y: y - 50, alpha: 0, duration: 800, ease: 'Cubic.easeOut',
      onComplete: () => text.destroy()
    });
  }

  showComboBanner(multiplier) {
    const c = COIN_DASH;
    if (this.comboBanner) this.comboBanner.destroy();
    const banner = this.add.text(c.width / 2, c.height / 2 - 80, `COMBO x${multiplier}!`, {
      font: 'bold 40px monospace', color: '#ffd166', stroke: '#0a1120', strokeThickness: 6
    }).setOrigin(0.5).setDepth(30).setScale(0.4);
    this.comboBanner = banner;
    this.tweens.add({ targets: banner, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: banner, alpha: 0, y: banner.y - 30, delay: 550, duration: 350,
      onComplete: () => banner.destroy()
    });
    this.tweens.add({ targets: this.comboText, scale: 1.4, duration: 120, yoyo: true });
  }

  update(time, delta) {
    if (this.finished || this.pauser.paused) return;
    // Advance by frame delta (not absolute time) so the combo freezes while the scene is paused.
    this.combo.update(delta);
    this.updateComboHud();
    const dx = Number(this.cursors.right.isDown || this.keys.D.isDown)
      - Number(this.cursors.left.isDown || this.keys.A.isDown);
    const dy = Number(this.cursors.down.isDown || this.keys.S.isDown)
      - Number(this.cursors.up.isDown || this.keys.W.isDown);
    const direction = new Phaser.Math.Vector2(dx, dy).normalize().scale(COIN_DASH.playerSpeed);
    this.player.body.setVelocity(direction.x, direction.y);
    this.effects.update();
    // Higher levels: an uncollected coin relocates after a while.
    const lifetime = this.levelDifficulty.coinLifetimeMs;
    if (lifetime && this.time.now - this.coinPlacedAt > lifetime) this.placeCoin();
    const seconds = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.hud.setText(`Score: ${this.score}  Coins: ${this.coins}             Time: ${seconds}s`);
    if (seconds === 0) {
      this.effects.roundOver();
      sfx().gameOver?.();
      this.finish('Time is up!');
    }
  }

  finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    // Brief pause so the player sees what happened, then hand off to the Game Over screen.
    this.time.delayedCall(700, () => this.scene.start('GameOver',
      { score: this.score, reason, difficulty: this.difficulty.key, level: this.levels.level }));
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
  scene: [COIN_DASH_SCREENS.MenuScene, DifficultySelect, CoinDash, COIN_DASH_SCREENS.GameOverScene]
});
