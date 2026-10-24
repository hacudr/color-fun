// Little sounds, all made here with Web Audio, so there are no files to fetch.
const sound = (() => {
  let ctx = null;
  let on = localStorage.getItem('color.sound') !== 'off';
  // A major pentatonic run, so any notes played in a row sound happy together
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

  // iOS allows no sound until a touch, and may stop the clock while the app is away
  function unlock() {
    if (!ctx || ctx.state === 'closed') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  function note(freq, when = 0, length = 0.35, volume = 0.18, type = 'sine') {
    if (!on || !ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + length + 0.05);
    // a soft bell-like overtone
    if (type === 'sine') {
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.frequency.value = freq * 2.01;
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(volume * 0.25, t + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + length * 0.6);
      o2.connect(g2).connect(ctx.destination);
      o2.start(t);
      o2.stop(t + length);
    }
  }

  function pop() {
    if (!on || !ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.12);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  return {
    unlock,
    get on() { return on; },
    set(value) { on = value; localStorage.setItem('color.sound', on ? 'on' : 'off'); },
    tap() { note(SCALE[4], 0, 0.12, 0.08, 'triangle'); },
    // colouring climbs the scale, one note for every tenth of the page
    step(tenth) { note(SCALE[Math.min(SCALE.length - 1, tenth)], 0, 0.5, 0.14); },
    sparkle() { [0, 2, 4, 5, 7, 9].forEach((k, i) => note(SCALE[k], i * 0.08, 0.6, 0.12)); },
    pick() { note(SCALE[2], 0, 0.1, 0.06, 'triangle'); },
    snap(n) { pop(); note(SCALE[n % SCALE.length], 0.04, 0.45, 0.15); },
    fanfare() {
      [[0, 0], [2, 0.14], [4, 0.28], [7, 0.42]].forEach(([k, w]) => note(SCALE[k], w, 0.4, 0.15));
      [0, 4, 7].forEach((k) => note(SCALE[k], 0.62, 1.4, 0.1));
      [5, 9].forEach((k) => note(SCALE[k], 0.62, 1.4, 0.08));
    },
  };
})();

window.addEventListener('pointerdown', () => sound.unlock(), true);
