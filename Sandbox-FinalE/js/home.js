// Modular Album Configuration
// Note: You can easily substitute 'artImage' with a direct image URL (e.g. 'images/cover1.jpg')
const albums = [
  { title:"Applause",   album:"ARTPOP",   year:2013, audio:"Audio/Applause.mp3", cover:"linear-gradient(135deg,#ff4fa3,#7b2ff7)", artImage:"", lyrics:"Write a few lines of lyrics\nor a short description\nof the song here." },
  { title:"Cowboys And Angles",   album:"Ladies & Gentelmen",   year:1998, audio:"Audio/CowboysAndAngles.mp3", cover:"linear-gradient(135deg,#4de1ff,#2b5876)", artImage:"", lyrics:"Lyrics or description 2\nSecond line of rhythm and flow\nEchoes through the night." },
  { title:"Last Christmas", album:"LAST CHRISTMAS", year:1984, audio:"Audio/LastChristmas.mp3", cover:"linear-gradient(135deg,#f9d423,#ff4e50)", artImage:"", lyrics:"Lyrics or description 3\nBright sunlight and golden beats." },
  { title:"One More Night",  album:"Overexposed (Deluxe)",  year:2012, audio:"Audio/OneMoreNight.mp3", cover:"linear-gradient(135deg,#43e97b,#0f3443)", artImage:"", lyrics:"Lyrics or description 4\nDeep synth waves and basslines." },
  { title:"Stereo Love",  album:"Stereo Love",  year:2009, audio:"Audio/StereoLove.mp3", cover:"linear-gradient(135deg,#fa709a,#fee140)", artImage:"", lyrics:"Lyrics or description 5\nWarm sunset melodies." },
  { title:"The Lady in My Life",   album:"Thriller",   year:1982, audio:"Audio/TheLadyinMyLife.mp3", cover:"linear-gradient(135deg,#c471ed,#f64f59)", artImage:"images/michael.webp", lyrics:"Lyrics or description 6\nElectric neon dreams and velvet skies\nUnder midnight stars." },
];

const cd = document.getElementById('cd');
const artBackdrop = document.getElementById('art-backdrop');
const tabs = document.getElementById('tabs');
const eq = document.getElementById('eq');
const audio = document.getElementById('audio');
const infoContent = document.getElementById('info-content');

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

  try {
    sourceNode = audioCtx.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  } catch (err) {
    console.warn("MediaElementSource connection note:", err);
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
      // Audio file not found or blocked: Seamlessly activate synthesizer stream
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
audio.addEventListener('ended', () => {
  pauseAudio();
});

// Real-time render loop driven by AnalyserNode byte frequency data
function renderEqFrame() {
  requestAnimationFrame(renderEqFrame);

  if (analyser && isPlaying) {
    analyser.getByteFrequencyData(freqDataArray);
    const binCount = analyser.frequencyBinCount; // 128 bins

    for (let c = 0; c < COL_COUNT; c++) {
      // Non-linear acoustic mapping (more emphasis on bass and mid frequencies)
      const ratio = Math.pow(c / (COL_COUNT - 1), 1.6);
      const binIndex = Math.min(binCount - 1, Math.max(0, Math.floor(ratio * (binCount * 0.85))));
      const rawValue = freqDataArray[binIndex] || 0;

      // Subtle dynamic range expansion for expressive visual pop
      const normalized = Math.min(1, Math.max(0, (rawValue / 245)));
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
    // Support image URLs as well as gradient/color backgrounds
    const effectiveArtwork = (a.artImage && a.artImage.trim() !== "") ? `url("${a.artImage}")` : a.cover;
    
    cd.style.setProperty('--cover', a.cover);
    if (artBackdrop) {
      artBackdrop.style.setProperty('--art-cover', effectiveArtwork);
    }
    
    document.getElementById('title').textContent = a.title;
    document.getElementById('album').textContent = a.album;
    document.getElementById('year').textContent = a.year;
    document.getElementById('lyrics').textContent = a.lyrics;

    infoContent.classList.remove('fade-out');
    cd.classList.remove('fade-transition');
    if (artBackdrop) artBackdrop.classList.remove('fade-transition');
  }, 160);

  // Update audio source cleanly
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