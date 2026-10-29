/* global Phaser, COIN_DASH, COIN_DASH_ENEMIES */
class CoinDash extends Phaser.Scene {
  constructor() { super('CoinDash'); }

  create() {
    const c = COIN_DASH;
    this.score = 0;
    this.finished = false;
    // The scene clock is stale until its first update, so read the live game loop time.
    this.deadline = this.game.loop.time + c.roundSeconds * 1000;
    this.physics.world.setBounds(0, 44, c.width, c.height - 44);
    this.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
      c.colors.background, 1, 0x24334b, 0.45);
    this.hud = this.add.text(18, 12, '', { font: '18px monospace', color: '#ffffff' });
    this.player = this.add.rectangle(c.width / 2, c.height / 2, 24, 24, c.colors.player);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.coin = this.add.circle(100, 100, 9, c.colors.coin);
    this.physics.add.existing(this.coin);
    this.coin.body.setCircle(9);
    this.placeCoin();
    // Enemies are managed by enemies.js; the schedule in settings introduces
    // each type over the round. this.drones stays the group used for collisions.
    this.enemies = COIN_DASH_ENEMIES.createEnemyManager(this, { player: this.player });
    this.drones = this.enemies.group;
    this.events.on('enemy-type-introduced', (type, label) => this.announce(`${label} incoming!`));
    this.events.once('shutdown', () => this.events.off('enemy-type-introduced'));
    this.physics.add.overlap(this.player, this.coin, () => {
      if (this.finished) return;
      this.score++;
      this.placeCoin();
    });
    this.physics.add.overlap(this.player, this.drones,
      (player, enemy) => this.finish(`${this.enemies.describe(enemy)} caught you!`),
      (player, enemy) => this.enemies.isArmed(enemy));
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

  announce(message) {
    const c = COIN_DASH;
    const text = this.add.text(c.width / 2, 70, message,
      { font: '20px monospace', color: '#ffffff' }).setOrigin(0.5).setAlpha(0);
    this.tweens.add({
      targets: text, alpha: { from: 0, to: 1 }, y: 60, duration: 250, yoyo: true, hold: 900,
      onComplete: () => text.destroy()
    });
  }

  update(time, delta) {
    if (this.finished) return;
    this.enemies.update(time, delta);
    const dx = Number(this.cursors.right.isDown || this.keys.D.isDown)
      - Number(this.cursors.left.isDown || this.keys.A.isDown);
    const dy = Number(this.cursors.down.isDown || this.keys.S.isDown)
      - Number(this.cursors.up.isDown || this.keys.W.isDown);
    const direction = new Phaser.Math.Vector2(dx, dy).normalize().scale(COIN_DASH.playerSpeed);
    this.player.body.setVelocity(direction.x, direction.y);
    const seconds = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.hud.setText(`Coins: ${this.score}                       Time: ${seconds}s`);
    if (seconds === 0) this.finish('Time is up!');
  }

  finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    // Brief pause so the player sees what happened, then hand off to the Game Over screen.
    this.time.delayedCall(700, () => this.scene.start('GameOver', { score: this.score, reason }));
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
  scene: [COIN_DASH_SCREENS.MenuScene, CoinDash, COIN_DASH_SCREENS.GameOverScene]
});
