/* 音频引擎：全部用 WebAudio 合成，不依赖音频文件
 * 环境层：反应堆嗡鸣、通风、艇壳吱嘎
 * 设备层：按键、继电器、消磁、CRT 啸叫、Ping
 * 信息层：戴耳机（H）后收听接触目标，声像按相对方位摆放 */

SD.audio = (() => {
  let ac = null, master, amb, dev, info, hum, humGain, vent, whine, noiseBuf;
  const voices = {};
  let headphones = false;
  let ambLevel = 1;

  function noise(sec = 2) {
    const b = ac.createBuffer(1, ac.sampleRate * sec, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function loopNoise() { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; }

  function init() {
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = noise(3);
    master = ac.createGain(); master.gain.value = .7; master.connect(ac.destination);
    amb = ac.createGain(); amb.connect(master);
    dev = ac.createGain(); dev.connect(master);
    info = ac.createGain(); info.gain.value = 0; info.connect(master);

    // 反应堆嗡鸣：50Hz 锯齿 + 低通，音量跟反应堆功率走
    hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 50;
    const hum2 = ac.createOscillator(); hum2.type = 'sine'; hum2.frequency.value = 100.4;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    humGain = ac.createGain(); humGain.gain.value = .05;
    hum.connect(lp); hum2.connect(lp); lp.connect(humGain); humGain.connect(amb);
    hum.start(); hum2.start();

    // 通风：带通噪声
    const vs = loopNoise(), bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = .6;
    vent = ac.createGain(); vent.gain.value = .025;
    vs.connect(bp); bp.connect(vent); vent.connect(amb);

    // CRT 高频啸叫（很轻）
    whine = ac.createOscillator(); whine.frequency.value = 15625;
    const wg = ac.createGain(); wg.gain.value = .004;
    whine.connect(wg); wg.connect(dev); whine.start();

    creakLoop();
  }

  // 艇壳吱嘎：越深越频繁、越响
  function creakLoop() {
    const depth = SD.state.depth;
    const wait = SD.clamp(14000 - depth * 20, 3000, 14000) * SD.rand(.6, 1.4);
    setTimeout(() => { if (!SD.state.leviathan) creak(SD.clamp(depth / 400, .15, 1)); creakLoop(); }, wait);
  }
  function creak(amt) {
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(SD.rand(60, 110), t);
    o.frequency.linearRampToValueAtTime(SD.rand(40, 90), t + 1.2);
    f.type = 'bandpass'; f.frequency.value = SD.rand(200, 500); f.Q.value = 8;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05 * amt, t + .3); g.gain.linearRampToValueAtTime(0, t + 1.4);
    o.connect(f); f.connect(g); g.connect(amb); o.start(t); o.stop(t + 1.5);
  }

  // ---------- 设备层 ----------
  function click(vol = .12, freq = 2200) {
    if (!ac) return;
    const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2;
    const v = SD.state.silent ? vol * .35 : vol;   // 静默航行时按键声变弱
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + .03);
    s.connect(f); f.connect(g); g.connect(dev); s.start(t, Math.random()); s.stop(t + .04);
  }
  const key = () => click(.08, SD.rand(1800, 3200));
  const relay = () => { click(.25, 900); setTimeout(() => click(.15, 1400), 35); };

  function beep(freq = 880, dur = .08, vol = .06, type = 'square') {
    if (!ac) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(0, t + dur);
    o.connect(g); g.connect(dev); o.start(t); o.stop(t + dur + .02);
  }

  function degauss() {
    if (!ac) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + .7);
    g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .9);
    o.connect(g); g.connect(dev); o.start(t); o.stop(t + 1);
    const s = ac.createBufferSource(), sg = ac.createGain(), f = ac.createBiquadFilter();
    s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 3000;
    sg.gain.setValueAtTime(.08, t); sg.gain.exponentialRampToValueAtTime(.001, t + .6);
    s.connect(f); f.connect(sg); sg.connect(dev); s.start(t); s.stop(t + .7);
  }

  function ping() {
    if (!ac) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    const dl = ac.createDelay(2), fb = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(3500, t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.35, t + .01); g.gain.exponentialRampToValueAtTime(.001, t + 1.6);
    dl.delayTime.value = .45; fb.gain.value = .35;
    o.connect(g); g.connect(dev); g.connect(dl); dl.connect(fb); fb.connect(dl); fb.connect(dev);
    o.start(t); o.stop(t + 1.7);
  }

  // 内部广播前的"咔-嘶"声
  function squelch() {
    if (!ac) return;
    const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.2;
    g.gain.setValueAtTime(.07, t); g.gain.linearRampToValueAtTime(0, t + .25);
    s.connect(f); f.connect(g); g.connect(dev); s.start(t, Math.random()); s.stop(t + .3);
    click(.2, 700);
  }

  function alarm() {
    if (!ac) return;
    for (let i = 0; i < 3; i++) setTimeout(() => beep(620, .22, .07, 'sawtooth'), i * 420);
  }

  // ---------- 信息层：接触目标声音 ----------
  function makeVoice(c) {
    const pan = ac.createStereoPanner(), g = ac.createGain(); g.gain.value = 0;
    g.connect(pan); pan.connect(info);
    const v = { pan, g, nodes: [] };
    if (c.kind === 'sub' || c.kind === 'rust') {
      // 螺旋桨空化：噪声被叶频调制
      const s = loopNoise(), f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = c.kind === 'rust' ? 900 : 600; f.Q.value = .8;
      const am = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = c.kind === 'rust' ? 7.3 : 5.1; lg.gain.value = .5; am.gain.value = .5;
      lfo.connect(lg); lg.connect(am.gain); lfo.start();
      s.connect(f); f.connect(am); am.connect(g);
      const tone = ac.createOscillator(), tg = ac.createGain(); tone.frequency.value = c.lines[0]; tg.gain.value = .15;
      tone.connect(tg); tg.connect(g); tone.start();
      v.nodes.push(s, lfo, tone);
    } else if (c.kind === 'echo') {
      // 回声体：模仿螺旋桨，但节奏完全一样、没有电源谐波
      const s = loopNoise(), f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 3;
      const am = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.type = 'square'; lfo.frequency.value = 5.1; lg.gain.value = .5; am.gain.value = .5;
      lfo.connect(lg); lg.connect(am.gain); lfo.start();
      s.connect(f); f.connect(am); am.connect(g);
      v.nodes.push(s, lfo);
    } else if (c.kind === 'whale') {
      v.song = true;
    }
    return v;
  }
  function whaleCall(v) {
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    const f0 = SD.rand(180, 320);
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * SD.rand(.5, 1.6), t + 2.5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.4, t + .8); g.gain.linearRampToValueAtTime(0, t + 3);
    o.connect(g); g.connect(v.g); o.start(t); o.stop(t + 3.1);
  }

  // 每帧更新：声像 = 相对方位，音量 = 距离
  function update() {
    if (!ac) return;
    const S = SD.state, now = ac.currentTime;
    humGain.gain.setTargetAtTime(S.leviathan ? 0 : .02 + S.reactor / 100 * .08, now, .5);
    hum.frequency.setTargetAtTime(48 + S.reactor / 100 * 6, now, .5);
    vent.gain.setTargetAtTime(S.leviathan ? 0 : (S.breakers.LIFE.on ? .025 : .004), now, .5);
    amb.gain.setTargetAtTime(ambLevel, now, S.leviathan ? 3 : .5);
    info.gain.setTargetAtTime(headphones ? .5 : 0, now, .2);
    for (const c of S.contacts) {
      if (!voices[c.id]) voices[c.id] = makeVoice(c);
      const v = voices[c.id];
      const audible = !c.hidden && !S.leviathan && S.breakers.SONAR.on;
      const d = SD.dist(S.own.x, S.own.y, c.x, c.y);
      const rel = SD.norm(SD.bearingTo(S.own.x, S.own.y, c.x, c.y) - S.hdg);
      const p = Math.sin(SD.rad(rel));
      v.pan.pan.setTargetAtTime(p, now, .1);
      const vol = audible ? SD.clamp(1.6 / (d + .5), 0, .5) * (c.id === S.selected ? 1.6 : .6) : 0;
      v.g.gain.setTargetAtTime(vol, now, S.leviathan ? 2.5 : .3);
      if (v.song && audible && headphones && Math.random() < .004) whaleCall(v);
    }
  }

  return {
    init, update, key, relay, beep, degauss, ping, squelch, alarm, click,
    get ready() { return !!ac; },
    get headphones() { return headphones; },
    toggleHeadphones() { headphones = !headphones; return headphones; },
    setAmbient(v) { ambLevel = v; },
  };
})();
