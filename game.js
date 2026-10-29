/* global Phaser, COIN_DASH */
class CoinDash extends Phaser.Scene {
  constructor() { super('CoinDash'); }

  create() {
    const c = COIN_DASH;
    this.score = 0; // total points, including combo multipliers
    this.coins = 0;
    this.combo = new CoinDashCombo.ComboTracker(c.combo);
    this.finished = false;
    this.deadline = this.time.now + c.roundSeconds * 1000;
    this.physics.world.setBounds(0, 44, c.width, c.height - 44);
    this.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
      c.colors.background, 1, 0x24334b, 0.45);
    this.hud = this.add.text(18, 12, '', { font: '18px monospace', color: '#ffffff' });
    this.createComboHud();
    this.player = this.add.rectangle(c.width / 2, c.height / 2, 24, 24, c.colors.player);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.coin = this.add.circle(100, 100, 9, c.colors.coin);
    this.physics.add.existing(this.coin);
    this.coin.body.setCircle(9);
    this.placeCoin();
    this.drones = this.physics.add.group();
    for (let i = 0; i < c.droneCount; i++) {
      const drone = this.add.rectangle(90 + i * 270, 100, 26, 26, c.colors.drone);
      this.drones.add(drone);
      drone.body.setCollideWorldBounds(true).setBounce(1, 1);
      const angle = (35 + i * 105) * Math.PI / 180;
      drone.body.setVelocity(Math.cos(angle) * c.droneSpeed, Math.sin(angle) * c.droneSpeed);
    }
    this.physics.add.overlap(this.player, this.coin, () => {
      if (this.finished) return;
      this.collectCoin();
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
    if (this.finished) return;
    // Advance by frame delta (not absolute time) so the combo freezes while the scene is paused.
    this.combo.update(delta);
    this.updateComboHud();
    const dx = Number(this.cursors.right.isDown || this.keys.D.isDown)
      - Number(this.cursors.left.isDown || this.keys.A.isDown);
    const dy = Number(this.cursors.down.isDown || this.keys.S.isDown)
      - Number(this.cursors.up.isDown || this.keys.W.isDown);
    const direction = new Phaser.Math.Vector2(dx, dy).normalize().scale(COIN_DASH.playerSpeed);
    this.player.body.setVelocity(direction.x, direction.y);
    const seconds = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.hud.setText(`Score: ${this.score}  Coins: ${this.coins}             Time: ${seconds}s`);
    if (seconds === 0) this.finish('Time is up!');
  }

  finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    const c = COIN_DASH;
    this.add.rectangle(c.width / 2, c.height / 2, 460, 190, 0x0a1120, 0.95);
    this.add.text(c.width / 2, c.height / 2,
      `${reason}\nFinal score: ${this.score}\n${this.coins} coins collected\nPress R to try again`,
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
