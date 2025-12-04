'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const template = document.getElementById('popup-template');
  if (!template) return;

  const imagePool = [
    'slop.png',
    'slopp.png',
    'sloppy.png',
    'also shit.jpg',
    'fuckin shit.jpg',
    'shit.jfif',
    'shitt.jpg',
    'shitty.jpeg',
    'shittyy.jpg',
    'shit.webp',
    'kill.jfif',
    'shill.png',
    'shillll.png',
    'shittt.jpg',
    'Soulless.jpg',
    '2025-08-28-AI-Slop-to-Slay-1 (1).jpg',
    '2025-08-28-AI-Slop-to-Slay-2.jpg',
    '2025-08-28-AI-Slop-to-Slay-3.jpg',
    'assfromabutt.png',
    'buttfrom anass.png',
    'shite.png',
    'trash.png'
  ];

  let closedCount = 0;
  let maniaStarted = false;
  let persistentTimer = null;
  let chaosTimeout = null;
  let accelerateInterval = null;
  let accelerateStartTimeout = null;
  let baselineDelay = 3500;
  let maniaAutoTimeout = null;
  let maniaAudio = null;
  let maniaClickListener = null;

  const MANIA_THRESHOLD = 5;

  const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randomOffset = () => Math.random() * 40 - 20;

  const titles = [
    "Isn't this worth it?",
    "This is progress.",
    "Isn't this beautiful?",
    "Isn't this art?",
    'This is efficient, you aren\'t.',
    'An insult to life itself — Hayao Miyazaki',
    'I just had it write my essay for me no biggie'
  ];

  const subtitles = [
    'Keep going. The future needs this.',
    'Progress requires dedication.',
    'Marvel at the innovation before you.',
    'The masterpiece demands your attention.',
    "Isn't this so much easier than drawing?",
    "It's okay it's just a funny AI chat"
  ];

  const maniaTitles = [
    'I am complicit helping the rich',
    "It's okay, you were sold out long ago",
    'Keep licking the boots of tech bros who will take everything you own',
    'Do you feel proud selling out?',
    'You helped use more water than the entirety of Denmark consumes in one day. GOOD JOB!',
    "Who's a good little sheep?",
    "How's your Electric bill?",
    'This is progress and we all know what happens to those in the way of progress',
    'COMPLY'
  ];

  const maniaSubtitles = [
    'Who needs drinking water anyway?',
    "We'll take your home and build more data centers",
    'Rot.',
    'Rot.',
    'Maybe if you shill enough you can clean their 25th private jet?',
    "Yeah you're funding this too.",
    'Be a good little cog.',
    "Don't act like you have morals now"
  ];

  const playManiaAudio = () => {
    if (!maniaAudio) {
      maniaAudio = new Audio('game scream.mp3');
      maniaAudio.loop = true;
      maniaAudio.volume = 0.7;
    }

    const attempt = maniaAudio.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        const unlock = () => {
          document.removeEventListener('pointerdown', unlock);
          document.removeEventListener('keydown', unlock);
          playManiaAudio();
        };
        document.addEventListener('pointerdown', unlock);
        document.addEventListener('keydown', unlock);
      });
    }
  };

  const spawnPopup = () => {
    const fragment = template.content.cloneNode(true);
    const popup = fragment.querySelector('.popup');
    const inner = popup.querySelector('.popup-inner');
    const title = popup.querySelector('[data-title]');
    const subtitle = popup.querySelector('[data-subtitle]');
    const img = popup.querySelector('.popup-img');
    const closeBtn = popup.querySelector('.close');
    const checkbox = popup.querySelector('.popup-checkbox');
    const consentLabel = popup.querySelector('[data-consent-text]');

    if (maniaStarted) inner.classList.add('mania');
    if (title) title.textContent = randomPick(maniaStarted ? maniaTitles : titles);
    if (subtitle) subtitle.textContent = randomPick(maniaStarted ? maniaSubtitles : subtitles);
    if (consentLabel) {
      const consentOptions = maniaStarted
        ? [
            'You already agreed. Keep clicking.',
            'Compliance confirmed.',
            'Complicity acknowledged.'
          ]
        : [
            'I agree this is totally worth it.',
            'I accept that this is progress.',
            'Accept your future.'
          ];
      consentLabel.textContent = randomPick(consentOptions);
    }
    img.src = randomPick(imagePool);
    img.alt = 'Motivation';

    inner.style.transform = `translate(${randomOffset()}px, ${randomOffset()}px)`;
    inner.style.animationDuration = `${0.6 + Math.random() * 0.6}s`;

    const removePopup = () => {
      if (!popup.isConnected) return;
      popup.remove();
      closedCount += 1;
      if (!maniaStarted && closedCount >= MANIA_THRESHOLD) startMania();
    };

    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!checkbox || checkbox.checked) {
        removePopup();
        return;
      }

      checkbox.focus();
    });

    if (checkbox) {
      checkbox.addEventListener('click', () => {
        if (!maniaStarted) {
          removePopup();
          return;
        }

        window.open('https://www.eesi.org/articles/view/data-centers-and-water-consumption', '_blank', 'noopener');
      });
    }

    document.body.appendChild(fragment);

    requestAnimationFrame(() => {
      const maxX = Math.max(0, window.innerWidth - inner.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - inner.offsetHeight);
      inner.style.left = `${Math.random() * maxX}px`;
      inner.style.top = `${Math.random() * maxY}px`;
    });
  };

  const ensurePersistentLoop = () => {
    clearInterval(persistentTimer);
    clearInterval(accelerateInterval);
    clearTimeout(accelerateStartTimeout);
    baselineDelay = 3500;

    persistentTimer = setInterval(() => {
      spawnPopup();
    }, baselineDelay);

    accelerateStartTimeout = setTimeout(() => {
      if (maniaStarted) return;
      accelerateInterval = setInterval(() => {
        if (maniaStarted) return;
        baselineDelay = Math.max(300, baselineDelay - 250);
        clearInterval(persistentTimer);
        persistentTimer = setInterval(() => {
          spawnPopup();
        }, baselineDelay);
        spawnPopup();
      }, 1000);
    }, 1000);
  };

  const startMania = () => {
    if (maniaStarted) return;
    maniaStarted = true;
    clearInterval(persistentTimer);
    clearInterval(accelerateInterval);
    clearTimeout(accelerateStartTimeout);
    clearTimeout(chaosTimeout);
    clearTimeout(maniaAutoTimeout);
  playManiaAudio();

    if (!maniaClickListener) {
      maniaClickListener = () => {
        window.open('https://www.eesi.org/articles/view/data-centers-and-water-consumption', '_blank', 'noopener');
      };
      document.addEventListener('click', maniaClickListener);
    }

    const unleash = (delay) => {
      if (!maniaStarted) return;
      for (let i = 0; i < 8; i += 1) spawnPopup();
      const nextDelay = Math.max(60, delay * 0.85);
      chaosTimeout = setTimeout(() => unleash(nextDelay), nextDelay);
    };

    unleash(600);
  };

  ensurePersistentLoop();
  for (let i = 0; i < 4; i += 1) spawnPopup();
  maniaAutoTimeout = setTimeout(() => {
    startMania();
  }, 15000);

  const buttons = document.querySelectorAll('.cta-button');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      button.classList.add('spark');
      spawnPopup();
      setTimeout(() => button.classList.remove('spark'), 700);
    });
  });

  const reassurance = () => {
    if (!maniaStarted) spawnPopup();
    setTimeout(reassurance, 12000);
  };
  setTimeout(reassurance, 12000);

  window.addEventListener('beforeunload', () => {
    clearInterval(persistentTimer);
    clearTimeout(chaosTimeout);
    clearInterval(accelerateInterval);
    clearTimeout(accelerateStartTimeout);
    clearTimeout(maniaAutoTimeout);
    if (maniaClickListener) {
      document.removeEventListener('click', maniaClickListener);
      maniaClickListener = null;
    }
    if (maniaAudio) {
      maniaAudio.pause();
      maniaAudio = null;
    }
  });
});
