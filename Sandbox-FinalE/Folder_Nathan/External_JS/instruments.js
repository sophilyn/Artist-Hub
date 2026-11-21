/* ==========================================================================
   instruments.js  (Nathan's Studio)
   --------------------------------------------------------------------------
   Everything that MAKES SOUND lives in this file:

   1. SAMPLED instruments  - real recordings of band instruments (piano,
      trumpet, tuba ...). They come from the free "FluidR3 GM" soundfont
      (Creative Commons BY 3.0), pre-cut into one MP3 per note by the
      open-source "midi-js-soundfonts" project. No AI-generated audio.
   2. SYNTH instruments    - Daft-Punk-style sounds built live with the
      Web Audio API (oscillators + filters). Pure maths, no samples.
   3. DRUMS                - a small synthesized drum kit (kick, snare ...).

   Public object:  window.Instruments
   ========================================================================== */
(function (global) {
  'use strict';

  /* Folder with the soundfont .js files, relative to HTML/studio.html */
  const SF_PATH = '../Audio/Soundfonts/';

  /* ---------- Small music helpers ---------- */

  // MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz)
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Note names used by the soundfont files, e.g. "Db4" -> MIDI number 61
  const SEMITONE = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
  function nameToMidi(name) {
    const parts = /^([A-G]b?)(-?\d)$/.exec(name);
    return 12 * (parseInt(parts[2], 10) + 1) + SEMITONE[parts[1]];
  }

  // MIDI number -> readable name for the piano-roll labels ("C4", "F#3")
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // useFlats = true gives "Ab4" instead of "G#4"
  const midiName = (m, useFlats) => (useFlats ? FLAT_NAMES : SHARP_NAMES)[m % 12] + (Math.floor(m / 12) - 1);
  // Black keys have two names for the same pitch: "G#4 / Ab4"
  const midiNameBoth = (m) => {
    const sharp = midiName(m, false), flat = midiName(m, true);
    return sharp === flat ? sharp : sharp + ' / ' + flat;
  };

  /* ---------- Drum kit layout (General MIDI drum numbers) ---------- */
  const DRUMS = [
    { m: 36, name: 'Kick' },
    { m: 38, name: 'Snare' },
    { m: 39, name: 'Clap' },
    { m: 42, name: 'Closed Hat' },
    { m: 46, name: 'Open Hat' },
    { m: 45, name: 'Tom' },
    { m: 56, name: 'Cowbell' }
  ];

  /* ---------- Instrument catalogue ----------
     id      : used inside saved projects
     name    : shown in the menus
     group   : <optgroup> label in the menus
     type    : 'sample' | 'synth' | 'drums'
     file    : soundfont file name (samples only)
     release : seconds the sound fades after a note ends
     center  : MIDI note the piano roll scrolls to for this instrument
     gm      : General MIDI program number (used for the MIDI export)  */
  const LIST = [
    { id: 'piano',    name: 'Grand Piano',      group: 'Keys',            type: 'sample', file: 'acoustic_grand_piano',  release: 0.35, center: 64, gm: 0 },
    { id: 'epiano',   name: 'Electric Piano',   group: 'Keys',            type: 'sample', file: 'electric_piano_1',      release: 0.30, center: 64, gm: 4 },
    { id: 'bass',     name: 'Bass Guitar',      group: 'Guitar & Bass',   type: 'sample', file: 'electric_bass_finger',  release: 0.15, center: 40, gm: 33 },
    { id: 'guitar',   name: 'Nylon Guitar',     group: 'Guitar & Bass',   type: 'sample', file: 'acoustic_guitar_nylon', release: 0.30, center: 58, gm: 24 },
    { id: 'eguitar',  name: 'Clean Electric Guitar', group: 'Guitar & Bass', type: 'sample', file: 'electric_guitar_clean', release: 0.25, center: 58, gm: 27 },
    { id: 'trumpet',  name: 'Trumpet',          group: 'Brass',           type: 'sample', file: 'trumpet',               sustain: true, release: 0.12, center: 66, gm: 56 },
    { id: 'trombone', name: 'Trombone',         group: 'Brass',           type: 'sample', file: 'trombone',              sustain: true, release: 0.12, center: 52, gm: 57 },
    { id: 'tuba',     name: 'Tuba',             group: 'Brass',           type: 'sample', file: 'tuba',                  sustain: true, release: 0.15, center: 38, gm: 58 },
    { id: 'sax',      name: 'Saxophone',        group: 'Woodwinds',       type: 'sample', file: 'alto_sax',              sustain: true, release: 0.12, center: 64, gm: 65 },
    { id: 'flute',    name: 'Flute',            group: 'Woodwinds',       type: 'sample', file: 'flute',                 sustain: true, release: 0.12, center: 76, gm: 73 },
    { id: 'clarinet', name: 'Clarinet',         group: 'Woodwinds',       type: 'sample', file: 'clarinet',              sustain: true, release: 0.12, center: 64, gm: 71 },
    { id: 'lead',     name: 'Digital Lead (synth)',  group: 'Daft Punk Synths', type: 'synth', release: 0.15, center: 72, gm: 81 },
    { id: 'supersaw', name: 'Supersaw Stab (synth)', group: 'Daft Punk Synths', type: 'synth', release: 0.10, center: 62, gm: 90 },
    { id: 'dpbass',   name: 'Disco Bass (synth)',    group: 'Daft Punk Synths', type: 'synth', release: 0.08, center: 40, gm: 38 },
    { id: 'robot',    name: 'Robot Voice (synth)',   group: 'Daft Punk Synths', type: 'synth', release: 0.15, center: 62, gm: 54 },
    { id: 'drums',    name: 'Drum Machine',     group: 'Drums',           type: 'drums', release: 0, center: 42, gm: 0 }
  ];
  const BY_ID = {};
  LIST.forEach((i) => { BY_ID[i.id] = i; });

  /* ==========================================================================
     1. SAMPLED INSTRUMENTS - loading and decoding
     ========================================================================== */

  const cache = {};   // id -> { promise, ready, bufs:{midi:{buf, offset}}, gain }

  // Add a <script> tag and wait for it. (A script tag also works when the
  // site is opened straight from disk, unlike fetch().)
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  // "data:audio/mp3;base64,AAAA" -> ArrayBuffer that decodeAudioData accepts
  function dataUriToArrayBuffer(uri) {
    const bin = atob(uri.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // A tiny offline context is only used to decode the MP3 files.
  let decoderCtx = null;
  function decode(arrayBuffer) {
    if (!decoderCtx) {
      const Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      decoderCtx = new Ctx(1, 1, 44100);
    }
    return decoderCtx.decodeAudioData(arrayBuffer);
  }

  /* MP3 files start with a little silence (encoder padding). Find where the
     real sound begins so notes land exactly on the beat. */
  function findOnset(buffer) {
    const data = buffer.getChannelData(0);
    const limit = Math.min(data.length, Math.floor(buffer.sampleRate * 0.08));
    for (let i = 0; i < limit; i++) {
      if (Math.abs(data[i]) > 0.004) return Math.max(0, i / buffer.sampleRate - 0.002);
    }
    return 0;
  }

  // Root-mean-square loudness of the first 0.4 s after the onset
  function loudness(buffer, offset) {
    const data = buffer.getChannelData(0);
    const start = Math.floor(offset * buffer.sampleRate);
    const end = Math.min(data.length, start + Math.floor(buffer.sampleRate * 0.4));
    let sum = 0;
    for (let i = start; i < end; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / Math.max(1, end - start));
  }

  /* Load one sampled instrument. Returns a promise; calling it twice is safe. */
  function load(id) {
    const info = BY_ID[id];
    if (!info || info.type !== 'sample') return Promise.resolve();   // synths & drums need no files
    if (cache[id]) return cache[id].promise;

    const entry = { ready: false, bufs: {}, gain: 1 };
    entry.promise = (async function () {
      await loadScript(SF_PATH + info.file + '-mp3.js');
      const fontName = info.file;
      const raw = global.MIDI && global.MIDI.Soundfont && global.MIDI.Soundfont[fontName];
      if (!raw) throw new Error('Soundfont data missing for ' + info.name);

      // Decode every note (A0 ... C8) in parallel
      const names = Object.keys(raw);
      await Promise.all(names.map(async (n) => {
        const buf = await decode(dataUriToArrayBuffer(raw[n]));
        entry.bufs[nameToMidi(n)] = { buf: buf, offset: findOnset(buf) };
      }));
      delete global.MIDI.Soundfont[fontName];   // free the big base64 strings

      // Auto-balance volume so quiet instruments (flute) and loud ones (tuba) feel even
      const probes = [48, 60, 72].map((m) => entry.bufs[m]).filter(Boolean);
      const rms = probes.reduce((t, p) => t + loudness(p.buf, p.offset), 0) / Math.max(1, probes.length);
      entry.gain = rms > 0 ? Math.min(4, Math.max(0.3, 0.15 / rms)) : 1;
      entry.ready = true;
    })();
    cache[id] = entry;
    entry.promise.catch(() => { delete cache[id]; });   // allow a retry after an error
    return entry.promise;
  }

  const isReady = (id) => {
    const info = BY_ID[id];
    return !info || info.type !== 'sample' || !!(cache[id] && cache[id].ready);
  };


  /* Brass and woodwind recordings are only ~3 s long. To hold a note longer,
     we loop a steady part of the recording. The loop starts and ends on
     rising zero-crossings and spans a whole number of wave cycles, so the
     repeat is not audible as a click. */
  function findLoop(buf, midi, offset) {
    const d = buf.getChannelData(0), sr = buf.sampleRate;
    const period = sr / mtof(midi);
    const rising = (i) => d[i] <= 0 && d[i + 1] > 0;
    const nearest = (target) => {
      for (let k = 0; k < period * 1.5; k++) {
        if (target + k < d.length - 1 && rising(Math.floor(target + k))) return Math.floor(target + k);
        if (target - k > 0 && rising(Math.floor(target - k))) return Math.floor(target - k);
      }
      return Math.floor(target);
    };
    const start = nearest((offset + 0.7) * sr);
    const cycles = Math.max(1, Math.round(sr * 1.0 / period));
    const end = nearest(start + cycles * period);
    if (end >= d.length - 2 || end - start < period) return null;
    return { start: start / sr, end: end / sr };
  }

  /* Play one sampled note.
     ctx/dest : audio context and the node to connect to
     when     : start time (seconds on ctx clock)   dur : length in seconds
     sink     : array that collects the sources so "Stop" can silence them */
  function playSample(info, ctx, dest, midi, when, dur, vel, sink) {
    const e = cache[info.id];
    if (!e || !e.ready) return;
    const m = Math.min(108, Math.max(21, midi));
    const s = e.bufs[m];
    if (!s) return;

    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    const env = ctx.createGain();
    const level = vel * e.gain;
    const end = when + Math.max(dur, 0.06);
    env.gain.setValueAtTime(level, when);
    env.gain.setValueAtTime(level, end);                       // hold while the note is "pressed"
    env.gain.linearRampToValueAtTime(0, end + info.release);   // then fade out
    if (info.sustain && dur > 1.2) {                          // hold long wind notes by looping
      if (s.loop === undefined) s.loop = findLoop(s.buf, m, s.offset);
      if (s.loop) { src.loop = true; src.loopStart = s.loop.start; src.loopEnd = s.loop.end; }
    }
    src.connect(env);
    env.connect(dest);
    src.start(when, s.offset);
    src.stop(end + info.release + 0.05);
    if (sink) sink.push(src);
  }

  /* ==========================================================================
     2. SYNTH INSTRUMENTS (Daft-Punk-style, built from oscillators)
     ========================================================================== */

  // Create an oscillator, schedule it and remember it in "sink"
  function osc(ctx, type, freq, detuneCents, when, stopAt, out, sink) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detuneCents;
    o.connect(out);
    o.start(when);
    o.stop(stopAt);
    if (sink) sink.push(o);
    return o;
  }

  // Standard "attack - hold - release" volume shape
  function adsrGain(ctx, when, end, peak, attack, release) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.setValueAtTime(peak, Math.max(end, when + attack));
    g.gain.linearRampToValueAtTime(0, Math.max(end, when + attack) + release);
    return g;
  }

  /* "Digital Lead" - two detuned saws + a square, filter that opens and closes,
     with a little vibrato. Think "Digital Love" solo. */
  function synthLead(ctx, dest, midi, when, dur, vel, sink) {
    const f = mtof(midi), end = when + Math.max(dur, 0.06), rel = 0.15;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(700, when);
    filter.frequency.exponentialRampToValueAtTime(5200, when + 0.07);
    filter.frequency.exponentialRampToValueAtTime(2400, when + 0.45);
    const amp = adsrGain(ctx, when, end, 0.2 * vel, 0.01, rel);
    filter.connect(amp);
    amp.connect(dest);

    const lfo = osc(ctx, 'sine', 5.5, 0, when, end + rel + 0.05, ctx.createGain(), sink);   // vibrato LFO
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 9;                      // +/- 9 cents
    lfo.disconnect();
    lfo.connect(lfoDepth);

    [['sawtooth', -9, 1], ['sawtooth', 9, 1], ['square', 0, 0.5]].forEach(function (v) {
      const mix = ctx.createGain();
      mix.gain.value = v[2];
      mix.connect(filter);
      const o = osc(ctx, v[0], f, v[1], when, end + rel + 0.05, mix, sink);
      lfoDepth.connect(o.detune);
    });
  }

  /* "Supersaw Stab" - five detuned saws with a fast closing filter: the
     classic house chord hit. */
  function synthSupersaw(ctx, dest, midi, when, dur, vel, sink) {
    const f = mtof(midi), end = when + Math.max(dur, 0.05), rel = 0.1;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(7500, when);
    filter.frequency.exponentialRampToValueAtTime(1400, when + 0.28);
    const amp = adsrGain(ctx, when, end, 0.3 * vel, 0.005, rel);
    filter.connect(amp);
    amp.connect(dest);
    [-22, -11, 0, 11, 22].forEach(function (c) {
      const mix = ctx.createGain();
      mix.gain.value = 0.35;
      mix.connect(filter);
      osc(ctx, 'sawtooth', f, c, when, end + rel + 0.05, mix, sink);
    });
  }

  /* "Disco Bass" - saw + sub sine through a plucky filter (Around the World vibes) */
  function synthDiscoBass(ctx, dest, midi, when, dur, vel, sink) {
    const f = mtof(midi), end = when + Math.max(dur, 0.06), rel = 0.07;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(2200, when);
    filter.frequency.exponentialRampToValueAtTime(260, when + 0.16);
    const amp = adsrGain(ctx, when, end, 0.3 * vel, 0.004, rel);
    filter.connect(amp);
    amp.connect(dest);
    const sawMix = ctx.createGain(); sawMix.gain.value = 0.8; sawMix.connect(filter);
    const subMix = ctx.createGain(); subMix.gain.value = 1.0; subMix.connect(amp);
    osc(ctx, 'sawtooth', f, 0, when, end + rel + 0.05, sawMix, sink);
    osc(ctx, 'sine', f, 0, when, end + rel + 0.05, subMix, sink);
  }

  /* "Robot Voice" - a saw wave pushed through three vowel (formant) filters,
     which sounds like a vocoder / talk-box saying "ahh -> ooh". */
  function synthRobot(ctx, dest, midi, when, dur, vel, sink) {
    const f = mtof(midi), end = when + Math.max(dur, 0.08), rel = 0.15;
    const amp = adsrGain(ctx, when, end, 1.1 * vel, 0.03, rel);
    amp.connect(dest);
    const source = ctx.createGain();
    source.gain.value = 0.5;
    [[730, 570, 1.0], [1090, 840, 0.6], [2440, 2410, 0.3]].forEach(function (fm) {
      const band = ctx.createBiquadFilter();       // one formant = one band-pass filter
      band.type = 'bandpass';
      band.Q.value = 9;
      band.frequency.setValueAtTime(fm[0], when);
      band.frequency.linearRampToValueAtTime(fm[1], end + rel);   // "ah" slides to "oh"
      const g = ctx.createGain();
      g.gain.value = fm[2];
      source.connect(band);
      band.connect(g);
      g.connect(amp);
    });
    osc(ctx, 'sawtooth', f, 0, when, end + rel + 0.05, source, sink);
    osc(ctx, 'sawtooth', f, 7, when, end + rel + 0.05, source, sink);
  }

  /* ==========================================================================
     3. DRUM MACHINE (synthesized)
     ========================================================================== */

  const noiseBuffers = new WeakMap();   // one noise buffer per audio context
  function noise(ctx) {
    if (!noiseBuffers.has(ctx)) {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseBuffers.set(ctx, b);
    }
    return noiseBuffers.get(ctx);
  }

  // Short burst of filtered noise (the base of snare, clap and hi-hats)
  function noiseHit(ctx, dest, when, len, type, freq, q, level, sink) {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + len);
    src.connect(filter); filter.connect(g); g.connect(dest);
    src.start(when, Math.random() * 0.5);
    src.stop(when + len + 0.02);
    if (sink) sink.push(src);
  }

  // Pitched "thump" whose pitch drops quickly (kick drum and tom)
  function thump(ctx, dest, when, f0, f1, sweep, len, level, sink) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(f1, when + sweep);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + len);
    o.connect(g); g.connect(dest);
    o.start(when);
    o.stop(when + len + 0.02);
    if (sink) sink.push(o);
  }

  function playDrum(ctx, dest, midi, when, dur, vel, sink) {
    switch (midi) {
      case 36:  // Kick
        thump(ctx, dest, when, 165, 46, 0.13, 0.48, 1.0 * vel, sink);
        noiseHit(ctx, dest, when, 0.012, 'highpass', 3000, 0.7, 0.25 * vel, sink);   // beater click
        break;
      case 38:  // Snare = noise body + short tone
        noiseHit(ctx, dest, when, 0.2, 'bandpass', 1900, 0.7, 0.8 * vel, sink);
        thump(ctx, dest, when, 220, 130, 0.07, 0.12, 0.45 * vel, sink);
        break;
      case 39:  // Clap = three quick noise bursts + tail
        [0, 0.011, 0.023].forEach(function (d) { noiseHit(ctx, dest, when + d, 0.02, 'bandpass', 1500, 1.4, 0.55 * vel, sink); });
        noiseHit(ctx, dest, when + 0.035, 0.18, 'bandpass', 1400, 1.2, 0.5 * vel, sink);
        break;
      case 42:  // Closed hi-hat
        noiseHit(ctx, dest, when, 0.05, 'highpass', 8000, 0.7, 0.4 * vel, sink);
        break;
      case 46:  // Open hi-hat
        noiseHit(ctx, dest, when, 0.3, 'highpass', 7500, 0.7, 0.32 * vel, sink);
        break;
      case 45:  // Tom
        thump(ctx, dest, when, 190, 90, 0.12, 0.35, 0.85 * vel, sink);
        break;
      case 56:  // Cowbell = two square waves through a band-pass
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass'; filter.frequency.value = 820; filter.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.35 * vel, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.25);
        filter.connect(g); g.connect(dest);
        [587, 845].forEach(function (fr) { osc(ctx, 'square', fr, 0, when, when + 0.27, filter, sink); });
        break;
    }
  }

  /* ==========================================================================
     Public play() - picks the right engine for the instrument
     ========================================================================== */
  function play(id, ctx, dest, midi, when, dur, vel, sink) {
    const info = BY_ID[id];
    if (!info) return;
    switch (id) {
      case 'lead':     return synthLead(ctx, dest, midi, when, dur, vel, sink);
      case 'supersaw': return synthSupersaw(ctx, dest, midi, when, dur, vel, sink);
      case 'dpbass':   return synthDiscoBass(ctx, dest, midi, when, dur, vel, sink);
      case 'robot':    return synthRobot(ctx, dest, midi, when, dur, vel, sink);
      case 'drums':    return playDrum(ctx, dest, midi, when, dur, vel, sink);
      default:         return playSample(info, ctx, dest, midi, when, dur, vel, sink);
    }
  }

  global.Instruments = {
    list: LIST,
    get: function (id) { return BY_ID[id]; },
    drums: DRUMS,
    load: load,
    isReady: isReady,
    play: play,
    mtof: mtof,
    midiName: midiName,
    midiNameBoth: midiNameBoth
  };
})(window);
