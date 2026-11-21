/* ==========================================================================
   piano-roll.js  (Nathan's Studio)
   --------------------------------------------------------------------------
   The note editor. Time runs left -> right, pitch runs bottom -> top.

     click empty space ........ add a note  (drag sideways to make it longer)
     drag a note .............. move it (time + pitch)
     drag a note's right edge . change its length
     right-click / Shift+click  delete a note
     click the number ruler ... move the start position
     click the keys on the left to hear the pitch

   The piano roll draws with three <canvas> elements (ruler, keys, grid) and
   reports every finished edit to the main program through "hooks".
   ========================================================================== */
(function (global) {
  'use strict';

  const LO = 24, HI = 96;          // lowest / highest MIDI note shown (C1 .. C7)
  const KEY_W = 72;                // width of the keyboard column in pixels
  const RULER_H = 22;              // height of the bar-number ruler
  const EDGE = 7;                  // pixels at a note's right end that count as "resize handle"
  const BLACK = [1, 3, 6, 8, 10];  // semitones that are black keys

  class PianoRoll {
    /* els   = { scroller, keys, grid, ruler, playhead }  (DOM elements)
       hooks = { getProject, getTrack, getSnap, onEdit, onPreview, onSeek } */
    constructor(els, hooks) {
      this.els = els;
      this.hooks = hooks;
      this.cw = 28;                // pixel width of one 16th-note step
      this.rh = 16;                // pixel height of one pitch row
      this.sel = null;             // currently selected note
      this.startStep = 0;          // where Play begins
      this.lastLen = 2;            // length given to newly drawn notes
      this.drag = null;            // info about the drag in progress
      this.showNames = false;      // names inside notes are optional (off = cleaner)
      this.useFlats = false;       // false: show C#  /  true: show Db

      els.grid.addEventListener('mousedown', (e) => this.onDown(e));
      els.grid.addEventListener('mousemove', (e) => this.onHover(e));
      els.grid.addEventListener('contextmenu', (e) => e.preventDefault());   // right-click deletes, so no menu
      els.keys.addEventListener('mousedown', (e) => this.onKeyClick(e));
      els.ruler.addEventListener('mousedown', (e) => this.onRuler(e));
      window.addEventListener('mousemove', (e) => this.onMove(e));
      window.addEventListener('mouseup', () => this.onUp());
    }

    /* ---------- Row layout (drum tracks show named lanes instead of piano keys) ---------- */
    isDrum() { const t = this.hooks.getTrack(); return !!t && t.inst === 'drums'; }

    rows() {
      if (this.isDrum()) return Instruments.drums.map((d) => d.m).reverse();   // kick at the bottom
      const r = [];
      for (let m = HI; m >= LO; m--) r.push(m);
      return r;
    }
    rowHeight() { return this.isDrum() ? 36 : 16; }
    rowOfMidi(m) { return this.rows().indexOf(m); }

    /* ---------- Drawing ---------- */
    redraw() {
      const project = this.hooks.getProject();
      const track = this.hooks.getTrack();
      if (!project || !track) return;
      this.rh = this.rowHeight();
      const rows = this.rows();
      const W = Engine.totalSteps(project) * this.cw;
      const H = rows.length * this.rh;
      const { grid, keys, ruler, playhead } = this.els;

      // Resize canvases. On high-resolution screens (dpr > 1) the canvas gets
      // more real pixels than CSS pixels, which keeps lines and text sharp.
      // Browsers limit canvas size, so dpr is capped for very long songs.
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 30000 / W));
      const size = (c, w, h) => {
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);   // assigning size also clears the canvas
        c.style.width = w + 'px'; c.style.height = h + 'px';
        const ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);                          // draw in CSS pixels from now on
        return ctx;
      };
      const gctx = size(grid, W, H), rctx = size(ruler, W, RULER_H), kctx = size(keys, KEY_W, H);
      playhead.style.height = (H + RULER_H) + 'px';

      this.drawGrid(gctx, project, track, rows, W, H);
      this.drawKeys(kctx, rows, H);
      this.drawRuler(rctx, project, W);
      this.setPlayhead(this.lastPlayheadStep === undefined ? this.startStep : this.lastPlayheadStep);
    }

    drawGrid(ctx, project, track, rows, W, H) {
      const drum = this.isDrum(), cw = this.cw, rh = this.rh;
      const total = Engine.totalSteps(project);

      // Row stripes: black-key rows are darker, C rows get a brighter line
      rows.forEach((m, i) => {
        const dark = drum ? i % 2 === 0 : BLACK.indexOf(m % 12) >= 0;
        ctx.fillStyle = dark ? '#190a2b' : '#240f3c';
        ctx.fillRect(0, i * rh, W, rh);
        ctx.fillStyle = (!drum && m % 12 === 0) ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.05)';
        ctx.fillRect(0, (i + 1) * rh - 1, W, 1);
      });

      // Vertical lines: step, beat and bar
      for (let s = 0; s <= total; s++) {
        ctx.fillStyle = s % 16 === 0 ? 'rgba(255,79,163,.55)' : s % 4 === 0 ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.05)';
        ctx.fillRect(s * cw, 0, 1, H);
      }

      // "Ghost" notes of the other tracks so you can line things up
      project.tracks.forEach((t) => {
        if (t === track || (t.inst === 'drums') !== drum) return;
        ctx.fillStyle = t.color;
        ctx.globalAlpha = 0.16;
        t.notes.forEach((n) => {
          const r = this.rowOfMidi(n.m);
          if (r >= 0) ctx.fillRect(n.s * cw, r * rh + 2, n.l * cw - 1, rh - 4);
        });
        ctx.globalAlpha = 1;
      });

      // This track's notes
      track.notes.forEach((n) => {
        const r = this.rowOfMidi(n.m);
        if (r < 0) return;
        const x = n.s * cw, y = r * rh + 1, w = Math.max(4, n.l * cw - 1), h = rh - 2;
        ctx.globalAlpha = 0.55 + 0.45 * n.v;
        ctx.fillStyle = track.color;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, w, h, 3) : ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = n === this.sel ? 2 : 1;
        ctx.strokeStyle = n === this.sel ? '#ffffff' : 'rgba(0,0,0,.55)';
        ctx.stroke();
        if (!drum && this.showNames && w >= 26) {             // optional note name inside the note (e.g. "G#5")
          ctx.fillStyle = '#10051c';
          ctx.font = 'bold 10px "DM Sans", sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillText(Instruments.midiName(n.m, this.useFlats), x + 4, y + h / 2);
        }
        ctx.fillStyle = 'rgba(0,0,0,.35)';                    // little handle on the right edge
        ctx.fillRect(x + w - 3, y + 3, 2, h - 6);
      });
    }

    drawKeys(ctx, rows, H) {
      const drum = this.isDrum(), rh = this.rh;
      ctx.clearRect(0, 0, KEY_W, H);
      ctx.font = '10px "DM Sans", sans-serif';
      ctx.textBaseline = 'middle';
      rows.forEach((m, i) => {
        const black = !drum && BLACK.indexOf(m % 12) >= 0;
        ctx.fillStyle = drum ? '#2c1450' : (black ? '#15091f' : '#efe6ff');
        ctx.fillRect(0, i * rh, black ? KEY_W - 18 : KEY_W, rh - 1);
        if (black) { ctx.fillStyle = '#efe6ff'; ctx.fillRect(KEY_W - 18, i * rh, 18, rh - 1); }
        if (drum) {
          ctx.fillStyle = '#f4eaff';
          ctx.fillText(Instruments.drums.find((d) => d.m === m).name, 6, i * rh + rh / 2);
        } else if (m % 12 === 0) {                            // only the C keys are labelled (C4 = middle C)
          ctx.fillStyle = '#240e3b';
          ctx.font = 'bold 11px "DM Sans", sans-serif';
          ctx.fillText(Instruments.midiName(m, false), KEY_W - 28, i * rh + rh / 2);
        }
      });
    }

    drawRuler(ctx, project, W) {
      ctx.fillStyle = '#1b0a30';
      ctx.fillRect(0, 0, W, RULER_H);
      ctx.font = '11px "DM Sans", sans-serif';
      ctx.textBaseline = 'middle';
      for (let b = 0; b < project.bars; b++) {
        ctx.fillStyle = '#ff4fa3';
        ctx.fillRect(b * 16 * this.cw, 0, 1, RULER_H);
        ctx.fillStyle = '#f4eaff';
        ctx.fillText(String(b + 1), b * 16 * this.cw + 6, RULER_H / 2);
        for (let beat = 1; beat < 4; beat++) {
          ctx.fillStyle = 'rgba(255,255,255,.3)';
          ctx.fillRect((b * 16 + beat * 4) * this.cw, RULER_H - 6, 1, 6);
        }
      }
      // Start marker (small triangle)
      const x = this.startStep * this.cw;
      ctx.fillStyle = '#4de1ff';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 10, 0); ctx.lineTo(x, 12); ctx.closePath(); ctx.fill();
    }

    /* ---------- Play-head ---------- */
    setPlayhead(step, follow) {
      this.lastPlayheadStep = step;
      const x = step * this.cw;
      this.els.playhead.style.transform = 'translateX(' + x + 'px)';
      if (follow) {                                           // keep the play-head in view while playing
        const sc = this.els.scroller;
        if (x + KEY_W > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 40);
      }
    }

    setStart(step) {
      this.startStep = step;
      this.redraw();
    }

    scrollToCenter(midi) {
      const sc = this.els.scroller;
      const row = this.rowOfMidi(this.isDrum() ? 36 : Math.min(HI, Math.max(LO, midi)));
      sc.scrollTop = Math.max(0, row * this.rh - sc.clientHeight / 2 + RULER_H);
    }

    setShowNames(on) { this.showNames = on; this.redraw(); }

    setAccidentals(useFlats) { this.useFlats = useFlats; this.redraw(); }

    setZoom(cw) { this.cw = cw; this.redraw(); }

    /* ---------- Mouse handling ---------- */
    local(e) {
      const r = this.els.grid.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    rowAt(y) {
      const rows = this.rows();
      const i = Math.max(0, Math.min(rows.length - 1, Math.floor(y / this.rh)));
      return { index: i, midi: rows[i] };
    }

    noteAt(x, y) {
      const track = this.hooks.getTrack();
      for (let i = track.notes.length - 1; i >= 0; i--) {     // topmost (last drawn) first
        const n = track.notes[i], r = this.rowOfMidi(n.m);
        if (r < 0 || Math.floor(y / this.rh) !== r) continue;
        if (x >= n.s * this.cw && x <= (n.s + n.l) * this.cw) return n;
      }
      return null;
    }

    onHover(e) {
      if (this.drag) return;
      const p = this.local(e), n = this.noteAt(p.x, p.y);
      const grid = this.els.grid;
      grid.classList.toggle('on-edge', !!n && p.x > (n.s + n.l) * this.cw - EDGE);
      grid.classList.toggle('on-note', !!n && p.x <= (n.s + n.l) * this.cw - EDGE);
    }

    onDown(e) {
      const project = this.hooks.getProject(), track = this.hooks.getTrack();
      const snap = this.hooks.getSnap(), total = Engine.totalSteps(project);
      const p = this.local(e), hit = this.noteAt(p.x, p.y);

      // Delete: right button, or Shift/Alt + click
      if (hit && (e.button === 2 || e.shiftKey || e.altKey)) {
        track.notes.splice(track.notes.indexOf(hit), 1);
        if (this.sel === hit) this.sel = null;
        this.redraw();
        this.hooks.onEdit();
        return;
      }
      if (e.button !== 0) return;

      if (hit) {                                              // grab an existing note
        this.sel = hit;
        const resize = p.x > (hit.s + hit.l) * this.cw - EDGE;
        this.drag = { mode: resize ? 'resize' : 'move', note: hit, startX: p.x, startY: p.y,
                      origS: hit.s, origL: hit.l, origRow: this.rowOfMidi(hit.m), changed: false };
        this.hooks.onPreview(hit.m);
      } else {                                                // draw a new note
        const row = this.rowAt(p.y);
        const s = Math.max(0, Math.min(total - 1, Math.floor(p.x / this.cw / snap) * snap));
        const len = Math.max(1, Math.min(this.lastLen, total - s));
        const note = { m: row.midi, s: s, l: len, v: 0.8 };
        track.notes.push(note);
        this.sel = note;
        this.drag = { mode: 'create', note: note, startX: p.x, startY: p.y, origS: s, origL: len, origRow: row.index, changed: true, moved: false };
        this.hooks.onPreview(note.m);
      }
      this.redraw();
      e.preventDefault();
    }

    onMove(e) {
      const d = this.drag;
      if (!d) return;
      const project = this.hooks.getProject(), snap = this.hooks.getSnap(), total = Engine.totalSteps(project);
      const p = this.local(e), n = d.note;

      if (d.mode === 'move') {
        const ds = Math.round((p.x - d.startX) / this.cw / snap) * snap;
        const rows = this.rows();
        const row = Math.max(0, Math.min(rows.length - 1, d.origRow + Math.round((p.y - d.startY) / this.rh)));
        const s = Math.max(0, Math.min(total - n.l, d.origS + ds));
        if (rows[row] !== n.m) this.hooks.onPreview(rows[row]);   // hear the new pitch
        if (s !== n.s || rows[row] !== n.m) d.changed = true;
        n.s = s; n.m = rows[row];
      } else {                                                // 'resize' and 'create' both change the length
        if (d.mode === 'create' && Math.abs(p.x - d.startX) < 4 && !d.moved) return;   // plain click keeps the default length
        d.moved = true;
        const end = Math.round(p.x / this.cw / snap) * snap;
        const len = Math.max(snap, Math.min(total - n.s, end - n.s));
        if (len !== n.l) d.changed = true;
        n.l = len;
      }
      this.redraw();
    }

    onUp() {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (d.mode !== 'move') this.lastLen = d.note.l;         // remember length for the next new note
      if (d.changed) this.hooks.onEdit();
    }

    deleteSelected() {
      const track = this.hooks.getTrack();
      if (!this.sel || !track) return false;
      const i = track.notes.indexOf(this.sel);
      if (i < 0) return false;
      track.notes.splice(i, 1);
      this.sel = null;
      this.redraw();
      this.hooks.onEdit();
      return true;
    }

    onKeyClick(e) {
      const r = this.els.keys.getBoundingClientRect();
      this.hooks.onPreview(this.rowAt(e.clientY - r.top).midi);
    }

    onRuler(e) {
      const r = this.els.ruler.getBoundingClientRect();
      const snap = 4;                                          // start positions snap to beats
      const step = Math.max(0, Math.floor((e.clientX - r.left) / this.cw / snap) * snap);
      this.setStart(step);
      this.hooks.onSeek(step);
    }
  }

  global.PianoRoll = PianoRoll;
})(window);
