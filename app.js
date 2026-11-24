(() => {
  const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  // --- Tab Router ---
  const App = {
    modules: {},
    active: 'logic',
    register(name, mod) {
      this.modules[name] = mod;
      if (name === this.active && mod.onShow) mod.onShow();
    },
    switchTab(name) {
      if (name === this.active) return;
      const prev = this.modules[this.active];
      if (prev && prev.onHide) prev.onHide();
      this.active = name;
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
      document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
      const next = this.modules[name];
      if (next && next.onShow) next.onShow();
    }
  };

  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) App.switchTab(btn.dataset.tab);
  });

  function bindCanvas(wrap, canvas, onResize) {
    const ctx = canvas.getContext('2d');
    const state = { w: 800, h: 500 };
    function resize() {
      const r = wrap.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = window.devicePixelRatio || 1;
      state.w = r.width;
      state.h = r.height;
      canvas.width = Math.floor(r.width * dpr);
      canvas.height = Math.floor(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (onResize) onResize(state.w, state.h);
    }
    new ResizeObserver(resize).observe(wrap);
    return { ctx, state, resize };
  }

  function pointerPos(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // =========================================================================
  // 01: DIGITAL LOGIC SANDBOX
  // =========================================================================
  (() => {
    const canvas = document.getElementById('logic-canvas');
    const wrap = document.getElementById('logic-wrap');
    const { ctx, state, resize } = bindCanvas(wrap, canvas);
    const statsEl = document.getElementById('logic-stats');
    const hzSlider = document.getElementById('logic-hz');
    const hzVal = document.getElementById('logic-hz-val');

    const SPEC = {
      IN:   { in: 0, out: 1, w: 72, h: 44 },
      CLK:  { in: 0, out: 1, w: 72, h: 44 },
      OUT:  { in: 1, out: 0, w: 72, h: 44 },
      NOT:  { in: 1, out: 1, w: 74, h: 44 },
      AND:  { in: 2, out: 1, w: 82, h: 52 },
      OR:   { in: 2, out: 1, w: 82, h: 52 },
      NAND: { in: 2, out: 1, w: 86, h: 52 },
      XOR:  { in: 2, out: 1, w: 82, h: 52 },
      HEX:  { in: 4, out: 0, w: 82, h: 104 }
    };

    let nodes = [], wires = [], nextId = 1, rafId = null;
    let clockHz = 1.0, clockState = 0, lastClock = performance.now();
    let selectedId = null, dragNode = null, wiringFrom = null;
    let dragOff = { x: 0, y: 0 }, downPos = { x: 0, y: 0 }, mouse = { x: 0, y: 0 };

    const updateStats = () => { statsEl.textContent = `${nodes.length} nodes · ${wires.length} wires`; };

    function addNode(type, x, y, opts = {}) {
      const s = SPEC[type];
      const n = {
        id: opts.id ?? nextId++,
        type, w: s.w, h: s.h,
        x: Math.round(x / 16) * 16,
        y: Math.round(y / 16) * 16,
        label: opts.label || type,
        out: opts.out ?? 0,
        ins: new Array(s.in).fill(0)
      };
      nodes.push(n);
      updateStats();
      return n;
    }

    function removeNode(id) {
      nodes = nodes.filter(n => n.id !== id);
      wires = wires.filter(w => w.from !== id && w.to !== id);
      if (selectedId === id) selectedId = null;
      updateStats();
    }

    function pinPos(n, side, idx = 0) {
      if (side === 'out') return { x: n.x + n.w, y: n.y + n.h / 2 };
      const gap = n.h / (SPEC[n.type].in + 1);
      return { x: n.x, y: n.y + gap * (idx + 1) };
    }

    function findPin(x, y) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i], s = SPEC[n.type];
        if (s.out) {
          const p = pinPos(n, 'out', 0);
          if (Math.hypot(x - p.x, y - p.y) <= 11) return { node: n, side: 'out', idx: 0 };
        }
        for (let k = 0; k < s.in; k++) {
          const p = pinPos(n, 'in', k);
          if (Math.hypot(x - p.x, y - p.y) <= 11) return { node: n, side: 'in', idx: k };
        }
      }
      return null;
    }

    function findNode(x, y) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n;
      }
      return null;
    }

    function evaluate() {
      const byId = new Map(nodes.map(n => [n.id, n]));
      for (let pass = 0; pass < 6; pass++) {
        for (const n of nodes) n.ins.fill(0);
        for (const w of wires) {
          const src = byId.get(w.from), dst = byId.get(w.to);
          if (src && dst && w.toPin < dst.ins.length) dst.ins[w.toPin] = src.out;
        }
        for (const n of nodes) {
          if (n.type === 'CLK') n.out = clockState;
          else if (n.type === 'NOT') n.out = n.ins[0] ? 0 : 1;
          else if (n.type === 'AND') n.out = (n.ins[0] && n.ins[1]) ? 1 : 0;
          else if (n.type === 'OR') n.out = (n.ins[0] || n.ins[1]) ? 1 : 0;
          else if (n.type === 'NAND') n.out = (n.ins[0] && n.ins[1]) ? 0 : 1;
          else if (n.type === 'XOR') n.out = (n.ins[0] ^ n.ins[1]) ? 1 : 0;
          else if (n.type === 'OUT') n.out = n.ins[0];
        }
      }
    }

    function drawWire(p1, p2, hi) {
      const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.5);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(p1.x + dx, p1.y, p2.x - dx, p2.y, p2.x, p2.y);
      ctx.lineWidth = hi ? 2.4 : 1.6;
      ctx.strokeStyle = hi ? '#34d399' : '#3a4252';
      ctx.stroke();
    }

    function draw() {
      const { w, h } = state;
      ctx.fillStyle = '#0c0e11';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1d222b';
      for (let x = 16; x < w; x += 16)
        for (let y = 16; y < h; y += 16) ctx.fillRect(x, y, 1, 1);

      const byId = new Map(nodes.map(n => [n.id, n]));
      for (const wr of wires) {
        const s = byId.get(wr.from), d = byId.get(wr.to);
        if (s && d) drawWire(pinPos(s, 'out', 0), pinPos(d, 'in', wr.toPin), s.out === 1);
      }
      if (wiringFrom !== null) {
        const s = byId.get(wiringFrom);
        if (s) drawWire(pinPos(s, 'out', 0), mouse, true);
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const n of nodes) {
        const sel = n.id === selectedId;
        const lit = (n.type === 'IN' || n.type === 'CLK' || n.type === 'OUT') && n.out === 1;
        ctx.fillStyle = '#141820';
        ctx.strokeStyle = sel ? '#f59e0b' : (lit ? '#34d399' : '#2d3544');
        ctx.lineWidth = sel ? 2 : 1.25;
        ctx.fillRect(n.x, n.y, n.w, n.h);
        ctx.strokeRect(n.x, n.y, n.w, n.h);

        if (n.type === 'HEX') {
          const v = (n.ins[0] << 3) | (n.ins[1] << 2) | (n.ins[2] << 1) | n.ins[3];
          ctx.fillStyle = '#34d399';
          ctx.font = `bold 28px ${FONT}`;
          ctx.fillText(v.toString(16).toUpperCase(), n.x + n.w / 2 + 4, n.y + n.h / 2 - 4);
          ctx.fillStyle = '#7a8496';
          ctx.font = `10px ${FONT}`;
          ctx.fillText(`DEC ${v}`, n.x + n.w / 2 + 4, n.y + n.h - 14);
        } else if (n.type === 'OUT') {
          ctx.beginPath();
          ctx.arc(n.x + n.w / 2, n.y + 18, 7, 0, Math.PI * 2);
          ctx.fillStyle = lit ? '#34d399' : '#242a35';
          ctx.fill();
          ctx.fillStyle = '#9aa4b6';
          ctx.font = `10px ${FONT}`;
          ctx.fillText(n.label, n.x + n.w / 2, n.y + 34);
        } else {
          ctx.font = `12px ${FONT}`;
          ctx.fillStyle = lit ? '#34d399' : '#d8dee9';
          const txt = (n.type === 'IN' || n.type === 'CLK') ? `${n.label}:${n.out}` : n.label;
          ctx.fillText(txt, n.x + n.w / 2, n.y + n.h / 2);
        }

        const s = SPEC[n.type];
        for (let k = 0; k < s.in; k++) {
          const p = pinPos(n, 'in', k);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = n.ins[k] ? '#34d399' : '#465064';
          ctx.fill();
        }
        if (s.out) {
          const p = pinPos(n, 'out', 0);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = n.out ? '#34d399' : '#64728c';
          ctx.fill();
        }
      }
    }

    function loop(now) {
      if (now - lastClock >= 1000 / (clockHz * 2)) {
        clockState = clockState ? 0 : 1;
        lastClock = now;
      }
      evaluate();
      draw();
      rafId = requestAnimationFrame(loop);
    }

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) return;
      const p = pointerPos(canvas, e);
      mouse = p; downPos = p;
      const pin = findPin(p.x, p.y);
      if (pin) {
        if (pin.side === 'out') wiringFrom = pin.node.id;
        else {
          wires = wires.filter(w => !(w.to === pin.node.id && w.toPin === pin.idx));
          updateStats();
        }
        return;
      }
      const n = findNode(p.x, p.y);
      if (n) {
        selectedId = n.id; dragNode = n;
        dragOff = { x: p.x - n.x, y: p.y - n.y };
      } else selectedId = null;
    });

    canvas.addEventListener('mousemove', (e) => {
      mouse = pointerPos(canvas, e);
      if (dragNode) {
        dragNode.x = Math.round((mouse.x - dragOff.x) / 16) * 16;
        dragNode.y = Math.round((mouse.y - dragOff.y) / 16) * 16;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (App.active !== 'logic') return;
      const p = pointerPos(canvas, e);
      if (wiringFrom !== null) {
        const pin = findPin(p.x, p.y);
        if (pin && pin.side === 'in' && pin.node.id !== wiringFrom) {
          wires = wires.filter(w => !(w.to === pin.node.id && w.toPin === pin.idx));
          wires.push({ from: wiringFrom, to: pin.node.id, toPin: pin.idx });
          updateStats();
        }
        wiringFrom = null;
      }
      if (dragNode) {
        if (Math.hypot(p.x - downPos.x, p.y - downPos.y) < 5 && dragNode.type === 'IN') {
          dragNode.out = dragNode.out ? 0 : 1;
        }
        dragNode = null;
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = pointerPos(canvas, e);
      const n = findNode(p.x, p.y);
      if (n) removeNode(n.id);
    });

    window.addEventListener('keydown', (e) => {
      if (App.active === 'logic' && (e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null) {
        removeNode(selectedId);
      }
    });

    function loadPreset(name) {
      nodes = []; wires = []; nextId = 1; selectedId = null;
      if (name === 'half-adder') {
        const a = addNode('IN', 80, 112, { label: 'A', out: 1 });
        const b = addNode('IN', 80, 208, { label: 'B', out: 0 });
        const x = addNode('XOR', 272, 112), g = addNode('AND', 272, 208);
        const s = addNode('OUT', 464, 112, { label: 'SUM' }), c = addNode('OUT', 464, 208, { label: 'CARRY' });
        wires.push(
          { from: a.id, to: x.id, toPin: 0 }, { from: b.id, to: x.id, toPin: 1 },
          { from: a.id, to: g.id, toPin: 0 }, { from: b.id, to: g.id, toPin: 1 },
          { from: x.id, to: s.id, toPin: 0 }, { from: g.id, to: c.id, toPin: 0 }
        );
      } else if (name === 'sr-latch') {
        const s = addNode('IN', 80, 112, { label: "S'", out: 1 });
        const r = addNode('IN', 80, 224, { label: "R'", out: 1 });
        const n1 = addNode('NAND', 272, 112, { out: 1 }), n2 = addNode('NAND', 272, 224, { out: 0 });
        const q = addNode('OUT', 464, 112, { label: 'Q' }), qb = addNode('OUT', 464, 224, { label: "Q'" });
        wires.push(
          { from: s.id, to: n1.id, toPin: 0 }, { from: n2.id, to: n1.id, toPin: 1 },
          { from: n1.id, to: n2.id, toPin: 0 }, { from: r.id, to: n2.id, toPin: 1 },
          { from: n1.id, to: q.id, toPin: 0 }, { from: n2.id, to: qb.id, toPin: 0 }
        );
      } else {
        const b3 = addNode('IN', 80, 80, { label: 'B3', out: 1 });
        const b2 = addNode('IN', 80, 144, { label: 'B2', out: 0 });
        const b1 = addNode('IN', 80, 208, { label: 'B1', out: 1 });
        const b0 = addNode('CLK', 80, 272, { label: 'B0' });
        const hx = addNode('HEX', 320, 144);
        wires.push(
          { from: b3.id, to: hx.id, toPin: 0 }, { from: b2.id, to: hx.id, toPin: 1 },
          { from: b1.id, to: hx.id, toPin: 2 }, { from: b0.id, to: hx.id, toPin: 3 }
        );
      }
      updateStats();
    }

    document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
      addNode(b.dataset.add, 140 + Math.random() * 240, 80 + Math.random() * 180);
    }));
    document.getElementById('logic-preset').addEventListener('change', e => loadPreset(e.target.value));
    hzSlider.addEventListener('input', () => {
      clockHz = parseFloat(hzSlider.value);
      hzVal.textContent = `${clockHz.toFixed(1)}Hz`;
    });
    document.getElementById('logic-clear').addEventListener('click', () => {
      nodes = []; wires = []; selectedId = null; updateStats();
    });
    document.getElementById('logic-export').addEventListener('click', async () => {
      const data = JSON.stringify({ nodes, wires });
      try { await navigator.clipboard.writeText(data); statsEl.textContent = 'copied json to clipboard'; }
      catch { prompt('Copy circuit JSON:', data); }
    });
    document.getElementById('logic-import').addEventListener('click', () => {
      const raw = prompt('Paste circuit JSON:');
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        nodes = d.nodes || []; wires = d.wires || [];
        nextId = Math.max(0, ...nodes.map(n => n.id)) + 1;
        updateStats();
      } catch { alert('Invalid JSON'); }
    });

    loadPreset('half-adder');
    App.register('logic', {
      onShow() { resize(); if (!rafId) rafId = requestAnimationFrame(loop); },
      onHide() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    });
  })();

  // =========================================================================
  // 02: OSCILLOSCOPE / SYNTH / LIVE FFT
  // =========================================================================
  (() => {
    const canvas = document.getElementById('scope-canvas');
    const wrap = document.getElementById('scope-wrap');
    const { ctx, state, resize } = bindCanvas(wrap, canvas);

    const synthBtn = document.getElementById('scope-synth');
    const micBtn = document.getElementById('scope-mic');
    const waveSel = document.getElementById('scope-wave');
    const freqSlider = document.getElementById('scope-freq');
    const freqVal = document.getElementById('scope-freq-val');
    const cutSlider = document.getElementById('scope-cut');
    const cutVal = document.getElementById('scope-cut-val');
    const gainSlider = document.getElementById('scope-gain');
    const viewSel = document.getElementById('scope-view');
    const holdBtn = document.getElementById('scope-hold');
    const statsEl = document.getElementById('scope-stats');

    let rafId = null, held = false, mode = 'idle';
    let ac = null, analyser = null, filter = null, gainNode = null, osc = null;
    let micStream = null, micSource = null;
    let timeData = new Float32Array(2048), freqData = new Uint8Array(1024);

    function ensureAudio() {
      if (ac) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC();
      filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = parseFloat(cutSlider.value);
      gainNode = ac.createGain();
      gainNode.gain.value = parseFloat(gainSlider.value);
      analyser = ac.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.78;
      timeData = new Float32Array(analyser.fftSize);
      freqData = new Uint8Array(analyser.frequencyBinCount);
    }

    function stopSources() {
      if (osc) { try { osc.stop(); } catch {} osc.disconnect(); osc = null; }
      if (micSource) { micSource.disconnect(); micSource = null; }
      if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
      if (filter) filter.disconnect();
      if (gainNode) gainNode.disconnect();
      mode = 'idle';
      synthBtn.textContent = 'synth: off'; synthBtn.classList.remove('active');
      micBtn.textContent = 'mic: off'; micBtn.classList.remove('active');
      statsEl.textContent = 'idle';
    }

    async function toggleSynth() {
      if (mode === 'synth') return stopSources();
      stopSources(); ensureAudio();
      if (ac.state === 'suspended') await ac.resume();
      osc = ac.createOscillator();
      osc.type = waveSel.value;
      osc.frequency.value = parseFloat(freqSlider.value);
      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(analyser);
      gainNode.connect(ac.destination);
      osc.start();
      mode = 'synth';
      synthBtn.textContent = 'synth: on';
      synthBtn.classList.add('active');
    }

    async function toggleMic() {
      if (mode === 'mic') return stopSources();
      stopSources(); ensureAudio();
      if (ac.state === 'suspended') await ac.resume();
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micSource = ac.createMediaStreamSource(micStream);
        micSource.connect(filter);
        filter.connect(analyser);
        mode = 'mic';
        micBtn.textContent = 'mic: on';
        micBtn.classList.add('active');
      } catch {
        statsEl.textContent = 'mic permission denied';
      }
    }

    function drawBoxGrid(x, y, w, h, cols, rows) {
      ctx.strokeStyle = '#1b2029'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < cols; i++) { const gx = x + (w / cols) * i; ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
      for (let j = 1; j < rows; j++) { const gy = y + (h / rows) * j; ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
      ctx.stroke();
      ctx.strokeStyle = '#262c36';
      ctx.strokeRect(x, y, w, h);
    }

    function drawScope(x, y, w, h) {
      drawBoxGrid(x, y, w, h, 10, 6);
      const midY = y + h / 2;
      ctx.strokeStyle = '#26303d';
      ctx.beginPath(); ctx.moveTo(x, midY); ctx.lineTo(x + w, midY); ctx.stroke();

      const half = timeData.length >> 1;
      let trig = 0;
      for (let i = 1; i < half; i++) {
        if (timeData[i - 1] < 0 && timeData[i] >= 0) { trig = i; break; }
      }
      ctx.beginPath();
      const sy = h * 0.42;
      for (let i = 0; i < half; i++) {
        const px = x + (i / (half - 1)) * w;
        const py = midY - timeData[trig + i] * sy;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = '#34d399'; ctx.lineWidth = 1.75; ctx.stroke();
      ctx.fillStyle = '#7a8496'; ctx.font = `11px ${FONT}`;
      ctx.fillText('TIME DOMAIN (CH1)', x + 10, y + 16);
    }

    function drawFFT(x, y, w, h) {
      drawBoxGrid(x, y, w, h, 10, 4);
      const sr = ac ? ac.sampleRate : 48000;
      const nyq = sr / 2, maxHz = Math.min(10000, nyq);
      const maxBin = Math.max(1, Math.floor((maxHz / nyq) * freqData.length));

      ctx.beginPath();
      ctx.moveTo(x, y + h);
      for (let i = 0; i <= maxBin; i++) {
        ctx.lineTo(x + (i / maxBin) * w, y + h - (freqData[i] / 255) * (h - 22));
      }
      ctx.lineTo(x + w, y + h); ctx.closePath();
      ctx.fillStyle = 'rgba(245, 158, 11, 0.14)'; ctx.fill();

      ctx.beginPath();
      for (let i = 0; i <= maxBin; i++) {
        const px = x + (i / maxBin) * w, py = y + h - (freqData[i] / 255) * (h - 22);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5; ctx.stroke();

      ctx.fillStyle = '#7a8496'; ctx.font = `11px ${FONT}`;
      ctx.fillText('FFT SPECTRUM (0–10 kHz)', x + 10, y + 16);
      for (let hz = 2000; hz <= 8000; hz += 2000) {
        ctx.fillText(`${hz / 1000}k`, x + (hz / maxHz) * w - 8, y + h - 6);
      }
    }

    function loop() {
      if (!held) {
        if (analyser && mode !== 'idle') {
          analyser.getFloatTimeDomainData(timeData);
          analyser.getByteFrequencyData(freqData);
          let min = 1, max = -1, pBin = 0, pVal = 0;
          for (let i = 0; i < timeData.length; i++) {
            if (timeData[i] < min) min = timeData[i];
            if (timeData[i] > max) max = timeData[i];
          }
          for (let i = 1; i < freqData.length; i++) {
            if (freqData[i] > pVal) { pVal = freqData[i]; pBin = i; }
          }
          const peakHz = Math.round((pBin * ac.sampleRate) / analyser.fftSize);
          statsEl.textContent = `${mode} · peak ${peakHz}Hz · vpp ${(max - min).toFixed(2)}`;
        } else {
          timeData.fill(0); freqData.fill(0);
        }
      }
      const { w, h } = state;
      ctx.fillStyle = '#0c0e11'; ctx.fillRect(0, 0, w, h);
      const pad = 12, iw = Math.max(80, w - pad * 2), ih = Math.max(80, h - pad * 2);
      const v = viewSel.value;
      if (v === 'split') {
        const h1 = Math.floor((ih - pad) * 0.54);
        drawScope(pad, pad, iw, h1);
        drawFFT(pad, pad + h1 + pad, iw, ih - pad - h1);
      } else if (v === 'scope') drawScope(pad, pad, iw, ih);
      else drawFFT(pad, pad, iw, ih);
      rafId = requestAnimationFrame(loop);
    }

    synthBtn.addEventListener('click', toggleSynth);
    micBtn.addEventListener('click', toggleMic);
    waveSel.addEventListener('change', () => { if (osc) osc.type = waveSel.value; });
    freqSlider.addEventListener('input', () => {
      const f = parseFloat(freqSlider.value);
      freqVal.textContent = `${f}Hz`;
      if (osc && ac) osc.frequency.setTargetAtTime(f, ac.currentTime, 0.01);
    });
    cutSlider.addEventListener('input', () => {
      const f = parseFloat(cutSlider.value);
      cutVal.textContent = f >= 1000 ? `${(f / 1000).toFixed(1)}kHz` : `${f}Hz`;
      if (filter && ac) filter.frequency.setTargetAtTime(f, ac.currentTime, 0.015);
    });
    gainSlider.addEventListener('input', () => {
      if (gainNode && ac) gainNode.gain.setTargetAtTime(parseFloat(gainSlider.value), ac.currentTime, 0.015);
    });
    holdBtn.addEventListener('click', () => {
      held = !held;
      holdBtn.classList.toggle('active', held);
      holdBtn.textContent = held ? 'held' : 'hold';
    });

    App.register('scope', {
      onShow() { resize(); if (!rafId) rafId = requestAnimationFrame(loop); },
      onHide() { stopSources(); if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    });
  })();

  // =========================================================================
  // 03: VISUAL 8-BIT CPU & RAM PLAYGROUND
  // =========================================================================
  (() => {
    const canvas = document.getElementById('cpu-canvas');
    const wrap = document.getElementById('cpu-wrap');
    const { ctx, state, resize } = bindCanvas(wrap, canvas);

    const codeEl = document.getElementById('cpu-code');
    const presetSel = document.getElementById('cpu-preset');
    const ramEl = document.getElementById('cpu-ram');
    const statsEl = document.getElementById('cpu-stats');
    const runBtn = document.getElementById('cpu-run');
    const speedSlider = document.getElementById('cpu-speed');
    const speedVal = document.getElementById('cpu-speed-val');

    const PRESETS = {
      fib: `; write 10 fibonacci numbers into RAM[0..9]
MOV R0, 0      ; a
MOV R1, 1      ; b
MOV R3, 0      ; ptr = 0
loop:
ST [R3], R0    ; *ptr = a
MOV R2, R0
ADD R2, R1     ; next = a + b
MOV R0, R1
MOV R1, R2
ADD R3, 1      ; ptr++
CMP R3, 10
JL loop
HLT`,
      sum: `; sum integers 1..10 -> RAM[0]
MOV R0, 0      ; acc
MOV R1, 1      ; i = 1
loop:
ADD R0, R1
ADD R1, 1
CMP R1, 11
JL loop
ST [0], R0
HLT`,
      copy: `; init [0..4] then copy via pointers to [16..20]
MOV R0, 10
ST [0], R0
MOV R0, 20
ST [1], R0
MOV R0, 30
ST [2], R0
MOV R0, 40
ST [3], R0
MOV R0, 50
ST [4], R0
MOV R1, 0      ; src ptr
MOV R2, 16     ; dst ptr
copy:
LD R0, [R1]
ST [R2], R0
ADD R1, 1
ADD R2, 1
CMP R1, 5
JL copy
HLT`
    };

    const cpu = {
      regs: new Uint8Array(4),
      ram: new Uint8Array(32),
      pc: 0, z: 0, lt: 0, cycles: 0, halted: false,
      lastOp: 'idle', aluInfo: 'idle', lastReg: -1, lastRam: -1
    };

    let prog = [], labels = {}, running = false, hz = 3, lastStepMs = 0, rafId = null;
    let packets = []; // { from, to, t, color, text }

    function buildRamDom() {
      ramEl.innerHTML = '';
      for (let i = 0; i < 32; i++) {
        const d = document.createElement('div');
        d.className = 'ram-cell';
        d.id = `ram-c-${i}`;
        d.innerHTML = `<span class="addr">${i.toString(16).padStart(2, '0').toUpperCase()}</span><span class="val">00</span>`;
        ramEl.appendChild(d);
      }
    }

    function refreshRamDom() {
      for (let i = 0; i < 32; i++) {
        const el = document.getElementById(`ram-c-${i}`);
        if (!el) continue;
        const v = cpu.ram[i];
        el.querySelector('.val').textContent = v.toString(16).padStart(2, '0').toUpperCase();
        el.classList.toggle('nonzero', v !== 0);
        el.classList.toggle('hit', i === cpu.lastRam);
      }
    }

    function assemble() {
      prog = []; labels = {};
      const lines = codeEl.value.split('\n');
      for (const rawLine of lines) {
        const clean = rawLine.split(';')[0].trim();
        if (!clean) continue;
        if (clean.endsWith(':')) {
          labels[clean.slice(0, -1).toUpperCase()] = prog.length;
        } else {
          const parts = clean.replace(/,/g, ' ').split(/\s+/);
          prog.push({
            op: parts[0].toUpperCase(),
            a: parts[1] ? parts[1].toUpperCase() : null,
            b: parts[2] ? parts[2].toUpperCase() : null,
            raw: clean
          });
        }
      }
      resetCpu();
      statsEl.textContent = `assembled ${prog.length} instructions`;
    }

    function resetCpu() {
      cpu.regs.fill(0); cpu.ram.fill(0);
      cpu.pc = 0; cpu.z = 0; cpu.lt = 0; cpu.cycles = 0;
      cpu.halted = false; cpu.lastOp = 'ready'; cpu.aluInfo = 'idle';
      cpu.lastReg = -1; cpu.lastRam = -1;
      packets = [];
      stopRun();
      refreshRamDom();
    }

    function stopRun() {
      running = false;
      runBtn.textContent = 'run';
      runBtn.classList.remove('active');
    }

    const regIdx = (s) => (s && /^R[0-3]$/.test(s)) ? parseInt(s[1], 10) : -1;
    function readVal(tok) {
      const r = regIdx(tok);
      if (r >= 0) return cpu.regs[r];
      return (parseInt(tok, 0) || 0) & 0xFF;
    }
    function readAddr(tok) {
      if (!tok || !tok.startsWith('[') || !tok.endsWith(']')) return 0;
      const inner = tok.slice(1, -1);
      const r = regIdx(inner);
      return (r >= 0 ? cpu.regs[r] : (parseInt(inner, 0) || 0)) & 0x1F;
    }

    function emitPacket(from, to, text, color = '#34d399') {
      packets.push({ from, to, t: 0, text, color });
    }

    function step() {
      if (cpu.halted || cpu.pc < 0 || cpu.pc >= prog.length) {
        cpu.halted = true; stopRun(); return;
      }
      const ins = prog[cpu.pc];
      cpu.lastOp = ins.raw;
      cpu.lastReg = -1;
      cpu.lastRam = -1;
      cpu.cycles++;
      let nextPc = cpu.pc + 1;

      emitPacket('ctrl', 'regs', ins.op, '#7a8496');

      if (ins.op === 'MOV') {
        const d = regIdx(ins.a), v = readVal(ins.b);
        if (d >= 0) { cpu.regs[d] = v; cpu.lastReg = d; emitPacket('ctrl', 'regs', `${v}`, '#34d399'); }
      } else if (ins.op === 'ADD' || ins.op === 'SUB') {
        const d = regIdx(ins.a), v = readVal(ins.b);
        if (d >= 0) {
          const a = cpu.regs[d];
          const res = (ins.op === 'ADD' ? a + v : a - v) & 0xFF;
          cpu.regs[d] = res; cpu.z = res === 0 ? 1 : 0; cpu.lt = (ins.op === 'SUB' && a < v) ? 1 : 0;
          cpu.lastReg = d; cpu.aluInfo = `${a} ${ins.op === 'ADD' ? '+' : '-'} ${v} = ${res}`;
          emitPacket('regs', 'alu', `${a},${v}`, '#f59e0b');
          emitPacket('alu', 'regs', `${res}`, '#34d399');
        }
      } else if (ins.op === 'CMP') {
        const a = readVal(ins.a), b = readVal(ins.b);
        cpu.z = a === b ? 1 : 0; cpu.lt = a < b ? 1 : 0;
        cpu.aluInfo = `CMP ${a} vs ${b} (Z=${cpu.z} L=${cpu.lt})`;
        emitPacket('regs', 'alu', `${a}?${b}`, '#f59e0b');
      } else if (ins.op === 'LD') {
        const d = regIdx(ins.a), addr = readAddr(ins.b);
        if (d >= 0) {
          cpu.regs[d] = cpu.ram[addr]; cpu.lastReg = d; cpu.lastRam = addr;
          emitPacket('ram', 'regs', `[${addr}]->${cpu.regs[d]}`, '#34d399');
        }
      } else if (ins.op === 'ST') {
        const addr = readAddr(ins.a), v = readVal(ins.b);
        cpu.ram[addr] = v; cpu.lastRam = addr;
        emitPacket('regs', 'ram', `${v}->[${addr}]`, '#f59e0b');
      } else if (ins.op === 'JMP' && labels[ins.a] !== undefined) {
        nextPc = labels[ins.a];
      } else if (ins.op === 'JZ' && cpu.z && labels[ins.a] !== undefined) {
        nextPc = labels[ins.a];
      } else if (ins.op === 'JNZ' && !cpu.z && labels[ins.a] !== undefined) {
        nextPc = labels[ins.a];
      } else if (ins.op === 'JL' && cpu.lt && labels[ins.a] !== undefined) {
        nextPc = labels[ins.a];
      } else if (ins.op === 'HLT') {
        cpu.halted = true; stopRun();
      }

      cpu.pc = nextPc;
      refreshRamDom();
      statsEl.textContent = `pc:${cpu.pc} · cycles:${cpu.cycles} · Z:${cpu.z} L:${cpu.lt} · ${cpu.halted ? 'HALTED' : cpu.lastOp}`;
    }

    function drawBox(x, y, w, h, title, hi) {
      ctx.fillStyle = '#13161b';
      ctx.strokeStyle = hi ? '#34d399' : '#262c36';
      ctx.lineWidth = hi ? 1.8 : 1.2;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#7a8496';
      ctx.font = `10px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(title, x + 8, y + 14);
    }

    function loop(now) {
      if (running && now - lastStepMs >= 1000 / hz) {
        lastStepMs = now;
        step();
      }

      const { w, h } = state;
      ctx.fillStyle = '#0c0e11';
      ctx.fillRect(0, 0, w, h);

      const pad = 18;
      const colW = Math.min(210, Math.max(130, (w - pad * 4) / 3));
      const topY = 22;
      const boxH = Math.max(120, Math.min(180, h - 90));

      const ctrlB = { x: pad, y: topY, w: colW, h: boxH };
      const regsB = { x: (w - colW) / 2, y: topY, w: colW, h: boxH };
      const aluB  = { x: w - pad - colW, y: topY, w: colW, h: boxH };
      const busY  = Math.min(h - 24, topY + boxH + 34);

      const anchors = {
        ctrl: { x: ctrlB.x + ctrlB.w / 2, y: ctrlB.y + ctrlB.h },
        regs: { x: regsB.x + regsB.w / 2, y: regsB.y + regsB.h },
        alu:  { x: aluB.x + aluB.w / 2,   y: aluB.y + aluB.h },
        ram:  { x: w / 2,                 y: h - 4 }
      };

      // Draw system bus rails
      ctx.strokeStyle = '#252c38';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(anchors.ctrl.x, busY);
      ctx.lineTo(anchors.alu.x, busY);
      for (const k of ['ctrl', 'regs', 'alu', 'ram']) {
        ctx.moveTo(anchors[k].x, anchors[k].y);
        ctx.lineTo(anchors[k].x, busY);
      }
      ctx.stroke();

      // Control / Fetch box
      drawBox(ctrlB.x, ctrlB.y, ctrlB.w, ctrlB.h, 'CONTROL UNIT', running);
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = '#d8dee9';
      ctx.fillText(`PC    : ${cpu.pc.toString().padStart(2, '0')}`, ctrlB.x + 10, ctrlB.y + 42);
      ctx.fillText(`CYCLE : ${cpu.cycles}`, ctrlB.x + 10, ctrlB.y + 62);
      ctx.fillText(`FLAGS : Z=${cpu.z}  L=${cpu.lt}`, ctrlB.x + 10, ctrlB.y + 82);
      ctx.fillStyle = cpu.halted ? '#f87171' : '#34d399';
      ctx.fillText(`IR: ${cpu.lastOp.slice(0, 18)}`, ctrlB.x + 10, ctrlB.y + 110);

      // Register File box
      drawBox(regsB.x, regsB.y, regsB.w, regsB.h, 'REGISTERS (8-BIT)', cpu.lastReg >= 0);
      for (let i = 0; i < 4; i++) {
        const ry = regsB.y + 38 + i * 24;
        const hi = cpu.lastReg === i;
        ctx.fillStyle = hi ? '#34d399' : '#d8dee9';
        const dec = cpu.regs[i].toString().padStart(3, ' ');
        const hex = cpu.regs[i].toString(16).padStart(2, '0').toUpperCase();
        ctx.fillText(`R${i}  0x${hex}  (${dec})`, regsB.x + 10, ry);
      }

      // ALU box
      drawBox(aluB.x, aluB.y, aluB.w, aluB.h, 'ALU', cpu.aluInfo !== 'idle');
      ctx.fillStyle = '#f59e0b';
      ctx.font = `12px ${FONT}`;
      ctx.fillText(cpu.aluInfo.slice(0, 22), aluB.x + 10, aluB.y + 54);
      ctx.fillStyle = '#7a8496';
      ctx.font = `11px ${FONT}`;
      ctx.fillText('8-bit unsigned wrap', aluB.x + 10, aluB.y + 84);

      // Animate data packets along the bus
      for (let i = packets.length - 1; i >= 0; i--) {
        const pk = packets[i];
        pk.t += 0.04;
        if (pk.t >= 1) { packets.splice(i, 1); continue; }
        const pA = anchors[pk.from], pB = anchors[pk.to];
        let px, py;
        if (pk.t < 0.25) {
          const u = pk.t / 0.25;
          px = pA.x; py = pA.y + (busY - pA.y) * u;
        } else if (pk.t < 0.75) {
          const u = (pk.t - 0.25) / 0.5;
          px = pA.x + (pB.x - pA.x) * u; py = busY;
        } else {
          const u = (pk.t - 0.75) / 0.25;
          px = pB.x; py = busY + (pB.y - busY) * u;
        }
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = pk.color;
        ctx.fill();
        ctx.fillStyle = '#d8dee9';
        ctx.font = `10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(pk.text, px, py - 9);
      }
      ctx.textAlign = 'left';

      rafId = requestAnimationFrame(loop);
    }

    buildRamDom();
    codeEl.value = PRESETS.fib;
    assemble();

    presetSel.addEventListener('change', () => { codeEl.value = PRESETS[presetSel.value]; assemble(); });
    document.getElementById('cpu-asm').addEventListener('click', assemble);
    document.getElementById('cpu-step').addEventListener('click', () => { stopRun(); step(); });
    document.getElementById('cpu-reset').addEventListener('click', resetCpu);
    runBtn.addEventListener('click', () => {
      if (running) stopRun();
      else {
        if (cpu.halted) resetCpu();
        running = true; lastStepMs = 0;
        runBtn.textContent = 'pause'; runBtn.classList.add('active');
      }
    });
    speedSlider.addEventListener('input', () => {
      hz = parseInt(speedSlider.value, 10);
      speedVal.textContent = `${hz}Hz`;
    });

    App.register('cpu', {
      onShow() { resize(); if (!rafId) rafId = requestAnimationFrame(loop); },
      onHide() { stopRun(); if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    });
  })();

  // =========================================================================
  // 04: EM FIELDS & 2D WAVE INTERFERENCE
  // =========================================================================
  (() => {
    const canvas = document.getElementById('fields-canvas');
    const wrap = document.getElementById('fields-wrap');
    const { ctx, state, resize } = bindCanvas(wrap, canvas);

    const modeSel = document.getElementById('fields-mode');
    const efCtrls = document.getElementById('fields-ef-ctrls');
    const wvCtrls = document.getElementById('fields-wv-ctrls');
    const hintEl = document.getElementById('fields-hint');
    const statsEl = document.getElementById('fields-stats');
    const freqSlider = document.getElementById('fields-freq');
    const freqVal = document.getElementById('fields-freq-val');

    let mode = 'efield', rafId = null, dragging = null, waveTime = 0, waveFreq = 3.0;
    let charges = [], particles = [], sources = [];

    // Offscreen low-res buffer for smooth 60fps wave interference
    const wOff = document.createElement('canvas');
    wOff.width = 180; wOff.height = 110;
    const wCtx = wOff.getContext('2d');
    const wImg = wCtx.createImageData(wOff.width, wOff.height);

    function loadEfieldPreset(name) {
      const cx = state.w / 2 || 400, cy = state.h / 2 || 240;
      particles = [];
      if (name === 'dipole') {
        charges = [{ x: cx - 120, y: cy, q: 1 }, { x: cx + 120, y: cy, q: -1 }];
      } else if (name === 'quad') {
        charges = [
          { x: cx - 110, y: cy - 85, q: 1 }, { x: cx + 110, y: cy - 85, q: -1 },
          { x: cx - 110, y: cy + 85, q: -1 }, { x: cx + 110, y: cy + 85, q: 1 }
        ];
      } else {
        charges = [{ x: cx - 110, y: cy, q: 1 }, { x: cx + 110, y: cy, q: 1 }];
      }
      burstParticles();
    }

    function resetWaveSources() {
      const cx = state.w / 2 || 400, cy = state.h / 2 || 240;
      sources = [{ x: cx - 90, y: cy }, { x: cx + 90, y: cy }];
    }

    function burstParticles() {
      for (let i = 0; i < 24; i++) {
        const a = (Math.PI * 2 * i) / 24;
        const c = charges.find(ch => ch.q > 0) || { x: state.w / 2, y: state.h / 2 };
        particles.push({
          x: c.x + Math.cos(a) * 26, y: c.y + Math.sin(a) * 26,
          vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6, trail: []
        });
      }
      if (particles.length > 90) particles.splice(0, particles.length - 90);
    }

    function fieldAt(x, y) {
      let ex = 0, ey = 0;
      for (const c of charges) {
        const dx = x - c.x, dy = y - c.y;
        const r2 = dx * dx + dy * dy + 160;
        const f = (c.q * 6000) / (r2 * Math.sqrt(r2));
        ex += dx * f; ey += dy * f;
      }
      return { ex, ey };
    }

    function drawEfield() {
      const { w, h } = state;
      ctx.fillStyle = '#0c0e11'; ctx.fillRect(0, 0, w, h);

      // Vector grid
      const step = 30;
      for (let gx = step; gx < w; gx += step) {
        for (let gy = step; gy < h; gy += step) {
          const { ex, ey } = fieldAt(gx, gy);
          const mag = Math.hypot(ex, ey);
          if (mag < 0.001) continue;
          const nx = ex / mag, ny = ey / mag;
          const len = Math.min(13, 4 + Math.log1p(mag * 18) * 4);
          const alpha = Math.min(0.85, 0.14 + mag * 3.2);
          ctx.strokeStyle = `rgba(52, 211, 153, ${alpha.toFixed(2)})`;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(gx - nx * len * 0.5, gy - ny * len * 0.5);
          ctx.lineTo(gx + nx * len * 0.5, gy + ny * len * 0.5);
          ctx.stroke();
        }
      }

      // Test particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const { ex, ey } = fieldAt(p.x, p.y);
        p.vx = (p.vx + ex * 0.9) * 0.985;
        p.vy = (p.vy + ey * 0.9) * 0.985;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 6) { p.vx = (p.vx / sp) * 6; p.vy = (p.vy / sp) * 6; }
        p.x += p.vx; p.y += p.vy;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 26) p.trail.shift();

        if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20 ||
            charges.some(c => c.q < 0 && Math.hypot(p.x - c.x, p.y - c.y) < 14)) {
          particles.splice(i, 1); continue;
        }
        ctx.beginPath();
        for (let k = 0; k < p.trail.length; k++) {
          const pt = p.trail[k];
          if (k === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        }
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }

      // Charges
      ctx.font = `bold 14px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const c of charges) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = c.q > 0 ? '#113026' : '#331c1c';
        ctx.fill();
        ctx.strokeStyle = c.q > 0 ? '#34d399' : '#f87171';
        ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = c.q > 0 ? '#34d399' : '#f87171';
        ctx.fillText(c.q > 0 ? '+' : '-', c.x, c.y + 1);
      }
      statsEl.textContent = `${charges.length} charges · ${particles.length} test particles`;
    }

    function drawWaves() {
      const { w, h } = state;
      const ow = wOff.width, oh = wOff.height;
      const sx = w / ow, sy = h / oh;
      const data = wImg.data;
      const k = waveFreq * 0.055;
      waveTime += 0.14;

      for (let py = 0; py < oh; py++) {
        const wy = py * sy;
        for (let px = 0; px < ow; px++) {
          const wx = px * sx;
          let sum = 0;
          for (let i = 0; i < sources.length; i++) {
            const r = Math.hypot(wx - sources[i].x, wy - sources[i].y);
            sum += Math.sin(r * k - waveTime) / (1 + r * 0.004);
          }
          const norm = Math.max(-1, Math.min(1, sum / Math.max(1, sources.length * 0.65)));
          const idx = (py * ow + px) * 4;
          if (norm >= 0) {
            data[idx]     = 12 + norm * 40;
            data[idx + 1] = 14 + norm * 197;
            data[idx + 2] = 17 + norm * 136;
          } else {
            const n = -norm;
            data[idx]     = 12 + n * 120;
            data[idx + 1] = 14 + n * 70;
            data[idx + 2] = 17 + n * 10;
          }
          data[idx + 3] = 255;
        }
      }
      wCtx.putImageData(wImg, 0, 0);
      ctx.drawImage(wOff, 0, 0, w, h);

      for (const s of sources) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#0c0e11'; ctx.fill();
        ctx.strokeStyle = '#d8dee9'; ctx.lineWidth = 2; ctx.stroke();
      }
      statsEl.textContent = `${sources.length} wave sources · k=${waveFreq.toFixed(1)}`;
    }

    function loop() {
      if (mode === 'efield') drawEfield(); else drawWaves();
      rafId = requestAnimationFrame(loop);
    }

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) return;
      const p = pointerPos(canvas, e);
      const list = mode === 'efield' ? charges : sources;
      const hit = list.find(o => Math.hypot(o.x - p.x, o.y - p.y) < 18);
      if (hit) { dragging = hit; return; }
      if (mode === 'efield') {
        particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, trail: [] });
      } else {
        sources.push({ x: p.x, y: p.y });
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const p = pointerPos(canvas, e);
      dragging.x = p.x; dragging.y = p.y;
    });

    window.addEventListener('mouseup', () => { dragging = null; });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = pointerPos(canvas, e);
      if (mode === 'efield') charges = charges.filter(c => Math.hypot(c.x - p.x, c.y - p.y) >= 18);
      else sources = sources.filter(s => Math.hypot(s.x - p.x, s.y - p.y) >= 18);
    });

    modeSel.addEventListener('change', () => {
      mode = modeSel.value;
      efCtrls.classList.toggle('hidden', mode !== 'efield');
      wvCtrls.classList.toggle('hidden', mode !== 'waves');
      hintEl.textContent = mode === 'efield'
        ? 'drag charges to warp field | click empty space to drop test particle | right-click charge to remove'
        : 'drag emitters to shift interference fringes | click empty space to add source | right-click to remove';
      if (mode === 'waves' && sources.length === 0) resetWaveSources();
    });

    document.getElementById('fields-add-pos').addEventListener('click', () => {
      charges.push({ x: state.w * (0.25 + Math.random() * 0.5), y: state.h * (0.25 + Math.random() * 0.5), q: 1 });
    });
    document.getElementById('fields-add-neg').addEventListener('click', () => {
      charges.push({ x: state.w * (0.25 + Math.random() * 0.5), y: state.h * (0.25 + Math.random() * 0.5), q: -1 });
    });
    document.getElementById('fields-spawn').addEventListener('click', burstParticles);
    document.getElementById('fields-preset').addEventListener('change', e => loadEfieldPreset(e.target.value));
    document.getElementById('fields-add-src').addEventListener('click', () => {
      sources.push({ x: state.w * (0.25 + Math.random() * 0.5), y: state.h * (0.25 + Math.random() * 0.5) });
    });
    document.getElementById('fields-slit').addEventListener('click', resetWaveSources);
    freqSlider.addEventListener('input', () => {
      waveFreq = parseFloat(freqSlider.value);
      freqVal.textContent = waveFreq.toFixed(1);
    });
    document.getElementById('fields-clear').addEventListener('click', () => {
      if (mode === 'efield') { charges = []; particles = []; } else sources = [];
    });

    let fieldsInit = false;
    App.register('fields', {
      onShow() {
        resize();
        if (!fieldsInit) { loadEfieldPreset('dipole'); resetWaveSources(); fieldsInit = true; }
        if (!rafId) rafId = requestAnimationFrame(loop);
      },
      onHide() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    });
  })();

  // =========================================================================
  // 05: PATHFINDING & LIVE NEURAL NET ARENA
  // =========================================================================
  (() => {
    const canvas = document.getElementById('arena-canvas');
    const wrap = document.getElementById('arena-wrap');
    const { ctx, state, resize } = bindCanvas(wrap, canvas);

    const modeSel = document.getElementById('arena-mode');
    const pfCtrls = document.getElementById('arena-pf-ctrls');
    const nnCtrls = document.getElementById('arena-nn-ctrls');
    const algoSel = document.getElementById('arena-algo');
    const dsSel = document.getElementById('arena-dataset');
    const lrSlider = document.getElementById('arena-lr');
    const lrVal = document.getElementById('arena-lr-val');
    const trainBtn = document.getElementById('arena-nn-train');
    const hintEl = document.getElementById('arena-hint');
    const statsEl = document.getElementById('arena-stats');

    let mode = 'pathfind', rafId = null;

    // --- Pathfinding State ---
    const COLS = 35, ROWS = 21;
    let walls = Array.from({ length: ROWS }, () => new Uint8Array(COLS));
    let start = { c: 3, r: 10 }, goal = { c: 31, r: 10 };
    let visited = new Set(), frontier = new Set(), path = [], pfQueue = null, pfRunning = false;
    let dragMode = null; // 'wall' | 'erase' | 'start' | 'goal'

    function gridGeom() {
      const pad = 16;
      const cell = Math.max(8, Math.floor(Math.min((state.w - pad * 2) / COLS, (state.h - pad * 2) / ROWS)));
      const ox = Math.floor((state.w - cell * COLS) / 2);
      const oy = Math.floor((state.h - cell * ROWS) / 2);
      return { cell, ox, oy };
    }

    function cellAt(px, py) {
      const { cell, ox, oy } = gridGeom();
      const c = Math.floor((px - ox) / cell), r = Math.floor((py - oy) / cell);
      return (c >= 0 && c < COLS && r >= 0 && r < ROWS) ? { c, r } : null;
    }

    const key = (c, r) => `${c},${r}`;

    function resetSearch() {
      visited.clear(); frontier.clear(); path = []; pfQueue = null; pfRunning = false;
    }

    function genMaze() {
      resetSearch();
      walls = Array.from({ length: ROWS }, () => new Uint8Array(COLS).fill(1));
      const carve = (c, r) => {
        walls[r][c] = 0;
        const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]].sort(() => Math.random() - 0.5);
        for (const [dc, dr] of dirs) {
          const nc = c + dc, nr = r + dr;
          if (nc > 0 && nc < COLS - 1 && nr > 0 && nr < ROWS - 1 && walls[nr][nc] === 1) {
            walls[r + dr / 2][c + dc / 2] = 0;
            carve(nc, nr);
          }
        }
      };
      carve(1, 1);
      start = { c: 1, r: 1 }; goal = { c: COLS - 2, r: ROWS - 2 };
      walls[start.r][start.c] = 0; walls[goal.r][goal.c] = 0;
      statsEl.textContent = 'maze generated';
    }

    function startSearch() {
      resetSearch();
      const k0 = key(start.c, start.r);
      const gScore = new Map([[k0, 0]]);
      const cameFrom = new Map();
      const open = [{ c: start.c, r: start.r, g: 0, f: 0 }];
      frontier.add(k0);
      pfQueue = { open, gScore, cameFrom, algo: algoSel.value };
      pfRunning = true;
    }

    function stepSearch() {
      if (!pfRunning || !pfQueue) return;
      const { open, gScore, cameFrom, algo } = pfQueue;
      for (let iter = 0; iter < 6 && open.length > 0; iter++) {
        let idx = 0;
        if (algo !== 'bfs') {
          for (let i = 1; i < open.length; i++) if (open[i].f < open[idx].f) idx = i;
        }
        const cur = open.splice(idx, 1)[0];
        const ck = key(cur.c, cur.r);
        frontier.delete(ck);
        if (visited.has(ck)) continue;
        visited.add(ck);

        if (cur.c === goal.c && cur.r === goal.r) {
          let p = ck;
          while (p) {
            const [c, r] = p.split(',').map(Number);
            path.push({ c, r });
            p = cameFrom.get(p);
          }
          pfRunning
