// NATHAN: equalizer bars. home.js calls startEq() when music plays and stopEq() when it stops.
const eq = document.getElementById('eq');
// Build the equalizer bars
for (let i = 0; i < 18; i++) eq.appendChild(document.createElement('i'));
const bars = eq.querySelectorAll('i');
let eqTimer;

function startEq() {
  eq.classList.add('on');
  eqTimer = setInterval(() => {
    bars.forEach(b => b.style.height = (10 + Math.random() * 90) + '%'); // random heights = fake equalizer
  }, 130);
}
function stopEq() { eq.classList.remove('on'); clearInterval(eqTimer); }

