// Coin Dash sound effects and music, synthesised with the Web Audio API (no audio files).
// Other code triggers sounds through window.CoinDashSound:
//   coin(), hit(), milestone(), start(), gameOver()            play an effect
//   toggleMute(), setMuted(bool), isMuted()                      master mute (key M)
//   toggleMusic(), setMusic(bool), isMusicOn()                   background music (key B)
//   onChange(fn)                                                 fn({ muted, music }) on any change
// From game code prefer `window.CoinDashSound?.coin()` so the game still runs without this file.
// Every call is safe before the first user gesture: the browser keeps audio locked until then,
// and sounds requested while locked are simply skipped (the start jingle is replayed on unlock).
(function () {
  const STORAGE_KEY = 'coinDash.sound';
  const MASTER_VOLUME = 0.5;   // overall ceiling; individual sounds stay well below 1
  const MUSIC_VOLUME = 0.22;   // relative to master
  const AudioCtor = window.AudioContext || window.webkitAudioContext;

  let ctx = null, master = null, sfxBus = null, musicBus = null;
  let prefs = { muted: false, music: true };
  let musicTimer = null, nextNoteTime = 0, step = 0;
  let pendingStart = false;
  const listeners = [];

  try { Object.assign(prefs, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); } catch (e) { /* storage unavailable */ }
  const savePrefs = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } };

  function ensureContext() {
    if (ctx || !AudioCtor) return ctx;
    ctx = new AudioCtor();
    master = ctx.createGain();
    master.gain.value = prefs.muted ? 0 : MASTER_VOLUME;
    // A gentle compressor keeps overlapping sounds from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 6;
    master.connect(limiter).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    return ctx;
  }

  const ready = () => ctx && ctx.state === 'running';

  // Autoplay policy: create/resume the context only from a real user gesture.
  let unlocked = false;
  function unlock() {
    if (unlocked || !ensureContext()) return;
    ctx.resume().then(() => {
      if (unlocked) return;
      unlocked = true;
      if (prefs.music) startMusic();
      if (pendingStart) { pendingStart = false; start(); }
    });
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(type =>
    window.addEventListener(type, unlock, { capture: true, passive: true }));

  // --- Building blocks -----------------------------------------------------------------------

  function tone(freq, startAt, duration, { type = 'square', volume = 0.15, slideTo = null, bus = sfxBus } = {}) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, startAt + duration);
    env.gain.setValueAtTime(0.0001, startAt);
    env.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(env).connect(bus);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  function noise(startAt, duration, { volume = 0.3, from = 1800, to = 120 } = {}) {
    const length = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, startAt);
    filter.frequency.exponentialRampToValueAtTime(to, startAt + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(volume, startAt);
    env.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    src.connect(filter).connect(env).connect(sfxBus);
    src.start(startAt);
  }

  // --- Sound effects -------------------------------------------------------------------------

  function coin() {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone(988, t, 0.08, { volume: 0.12 });          // B5
    tone(1319, t + 0.07, 0.22, { volume: 0.12 });  // E6
  }

  function hit() {
    if (!ready()) return;
    const t = ctx.currentTime;
    noise(t, 0.6, { volume: 0.35 });
    tone(220, t, 0.45, { type: 'sawtooth', volume: 0.14, slideTo: 40 });
  }

  function milestone() {
    if (!ready()) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.08, 0.16, { volume: 0.1 }));
    tone(1047, t + 0.32, 0.35, { type: 'triangle', volume: 0.12 });
  }

  function start() {
    if (!ready()) { pendingStart = true; return; }
    const t = ctx.currentTime;
    tone(392, t, 0.1, { type: 'triangle', volume: 0.1 });       // G4
    tone(587, t + 0.09, 0.18, { type: 'triangle', volume: 0.1 }); // D5
  }

  function gameOver() {
    if (!ready()) return;
    const t = ctx.currentTime;
    [523, 415, 330].forEach((f, i) => tone(f, t + i * 0.14, 0.2, { type: 'triangle', volume: 0.1 }));
  }

  // --- Background music: a short looping arpeggio scheduled ahead of time ---------------------

  const BASS = [110, 110, 87.31, 98];                    // A2 A2 F2 G2, one per bar
  const ARP = [0, 3, 7, 12, 7, 3, 0, 7];                  // semitone offsets within each bar
  const STEP_SECONDS = 0.16;

  function scheduleMusic() {
    while (nextNoteTime < ctx.currentTime + 0.25) {
      const bar = Math.floor(step / ARP.length) % BASS.length;
      const root = BASS[bar];
      if (step % ARP.length === 0) tone(root, nextNoteTime, STEP_SECONDS * 7, { type: 'triangle', volume: 0.35, bus: musicBus });
      const f = root * 4 * Math.pow(2, ARP[step % ARP.length] / 12);
      tone(f, nextNoteTime, STEP_SECONDS * 0.9, { type: 'square', volume: 0.06, bus: musicBus });
      nextNoteTime += STEP_SECONDS;
      step++;
    }
  }

  function startMusic() {
    if (!ready() || musicTimer) return;
    // Each music session gets its own bus so stopping can fade out notes already scheduled.
    musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_VOLUME;
    musicBus.connect(master);
    nextNoteTime = ctx.currentTime + 0.05;
    step = 0;
    musicTimer = setInterval(scheduleMusic, 60);
    scheduleMusic();
  }

  function stopMusic() {
    clearInterval(musicTimer);
    musicTimer = null;
    if (!musicBus) return;
    const bus = musicBus;
    musicBus = null;
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    setTimeout(() => bus.disconnect(), 1500);
  }

  // --- Settings ------------------------------------------------------------------------------

  function notify() { listeners.forEach(fn => fn({ ...prefs })); }

  function setMuted(muted) {
    prefs.muted = !!muted;
    if (master) master.gain.setTargetAtTime(prefs.muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.02);
    savePrefs(); notify();
  }

  function setMusic(on) {
    prefs.music = !!on;
    if (prefs.music) startMusic(); else stopMusic();
    savePrefs(); notify();
  }

  // --- On-page controls (kept outside the canvas so they never clash with game rendering) -----

  function buildControls() {
    const game = document.getElementById('game');
    if (!game || document.getElementById('sound-controls')) return;
    const bar = document.createElement('div');
    bar.id = 'sound-controls';
    bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:10px;';
    const button = (onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = 'font:14px monospace;padding:6px 12px;border-radius:8px;cursor:pointer;'
        + 'background:#14213a;color:#e5edf7;border:1px solid #34445e;';
      // Keep focus off the button so Space/arrow keys still reach the game.
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    };
    const muteBtn = button(() => setMuted(!prefs.muted));
    const musicBtn = button(() => setMusic(!prefs.music));
    const render = p => {
      muteBtn.textContent = p.muted ? '\u{1F507} Unmute (M)' : '\u{1F50A} Mute (M)';
      muteBtn.setAttribute('aria-pressed', String(p.muted));
      musicBtn.textContent = p.music ? '\u266A Music: on (B)' : '\u266A Music: off (B)';
      musicBtn.setAttribute('aria-pressed', String(p.music));
      musicBtn.style.opacity = p.muted ? '0.5' : '1';
    };
    listeners.push(render);
    render(prefs);
    game.insertAdjacentElement('afterend', bar);
  }

  window.addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.code === 'KeyM') setMuted(!prefs.muted);
    else if (e.code === 'KeyB') setMusic(!prefs.music);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildControls);
  else buildControls();

  window.CoinDashSound = {
    coin, hit, milestone, start, gameOver,
    setMuted, toggleMute: () => setMuted(!prefs.muted), isMuted: () => prefs.muted,
    setMusic, toggleMusic: () => setMusic(!prefs.music), isMusicOn: () => prefs.music,
    onChange: fn => listeners.push(fn),
    audioContext: () => ctx  // for debugging/tests
  };
})();
