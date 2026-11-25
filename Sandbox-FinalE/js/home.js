// Modular Album Configuration
// 'artImage' is an image path relative to index.html (e.g. 'images/cover1.jpg').
// Leave it "" to use the 'cover' gradient instead. Paths are case-sensitive on most web hosts.
//
// 'start' / 'end' pick which part of the song plays on the home page (task #29).
// Write times as "m:ss", e.g. start:"1:05", end:"1:35" plays 1:05 -> 1:35 and then loops back to 1:05.
// start:"0:00" = from the beginning, end:"" = until the song ends.
const albums = [
  { title:"Applause",   album:"ARTPOP",   year:2013, audio:"audio/Applause.mp3", cover:"linear-gradient(135deg,#ff4fa3,#7b2ff7)", artImage:"images/Applause.jpg", start:"0:00", end:"", lyrics:"Write a few lines of lyrics\nor a short description\nof the song here." },
  { title:"Cowboys And Angels",   album:"Ladies & Gentlemen",   year:1998, audio:"audio/CowboysAndAngels.mp3", cover:"linear-gradient(135deg,#4de1ff,#2b5876)", artImage:"images/LadiesAndGentlemen.jpg", start:"0:00", end:"", lyrics:"Lyrics or description 2\nSecond line of rhythm and flow\nEchoes through the night." },
  { title:"Last Christmas", album:"LAST CHRISTMAS", year:1984, audio:"audio/LastChristmas.mp3", cover:"linear-gradient(135deg,#f9d423,#ff4e50)", artImage:"images/LastChristmas.jpg", start:"0:00", end:"", lyrics:"Lyrics or description 3\nBright sunlight and golden beats." },
  { title:"One More Night",  album:"Overexposed (Deluxe)",  year:2012, audio:"audio/OneMoreNight.mp3", cover:"linear-gradient(135deg,#43e97b,#0f3443)", artImage:"images/Overexposed.jpg", start:"0:00", end:"", lyrics:"Lyrics or description 4\nDeep synth waves and basslines." },
  { title:"Stereo Love",  album:"Stereo Love",  year:2009, audio:"audio/StereoLove.mp3", cover:"linear-gradient(135deg,#fa709a,#fee140)", artImage:"images/StereoLove.webp", start:"0:00", end:"", lyrics:"Lyrics or description 5\nWarm sunset melodies." },
  { title:"The Lady in My Life",   album:"Thriller",   year:1982, audio:"audio/TheLadyinMyLife.mp3", cover:"linear-gradient(135deg,#c471ed,#f64f59)", artImage:"images/Michael.webp", start:"0:00", end:"", lyrics:"Lyrics or description 6\nElectric neon dreams and velvet skies\nUnder midnight stars." },
];

const cd = document.getElementById('cd');
const artBackdrop = document.getElementById('art-backdrop');
const tabs = document.getElementById('tabs');
const eq = document.getElementById('eq');
const audio = document.getElementById('audio');
const infoContent = document.getElementById('info-content');

// Opened straight from disk (address starts with file:///, e.g. double-clicking index.html)?
// Then browsers refuse the MP3 when crossorigin is set, and won't let the equalizer read
// the song's sound (it would go silent). So from disk: play the song directly and
// animate the bars instead. On a server (Live Server, GitHub Pages) the real analyser is used.
const openedFromDisk = location.protocol === 'file:';
if (openedFromDisk) audio.removeAttribute('crossorigin');

let isPlaying = false;
let currentAlbumIndex = -1;
let fadeTimeout;

// Web Audio API State
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let synthOscillators = [];
let synthGain = null;
let usingFallbackSynth = false;

// Visualizer Configuration
const COL_COUNT = 64;
const BLOCKS_PER_COL = 10;
const columns = [];
let currentLevels = new Array(COL_COUNT).fill(0);
let freqDataArray = null;

// Initialize LED bar DOM elements
for (let i = 0; i < COL_COUNT; i++) {
  const col = document.createElement('div');
  col.className = 'eq-column';

  const blocks = [];
  for (let b = 0; b < BLOCKS_PER_COL; b++) {
    const block = document.createElement('div');
    block.className = 'eq-block';
    
    // Palette layering: Cyan low/mid -> Yellow mid-high -> Magenta/Purple high peak
    if (b < 4) {
      block.dataset.color = 'cyan';
    } else if (b < 7) {
      block.dataset.color = 'yellow';
    } else if (b < 9) {
      block.dataset.color = 'pink';
    } else {
      block.dataset.color = 'purple';
    }
    col.appendChild(block);
    blocks.push(block);
  }
  columns.push(blocks);
  eq.appendChild(col);
}

// Lazy initialization of Web Audio API
function initAudioContext() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  audioCtx = new AudioContextClass();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.83;
  freqDataArray = new Uint8Array(analyser.frequencyBinCount);

  analyser.connect(audioCtx.destination);
  if (!openedFromDisk) {
    try {
      sourceNode = audioCtx.createMediaElementSource(audio);
      sourceNode.connect(analyser);
    } catch (err) {
      console.warn("MediaElementSource connection note:", err);
    }
  }

  // Master Gain for synthetic fallback audio
  synthGain = audioCtx.createGain();
  synthGain.gain.setValueAtTime(0.12, audioCtx.currentTime);
  synthGain.connect(analyser);
}

// Procedural musical synth fallback when audio media fails or is absent
function startFallbackSynth(songIdx) {
  if (!audioCtx) return;
  stopFallbackSynth();

  usingFallbackSynth = true;
  const rootFreqs = [55, 65.41, 73.42, 82.41, 98.0, 110.0]; // Low bass fundamental
  const base = rootFreqs[songIdx % rootFreqs.length];

  // Synth Bass
  const bassOsc = audioCtx.createOscillator();
  bassOsc.type = 'sawtooth';
  bassOsc.frequency.setValueAtTime(base, audioCtx.currentTime);

  // Filter for cyber neon warmth
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(480, audioCtx.currentTime);
  filter.Q.setValueAtTime(4, audioCtx.currentTime);

  // Modulation LFO for dynamic frequency movement
  const lfo = audioCtx.createOscillator();
  lfo.frequency.setValueAtTime(3.2 + (songIdx * 0.4), audioCtx.currentTime);
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.setValueAtTime(340, audioCtx.currentTime);
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  // Synth Arp/Pad harmonic
  const arpOsc = audioCtx.createOscillator();
  arpOsc.type = 'triangle';
  arpOsc.frequency.setValueAtTime(base * 4, audioCtx.currentTime);

  bassOsc.connect(filter);
  arpOsc.connect(filter);
  filter.connect(synthGain);

  bassOsc.start();
  arpOsc.start();
  lfo.start();

  synthOscillators = [bassOsc, arpOsc, lfo];
}

function stopFallbackSynth() {
  if (synthOscillators.length) {
    synthOscillators.forEach(osc => {
      try { osc.stop(); osc.disconnect(); } catch (e) {}
    });
    synthOscillators = [];
  }
  usingFallbackSynth = false;
}

// ---------- Song part (task #29) ----------
// Plays only the part of each song between its 'start' and 'end' (see the albums list), on loop.
let currentClip = { start: 0, end: Infinity };

// Turns "m:ss" text into seconds, e.g. "1:05" -> 65. Empty -> null (= not set)
function parseTime(text) {
  if (text === undefined || text === null || String(text).trim() === '') return null;
  const parts = String(text).trim().split(':').map(Number);
  if (parts.some(n => isNaN(n) || n < 0)) {
    console.warn(`Time "${text}" is not valid, use "m:ss" like "1:05"`);
    return null;
  }
  return parts.reduce((total, n) => total * 60 + n, 0); // works for "ss", "m:ss" and "h:mm:ss"
}

// Works out the start/end seconds for a song and fixes impossible values
function getClip(album) {
  const duration = audio.duration;
  let start = parseTime(album.start) ?? 0;
  let end = parseTime(album.end) ?? duration;
  if (start >= duration) {
    console.warn(`"${album.title}": start ${album.start} is after the song ends, using 0:00`);
    start = 0;
  }
  if (end > duration) end = duration;
  if (end <= start) {
    console.warn(`"${album.title}": end must be after start, playing to the end of the song instead`);
    end = duration;
  }
  return { start, end };
}

// Once the song length is known: work out its part and jump to the start
audio.addEventListener('loadedmetadata', () => {
  const album = albums[currentAlbumIndex];
  if (!album) return;
  currentClip = getClip(album);
  audio.currentTime = currentClip.start;
});

// Loops back to the start when the song passes its end time
function keepInsideClip() {
  if (audio.paused || usingFallbackSynth || audio.readyState < 1) return;
  if (audio.currentTime >= currentClip.end || audio.currentTime < currentClip.start - 0.5) {
    audio.currentTime = currentClip.start;
  }
}
audio.addEventListener('timeupdate', keepInsideClip);

// Play / Pause handling
async function playAudio() {
  initAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const album = albums[currentAlbumIndex];
  if (!album) return;

  isPlaying = true;
  cd.classList.add('spin');
  eq.classList.add('on');

  if (album.audio && audio.src && !audio.src.endsWith('#')) {
    audio.play().then(() => {
      stopFallbackSynth();
    }).catch(err => {
      // Interrupted because another song was picked: the newer play() takes over
      if (err.name === 'AbortError') return;
      // Browser blocked autoplay (e.g. hover before any click): go back to paused state
      if (err.name === 'NotAllowedError') {
        pauseAudio();
        return;
      }
      // Audio file not found or unsupported: activate synthesizer stream
      startFallbackSynth(currentAlbumIndex);
    });
  } else {
    startFallbackSynth(currentAlbumIndex);
  }
}

function pauseAudio() {
  isPlaying = false;
  cd.classList.remove('spin');
  eq.classList.remove('on');
  audio.pause();
  stopFallbackSynth();
}

function togglePlay() {
  if (isPlaying) {
    pauseAudio();
  } else {
    playAudio();
  }
}

// Audio element event listeners
audio.addEventListener('error', () => {
  if (isPlaying) {
    startFallbackSynth(currentAlbumIndex);
  }
});
// When the end of the file is reached (end:""), loop back to the start time
audio.addEventListener('ended', () => {
  if (!isPlaying) return;
  audio.currentTime = currentClip.start;
  audio.play().catch(() => {});
});

// Beat-like bar height (0 to 1) for column c at time t, used when opened from disk.
// Taller on the left (bass), with a pulse about twice a second and a little randomness.
function simulatedLevel(c, t) {
  const bass = 1 - c / COL_COUNT;
  const wave = Math.sin(t * 6 + c * 0.45) * 0.5 + 0.5;
  const pulse = Math.pow(Math.sin(t * 4.2) * 0.5 + 0.5, 3);
  return Math.min(1, 0.12 + 0.45 * wave * (0.4 + 0.6 * bass) + 0.4 * pulse * bass + Math.random() * 0.12);
}

// Real-time render loop driven by AnalyserNode byte frequency data
function renderEqFrame() {
  requestAnimationFrame(renderEqFrame);
  keepInsideClip(); // checked every frame so the loop point is accurate

  // From disk the analyser can't hear the MP3, so the bars follow a made-up beat instead
  const simulate = openedFromDisk && !usingFallbackSynth;

  if (analyser && isPlaying) {
    analyser.getByteFrequencyData(freqDataArray);
    const binCount = analyser.frequencyBinCount; // 128 bins
    const t = performance.now() / 1000;

    for (let c = 0; c < COL_COUNT; c++) {
      let normalized;
      if (simulate) {
        normalized = simulatedLevel(c, t);
      } else {
        // Non-linear acoustic mapping (more emphasis on bass and mid frequencies)
        const ratio = Math.pow(c / (COL_COUNT - 1), 1.6);
        const binIndex = Math.min(binCount - 1, Math.max(0, Math.floor(ratio * (binCount * 0.85))));
        const rawValue = freqDataArray[binIndex] || 0;

        // Subtle dynamic range expansion for expressive visual pop
        normalized = Math.min(1, Math.max(0, (rawValue / 245)));
      }
      const targetBar = Math.floor(normalized * BLOCKS_PER_COL);

      // Smooth easing per column
      if (targetBar > currentLevels[c]) {
        currentLevels[c] += (targetBar - currentLevels[c]) * 0.7; // Fast attack
      } else {
        currentLevels[c] += (targetBar - currentLevels[c]) * 0.16; // Smooth decay
      }
    }
  } else {
    // When paused or stopped: Smoothly ease bars down to resting floor without random loops
    for (let c = 0; c < COL_COUNT; c++) {
      currentLevels[c] += (0 - currentLevels[c]) * 0.15;
      if (currentLevels[c] < 0.05) currentLevels[c] = 0;
    }
  }

  // Update segmented DOM bar states
  for (let c = 0; c < COL_COUNT; c++) {
    const activeLevel = Math.round(currentLevels[c]);
    const blocks = columns[c];

    for (let b = 0; b < BLOCKS_PER_COL; b++) {
      const block = blocks[b];
      if (b < activeLevel) {
        if (!block.classList.contains('active')) {
          block.className = `eq-block active ${block.dataset.color}`;
        }
      } else {
        if (block.classList.contains('active')) {
          block.className = 'eq-block';
        }
      }
    }
  }
}

// Start continuous requestAnimationFrame loop
requestAnimationFrame(renderEqFrame);

// Album artwork: shows artImage on the disc and the backdrop card, falls back to the gradient.
// The path is turned into a full URL first: a relative url() inside a CSS variable is
// resolved from the stylesheet's folder (css/), so "images/x.webp" would become "css/images/x.webp".
function applyArtwork(a) {
  cd.style.setProperty('--cover', a.cover);
  if (artBackdrop) artBackdrop.style.setProperty('--art-cover', a.cover);

  const src = (a.artImage || '').trim();
  if (!src) return;

  const fullUrl = new URL(src, document.baseURI).href;
  const img = new Image();
  img.onload = () => {
    if (albums[currentAlbumIndex] !== a) return; // user already moved to another song
    const cssUrl = `url("${fullUrl}")`;
    cd.style.setProperty('--cover', cssUrl);
    if (artBackdrop) artBackdrop.style.setProperty('--art-cover', cssUrl);
  };
  img.onerror = () => console.warn(`artImage not found for "${a.title}": ${src}`);
  img.src = fullUrl;
}

// Song switching
function showAlbum(i, autoPlay = false) {
  if (currentAlbumIndex === i) {
    if (autoPlay && !isPlaying) playAudio();
    return;
  }
  currentAlbumIndex = i;
  const a = albums[i];

  tabs.querySelectorAll('li').forEach((li, n) => li.classList.toggle('on', n === i));

  if (fadeTimeout) clearTimeout(fadeTimeout);

  infoContent.classList.add('fade-out');
  cd.classList.add('fade-transition');
  if (artBackdrop) artBackdrop.classList.add('fade-transition');

  fadeTimeout = setTimeout(() => {
    applyArtwork(a);

    document.getElementById('title').textContent = a.title;
    document.getElementById('album').textContent = a.album;
    document.getElementById('year').textContent = a.year;
    document.getElementById('lyrics').textContent = a.lyrics;

    infoContent.classList.remove('fade-out');
    cd.classList.remove('fade-transition');
    if (artBackdrop) artBackdrop.classList.remove('fade-transition');
  }, 160);

  // Update audio source cleanly (the song part is set again once it loads)
  currentClip = { start: 0, end: Infinity };
  if (a.audio) {
    audio.src = a.audio;
    audio.load();
  }

  if (isPlaying || autoPlay) {
    playAudio();
  }
}

// Build interactive album tabs
albums.forEach((a, i) => {
  const li = document.createElement('li');
  li.setAttribute('title', a.title + ' (' + a.album + ')');
  
  li.addEventListener('mouseenter', () => {
    showAlbum(i, true);
  });
  li.addEventListener('click', () => {
    showAlbum(i, true);
  });
  tabs.appendChild(li);
});

// CD disc click triggers play/pause
cd.addEventListener('click', () => {
  initAudioContext();
  togglePlay();
});

// Initialize on first album
showAlbum(0, false);