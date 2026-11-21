/* ==========================================================================
   exporters.js  (Nathan's Studio)
   --------------------------------------------------------------------------
   Turns a rendered song into files you can download:
     WAV  (lossless, plays everywhere)
     MP3  (small, uses the lamejs library in lame.all.js)
     FLAC (lossless AND smaller than WAV - written by the encoder below)
     MIDI (notes only - drag it into FL Studio's piano roll)
     ZIP  (one WAV "stem" per track - drag them into FL Studio's playlist)
   All of it runs in the browser. Nothing is uploaded anywhere.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- Shared helpers ---------- */

  // Float (-1..1) -> 16-bit integer, clamped
  const toInt16 = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));

  // Returns [left, right] Int16Arrays from an AudioBuffer (mono is duplicated)
  function toInt16Channels(buffer, trimTo) {
    const n = trimTo || buffer.length;
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const L = new Int16Array(n), R = new Int16Array(n);
    for (let i = 0; i < n; i++) { L[i] = toInt16(left[i]); R[i] = toInt16(right[i]); }
    return [L, R];
  }

  /* Peak limiter: if the mix is louder than 0 dB it is turned down (never up),
     so exported files never clip. Also cuts the silence after the reverb tail. */
  function finish(buffer, songSeconds) {
    const sr = buffer.sampleRate;
    const chans = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    let peak = 0, last = 0;
    chans.forEach((d) => {
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
        if (a > 0.0008 && i > last) last = i;
      }
    });
    const keep = Math.min(buffer.length, Math.max(Math.ceil(songSeconds * sr), last + Math.floor(sr * 0.1)));
    const scale = peak > 0.98 ? 0.98 / peak : 1;
    const out = new AudioBuffer({ length: keep, numberOfChannels: buffer.numberOfChannels, sampleRate: sr });
    chans.forEach((d, c) => {
      const o = out.getChannelData(c);
      for (let i = 0; i < keep; i++) o[i] = d[i] * scale;
    });
    return out;
  }

  // Let the page redraw (progress bar) between big chunks of work
  const breathe = () => new Promise((r) => setTimeout(r, 0));

  /* ==========================================================================
     WAV - a 44-byte header followed by raw 16-bit samples
     ========================================================================== */
  function encodeWav(buffer) {
    const [L, R] = toInt16Channels(buffer);
    const n = L.length, bytes = n * 4;
    const view = new DataView(new ArrayBuffer(44 + bytes));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);                       // PCM
    view.setUint16(22, 2, true);                       // 2 channels
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 4, true);   // bytes per second
    view.setUint16(32, 4, true);                       // bytes per frame
    view.setUint16(34, 16, true);                      // bits per sample
    str(36, 'data'); view.setUint32(40, bytes, true);
    let o = 44;
    for (let i = 0; i < n; i++) { view.setInt16(o, L[i], true); view.setInt16(o + 2, R[i], true); o += 4; }
    return new Blob([view], { type: 'audio/wav' });
  }

  /* ==========================================================================
     MP3 - uses the lamejs encoder (library file: lame.all.js)
     ========================================================================== */
  async function encodeMp3(buffer, kbps, onProgress) {
    if (typeof global.lamejs === 'undefined') throw new Error('MP3 encoder (lame.all.js) did not load.');
    const [L, R] = toInt16Channels(buffer);
    const encoder = new global.lamejs.Mp3Encoder(2, buffer.sampleRate, kbps || 192);
    const parts = [], block = 1152;
    for (let i = 0; i < L.length; i += block) {
      const chunk = encoder.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block));
      if (chunk.length) parts.push(new Uint8Array(chunk));
      if ((i / block) % 200 === 0) { if (onProgress) onProgress(i / L.length); await breathe(); }
    }
    const tail = encoder.flush();
    if (tail.length) parts.push(new Uint8Array(tail));
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  /* ==========================================================================
     FLAC - lossless compression.
     Each 4096-sample block is predicted from the two samples before it
     ("fixed order 2" predictor); the small leftover errors are stored with
     Rice codes. Files are about half the size of the WAV and bit-identical
     once decoded.
     ========================================================================== */

  // Writes individual bits into a byte array
  class BitWriter {
    constructor() { this.bytes = []; this.cur = 0; this.nbits = 0; }
    put(value, count) {                                  // value must be 0 .. 2^32-1
      while (count > 0) {
        const take = Math.min(count, 8 - this.nbits);
        const shift = count - take;
        const chunk = Math.floor(value / Math.pow(2, shift)) & ((1 << take) - 1);
        this.cur = (this.cur << take) | chunk;
        this.nbits += take;
        count -= take;
        if (this.nbits === 8) { this.bytes.push(this.cur); this.cur = 0; this.nbits = 0; }
      }
    }
    putSigned(value, count) { this.put(value < 0 ? value + Math.pow(2, count) : value, count); }
    align() { if (this.nbits) this.put(0, 8 - this.nbits); }
  }

  // Checksums required by the FLAC format
  const CRC8_TABLE = (function () {
    const t = new Uint8Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; t[i] = c; }
    return t;
  })();
  const CRC16_TABLE = (function () {
    const t = new Uint16Array(256);
    for (let i = 0; i < 256; i++) { let c = i << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; t[i] = c; }
    return t;
  })();
  const crc8 = (bytes) => bytes.reduce((c, b) => CRC8_TABLE[c ^ b], 0);
  const crc16 = (bytes) => bytes.reduce((c, b) => ((c << 8) & 0xffff) ^ CRC16_TABLE[(c >> 8) ^ b], 0);

  // Frame numbers are stored in UTF-8 style
  function utf8Number(n) {
    if (n < 0x80) return [n];
    if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 63)];
    if (n < 0x10000) return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)];
    return [0xf0 | (n >> 18), 0x80 | ((n >> 12) & 63), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)];
  }

  // Write one channel of one block as a FLAC "subframe"
  function writeSubframe(bw, x, start, n) {
    // Residual of the order-2 predictor: x[i] - 2*x[i-1] + x[i-2]
    const res = new Int32Array(n - 2);
    let sum = 0;
    for (let i = 2; i < n; i++) {
      const r = x[start + i] - 2 * x[start + i - 1] + x[start + i - 2];
      res[i - 2] = r;
      sum += r < 0 ? -2 * r - 1 : 2 * r;                  // zig-zag so negatives become positive
    }
    // Pick the Rice parameter k that gives the fewest bits
    const mean = sum / Math.max(1, res.length);
    let k0 = Math.max(0, Math.floor(Math.log2(mean + 1)));
    let bestK = -1, bestBits = Infinity;
    for (let k = Math.max(0, k0 - 1); k <= Math.min(14, k0 + 1); k++) {
      let bits = 0;
      for (let i = 0; i < res.length; i++) { const u = res[i] < 0 ? -2 * res[i] - 1 : 2 * res[i]; bits += (u >>> k) + 1 + k; }
      if (bits < bestBits) { bestBits = bits; bestK = k; }
    }
    const verbatimBits = n * 16;
    if (n < 8 || bestK < 0 || bestBits + 32 > verbatimBits) {
      bw.put(0, 1); bw.put(1, 6); bw.put(0, 1);            // header: VERBATIM (raw samples)
      for (let i = 0; i < n; i++) bw.putSigned(x[start + i], 16);
      return;
    }
    bw.put(0, 1); bw.put(10, 6); bw.put(0, 1);              // header: FIXED predictor, order 2
    bw.putSigned(x[start], 16);                             // warm-up samples
    bw.putSigned(x[start + 1], 16);
    bw.put(0, 2);                                           // Rice coding, 4-bit parameters
    bw.put(0, 4);                                           // one partition for the whole block
    bw.put(bestK, 4);
    for (let i = 0; i < res.length; i++) {
      const u = res[i] < 0 ? -2 * res[i] - 1 : 2 * res[i];
      let q = u >>> bestK;
      while (q >= 8) { bw.put(0, 8); q -= 8; }              // quotient in unary (zeros...)
      bw.put(1, q + 1);                                     // ...ended by a one
      if (bestK) bw.put(u & ((1 << bestK) - 1), bestK);     // remainder
    }
  }

  async function encodeFlac(buffer, onProgress) {
    const [L, R] = toInt16Channels(buffer);
    const total = L.length, BLOCK = 4096, sr = buffer.sampleRate;

    // 1) "fLaC" marker + STREAMINFO block (format description, 34 bytes)
    const head = new BitWriter();
    [0x66, 0x4c, 0x61, 0x43].forEach((b) => head.put(b, 8));
    head.put(1, 1); head.put(0, 7); head.put(34, 24);       // last metadata block, type 0, length 34
    head.put(BLOCK, 16); head.put(BLOCK, 16);               // min / max block size
    head.put(0, 24); head.put(0, 24);                       // min / max frame size (unknown)
    head.put(sr, 20); head.put(1, 3); head.put(15, 5);      // sample rate, 2 channels, 16 bits
    head.put(Math.floor(total / 4294967296), 4);            // total samples (36 bits)
    head.put(total % 4294967296, 32);
    for (let i = 0; i < 16; i++) head.put(0, 8);            // MD5 checksum (0 = not provided)
    const parts = [new Uint8Array(head.bytes)];

    // 2) the audio frames
    let frameNo = 0;
    for (let pos = 0; pos < total; pos += BLOCK, frameNo++) {
      const n = Math.min(BLOCK, total - pos);
      const h = new BitWriter();
      h.put(0x3ffe, 14); h.put(0, 1); h.put(0, 1);          // sync code, fixed block size
      h.put(n === BLOCK ? 12 : 7, 4);                       // block size code (12 = 4096, 7 = "16-bit value follows")
      h.put(0, 4);                                          // sample rate: read from STREAMINFO
      h.put(1, 4);                                          // 2 independent channels
      h.put(4, 3); h.put(0, 1);                             // 16 bits per sample
      utf8Number(frameNo).forEach((b) => h.put(b, 8));
      if (n !== BLOCK) h.put(n - 1, 16);
      h.bytes.push(crc8(h.bytes));

      const bw = new BitWriter();
      bw.bytes = h.bytes;
      writeSubframe(bw, L, pos, n);
      writeSubframe(bw, R, pos, n);
      bw.align();
      const c = crc16(bw.bytes);
      bw.bytes.push(c >> 8, c & 255);
      parts.push(new Uint8Array(bw.bytes));
      if (frameNo % 40 === 0) { if (onProgress) onProgress(pos / total); await breathe(); }
    }
    return new Blob(parts, { type: 'audio/flac' });
  }

  /* ==========================================================================
     MIDI - Standard MIDI File, format 1 (one MIDI track per studio track).
     FL Studio: drag the .mid file onto the piano roll or use
     File > Import > MIDI file.
     ========================================================================== */
  function varLen(n) {                                      // MIDI "variable length" numbers
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  }
  const be16 = (n) => [(n >> 8) & 255, n & 255];
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const ascii = (s) => Array.from(s).map((ch) => ch.charCodeAt(0) & 127);

  function midiChunk(events) {                              // events: [{tick, order, bytes}]
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const data = [];
    let prev = 0;
    events.forEach((e) => { data.push(...varLen(e.tick - prev), ...e.bytes); prev = e.tick; });
    data.push(0, 0xff, 0x2f, 0);                            // end of track
    return [...ascii('MTrk'), ...be32(data.length), ...data];
  }

  function encodeMidi(project) {
    const PPQ = 480, TICKS_PER_STEP = PPQ / 4;
    const micros = Math.round(60000000 / project.bpm);
    const chunks = [];

    // Track 0: tempo, time signature, song name
    const title = ascii(project.name || 'Song');
    chunks.push(midiChunk([
      { tick: 0, order: 0, bytes: [0xff, 0x03, title.length, ...title] },
      { tick: 0, order: 0, bytes: [0xff, 0x51, 3, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255] },
      { tick: 0, order: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] }
    ]));

    let channel = 0;
    project.tracks.forEach((t) => {
      const info = Instruments.get(t.inst);
      const isDrums = t.inst === 'drums';
      let ch = 9;                                           // channel 10 (index 9) is always drums
      if (!isDrums) { if (channel === 9) channel++; ch = channel % 16; channel++; }
      const name = ascii(t.name);
      const ev = [{ tick: 0, order: 0, bytes: [0xff, 0x03, name.length, ...name] }];
      if (!isDrums) ev.push({ tick: 0, order: 1, bytes: [0xc0 | ch, info.gm] });   // choose the instrument
      t.notes.forEach((n) => {
        const vel = Math.max(1, Math.min(127, Math.round(n.v * 127)));
        ev.push({ tick: n.s * TICKS_PER_STEP, order: 3, bytes: [0x90 | ch, n.m, vel] });
        ev.push({ tick: (n.s + n.l) * TICKS_PER_STEP, order: 2, bytes: [0x80 | ch, n.m, 0] });
      });
      chunks.push(midiChunk(ev));
    });

    const header = [...ascii('MThd'), ...be32(6), ...be16(1), ...be16(chunks.length), ...be16(PPQ)];
    return new Blob([new Uint8Array(header.concat(...chunks))], { type: 'audio/midi' });
  }

  /* ==========================================================================
     ZIP - minimal writer ("store" = no compression) used for the stems
     ========================================================================== */
  const CRC32_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // files: [{ name:'drums.wav', data: Uint8Array }]
  function makeZip(files) {
    const enc = new TextEncoder();
    const locals = [], centrals = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);   // 0x0800 = UTF-8 names
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);              // stored, date 1980-01-01
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      locals.push(new Uint8Array(lh.buffer), name, f.data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      centrals.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    });
    const cdSize = centrals.reduce((t, p) => t + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...locals, ...centrals, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  /* ---------- Download helper ---------- */
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  global.Exporters = {
    finish: finish,
    encodeWav: encodeWav,
    encodeMp3: encodeMp3,
    encodeFlac: encodeFlac,
    encodeMidi: encodeMidi,
    makeZip: makeZip,
    download: download
  };
})(window);
