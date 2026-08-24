// Low-impact matrix background. Disabled for reduced-motion users and paused off-screen.
const canvas = document.getElementById('matrix-bg');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (canvas && !reduceMotion) {
  const ctx = canvas.getContext('2d');
  const chars = 'アイウエオカキクケコ0123456789ABCDEF<>{}[]|'.split('');
  const fontSize = 16;
  let drops = [];
  let frame;
  let lastDraw = 0;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drops = Array.from({ length: Math.ceil(window.innerWidth / fontSize) }, () => Math.random() * -80);
  }

  function draw(time) {
    if (time - lastDraw > 70) {
      ctx.fillStyle = 'rgba(8, 10, 9, 0.08)';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = '#00f58a';
      ctx.font = `${fontSize}px monospace`;

      drops.forEach((drop, index) => {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(char, index * fontSize, drop * fontSize);
        if (drop * fontSize > window.innerHeight && Math.random() > 0.98) drops[index] = 0;
        else drops[index] += 1;
      });
      lastDraw = time;
    }
    frame = requestAnimationFrame(draw);
  }

  function handleVisibility() {
    if (document.hidden) cancelAnimationFrame(frame);
    else frame = requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', handleVisibility);
  frame = requestAnimationFrame(draw);
}
