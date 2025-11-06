// main.js - High-Speed Bumper
(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  let W = 1280;
  let H = 720;
  function resize() {
    const ratio = window.devicePixelRatio || 1;
    W = Math.max(600, window.innerWidth - 20);
    H = Math.max(400, window.innerHeight - 120);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.width = Math.floor(W * ratio);
    canvas.height = Math.floor(H * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Input
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  // Game constants
  const GRAVITY = 2000; // px/s^2
  const FRICTION = 0.85;
  const PLAYER_WIDTH = 36;
  const PLAYER_HEIGHT = 52;
  const MAX_SPEED = 1600; // high speed (increased)
  const JUMP_BASE = 780; // base jump velocity
  const DASH_MULT = 1.6;
  // dynamic world: generate ahead as the player moves
  const WORLD_CHUNK = 1200; // generate in chunks
  let worldEndX = 0; // farthest x we've generated

  // Audio helper (lazy-created to respect user gesture/autoplay policies)
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        audioCtx = null;
      }
    }
    return audioCtx;
  }

  // play a short impact (pluck) sound
  let lastImpactAt = 0;
  function playImpactSound(volume = 0.06) {
    // if user uploaded sample and they opted in, play it
    try {
      const useSamples = document.getElementById('useSamples')?.checked;
      if (useSamples && impactBuffer) {
        const ac = getAudioCtx(); if (!ac) return;
        const now = ac.currentTime;
        if (now - lastImpactAt < 0.04) return;
        lastImpactAt = now;
        const src = ac.createBufferSource();
        src.buffer = impactBuffer;
        const g = ac.createGain();
        g.gain.value = volume;
        src.connect(g); g.connect(ac.destination);
        src.start();
        return;
      }
    } catch (e) {
      // continue to fallback
    }
    const ac = getAudioCtx();
    if (!ac) return;
    const now = ac.currentTime;
    if (now - lastImpactAt < 0.06) return; // throttle
    lastImpactAt = now;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(700 + Math.random() * 400, now);
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    o.connect(g);
    g.connect(ac.destination);
    o.start(now);
    o.stop(now + 0.14);
  }

  // play an explosion sound (noise + low tone)
  function playExplosionSound(volume = 0.14) {
    // if user provided explosion sample and opted in, play it
    try {
      const useSamples = document.getElementById('useSamples')?.checked;
      if (useSamples && explosionBuffer) {
        const ac = getAudioCtx(); if (!ac) return;
        const src = ac.createBufferSource();
        src.buffer = explosionBuffer;
        const g = ac.createGain(); g.gain.value = volume;
        src.connect(g); g.connect(ac.destination);
        src.start();
        return;
      }
    } catch (e) {
      // fallback
    }
    const ac = getAudioCtx();
    if (!ac) return;
    const now = ac.currentTime;

    // noise burst
    const bufSize = ac.sampleRate * 1.0;
    const buffer = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const nf = ac.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(1200, now);
    nf.frequency.exponentialRampToValueAtTime(300, now + 0.8);
    const ng = ac.createGain();
    ng.gain.setValueAtTime(volume * 0.9, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    src.connect(nf);
    nf.connect(ng);
    ng.connect(ac.destination);
    src.start(now);

    // low booming tone
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(160 + Math.random() * 40, now);
    o.frequency.exponentialRampToValueAtTime(40, now + 0.9);
    const og = ac.createGain();
    og.gain.setValueAtTime(volume * 0.7, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    o.connect(og);
    og.connect(ac.destination);
    o.start(now);
    o.stop(now + 1.1);
  }

  // buffers for user-provided samples
  let impactBuffer = null;
  let explosionBuffer = null;

  // load user audio file into an ArrayBuffer; decode now if AudioContext available, otherwise store pending
  let pendingImpactData = null;
  let pendingExplosionData = null;

  function decodeArrayBuffer(arr) {
    const ac = getAudioCtx();
    if (!ac) return Promise.reject(new Error('AudioContext not available'));
    return ac.decodeAudioData(arr.slice(0));
  }

  function loadAudioFileToPending(file, kind) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const arr = reader.result;
        if (kind === 'impact') pendingImpactData = arr;
        else pendingExplosionData = arr;
        // try decode immediately if possible
        const ac = getAudioCtx();
        if (ac) {
          decodeArrayBuffer(arr).then((buf) => {
            if (kind === 'impact') { impactBuffer = buf; pendingImpactData = null; }
            else { explosionBuffer = buf; pendingExplosionData = null; }
            resolve(buf);
          }).catch((err) => {
            console.warn('decode failed (will retry on unlock)', err);
            resolve(null);
          });
        } else {
          // audio context not available yet; resolve with null but data is pending
          resolve(null);
        }
      };
      reader.onerror = (e) => reject(e);
      reader.readAsArrayBuffer(file);
    });
  }

  // attempt to decode any pending audio once AudioContext is available/unlocked
  function tryDecodePending() {
    const ac = getAudioCtx();
    if (!ac) return;
    if (pendingImpactData) {
      decodeArrayBuffer(pendingImpactData).then((buf) => { impactBuffer = buf; pendingImpactData = null; console.log('Impact sample decoded after unlock'); }).catch(() => {});
    }
    if (pendingExplosionData) {
      decodeArrayBuffer(pendingExplosionData).then((buf) => { explosionBuffer = buf; pendingExplosionData = null; console.log('Explosion sample decoded after unlock'); }).catch(() => {});
    }
  }

  // Player
  const player = {
    x: 150,
    y: 200,
    vx: 0,
    vy: 0,
    w: PLAYER_WIDTH,
    h: PLAYER_HEIGHT,
    onGround: false,
    facing: 1,
    jumpsLeft: 1,
  };

  // World and Platforms (x, y, w, h)
  const platforms = [];

  // reset the entire game state to initial values
  function resetAll() {
    // clear dynamic entities
    boxes.length = 0;
    enemies.length = 0;
    particles.length = 0;
    smoke.length = 0;
    walls.length = 0;
    hoops.length = 0;

    // reset world generation state
    worldEndX = 0;
    lastEnemyX = -4000;
    lastWallX = -4000;
    lastHoopX = -4000;

    // clear and reset platforms
    platforms.length = 0;

    // reset player
    player.x = 150;
    player.y = 200;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.facing = 1;

    // reset camera
    camera.x = 0;
    camera.y = 0;
    camera.shake = { timeLeft: 0, duration: 0, magnitude: 0, x: 0, y: 0 };

    // regenerate initial world
    extendWorld(WORLD_CHUNK);
    // ensure player stands on ground
    const gy = getGroundYAt(player.x);
    player.y = (isFinite(gy) ? gy : H - 200) - player.h - 2;
  }

  // camera
  const camera = { x: 0, y: 0, shake: { timeLeft: 0, duration: 0, magnitude: 0, x: 0, y: 0 } };

  // extend world generation forward to `toX`
  function extendWorld(toX) {
    let x = Math.max(worldEndX, 0);
    if (x === 0) x = 0; // start at 0
    while (x < toX) {
      // decide whether to make a pit (gap) or platform
      const allowGap = x > 200 && Math.random() < 0.20;
      if (allowGap) {
        const gap = 120 + Math.random() * 260;
        x += gap;
        // occasionally leave a small floating platform after gap
        if (Math.random() < 0.25) {
          const lx = x + 40 + Math.random() * 160;
          const ly = H - 180 - Math.random() * 220;
          const lw = 80 + Math.random() * 160;
          platforms.push({ x: lx, y: ly, w: lw, h: 24 });
          // spawn a box on this floating platform sometimes
          if (Math.random() < 0.6) boxes.push({ x: lx + 12 + Math.random() * Math.max(1, lw - 40), y: ly - 42 - 2, w: 42, h: 42, vx: 0, vy: 0, thrown: false });
            // sometimes put an air hoop above this floating platform
            if (Math.random() < 0.45) {
              const hx = lx + lw / 2 + (Math.random() - 0.5) * 40;
              const hy = ly - 60 - Math.random() * 40;
              if (hx > lastHoopX + MIN_HOOP_SPACING) {
                hoops.push({ x: hx, y: hy, r: 30, strengthX: 1600, strengthY: -780, _cooldown: 0 });
                lastHoopX = hx;
              }
            }
        }
        continue;
      }
      const segW = 180 + Math.floor(Math.random() * 280);
      const py = H - 80;
      platforms.push({ x: x, y: py, w: segW, h: 120 });
      // place 0..1 boxes on this chunk (reduced to avoid piles)
      const boxCount = Math.random() < 0.55 ? 0 : 1; // lower chance of boxes so they don't pile
      for (let bi = 0; bi < boxCount; bi++) {
        const bx = x + 12 + Math.random() * Math.max(1, segW - 40);
        const by = py - 42 - 2;
        boxes.push({ x: bx, y: by, w: 42, h: 42, vx: 0, vy: 0, thrown: false });
      }
      // occasional walls on ground segments
      if (Math.random() < 0.12) {
        const wallW = 20;
        const wallCount = Math.random() < 0.6 ? 1 : 2;
        for (let wi = 0; wi < wallCount; wi++) {
          let wx = x + 12 + Math.random() * Math.max(1, segW - 40);
          // enforce spacing so walls don't clump
          if (wx < lastWallX + MIN_WALL_SPACING) wx = lastWallX + MIN_WALL_SPACING + Math.random() * 60;
          const segRight = x + segW - 20;
          if (wx > segRight) continue;
          const wallH = 60 + Math.random() * 120;
          // place wall so it stands on top of the platform
          walls.push({ x: wx, y: py - wallH, w: wallW, h: wallH });
          lastWallX = wx;
        }
      }
      // occasionally spawn a hoop above ground segments as well
      if (Math.random() < 0.06) {
        let hx = x + 60 + Math.random() * Math.max(1, segW - 120);
        if (hx > lastHoopX + MIN_HOOP_SPACING) {
          const hy = py - 160 - Math.random() * 80;
          hoops.push({ x: hx, y: hy, r: 32, strengthX: 1800, strengthY: -900, _cooldown: 0 });
          lastHoopX = hx;
        }
      }
      // possible enemy on the chunk, but enforce spacing from last enemy
      if (Math.random() < 0.18) {
        const ex = x + 20 + Math.random() * Math.max(1, segW - 40);
        // ensure enemy is at least MIN_ENEMY_SPACING from the last spawned enemy
        if (ex > lastEnemyX + MIN_ENEMY_SPACING) {
          const ey = py - 48 - Math.random() * 10;
          enemies.push({ x: ex, y: ey, w: 40, h: 48, vx: 0, vy: 0, thrown: false });
          lastEnemyX = ex;
        }
      }
      x += segW;
    }
    worldEndX = Math.max(worldEndX, toX);
  }

  // Boxes (movable)
  const boxes = [];
  // Enemies
  const enemies = [];

  // smoke particles (follow flying enemies)
  const smoke = [];
  // walls (static obstacles placed on platform tops)
  const walls = [];
  // air boost hoops (floating boosts that launch the player)
  const hoops = [];
  // spacing controls to avoid clustering
  const MIN_ENEMY_SPACING = 1400; // minimum horizontal spacing between enemies (increased)
  let lastEnemyX = -4000;
  // spacing for walls to avoid clumps
  const MIN_WALL_SPACING = 420;
  let lastWallX = -4000;
  const MIN_HOOP_SPACING = 600;
  let lastHoopX = -4000;
  function spawnBoxes() {
    // legacy helper: clear and respawn boxes on existing platforms
    boxes.length = 0;
    const validPlatforms = platforms.filter(p => p.h >= 60 || p.y > H - 200);
    for (let i = 0; i < 14; i++) {
      const p = validPlatforms[Math.floor(Math.random() * validPlatforms.length)];
      if (!p) break;
      const bx = p.x + 20 + Math.random() * Math.max(1, p.w - 60);
      const by = p.y - 42 - 2;
      boxes.push({ x: bx, y: by, w: 42, h: 42, vx: 0, vy: 0, thrown: false });
    }
  }
  // create initial world
  extendWorld(WORLD_CHUNK);

  // Particles for explosion
  const particles = [];

  // explode an enemy at index i (chain reaction capable)
  function explodeEnemy(i) {
    if (i < 0 || i >= enemies.length) return;
    const e = enemies[i];
    const ex = e.x + e.w / 2;
    const ey = e.y + e.h / 2;
    // spawn a big explosion
    const n = 50 + Math.floor(Math.random() * 60);
    for (let k = 0; k < n; k++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 150 + Math.random() * 500;
      particles.push({ x: ex, y: ey, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 120, life: 0.9 + Math.random() * 0.9, r: 3 + Math.random() * 4, color: '#ffcc66' });
    }
    try { playExplosionSound(0.16 + Math.random() * 0.1); } catch (e) {}

    // apply chain impulse to other enemies
    const radius = 220;
    for (let j = enemies.length - 1; j >= 0; j--) {
      if (j === i) continue;
      const oth = enemies[j];
      const cx = oth.x + oth.w / 2;
      const cy = oth.y + oth.h / 2;
      const dx = cx - ex;
      const dy = cy - ey;
      const dist = Math.hypot(dx, dy);
      if (dist < radius) {
        const force = (1 - dist / radius) * 700;
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        oth.vx += nx * force;
        oth.vy += ny * force - 80;
        oth.thrown = true;
        // if extremely close, trigger immediate explosion (chain)
        if (dist < 80) {
          // schedule quick explode to avoid modifying array while iterating
          setTimeout(() => {
            const idx = enemies.indexOf(oth);
            if (idx >= 0) explodeEnemy(idx);
          }, 20 + Math.random() * 120);
        }
      }
    }

  // affect boxes too: apply impulse and mark hot if close
    for (let bi = boxes.length - 1; bi >= 0; bi--) {
      const b = boxes[bi];
      const bx = b.x + b.w / 2;
      const by = b.y + b.h / 2;
      const dx2 = bx - ex;
      const dy2 = by - ey;
      const dist2 = Math.hypot(dx2, dy2);
      if (dist2 < radius) {
        const f = (1 - dist2 / radius) * 420;
        const nx2 = dx2 / (dist2 || 1);
        const ny2 = dy2 / (dist2 || 1);
        b.vx += nx2 * f;
        b.vy += ny2 * f - 80;
        b.thrown = true;
        // if strong impulse, make the box hot (orange) and explode shortly
        if (Math.hypot(b.vx, b.vy) > 260) {
          b.hot = true;
          b.hotTimer = 0.18 + Math.random() * 0.38;
        }
      }
    }

    // camera shake
    camera.shake.timeLeft = 0.6;
    camera.shake.duration = 0.6;
    camera.shake.magnitude = 28 + Math.random() * 24;

    // remove the exploded enemy
    enemies.splice(i, 1);
  }

  // explode a box and allow chain reactions
  function explodeBox(i) {
    if (i < 0 || i >= boxes.length) return;
    const b = boxes[i];
    const bx = b.x + b.w / 2; const by = b.y + b.h / 2;
    // create medium explosion
    const n = 28 + Math.floor(Math.random() * 36);
    for (let k = 0; k < n; k++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 420;
      particles.push({ x: bx, y: by, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 100, life: 0.8 + Math.random() * 0.9, r: 2 + Math.random() * 4, color: '#ff8844' });
    }
    try { playExplosionSound(0.12 + Math.random() * 0.08); } catch (e) {}

    // camera shake smaller
    camera.shake.timeLeft = 0.45;
    camera.shake.duration = 0.45;
    camera.shake.magnitude = 18 + Math.random() * 18;

    // apply impulse to enemies and boxes nearby
    const radius = 200;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const oth = enemies[j];
      const cx = oth.x + oth.w / 2; const cy = oth.y + oth.h / 2;
      const dx = cx - bx; const dy = cy - by; const dist = Math.hypot(dx, dy);
      if (dist < radius) {
        const force = (1 - dist / radius) * 520;
        const nx = dx / (dist || 1); const ny = dy / (dist || 1);
        oth.vx += nx * force; oth.vy += ny * force - 80; oth.thrown = true;
        if (dist < 90) {
          setTimeout(() => { const idx = enemies.indexOf(oth); if (idx >= 0) explodeEnemy(idx); }, 20 + Math.random() * 120);
        }
      }
    }
    for (let bi = boxes.length - 1; bi >= 0; bi--) {
      if (bi === i) continue;
      const other = boxes[bi];
      const ox = other.x + other.w / 2; const oy = other.y + other.h / 2;
      const dx2 = ox - bx; const dy2 = oy - by; const d2 = Math.hypot(dx2, dy2);
      if (d2 < radius) {
        const f = (1 - d2 / radius) * 420;
        const nx2 = dx2 / (d2 || 1); const ny2 = dy2 / (d2 || 1);
        other.vx += nx2 * f; other.vy += ny2 * f - 60; other.thrown = true;
        if (d2 < 80) {
          // small delay then explode neighboring box
          setTimeout(() => { const idx = boxes.indexOf(other); if (idx >= 0) explodeBox(idx); }, 10 + Math.random() * 160);
        }
      }
    }

    // remove this box
    boxes.splice(i, 1);
  }

  function spawnExplosion(x, y, color = '#f55') {
    const n = 30 + Math.floor(Math.random() * 20);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 200 + Math.random() * 400;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        life: 0.9 + Math.random() * 0.7,
        r: 2 + Math.random() * 3,
        color,
      });
    }
    // play explosion sound (non-blocking)
    try {
      playExplosionSound(0.12 + Math.random() * 0.08);
    } catch (e) {
      /* ignore */
    }
  }

  // wire up audio file inputs (allow user to upload samples)
  document.addEventListener('DOMContentLoaded', () => {
    const impactInput = document.getElementById('impactFile');
    const explosionInput = document.getElementById('explosionFile');
    if (impactInput) impactInput.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      loadAudioFileToPending(f, 'impact').then((buf) => {
        if (buf) { impactBuffer = buf; console.log('Impact sample loaded'); }
        else console.log('Impact file stored and will decode after audio unlock');
      }).catch((err) => console.warn('impact load failed', err));
    });
    if (explosionInput) explosionInput.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      loadAudioFileToPending(f, 'explosion').then((buf) => {
        if (buf) { explosionBuffer = buf; console.log('Explosion sample loaded'); }
        else console.log('Explosion file stored and will decode after audio unlock');
      }).catch((err) => console.warn('explosion load failed', err));
    });

    // add a one-time user gesture listener to resume/create AudioContext and decode pending samples
    function unlockAudioOnGesture() {
      const ac = getAudioCtx();
      if (ac && ac.state === 'suspended' && typeof ac.resume === 'function') {
        ac.resume().catch(() => {});
      }
      tryDecodePending();
      window.removeEventListener('pointerdown', unlockAudioOnGesture);
      window.removeEventListener('keydown', unlockAudioOnGesture);
      window.removeEventListener('touchstart', unlockAudioOnGesture);
    }
    window.addEventListener('pointerdown', unlockAudioOnGesture, { once: true });
    window.addEventListener('keydown', unlockAudioOnGesture, { once: true });
    window.addEventListener('touchstart', unlockAudioOnGesture, { once: true });
  });

  // If a project file named "game scream.mp3" exists next to the page, try to load it and enable samples.
  (function tryLoadDefaultExplosion() {
    const url = 'game scream.mp3';
    fetch(url, { method: 'GET' }).then((resp) => {
      if (!resp.ok) throw new Error('not found');
      return resp.arrayBuffer();
    }).then((arr) => {
      // store pending explosion data and try decode if possible
      pendingExplosionData = arr;
      tryDecodePending();
      const cb = document.getElementById('useSamples');
      if (cb) cb.checked = true;
    }).then(() => {
      console.log('Attempted to load default explosion:', url);
    }).catch((err) => {
      // ignore failure - file may not exist when served locally
    });
  })();

  // Simple AABB intersection
  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Resolve platform collisions for an entity
  function resolvePlatforms(ent) {
    ent.onGround = false;
    ent._groundPlatform = null;
    for (const p of platforms) {
      if (aabb(ent, p)) {
        const overlapX = (ent.x + ent.w / 2) - (p.x + p.w / 2);
        const overlapY = (ent.y + ent.h / 2) - (p.y + p.h / 2);
        const halfW = ent.w / 2 + p.w / 2;
        const halfH = ent.h / 2 + p.h / 2;
        const dx = halfW - Math.abs(overlapX);
        const dy = halfH - Math.abs(overlapY);
        if (dx < dy) {
          // horizontal
          if (overlapX > 0) ent.x += dx; else ent.x -= dx;
          ent.vx = 0;
        } else {
          // vertical
          if (overlapY > 0) {
            ent.y += dy;
            ent.vy = Math.max(0, ent.vy);
          } else {
            ent.y -= dy;
            ent.vy = 0;
            ent.onGround = true;
            ent._groundPlatform = p;
          }
        }
      }
    }
    // also collide with walls (solid vertical obstacles)
    for (const w of walls) {
      if (aabb(ent, w)) {
        const overlapX = (ent.x + ent.w / 2) - (w.x + w.w / 2);
        const overlapY = (ent.y + ent.h / 2) - (w.y + w.h / 2);
        const halfW = ent.w / 2 + w.w / 2;
        const halfH = ent.h / 2 + w.h / 2;
        const dx = halfW - Math.abs(overlapX);
        const dy = halfH - Math.abs(overlapY);
        if (dx < dy) {
          // horizontal push
          if (overlapX > 0) ent.x += dx; else ent.x -= dx;
          ent.vx = 0;
        } else {
          // vertical push (standing on top)
          if (overlapY > 0) {
            ent.y += dy;
            ent.vy = Math.max(0, ent.vy);
          } else {
            ent.y -= dy;
            ent.vy = 0;
            ent.onGround = true;
          }
        }
      }
    }
  }

  // Collide player with boxes and transfer momentum
  function playerBoxCollisions(dt) {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (aabb(player, b)) {
        // Any contact with a box now causes it to explode and boost the player
        const pxCenter = player.x + player.w / 2;
        const bxCenter = b.x + b.w / 2;
        const dir = pxCenter < bxCenter ? -1 : 1;
        try { playImpactSound(0.06); } catch (e) {}
        // explode this box (will remove it from the array)
        explodeBox(i);
        // separate player from where the box was
        if (dir < 0) player.x = b.x - player.w - 0.5; else player.x = b.x + b.w + 0.5;
        // give the player a forward+upward boost similar to enemy impact
        const BOOST_X = 420;
        const BOOST_Y = 360;
        player.vx += dir * BOOST_X;
        if (player.vy > -BOOST_Y) player.vy = -BOOST_Y;
        player.onGround = false;
        if (player.vx > MAX_SPEED) player.vx = MAX_SPEED;
        if (player.vx < -MAX_SPEED) player.vx = -MAX_SPEED;
      }
    }
  }

  // Player collisions with enemies
  function playerEnemyCollisions(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (aabb(player, e)) {
        const pxCenter = player.x + player.w / 2;
        const exCenter = e.x + e.w / 2;
        const dir = pxCenter < exCenter ? -1 : 1;
  // Any collision with an enemy causes it to explode immediately
  try { playImpactSound(0.06); } catch (err) {}
  explodeEnemy(i);
  // separate player from removed enemy
  if (dir < 0) player.x = e.x - player.w - 0.5; else player.x = e.x + e.w + 0.5;
  // give the player a forward+upward boost on enemy impact to reward aggressive play
  const BOOST_X = 420;
  const BOOST_Y = 360;
  player.vx += dir * BOOST_X;
  // set upward velocity (only if not already moving upward fast)
  if (player.vy > -BOOST_Y) player.vy = -BOOST_Y;
  player.onGround = false;
  // clamp horizontal speed
  if (player.vx > MAX_SPEED) player.vx = MAX_SPEED;
  if (player.vx < -MAX_SPEED) player.vx = -MAX_SPEED;
      }
    }
  }

  function getGroundYAt(x) {
    for (const p of platforms) {
      if (x >= p.x && x <= p.x + p.w) return p.y;
    }
    return Infinity;
  }

  // Update loop
  let last = performance.now();
  let fpsCounter = 0;
  let fpsTimer = 0;
  // track previous jump-held state for charge detection
  let prevJumpHeld = false;
  function loop(now) {
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;

    update(dt);
    render();

    // FPS
    fpsCounter++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      document.getElementById('fps').textContent = 'FPS: ' + Math.round(fpsCounter / fpsTimer);
      fpsCounter = 0; fpsTimer = 0;
    }

    requestAnimationFrame(loop);
  }

  function update(dt) {
    // Player controls
    const left = keys['a'] || keys['arrowleft'];
    const right = keys['d'] || keys['arrowright'];
    // allow Up arrow as jump as well; support chargeable jump
    const jump = keys[' '] || keys['space'] || keys['arrowup'];
    const dash = keys['shift'];

    let accel = 5200; // px/s^2
    let maxSpeed = MAX_SPEED;
    if (dash) maxSpeed *= DASH_MULT;

    if (left) {
      player.vx -= accel * dt;
      player.facing = -1;
    }
    if (right) {
      player.vx += accel * dt;
      player.facing = 1;
    }

    // apply gravity
    player.vy += GRAVITY * dt;

    // jump (double jump): On key press, attempt to jump. If on ground, perform jump and
    // grant one mid-air jump; if in air and jumpsLeft>0, consume a mid-air jump.
    if (jump && !prevJumpHeld) {
      // key just pressed
      if (player.onGround) {
        player.vy = -JUMP_BASE;
        player.onGround = false;
        player.jumpsLeft = 1; // allow one additional mid-air jump
      } else if (player.jumpsLeft > 0) {
        player.vy = -JUMP_BASE;
        player.jumpsLeft -= 1;
      }
    }

    // friction and clamp
    player.vx *= player.onGround ? FRICTION : 0.995;
    if (player.vx > maxSpeed) player.vx = maxSpeed;
    if (player.vx < -maxSpeed) player.vx = -maxSpeed;

    // integrate
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // check platforms
  // remember previous platform so we can reset its timer if player steps off
  const prevPlatform = player._groundPlatform || null;
  resolvePlatforms(player);

  // reset available jumps when touching ground
  if (player.onGround) player.jumpsLeft = 1;

  // if stepped off a previous platform, reset its occupied timer
  if (prevPlatform && prevPlatform !== player._groundPlatform) prevPlatform._occupiedTimer = 0;

  // If player stands on a platform for too long, make that platform collapse beneath them
  if (player._groundPlatform) {
      const p = player._groundPlatform;
      p._occupiedTimer = (p._occupiedTimer || 0) + dt;
  // if this platform is part of a vertical stack/layer, make it collapse faster
  const overlapping = platforms.filter(q => q !== p && q.x < p.x + p.w && q.x + q.w > p.x && Math.abs(q.y - p.y) < 100).length + 1;
  // base threshold in seconds
  const BASE_THRESHOLD = 1.2;
  // scale threshold down when player is moving fast (horizontal speed)
  const speed = Math.abs(player.vx || 0);
  // compute a speed factor in range [0.15, 1] where higher speed yields smaller factor
  const speedFactor = 1 - Math.min(0.85, speed / (MAX_SPEED * 1.2));
  // final threshold is base * speedFactor, reduced further when platforms are layered
  const OCCUPY_THRESHOLD = Math.max(0.15, (BASE_THRESHOLD * speedFactor) / Math.min(3, overlapping));
  if (!p._collapsed && p._occupiedTimer > OCCUPY_THRESHOLD) {
        // collapse this platform immediately
        const idx = platforms.indexOf(p);
        if (idx >= 0) {
          // spawn debris boxes
          const debris = 3 + Math.floor(Math.random() * 3);
          for (let d = 0; d < debris; d++) {
            const bx = p.x + 8 + Math.random() * Math.max(1, p.w - 16);
            const by = p.y - 16 - Math.random() * 12;
            boxes.push({ x: bx, y: by, w: 18, h: 18, vx: (Math.random() * 260 - 130), vy: -180 - Math.random() * 100, thrown: true });
          }
          spawnExplosion(p.x + p.w / 2, p.y + 8, '#cc8844');
          platforms.splice(idx, 1);
        }
      }
    }

    // walls: block player movement via resolvePlatforms (walls treated as solid obstacles below)
    // (no instant-death hazards here; walls are static obstacles placed on platforms)

    // update hoops cooldowns and check for player overlap (air boost)
    for (const h of hoops) {
      h._cooldown = Math.max(0, (h._cooldown || 0) - dt);
      const hb = { x: h.x - h.r, y: h.y - h.r, w: h.r * 2, h: h.r * 2 };
      if (aabb(player, hb) && h._cooldown === 0) {
        // apply a strong forward + upward launch using player's facing
        const dir = player.facing || 1;
        player.vx = dir * h.strengthX;
        player.vy = h.strengthY;
        player.onGround = false;
        h._cooldown = 0.5; // short reuse delay
        spawnExplosion(h.x, h.y, '#88ffcc');
        try { playImpactSound(0.08); } catch (e) {}
      }
    }

    // boxes update
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      b.vy += GRAVITY * dt * 0.9;
      b.vx *= 0.998;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // simple platform collisions for boxes
      resolvePlatforms(b);

      // if box is hot, count down and explode when timer ends
      if (b.hot) {
        b.hotTimer -= dt;
        if (b.hotTimer <= 0) {
          explodeBox(i);
          continue;
        }
      }

      // thrown and off-screen detection -> explode box if it flies far
      if (b.thrown) {
        if (b.x > worldEndX + 800 || b.x + b.w < camera.x - 900 || b.y > H + 1200) {
          explodeBox(i);
          continue;
        }
      }
    }

    // enemies update
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.vy += GRAVITY * dt * 0.98;
      e.vx *= 0.998;
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // resolve against platforms
      resolvePlatforms(e);

      // smoke trail when flying fast
      if (e.thrown && Math.hypot(e.vx, e.vy) > 160) {
        // spawn smoke particle behind enemy
        smoke.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, vx: -e.vx * 0.06 + (Math.random() - 0.5) * 30, vy: -e.vy * 0.02 + (Math.random() - 0.5) * 10, life: 0.6 + Math.random() * 0.6, r: 6 + Math.random() * 6, color: '#555' });
      }

      // if thrown and out of visible area ahead, explode
      if (e.thrown) {
        if (e.x > camera.x + W + 120 || e.x + e.w < camera.x - 600 || e.y > H + 800) {
          // explode around this enemy and remove
          explodeEnemy(i);
          continue;
        }
      }
    }

    // enemy-vs-enemy collisions: if enemies touch, explode both (causes chain reactions)
    if (enemies.length > 1) {
      const toExplode = new Set();
      for (let i = 0; i < enemies.length; i++) {
        for (let j = i + 1; j < enemies.length; j++) {
          if (aabb(enemies[i], enemies[j])) {
            toExplode.add(enemies[i]);
            toExplode.add(enemies[j]);
          }
        }
      }
      // explode collected enemies (find current indices before exploding)
      const list = Array.from(toExplode);
      for (const obj of list) {
        const idx = enemies.indexOf(obj);
        if (idx >= 0) explodeEnemy(idx);
      }
    }

  // handle collisions between player and boxes/enemies (transfer momentum)
  playerBoxCollisions(dt);
  playerEnemyCollisions(dt);

    // update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 600 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // update smoke particles
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.vy += 40 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      s.r *= 0.995;
      if (s.life <= 0) smoke.splice(i, 1);
    }

  document.getElementById('objects').textContent = 'Objects: ' + boxes.length;

  // camera follow with smoothing
    const targetX = player.x + player.w / 2 - W / 2;
    camera.x += (targetX - camera.x) * Math.min(1, 8 * dt);
  // clamp left only (we generate ahead dynamically)
  camera.x = Math.max(0, camera.x);
    // vertical follow lightly
    const targetY = player.y + player.h / 2 - H / 2;
    camera.y += (targetY - camera.y) * Math.min(1, 6 * dt);
    camera.y = Math.max(0, Math.min(H * 0.5, camera.y));

    // update camera shake
    if (camera.shake.timeLeft > 0) {
      camera.shake.timeLeft -= dt;
      const t = Math.max(0, camera.shake.timeLeft / camera.shake.duration);
      const power = t * t; // ease-out
      camera.shake.x = (Math.random() * 2 - 1) * camera.shake.magnitude * power;
      camera.shake.y = (Math.random() * 2 - 1) * camera.shake.magnitude * power * 0.6;
    } else {
      camera.shake.x = 0; camera.shake.y = 0;
    }

    // player death (fell too far or wandered past world bounds) -> full reset
    if (player.y > H + 900 || player.x < -400 || player.x > worldEndX + 400) {
      resetAll();
    }

    // extend world ahead of camera
    extendWorld(camera.x + W * 1.5 + WORLD_CHUNK);

    // cleanup behind camera (platforms, boxes, particles)
    const behindX = camera.x - 1200;
    // remove platforms that are far behind
    for (let i = platforms.length - 1; i >= 0; i--) {
      if (platforms[i].x + platforms[i].w < behindX) platforms.splice(i, 1);
    }
    // remove boxes that are far behind
    for (let i = boxes.length - 1; i >= 0; i--) {
      if (boxes[i].x + boxes[i].w < behindX) boxes.splice(i, 1);
    }
    // remove walls far behind
    for (let i = walls.length - 1; i >= 0; i--) {
      if (walls[i].x + walls[i].w < behindX) walls.splice(i, 1);
    }
    // remove hoops far behind
    for (let i = hoops.length - 1; i >= 0; i--) {
      if (hoops[i].x + hoops[i].r < behindX) hoops.splice(i, 1);
    }
    // remove particles far behind
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].x < behindX - 400) particles.splice(i, 1);
    }

    // collapse platforms behind the player as they move
    // platforms that lie sufficiently left of the player will crumble and be removed,
    // spawning a few falling debris boxes and a small particle burst for feedback.
    for (let i = platforms.length - 1; i >= 0; i--) {
      const p = platforms[i];
      if (!p._collapsed && (p.x + p.w) < (player.x - 120)) {
        p._collapsed = true;
        // spawn debris boxes
        const debris = 2 + Math.floor(Math.random() * 3);
        for (let d = 0; d < debris; d++) {
          const bx = p.x + 8 + Math.random() * Math.max(1, p.w - 16);
          const by = p.y - 16 - Math.random() * 12;
          boxes.push({ x: bx, y: by, w: 18, h: 18, vx: (Math.random() * 240 - 120), vy: -160 - Math.random() * 80, thrown: true });
        }
        spawnExplosion(p.x + p.w / 2, p.y + 8, '#aa8844');
        // remove platform so it no longer supports entities
        platforms.splice(i, 1);
      }
    }
    // remember jump held state for next frame
    prevJumpHeld = jump;
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // background (parallax)
    ctx.fillStyle = '#0b0f1a';
    ctx.fillRect(0, 0, W, H);

    // world -> translate by camera
  ctx.save();
  // apply camera shake by offsetting when translating world
  const shakeX = camera.shake.x || 0;
  const shakeY = camera.shake.y || 0;
  ctx.translate(-(camera.x + shakeX), -(camera.y + shakeY));

    // parallax hills/background
    ctx.fillStyle = '#0e1630';
    const hillCount = 3;
    for (let i = 0; i < hillCount; i++) {
      const par = 0.2 + i * 0.15;
      const ox = -camera.x * par;
      ctx.beginPath();
      const baseY = H - 120 - i * 30 - 40;
      ctx.moveTo(ox - 400 + i * 200, baseY + 200);
      const worldW = Math.max(worldEndX, W);
      for (let xh = -400; xh < worldW + 800; xh += 160) {
        const cx = xh + ox + (i * 30);
        const cy = baseY - Math.abs(Math.sin((xh + i * 37) * 0.006)) * (120 + i * 40);
        ctx.quadraticCurveTo(cx + 40, cy, cx + 80, baseY + 200);
      }
      ctx.lineTo(worldW + 1000, H + 600);
      ctx.lineTo(-1000, H + 600);
      ctx.closePath();
      ctx.fill();
    }

    // platforms
    for (const p of platforms) {
      // platform body
      ctx.fillStyle = '#223';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = '#334';
      ctx.strokeRect(p.x, p.y, p.w, p.h);

      // grassy edge: draw small blades along the top edge
      const grassTop = p.y;
      const bladeStep = 10;
      for (let gx = p.x; gx < p.x + p.w; gx += bladeStep) {
        const h = 6 + Math.random() * 6;
        const sway = Math.sin((gx + performance.now() * 0.02) * 0.03) * 2;
        ctx.beginPath();
        ctx.moveTo(gx + 1, grassTop + 2);
        ctx.quadraticCurveTo(gx + 3 + sway, grassTop - h, gx + 6, grassTop + 2);
        ctx.fillStyle = (Math.random() > 0.5) ? '#3aa34a' : '#2f8b3a';
        ctx.fill();
      }
    }

    // boxes
    for (const b of boxes) {
      const boxColor = b.hot ? '#ff6a00' : (b.thrown ? '#ff9944' : '#66aaff');
      ctx.fillStyle = boxColor;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#112';
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }

    // walls
    for (const w of walls) {
      ctx.fillStyle = '#665';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = '#332';
      ctx.strokeRect(w.x, w.y, w.w, w.h);
    }

    // hoops (air boost rings)
    for (const h of hoops) {
      // outer ring
      ctx.beginPath();
      ctx.strokeStyle = '#8ff';
      ctx.lineWidth = 6;
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.stroke();
      // inner glow
      ctx.beginPath();
      ctx.fillStyle = 'rgba(136,255,204,0.12)';
      ctx.arc(h.x, h.y, h.r - 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
    }

    // enemies
    for (const e of enemies) {
      ctx.fillStyle = '#ff5577';
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.strokeStyle = '#741';
      ctx.strokeRect(e.x, e.y, e.w, e.h);
      // small eye
      ctx.fillStyle = '#000';
      ctx.fillRect(e.x + (e.w / 2 - 4), e.y + 12, 6, 6);
    }

    // smoke particles (draw under other particles)
    for (const s of smoke) {
      ctx.globalAlpha = Math.max(0, Math.min(1, s.life / 1.0));
      ctx.fillStyle = '#666';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // player
    ctx.fillStyle = '#fff';
    ctx.fillRect(player.x, player.y, player.w, player.h);
    // face indicator
    ctx.fillStyle = '#000';
    if (player.facing > 0) ctx.fillRect(player.x + player.w - 8, player.y + 12, 6, 6);
    else ctx.fillRect(player.x + 2, player.y + 12, 6, 6);

    // particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 1.2));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // smoke restore alpha
    ctx.globalAlpha = 1;

    ctx.restore();

    // debug / HUD (screen space)
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(8, 8, 220, 84);
    ctx.fillStyle = '#fff';
    ctx.font = '12px Arial';
    ctx.fillText('Speed: ' + Math.round(Math.hypot(player.vx, player.vy)), 14, 26);
    ctx.fillText('X: ' + Math.round(player.x) + ' Y: ' + Math.round(player.y), 14, 44);
    ctx.fillText('CamX: ' + Math.round(camera.x), 14, 62);
    ctx.fillText('Objects: ' + boxes.length, 120, 26);
  }

  // Kick off
  requestAnimationFrame(loop);

  // Expose some for debugging
  window._game = { player, boxes, spawnBoxes, spawnExplosion };
})();
