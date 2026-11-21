/* ==========================================================================
   studio.js  (Nathan's Studio)
   --------------------------------------------------------------------------
   Connects the page to the engine: buttons, track list, keyboard shortcuts,
   undo/redo, saving, and the export dialog.
   Load order (see studio.html): instruments -> engine -> exporters ->
   piano-roll -> studio.  The inline script in studio.html calls Studio.init().
   ========================================================================== */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'nathanStudioProject';

  let project, roll, player;
  let selectedId = null;
  let undoStack = [], redoStack = [];
  let recording = false, octave = 4;
  const heldNotes = {};                // keyboard key -> note being recorded

  const track = () => project.tracks.find((t) => t.id === selectedId) || project.tracks[0];
  const status = (msg) => { $('status').textContent = msg; };

  /* ---------- Loading instruments (with status messages) ---------- */
  function ensureLoaded(instIds) {
    const todo = instIds.filter((id) => !Instruments.isReady(id));
    if (!todo.length) return Promise.resolve();
    status('Loading ' + todo.map((id) => Instruments.get(id).name).join(', ') + ' ...');
    return Promise.all(todo.map(Instruments.load)).then(
      () => status('Instruments ready.'),
      (err) => { status('Error: ' + err.message + ' (open the site through a web server or GitHub Pages?)'); throw err; });
  }

  /* ---------- Undo / redo / autosave ---------- */
  function commit() {
    undoStack.push(JSON.stringify(project));
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    afterChange();
  }
  function afterChange() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(project)); } catch (e) { /* storage full or blocked */ }
    renderTracks();
  }
  function restore(json) {
    project = JSON.parse(json);
    if (!project.tracks.some((t) => t.id === selectedId)) selectedId = project.tracks[0].id;
    syncControls();
    renderTracks();
    roll.redraw();
    afterChange();
  }
  function undo() { if (undoStack.length > 1) { redoStack.push(undoStack.pop()); restore(undoStack[undoStack.length - 1]); } }
  function redo() { if (redoStack.length) { const j = redoStack.pop(); undoStack.push(j); restore(j); } }

  function loadProject(p) {
    project = p;
    selectedId = project.tracks[0].id;
    undoStack = [JSON.stringify(project)];
    redoStack = [];
    syncControls();
    renderTracks();
    roll.setStart(0);
    roll.scrollToCenter(Instruments.get(track().inst).center);
    afterChange();
    ensureLoaded(project.tracks.map((t) => t.inst));
  }

  /* ---------- Controls <-> project ---------- */
  function syncControls() {
    $('bpm').value = project.bpm;
    $('bars').value = project.bars;
    $('reverb').value = project.reverb;
    $('songName').value = project.name;
    $('rollTitle').textContent = track().name;
  }

  /* ---------- Track list ---------- */
  function instrumentOptions(selected) {
    const groups = {};
    Instruments.list.forEach((i) => { (groups[i.group] = groups[i.group] || []).push(i); });
    return Object.keys(groups).map((g) =>
      '<optgroup label="' + g + '">' + groups[g].map((i) =>
        '<option value="' + i.id + '"' + (i.id === selected ? ' selected' : '') + '>' + i.name + '</option>').join('') + '</optgroup>').join('');
  }

  function renderTracks() {
    const list = $('trackList');
    list.innerHTML = '';
    const anySolo = project.tracks.some((t) => t.solo);
    project.tracks.forEach((t) => {
      const li = document.createElement('li');
      const silenced = anySolo && !t.solo && !t.mute;          // another track is soloed
      li.className = 'track' + (t.id === selectedId ? ' selected' : '') + (t.mute ? ' muted' : '') +
        (silenced ? ' silenced' : '') + (t.solo ? ' soloed' : '');
      li.dataset.id = t.id;
      li.style.setProperty('--tc', t.color);                  // each track has its own colour variable
      li.innerHTML =
        '<div class="track-top"><span class="swatch"></span>' +
        '<input class="track-name" value="' + t.name.replace(/"/g, '&quot;') + '" aria-label="Track name">' +
        (t.mute ? '<span class="badge muted">MUTED</span>' : t.solo ? '<span class="badge solo">SOLO</span>' : silenced ? '<span class="badge silenced">OFF (solo)</span>' : '') +
        '<button class="mini mute' + (t.mute ? ' on' : '') + '" data-act="mute" title="Mute this track">M</button>' +
        '<button class="mini solo' + (t.solo ? ' on' : '') + '" data-act="solo" title="Solo">S</button>' +
        '<button class="mini" data-act="remove" title="Delete track">&times;</button></div>' +
        '<select class="track-inst" aria-label="Instrument">' + instrumentOptions(t.inst) + '</select>' +
        '<input class="track-vol" type="range" min="0" max="1" step="0.01" value="' + t.vol + '" aria-label="Volume">' +
        '<canvas class="thumb" width="240" height="28"></canvas>';
      list.appendChild(li);
      drawThumb(li.querySelector('.thumb'), t);
    });
  }

  // Tiny overview of a track's notes
  function drawThumb(canvas, t) {
    const ctx = canvas.getContext('2d');
    const total = Engine.totalSteps(project);
    const lo = Math.min(...t.notes.map((n) => n.m), 60), hi = Math.max(...t.notes.map((n) => n.m), 61);
    ctx.fillStyle = t.color;
    t.notes.forEach((n) => {
      const y = (1 - (n.m - lo) / (hi - lo + 1)) * (canvas.height - 4);
      ctx.fillRect(n.s / total * canvas.width, y, Math.max(1.5, n.l / total * canvas.width), 3);
    });
  }

  function selectTrack(id) {
    selectedId = id;
    roll.sel = null;
    $('rollTitle').textContent = track().name;
    document.querySelectorAll('.track').forEach((li) => li.classList.toggle('selected', li.dataset.id === id));
    roll.redraw();
    roll.scrollToCenter(Instruments.get(track().inst).center);
  }

  function onTrackEvent(e) {
    const li = e.target.closest('.track');
    if (!li) return;
    const t = project.tracks.find((x) => x.id === li.dataset.id);
    const act = e.target.dataset.act;

    if (e.type === 'click') {
      if (act === 'mute') { t.mute = !t.mute; commit(); player.syncMix(); status(t.name + (t.mute ? ' is muted.' : ' is unmuted.')); return; }
      if (act === 'solo') { t.solo = !t.solo; commit(); player.syncMix(); status(t.solo ? t.name + ' is solo: other tracks are silent.' : 'Solo off.'); return; }
      if (act === 'remove') {
        if (project.tracks.length === 1) { status('A song needs at least one track.'); return; }
        project.tracks.splice(project.tracks.indexOf(t), 1);
        if (selectedId === t.id) selectedId = project.tracks[0].id;
        commit(); roll.redraw(); return;
      }
      if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') selectTrack(t.id);
    } else if (e.type === 'change') {
      if (e.target.classList.contains('track-inst')) {
        t.inst = e.target.value;
        ensureLoaded([t.inst]);
        commit(); selectTrack(t.id);
      } else if (e.target.classList.contains('track-name')) {
        t.name = e.target.value; commit(); $('rollTitle').textContent = track().name;
      }
    } else if (e.type === 'input' && e.target.classList.contains('track-vol')) {
      t.vol = parseFloat(e.target.value);                    // live volume while dragging
      player.syncMix();
    }
  }

  function addTrack() {
    const id = $('addInst').value;
    const t = Engine.makeTrack(id, project.tracks.length);
    project.tracks.push(t);
    selectedId = t.id;
    ensureLoaded([id]);
    commit(); roll.redraw();
    roll.scrollToCenter(Instruments.get(id).center);
  }

  /* ---------- Transport ---------- */
  function noteToMidi(key) {
    const drumKeys = { a: 36, s: 38, d: 39, f: 42, g: 46, h: 45, j: 56 };
    if (track().inst === 'drums') return drumKeys[key];
    const keyboard = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15 };
    return key in keyboard ? 12 * (octave + 1) + keyboard[key] : undefined;
  }

  function preview(midi) {
    const t = track();
    if (!Instruments.isReady(t.inst)) { ensureLoaded([t.inst]); return; }
    player.preview(t.id, t.inst, midi, 0.45);
    if (t.inst !== 'drums') status('Note: ' + Instruments.midiNameBoth(midi));   // e.g. "G#5 / Ab5"
  }

  async function play() {
    if (player.playing) { stopPlayback(); return; }
    try { await ensureLoaded(project.tracks.map((t) => t.inst)); } catch (e) { return; }
    await player.start(roll.startStep);
    $('btnPlay').classList.add('on');
    $('btnPlay').textContent = '❚❚ Pause';
    animate();
  }

  function stopPlayback() {
    player.stop();
    $('btnPlay').classList.remove('on');
    $('btnPlay').textContent = '▶ Play';
    roll.setPlayhead(roll.startStep);
    $('time').textContent = formatTime(roll.startStep);
  }

  function formatTime(step) {
    const bar = Math.floor(step / 16) + 1, beat = Math.floor((step % 16) / 4) + 1;
    const secs = step * Engine.stepSeconds(project.bpm);
    return 'BAR ' + String(bar).padStart(2, '0') + '.' + beat + '  ' +
      Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0');
  }

  // Runs ~60 times a second: moves the play-head and draws the visualiser
  const bins = new Uint8Array(128);
  function animate() {
    const step = player.getStep();
    if (step !== null) {
      roll.setPlayhead(step, true);
      $('time').textContent = formatTime(step);
    }
    drawViz();
    if (player.playing) requestAnimationFrame(animate);
    else drawViz(true);
  }

  function drawViz(clear) {
    const c = $('viz'), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (clear) return;
    player.spectrum(bins);
    const n = 28, w = c.width / n;
    for (let i = 0; i < n; i++) {
      const v = bins[Math.floor(i * 1.6) + 1] / 255, h = Math.max(2, v * c.height);
      ctx.fillStyle = i % 3 === 0 ? '#ff4fa3' : i % 3 === 1 ? '#4de1ff' : '#ffe600';
      ctx.fillRect(i * w + 1, c.height - h, w - 3, h);
    }
  }

  /* ---------- Export ---------- */
  const fileBase = () => (project.name || 'song').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'song';

  async function doExport(kind) {
    const dlg = $('exportDlg'), bar = $('exportProgress'), msg = $('exportStatus');
    const buttons = dlg.querySelectorAll('button[data-fmt]');
    buttons.forEach((b) => { b.disabled = true; });
    const setMsg = (m, p) => { msg.textContent = m; if (p !== undefined) bar.value = p; };
    try {
      setMsg('Preparing...', 0);
      if (kind === 'json') {
        Exporters.download(new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' }), fileBase() + '.studio.json');
      } else if (kind === 'mid') {
        Exporters.download(Exporters.encodeMidi(project), fileBase() + '.mid');
      } else if (kind === 'stems') {
        const files = [];
        for (let i = 0; i < project.tracks.length; i++) {
          const t = project.tracks[i];
          setMsg('Rendering stem ' + (i + 1) + ' of ' + project.tracks.length + ': ' + t.name, i / project.tracks.length);
          const r = await Engine.render(project, { only: t.id });
          const wav = Exporters.encodeWav(Exporters.finish(r.buffer, r.songSeconds));
          files.push({ name: String(i + 1).padStart(2, '0') + '-' + t.name.replace(/[^\w\- ]+/g, '') + '.wav', data: new Uint8Array(await wav.arrayBuffer()) });
        }
        Exporters.download(Exporters.makeZip(files), fileBase() + '-stems.zip');
      } else {
        setMsg('Rendering the song...', 0.1);
        const r = await Engine.render(project);
        const buffer = Exporters.finish(r.buffer, r.songSeconds);
        let blob;
        if (kind === 'wav') blob = Exporters.encodeWav(buffer);
        if (kind === 'mp3') blob = await Exporters.encodeMp3(buffer, 192, (p) => setMsg('Encoding MP3...', 0.2 + p * 0.8));
        if (kind === 'flac') blob = await Exporters.encodeFlac(buffer, (p) => setMsg('Encoding FLAC...', 0.2 + p * 0.8));
        Exporters.download(blob, fileBase() + '.' + kind);
      }
      setMsg('Done! Check your Downloads folder.', 1);
    } catch (err) {
      setMsg('Export failed: ' + err.message, 0);
    }
    buttons.forEach((b) => { b.disabled = false; });
  }

  /* ---------- Keyboard shortcuts ---------- */
  function onKeyDown(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' && e.target.type !== 'range' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ' ') { e.preventDefault(); play(); return; }
    if (k === 'delete' || k === 'backspace') { if (roll.deleteSelected()) e.preventDefault(); return; }
    if (k === 'z') { octave = Math.max(1, octave - 1); status('Keyboard octave: C' + octave); return; }
    if (k === 'x') { octave = Math.min(7, octave + 1); status('Keyboard octave: C' + octave); return; }

    const midi = noteToMidi(k);
    if (midi === undefined || e.repeat) return;
    preview(midi);
    if (recording && player.playing) {                        // record what you play, snapped to the grid
      const snap = parseInt($('snap').value, 10);
      const step = Math.round(player.getStep() / snap) * snap % Engine.totalSteps(project);
      const note = { m: midi, s: step, l: 1, v: 0.8 };
      track().notes.push(note);
      heldNotes[k] = { note: note, at: player.getStep() };
      roll.redraw();
    }
  }
  function onKeyUp(e) {
    const h = heldNotes[e.key.toLowerCase()];
    if (!h) return;
    delete heldNotes[e.key.toLowerCase()];
    const held = player.getStep() - h.at;
    h.note.l = Math.max(1, Math.min(Engine.totalSteps(project) - h.note.s, Math.round(held < 0 ? 1 : held)));
    roll.redraw();
    commit();
  }

  /* ---------- Start-up ---------- */
  function init() {
    // The ids come from studio.html
    roll = new PianoRoll(
      { scroller: $('rollScroller'), keys: $('rollKeys'), grid: $('rollGrid'), ruler: $('rollRuler'), playhead: $('rollPlayhead') },
      {
        getProject: () => project,
        getTrack: track,
        getSnap: () => parseInt($('snap').value, 10),
        onEdit: commit,
        onPreview: preview,
        onSeek: (step) => { if (player.playing) player.start(step); else $('time').textContent = formatTime(step); }
      });
    player = new Engine.Player(() => project);
    player.onEnded = stopPlayback;

    $('addInst').innerHTML = instrumentOptions('trumpet');

    // Transport buttons (blur() so the Space bar does not "press" the last button again)
    const click = (id, fn) => $(id).addEventListener('click', (e) => { fn(e); e.currentTarget.blur(); });
    click('btnPlay', play);
    click('btnStop', () => { stopPlayback(); });
    click('btnRec', (e) => { recording = !recording; e.currentTarget.classList.toggle('on', recording); status(recording ? 'Record armed: press Play, then play the computer keyboard (A S D F ...).' : 'Record off.'); });
    click('btnNames', (e) => {                                 // show / hide the name inside every note
      roll.setShowNames(!roll.showNames);
      e.currentTarget.classList.toggle('on', roll.showNames);
    });
    click('btnAccidental', (e) => {                            // switch between sharps and flats
      const flats = !roll.useFlats;
      roll.setAccidentals(flats);
      e.currentTarget.textContent = flats ? 'Flats ♭' : 'Sharps ♯';
    });
    click('btnLoop', (e) => { player.loop = !player.loop; e.currentTarget.classList.toggle('on', player.loop); });
    click('btnUndo', undo);
    click('btnRedo', redo);
    click('btnAdd', addTrack);
    click('btnDemo', () => { stopPlayback(); loadProject(Engine.demoProject()); status('Demo song loaded - press Play!'); });
    click('btnNew', () => { if (confirm('Start a new empty song? (Use Undo if you change your mind)')) { stopPlayback(); loadProject(Engine.blankProject()); } });
    click('btnExport', () => { $('exportStatus').textContent = ''; $('exportProgress').value = 0; $('exportDlg').showModal(); });
    click('btnCloseExport', () => $('exportDlg').close());
    click('btnSave', () => Exporters.download(new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' }), fileBase() + '.studio.json'));
    click('btnOpen', () => $('fileOpen').click());
    $('exportDlg').querySelectorAll('button[data-fmt]').forEach((b) => b.addEventListener('click', () => doExport(b.dataset.fmt)));

    $('fileOpen').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((txt) => { try { stopPlayback(); loadProject(JSON.parse(txt)); status('Opened ' + f.name); } catch (err) { status('That file is not a studio project.'); } });
      e.target.value = '';
    });

    $('bpm').addEventListener('change', (e) => { project.bpm = Math.max(40, Math.min(220, parseInt(e.target.value, 10) || 120)); e.target.value = project.bpm; commit(); });
    $('bars').addEventListener('change', (e) => { project.bars = parseInt(e.target.value, 10); commit(); roll.redraw(); });
    $('songName').addEventListener('change', (e) => { project.name = e.target.value; afterChange(); });
    $('reverb').addEventListener('input', (e) => { project.reverb = parseFloat(e.target.value); player.syncMix(); });
    $('reverb').addEventListener('change', commit);
    $('zoom').addEventListener('change', (e) => roll.setZoom(parseInt(e.target.value, 10)));
    $('snap').addEventListener('change', (e) => { roll.lastLen = Math.max(1, parseInt(e.target.value, 10)); });

    ['click', 'change', 'input'].forEach((type) => $('trackList').addEventListener(type, onTrackEvent));
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // Restore the last session, or start with the demo song
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* ignore */ }
    loadProject(saved && saved.tracks && saved.tracks.length ? saved : Engine.demoProject());
    status('Ready. Press Play or the Space bar. Click the piano roll to add notes.');
  }

  global.Studio = { init: init, getProject: () => project };
})(window);
