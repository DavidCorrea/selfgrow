(function () {
  'use strict';

  const garden = document.getElementById('garden');
  const seed = document.getElementById('seed');
  const sprout = document.getElementById('sprout');
  const hint = document.getElementById('hint');
  const message = document.getElementById('message');
  const card = document.getElementById('welcomeCard');

  let planted = false;

  const messages = [
    "a tiny seed finds its place in the soil",
    "with patience, it reaches toward the light",
    "your garden is beginning to grow",
    "every bloom starts with a single seed",
    "nurture it and watch what happens",
  ];

  function getRandomMessage() {
    return messages[Math.floor(Math.random() * messages.length)];
  }

  function createSparkles() {
    const rect = garden.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2 - 10;

    for (let i = 0; i < 8; i++) {
      const sparkle = document.createElement('div');
      sparkle.classList.add('sparkle');
      const angle = (Math.PI * 2 * i) / 8;
      const distance = 2 + Math.random() * 2;
      const tx = Math.cos(angle) * distance * 10 + 'px';
      const ty = Math.sin(angle) * distance * 10 + 'px';
      sparkle.style.setProperty('--tx', tx);
      sparkle.style.setProperty('--ty', ty);
      sparkle.style.left = centerX + 'px';
      sparkle.style.top = centerY + 'px';
      garden.appendChild(sparkle);

      setTimeout(function () {
        sparkle.remove();
      }, 1000);
    }
  }

  function plantSeed() {
    if (planted) return;
    planted = true;

    // Fade out hint
    hint.classList.add('fade-out');

    // Intensify card glow
    card.classList.add('glow-intensify');

    // Show seed with drop animation
    seed.classList.add('visible');

    // After seed lands, start sprout growth
    setTimeout(function () {
      sprout.classList.add('growing');
    }, 800);

    // After flower blooms, show message and sparkles
    setTimeout(function () {
      sprout.classList.remove('growing');
      sprout.classList.add('grown');
      createSparkles();

      message.textContent = getRandomMessage();
      message.classList.add('visible');
    }, 3500);
  }

  garden.addEventListener('click', plantSeed);
  garden.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      plantSeed();
    }
  });
})();
