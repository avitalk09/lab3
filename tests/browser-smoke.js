// Optional end-to-end smoke test: drives the real game in headless Chrome via
// the DevTools protocol (Node 22+ built-in WebSocket, no npm packages).
//
//   python3 -m http.server 8791 &          # serve this folder
//   node tests/browser-smoke.js http://127.0.0.1:8791/index.html
//
// Set CHROME=/path/to/chrome if Chrome is not at the default macOS location.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] || 'http://127.0.0.1:8791/index.html';
const SHOTS = process.env.SHOT_DIR || null;
const port = 9222 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'coin-dash-chrome-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
function check(cond, msg) { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures.push(msg); }

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=900,760', 'about:blank'
  ], { stdio: 'ignore' });
  try {
    let targets = [];
    for (let i = 0; i < 50 && !targets.length; i++) {
      await sleep(200);
      try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(t => t.type === 'page'); } catch {}
    }
    if (!targets.length) throw new Error('Chrome did not expose a page target');
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map(); const exceptions = []; const consoleErrors = [];
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
    };
    const send = (method, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
    const evaluate = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.result.exceptionDetails));
      return r.result.result.value;
    };
    const shot = async name => {
      if (!SHOTS) return;
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: URL });
    await sleep(1500);
    // Sit on the start menu for a while: the round schedule must still start from zero.
    check(await evaluate('window.coinDashGame.scene.isActive("Menu")'), 'start menu is showing first');
    await sleep(3000);
    await evaluate('window.coinDashGame.scene.getScene("Menu").scene.start("CoinDash"); true');
    await sleep(300);

    // Helpers evaluated inside the page.
    await evaluate(`
      window.__scene = () => window.coinDashGame.scene.getScene('CoinDash');
      window.__enemies = () => window.__scene().enemies.group.getChildren().filter(e => e.active).map(e => ({
        type: e.enemyState.type, x: e.x, y: e.y, vx: e.body.velocity.x, vy: e.body.velocity.y,
        w: e.width, h: e.height, color: e.fillColor
      }));
      window.__inside = () => { const b = window.__scene().physics.world.bounds; return window.__enemies().every(e =>
        e.x >= b.x - 1 && e.x <= b.x + b.width + 1 && e.y >= b.y - 1 && e.y <= b.y + b.height + 1); };
      window.__texts = key => window.coinDashGame.scene.getScene(key).children.list.filter(o => o.type === 'Text').map(t => t.text);
      // Auto-dodge: keep the player at the grid point farthest from every enemy
      // so the round survives long enough to see each type arrive.
      window.__dodge = setInterval(() => {
        const s = window.__scene(); if (!s || s.finished || !s.enemies) return;
        const es = s.enemies.group.getChildren().filter(e => e.active);
        let best = null, bestD = -1;
        for (let x = 60; x <= 740; x += 40) for (let y = 100; y <= 460; y += 40) {
          const d = Math.min(...es.map(e => Math.hypot(e.x - x, e.y - y)), 9999);
          if (d > bestD) { bestD = d; best = [x, y]; }
        }
        s.player.setPosition(best[0], best[1]); s.player.body.reset(best[0], best[1]);
      }, 300);
      true;`);

    const started = Date.now();
    const atSecond = async s => { const wait = started + s * 1000 - Date.now(); if (wait > 0) await sleep(wait); };

    let e = await evaluate('__enemies()');
    check(e.length === 3 && e.every(x => x.type === 'drone'), `t=1.5s: three drones only (got ${e.map(x => x.type).join(',')})`);
    check(await evaluate('__scene().hud.text.includes("Time")'), 'HUD is rendering');

    await atSecond(10);
    e = await evaluate('__enemies()');
    const chaser = e.find(x => x.type === 'chaser');
    check(!!chaser, 't=10s: chaser has spawned');
    if (chaser) {
      const p = await evaluate('({x: __scene().player.x, y: __scene().player.y})');
      const dot = (p.x - chaser.x) * chaser.vx + (p.y - chaser.y) * chaser.vy;
      check(dot > 0, 'chaser is moving towards the player');
      check(chaser.w === 24 && chaser.color === 0xe63946, 'chaser is a 24px red triangle');
    }
    check(await evaluate('__inside()'), 't=10s: all enemies inside the arena');
    await shot('smoke-10s.png');

    await atSecond(18);
    e = await evaluate('__enemies()');
    const sp = e.find(x => x.type === 'speed');
    check(!!sp, 't=18s: speeder has spawned');
    if (sp) {
      check(Math.abs(Math.hypot(sp.vx, sp.vy) - 240) < 1, `speeder moves at 240 (got ${Math.hypot(sp.vx, sp.vy).toFixed(1)})`);
      check(sp.w === 14 && sp.color === 0xff9f1c, 'speeder is a 14px orange diamond');
    }

    await atSecond(26);
    e = await evaluate('__enemies()');
    const pat = e.find(x => x.type === 'patrol');
    check(!!pat, 't=26s: patrol has spawned');
    if (pat) check(Math.abs(Math.hypot(pat.vx, pat.vy) - 150) < 1 && pat.color === 0x9b5de5, 'patrol is purple and moves at 150');
    check(e.length === 6, `t=26s: six enemies live (got ${e.length})`);
    check(await evaluate('__inside()'), 't=26s: all enemies inside the arena');
    check(await evaluate('__scene().finished') === false, 'round still running (no accidental collision)');
    await shot('smoke-26s.png');

    // Force a collision with an armed enemy and make sure the round ends.
    await evaluate(`(() => { clearInterval(window.__dodge); const s = __scene(); const t = s.enemies.group.getChildren().find(x => x.enemyState.type === 'patrol');
      s.player.setPosition(t.x, t.y); s.player.body.reset(t.x, t.y); })()`);
    await sleep(400);
    check(await evaluate('__scene().finished') === true, 'touching a patrol ends the round');
    await sleep(1200); // finish() hands off to the GameOver scene after 700 ms
    check(await evaluate('window.coinDashGame.scene.isActive("GameOver")'), 'game over screen is showing');
    const texts = await evaluate('__texts("GameOver")');
    check(texts.some(t => t.includes('A PATROL CAUGHT YOU!')), `game over text names the enemy (${JSON.stringify(texts.slice(0, 3))})`);
    await shot('smoke-end.png');

    // Playing again must rebuild the roster and not stack event listeners.
    await evaluate('window.coinDashGame.scene.getScene("GameOver").scene.start("CoinDash"); true');
    await sleep(1200);
    e = await evaluate('__enemies()');
    check(e.length === 3 && e.every(x => x.type === 'drone'), 'after restart: three drones again');
    check(await evaluate('__scene().events.listenerCount("enemy-type-introduced")') === 1, 'after restart: single intro listener');

    check(exceptions.length === 0, `no uncaught exceptions ${exceptions.length ? JSON.stringify(exceptions) : ''}`);
    check(consoleErrors.length === 0, `no console errors ${consoleErrors.length ? JSON.stringify(consoleErrors) : ''}`);
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll browser checks passed');
  process.exit(failures.length ? 1 : 0);
}
main().catch(err => { console.error(err); process.exit(2); });
