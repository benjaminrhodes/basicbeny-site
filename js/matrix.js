// Matrix Rain Background Effect
const canvas = document.getElementById('matrix-bg');
const ctx = canvas.getContext('2d');

// Set canvas size
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// Characters (katakana + numbers + symbols)
const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF<>{}[]|';
const charArray = chars.split('');

// Columns
const fontSize = 14;
let columns = Math.floor(canvas.width / fontSize);
let drops = [];

// Initialize drops
function initDrops() {
  columns = Math.floor(canvas.width / fontSize);
  drops = [];
  for (let i = 0; i < columns; i++) {
    drops[i] = Math.random() * -100;
  }
}
initDrops();
window.addEventListener('resize', initDrops);

// Draw
function draw() {
  // Semi-transparent black to create fade effect
  ctx.fillStyle = 'rgba(10, 10, 10, 0.05)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Green text
  ctx.fillStyle = '#00ff88';
  ctx.font = fontSize + 'px monospace';

  for (let i = 0; i < drops.length; i++) {
    // Random character
    const char = charArray[Math.floor(Math.random() * charArray.length)];
    
    // Draw character
    ctx.fillText(char, i * fontSize, drops[i] * fontSize);

    // Reset drop randomly after it goes off screen
    if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
      drops[i] = 0;
    }

    // Move drop
    drops[i]++;
  }
}

// Animate
setInterval(draw, 50);
