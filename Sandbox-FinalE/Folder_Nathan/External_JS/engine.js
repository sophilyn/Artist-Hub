/* ==========================================================================
   engine.js  (Nathan's Studio)
   --------------------------------------------------------------------------
   The "brain" of the DAW:
     - the song/project data format and the demo song
     - Graph    : the mixer (track volumes -> reverb -> compressor -> speakers)
     - Player   : live playback with looping, play-head position, live preview
     - render() : plays the song into an OfflineAudioContext so it can be
                  exported much faster than real time

   A PROJECT looks like this (everything is measured in 16th-note "steps"):
     { name, bpm, bars, reverb,
       tracks:[ { id, name, inst, vol, mute, solo, color,
                  notes:[ { m: midiNote, s: startStep, l: lengthInSteps, v: velocity } ] } ] }
   ========================================================================== */
(function (global) {
  'use strict';

  const STEPS_PER_BAR = 16;                                  // 4/4 time, 16th-note grid
  const stepSeconds = (bpm) => 60 / bpm / 4;                 // seconds in one 16th note
  const totalSteps = (project) => project.bars * STEPS_PER_BAR;

  // Track colours borrowed from the site's colour theme (base.css)
  const COLORS = ['#ff4fa3', '#4de1ff', '#ffe600', '#9d4edd', '#5dff9d', '#ff8a3d', '#7aa2ff', '#ff6b6b'];

  let idCounter = 1;
  const newId = () => 't' + Date.now().toString(36) + (idCounter++);

  /* ---------- Project creation ---------- */
  function makeTrack(instId, index) {
    const info = Instruments.get(instId);
    return {
      id: newId(),
      name: info ? info.name.replace(' (synth)', '') : 'Track',
      inst: instId,
      vol: 0.8,
      mute: false,
      solo: false,
      color: COLORS[index % COLORS.length],
      notes: []
    };
  }

  function blankProject() {
    return { name: 'My Song', bpm: 120, bars: 4, reverb: 0.15, tracks: [makeTrack('piano', 0)] };
  }

  /* ---------- Demo song: a Daft-Punk-flavoured loop made with the notes below ---------- */
  function demoProject() {
    const p = { name: 'Demo - Robot Groove', bpm: 123, bars: 8, reverb: 0.18, tracks: [] };
    const mk = (inst, name, vol) => {
      const t = makeTrack(inst, p.tracks.length);
      t.name = name; t.vol = vol;
      p.tracks.push(t);
      return t;
    };
    const drums = mk('drums', 'Drums', 0.85);
    const bass = mk('dpbass', 'Disco Bass', 0.8);
    const stabs = mk('supersaw', 'Supersaw Stabs', 0.55);
    const keys = mk('epiano', 'Rhodes Chords', 0.8);
    const lead = mk('lead', 'Digital Lead', 0.6);
    const horn = mk('trumpet', 'Trumpet', 0.8);
    const voice = mk('robot', 'Robot Voice', 0.6);

    const add = (t, bar, step, midi, len, vel) => t.notes.push({ m: midi, s: bar * 16 + step, l: len, v: vel === undefined ? 0.8 : vel });

    // Chord progression: A minor, F, C, G (two bars each)
    const prog = [
      { root: 33, chord: [57, 60, 64] },
      { root: 29, chord: [53, 57, 60] },
      { root: 36, chord: [55, 60, 64] },
      { root: 31, chord: [55, 59, 62] }
    ];
    // Lead melody: [midi, step, length] - first bar and second bar of each chord
    const phrases = [
      [[[69, 0, 2], [72, 2, 2], [76, 4, 4], [74, 8, 2], [72, 10, 2], [69, 12, 4]], [[64, 0, 4], [67, 4, 4], [69, 8, 8]]],
      [[[65, 0, 2], [69, 2, 2], [72, 4, 4], [67, 8, 2], [69, 10, 2], [65, 12, 4]], [[60, 0, 4], [65, 4, 4], [69, 8, 8]]],
      [[[67, 0, 2], [72, 2, 2], [76, 4, 4], [74, 8, 2], [72, 10, 2], [67, 12, 4]], [[64, 0, 4], [67, 4, 4], [72, 8, 8]]],
      [[[67, 0, 2], [71, 2, 2], [74, 4, 4], [72, 8, 2], [71, 10, 2], [67, 12, 4]], [[62, 0, 4], [67, 4, 4], [71, 8, 8]]]
    ];

    for (let bar = 0; bar < 8; bar++) {
      const ci = Math.floor(bar / 2), ch = prog[ci];

      // Drums: four-on-the-floor kick, claps on 2 and 4, off-beat open hats, 16th closed hats
      [0, 4, 8, 12].forEach((s) => add(drums, bar, s, 36, 1, 0.95));
      [4, 12].forEach((s) => add(drums, bar, s, 39, 1, 0.8));
      [2, 6, 10, 14].forEach((s) => add(drums, bar, s, 46, 1, 0.55));
      [1, 3, 5, 7, 9, 11, 13, 15].forEach((s) => add(drums, bar, s, 42, 1, 0.3));
      if (bar === 7) [12, 13, 14, 15].forEach((s, i) => add(drums, bar, s, i < 2 ? 38 : 45, 1, 0.7));   // fill

      // Disco bass: root / octave bounce
      for (let s = 0; s < 16; s += 2) add(bass, bar, s, ch.root + (s % 4 === 2 ? 12 : 0), s % 4 === 2 ? 1 : 2, 0.85);

      // Supersaw stabs and Rhodes chords come in on bar 3
      if (bar >= 2) {
        [2, 6, 10, 14].forEach((s) => ch.chord.forEach((n) => add(stabs, bar, s, n, 1, 0.6)));
        ch.chord.forEach((n) => { add(keys, bar, 0, n, 8, 0.6); add(keys, bar, 10, n, 6, 0.55); });
      }
      // Lead comes in on bar 5
      if (bar >= 4) phrases[ci][bar % 2].forEach((n) => add(lead, bar, n[1], n[0], n[2], 0.8));
      // Trumpet doubles the melody (one octave up... then back in range) and the robot sings on the last 4 bars
      if (bar >= 6) phrases[ci][bar % 2].forEach((n) => add(horn, bar, n[1], n[0], n[2], 0.85));
      if (bar >= 4) add(voice, bar, 0, ch.chord[2], 16, 0.7);
    }
    return p;
  }

  /* ---------- Mixer graph (works for live AND offline contexts) ---------- */
  function makeImpulse(ctx, seconds) {
    // Fake room: noise that fades away exponentially = a simple reverb tail
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  class Graph {
    constructor(ctx, withAnalyser) {
      this.ctx = ctx;
      this.buses = {};                                   // track id -> GainNode

      this.master = ctx.createGain();
      this.master.gain.value = 0.8;

      this.comp = ctx.createDynamicsCompressor();        // glues the mix together & prevents clipping
      this.comp.threshold.value = -10;
      this.comp.knee.value = 12;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.005;
      this.comp.release.value = 0.15;

      this.reverbIn = ctx.createGain();                  // "send" level for the reverb
      this.reverbIn.gain.value = 0;
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = makeImpulse(ctx, 2.2);

      this.master.connect(this.comp);
      this.reverbIn.connect(this.reverb);
      this.reverb.connect(this.master);

      this.analyser = null;
      if (withAnalyser) {
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.7;
        this.comp.connect(this.analyser);
        this.analyser.connect(ctx.destination);
      } else {
        this.comp.connect(ctx.destination);
      }
    }

    // Get (or create) the volume bus for a track
    bus(track) {
      if (!this.buses[track.id]) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        g.connect(this.reverbIn);
        this.buses[track.id] = g;
      }
      return this.buses[track.id];
    }

    // Apply volume / mute / solo to every bus. "only" = render a single track (stems)
    applyMix(project, only) {
      const anySolo = project.tracks.some((t) => t.solo);
      project.tracks.forEach((t) => {
        let audible = !t.mute && (!anySolo || t.solo);
        if (only) audible = t.id === only;
        this.bus(t).gain.value = audible ? t.vol : 0;
      });
      this.reverbIn.gain.value = project.reverb;
    }
  }

  /* Schedule every note of a project starting at ctx time t0.
     fromStep skips notes that start before that step (play from the middle). */
  function schedule(project, graph, t0, fromStep, sink, skipSilent, only) {
    const sec = stepSeconds(project.bpm);
    const anySolo = project.tracks.some((t) => t.solo);
    project.tracks.forEach((t) => {
      const audible = only ? t.id === only : (!t.mute && (!anySolo || t.solo));
      if (skipSilent && !audible) return;
      const bus = graph.bus(t);
      t.notes.forEach((n) => {
        if (n.s < fromStep) return;
        Instruments.play(t.inst, graph.ctx, bus, n.m, t0 + (n.s - fromStep) * sec, n.l * sec, n.v, sink);
      });
    });
  }

  /* ---------- Offline rendering (for exports) ---------- */
  async function render(project, opts) {
    opts = opts || {};
    const sr = 44100;
    await Promise.all(project.tracks.map((t) => Instruments.load(t.inst)));
    const length = totalSteps(project) * stepSeconds(project.bpm);
    const tail = 2.5;                                           // let reverb and releases ring out
    const Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const ctx = new Ctx(2, Math.ceil((length + tail) * sr), sr);
    const graph = new Graph(ctx, false);
    graph.applyMix(project, opts.only);
    schedule(project, graph, 0, 0, null, true, opts.only);
    const buffer = await ctx.startRendering();
    return { buffer: buffer, songSeconds: length };
  }

  /* ---------- Live player ---------- */
  class Player {
    constructor(getProject) {
      this.getProject = getProject;
      this.ctx = null;
      this.graph = null;
      this.sink = [];            // every scheduled source node (so Stop can silence them)
      this.playing = false;
      this.loop = true;
      this.passStart = 0;        // ctx time at which step 0 of the current pass sits
      this.passSec = 0;          // seconds per step during the current pass
      this.timer = null;
      this.onEnded = null;       // callback when a non-looping song finishes
    }

    // Browsers only allow audio after a click, so the context is created lazily
    ensure() {
      if (!this.ctx) {
        const Ctx = global.AudioContext || global.webkitAudioContext;
        this.ctx = new Ctx({ latencyHint: 'interactive' });
        this.graph = new Graph(this.ctx, true);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    // Keep the mixer in sync with the project (volumes, mute, solo, reverb)
    syncMix() {
      if (!this.graph) return;
      this.graph.applyMix(this.getProject());
    }

    async start(fromStep) {
      const project = this.getProject();
      this.ensure();
      this.stopSound();
      this.playing = true;
      this.passSec = stepSeconds(project.bpm);
      this.passStart = this.ctx.currentTime + 0.1 - fromStep * this.passSec;
      this.syncMix();
      schedule(project, this.graph, this.passStart + fromStep * this.passSec, fromStep, this.sink, false, null);
      this.timer = setInterval(() => this.tick(), 60);
    }

    // Called every 60 ms: queue the next loop just before the current one ends
    tick() {
      if (!this.playing) return;
      const project = this.getProject();
      const passEnd = this.passStart + totalSteps(project) * this.passSec;
      const now = this.ctx.currentTime;
      if (now >= passEnd - 0.3 && !this.nextQueued) {
        if (this.loop) {
          this.nextQueued = true;
          const nextSec = stepSeconds(project.bpm);
          this.nextPass = { start: passEnd, sec: nextSec };
          this.syncMix();
          schedule(project, this.graph, passEnd, 0, this.sink, false, null);
        }
      }
      if (this.nextQueued && now >= passEnd) {              // the next pass has begun
        this.passStart = this.nextPass.start;
        this.passSec = this.nextPass.sec;
        this.nextQueued = false;
      } else if (!this.loop && now >= passEnd) {            // song finished
        this.playing = false;
        clearInterval(this.timer);
        if (this.onEnded) this.onEnded();
      }
    }

    // Current play-head position in steps (or null when stopped)
    getStep() {
      if (!this.playing) return null;
      const project = this.getProject();
      const step = (this.ctx.currentTime - this.passStart) / this.passSec;
      return Math.max(0, Math.min(totalSteps(project), step));
    }

    stopSound() {
      this.sink.forEach((s) => { try { s.stop(); } catch (e) { /* already stopped */ } });
      this.sink = [];
      this.nextQueued = false;
    }

    stop() {
      this.playing = false;
      clearInterval(this.timer);
      this.stopSound();
    }

    // Play one note right now (clicking the piano keys / typing on the keyboard)
    preview(trackId, instId, midi, seconds) {
      this.ensure();
      if (!Instruments.isReady(instId)) return;
      const project = this.getProject();
      const track = project.tracks.find((t) => t.id === trackId) || project.tracks[0];
      this.syncMix();
      Instruments.play(instId, this.ctx, this.graph.bus(track), midi, this.ctx.currentTime + 0.01, seconds || 0.4, 0.8, null);
    }

    // Spectrum data for the little visualiser (0-255 per bar)
    spectrum(out) {
      if (this.graph && this.graph.analyser) this.graph.analyser.getByteFrequencyData(out);
      else out.fill(0);
    }
  }

  global.Engine = {
    STEPS_PER_BAR: STEPS_PER_BAR,
    COLORS: COLORS,
    stepSeconds: stepSeconds,
    totalSteps: totalSteps,
    makeTrack: makeTrack,
    blankProject: blankProject,
    demoProject: demoProject,
    render: render,
    Player: Player
  };
})(window);
