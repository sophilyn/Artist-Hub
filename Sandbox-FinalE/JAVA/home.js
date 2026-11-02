// SOPHIA: home page logic (albums list, tabs, hover effects, play/pause)
// startEq() and stopEq() come from equalizer.js (Nathan's file)
// ---------- EDIT THIS: one object per oval tab (5-6 works well) ----------
// cover: use a gradient for now, or  "url('images/album1.jpg')"  for a real picture
const albums = [
  { title:"Song One",   album:"Album One",   year:2024, audio:"audio/song1.mp3", cover:"linear-gradient(135deg,#ff4fa3,#7b2ff7)", lyrics:"Write a few lines of lyrics\nor a short description\nof the song here." },
  { title:"Song Two",   album:"Album Two",   year:2023, audio:"audio/song2.mp3", cover:"linear-gradient(135deg,#4de1ff,#2b5876)", lyrics:"Lyrics or description 2" },
  { title:"Song Three", album:"Album Three", year:2022, audio:"audio/song3.mp3", cover:"linear-gradient(135deg,#f9d423,#ff4e50)", lyrics:"Lyrics or description 3" },
  { title:"Song Four",  album:"Album Four",  year:2021, audio:"audio/song4.mp3", cover:"linear-gradient(135deg,#43e97b,#0f3443)", lyrics:"Lyrics or description 4" },
  { title:"Song Five",  album:"Album Five",  year:2020, audio:"audio/song5.mp3", cover:"linear-gradient(135deg,#fa709a,#fee140)", lyrics:"Lyrics or description 5" },
];

const cd = document.getElementById('cd');
const tabs = document.getElementById('tabs');
const audio = document.getElementById('audio');

// Show one album on the CD + right side
function showAlbum(i) {
  const a = albums[i];
  cd.style.setProperty('--cover', a.cover);
  document.getElementById('title').textContent = a.title;
  document.getElementById('album').textContent = a.album;
  document.getElementById('year').textContent = a.year;
  document.getElementById('lyrics').textContent = a.lyrics;
  const wasPlaying = !audio.paused;
  audio.src = a.audio;
  if (wasPlaying) audio.play().catch(() => {});
  tabs.querySelectorAll('li').forEach((li, n) => li.classList.toggle('on', n === i));
}

// Make the tabs
albums.forEach((a, i) => {
  const li = document.createElement('li');
  li.addEventListener('mouseenter', () => {
    showAlbum(i);
    cd.classList.add('spin');                       // CD spins clockwise
    document.body.classList.remove('shake');
    void document.body.offsetWidth;                 // restart the shake animation
    document.body.classList.add('shake');
  });
  tabs.appendChild(li);
});

// Click the CD to play / pause (browsers block autoplay until you click)
cd.addEventListener('click', () => audio.paused ? audio.play().catch(() => {}) : audio.pause());
audio.addEventListener('play', startEq);
audio.addEventListener('pause', stopEq);
audio.addEventListener('ended', stopEq);

showAlbum(0);
