/* =========================================================================
   GEOMETRY GAME — motor do jogo (vanilla JS, sem dependências externas)
   Projeto original inspirado na mecânica de jogos de plataforma rítmicos.
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     0. Referências de DOM e utilidades
     --------------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  const canvas = $('game-canvas');
  const ctx = canvas.getContext('2d');

  const screensEls = {
    login: $('screen-login'),
    start: $('screen-start'),
    levels: $('screen-levels'),
    pause: $('screen-pause'),
    win: $('screen-win'),
  };
  const hudEl = $('hud');
  const practiceBannerEl = $('practice-banner');
  const flashEl = $('flash');
  const playerBadgeEl = $('player-badge');

  function showScreen(name) {
    Object.values(screensEls).forEach((s) => s && s.classList.add('hidden'));
    if (name && screensEls[name]) screensEls[name].classList.remove('hidden');
  }
  function showHud(v) { hudEl.classList.toggle('hidden', !v); }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // PRNG determinístico (mulberry32) — mesma fase + dificuldade sempre gera o mesmo layout
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function weightedPick(list, rng) {
    const total = list.reduce((sum, it) => sum + it.w, 0);
    let r = rng() * total;
    for (const it of list) { if ((r -= it.w) <= 0) return it.type; }
    return list[list.length - 1].type;
  }

  /* ---------------------------------------------------------------------
     1. Canvas responsivo
     --------------------------------------------------------------------- */
  let DPR = 1, VW = 0, VH = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    VW = window.innerWidth; VH = window.innerHeight;
    canvas.width = Math.floor(VW * DPR);
    canvas.height = Math.floor(VH * DPR);
    canvas.style.width = VW + 'px';
    canvas.style.height = VH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------------------------------------------------------------------
     2. Constantes físicas e geometria do mundo
     --------------------------------------------------------------------- */
  const GRAVITY = 2300;          // px/s^2
  const JUMP_VELOCITY = 760;     // px/s
  const PAD_BOOST = 1080;        // px/s (plataforma amarela)
  const ORB_BOOST = 880;         // px/s (orbe — exige toque no momento certo)
  const PLAYER_SIZE = 34;
  const GROUND_HEIGHT = 90;
  const CEIL_GAP = 90;           // distância do topo até o "teto" jogável
  const PLAYER_SCREEN_X = 0.22;  // fração da largura da tela onde o jogador fica fixo

  function groundY() { return VH - GROUND_HEIGHT; }
  function ceilY() { return CEIL_GAP; }
  function playerScreenX() { return Math.round(VW * PLAYER_SCREEN_X); }

  /* ---------------------------------------------------------------------
     3. Dificuldades, paletas e definição das 10 fases
     --------------------------------------------------------------------- */
  // cada dificuldade muda a DENSIDADE de obstáculos (em unidades de batida) e a
  // tolerância da colisão — a fase em si (bpm, velocidade, duração) não muda,
  // exatamente como as dificuldades de uma mesma música em jogos de ritmo.
  const DIFFICULTIES = {
    easy: { label: 'Fácil', order: 0, gapChoices: [2, 2, 2.5, 3, 3, 4], hitboxSpike: 10, hitboxBlock: 8, orbRadius: 34 },
    normal: { label: 'Normal', order: 1, gapChoices: [1, 1.5, 1.5, 2, 2, 2.5], hitboxSpike: 6, hitboxBlock: 4, orbRadius: 26 },
    hard: { label: 'Difícil', order: 2, gapChoices: [0.5, 0.5, 1, 1, 1, 1.5], hitboxSpike: 3, hitboxBlock: 2, orbRadius: 20 },
  };
  const DIFFICULTY_KEYS = ['easy', 'normal', 'hard'];

  const PALETTES = [
    { name: 'Aurora',     bg1: '#0a0d1a', bg2: '#112042', accent: '#2de2e6', accent2: '#7b5cff' },
    { name: 'Plasma',     bg1: '#0a0d1a', bg2: '#1c0f33', accent: '#ff2e92', accent2: '#7b5cff' },
    { name: 'Âmbar',      bg1: '#10120a', bg2: '#2a230d', accent: '#ffd23f', accent2: '#ff8a2d' },
    { name: 'Glacial',    bg1: '#070f14', bg2: '#0c2230', accent: '#2de2e6', accent2: '#3df0a6' },
    { name: 'Vulcânica',  bg1: '#150707', bg2: '#330d0d', accent: '#ff3b5c', accent2: '#ffd23f' },
    { name: 'Profundeza', bg1: '#050511', bg2: '#0e0c2c', accent: '#7b5cff', accent2: '#2de2e6' },
    { name: 'Solar',      bg1: '#140a02', bg2: '#3a1604', accent: '#ff8a2d', accent2: '#ffd23f' },
    { name: 'Esmeralda',  bg1: '#03110b', bg2: '#0a2a1c', accent: '#3df0a6', accent2: '#2de2e6' },
    { name: 'Crepúsculo', bg1: '#100618', bg2: '#2a0a3a', accent: '#ff2e92', accent2: '#ffd23f' },
    { name: 'Singular',   bg1: '#050507', bg2: '#16111f', accent: '#ffffff', accent2: '#ff2e92' },
  ];

  // "bars" = número de compassos de 4 tempos. A duração e a quantidade de
  // obstáculos de cada fase vêm diretamente disso (mais compassos = mais longa).
  const LEVEL_CONFIGS = [
    { id: 0, name: 'Primeiros Passos',    bpm: 118, speed: 300, bars: 20, seed: 101,
      types: [{ type: 'spike', w: 6 }, { type: 'gap', w: 2 }], introduces: [] },
    { id: 1, name: 'Salto Amarelo',       bpm: 122, speed: 315, bars: 22, seed: 202,
      types: [{ type: 'spike', w: 5 }, { type: 'block', w: 2 }, { type: 'gap', w: 2 }, { type: 'pad', w: 2 }], introduces: ['pad'] },
    { id: 2, name: 'Órbita',              bpm: 126, speed: 330, bars: 24, seed: 303,
      types: [{ type: 'spike', w: 4 }, { type: 'block', w: 2 }, { type: 'pad', w: 2 }, { type: 'orb', w: 3 }, { type: 'gap', w: 2 }], introduces: ['orb'] },
    { id: 3, name: 'Gravidade Zero',      bpm: 128, speed: 340, bars: 26, seed: 404,
      types: [{ type: 'spike', w: 4 }, { type: 'block', w: 2 }, { type: 'pad', w: 1 }, { type: 'orb', w: 2 }, { type: 'gravityPortal', w: 2 }], introduces: ['gravityPortal'] },
    { id: 4, name: 'Aceleração',          bpm: 132, speed: 355, bars: 28, seed: 505,
      types: [{ type: 'spike', w: 4 }, { type: 'block', w: 2 }, { type: 'orb', w: 2 }, { type: 'gravityPortal', w: 1 }, { type: 'speedPortal', w: 2 }, { type: 'gap', w: 1 }], introduces: ['speedPortal'] },
    { id: 5, name: 'Labirinto de Blocos', bpm: 135, speed: 365, bars: 30, seed: 606,
      types: [{ type: 'spike', w: 3 }, { type: 'block', w: 5 }, { type: 'pad', w: 2 }, { type: 'orb', w: 2 }, { type: 'gap', w: 2 }], introduces: [] },
    { id: 6, name: 'Tempestade',          bpm: 140, speed: 380, bars: 32, seed: 707,
      types: [{ type: 'spike', w: 4 }, { type: 'block', w: 3 }, { type: 'pad', w: 2 }, { type: 'orb', w: 2 }, { type: 'gravityPortal', w: 1 }, { type: 'speedPortal', w: 1 }, { type: 'gap', w: 2 }], introduces: [] },
    { id: 7, name: 'Inversão Total',      bpm: 144, speed: 395, bars: 34, seed: 808,
      types: [{ type: 'spike', w: 3 }, { type: 'block', w: 2 }, { type: 'orb', w: 2 }, { type: 'gravityPortal', w: 4 }, { type: 'speedPortal', w: 1 }, { type: 'gap', w: 1 }], introduces: [] },
    { id: 8, name: 'Precisão',            bpm: 150, speed: 410, bars: 36, seed: 909,
      types: [{ type: 'spike', w: 5 }, { type: 'block', w: 3 }, { type: 'pad', w: 1 }, { type: 'orb', w: 2 }, { type: 'gravityPortal', w: 1 }, { type: 'gap', w: 2 }], introduces: [] },
    { id: 9, name: 'Desafio Final',       bpm: 160, speed: 430, bars: 40, seed: 999,
      types: [{ type: 'spike', w: 4 }, { type: 'block', w: 3 }, { type: 'pad', w: 2 }, { type: 'orb', w: 3 }, { type: 'gravityPortal', w: 2 }, { type: 'speedPortal', w: 2 }, { type: 'gap', w: 2 }], introduces: [] },
  ];

  // gera os obstáculos de uma fase para uma dificuldade específica.
  // a posição de cada obstáculo é sempre um múltiplo exato de "pxPerBeat",
  // então eles caem em cima da batida da trilha sonora (mesmo bpm dos dois).
  function buildLevel(cfg, diffKey) {
    const diff = DIFFICULTIES[diffKey];
    const pxPerBeat = (cfg.speed * 60) / cfg.bpm;
    const rng = mulberry32(cfg.seed);
    const obstacles = [];
    const totalBeats = cfg.bars * 4;
    const lengthPx = totalBeats * pxPerBeat;
    const endBuffer = pxPerBeat * 3;

    let gravityDir = 1;
    let x = pxPerBeat * 6; // compasso de preparação antes do primeiro obstáculo

    if (cfg.introduces.includes('pad')) { obstacles.push({ type: 'pad', x, side: 'floor' }); x += pxPerBeat * 2; }
    if (cfg.introduces.includes('orb')) { obstacles.push({ type: 'orb', x, side: 'floor' }); x += pxPerBeat * 2; }
    if (cfg.introduces.includes('gravityPortal')) { obstacles.push({ type: 'portalGravity', x, dir: -1 }); gravityDir = -1; x += pxPerBeat * 2.5; }
    if (cfg.introduces.includes('speedPortal')) { obstacles.push({ type: 'portalSpeed', x, mult: 1.35 }); x += pxPerBeat * 2.5; }

    let sinceGravityFlip = 0;
    let guard = 0;
    while (x < lengthPx - endBuffer) {
      guard++;
      if (guard > 6000) break; // proteção contra loop infinito
      const gapBeats = diff.gapChoices[Math.floor(rng() * diff.gapChoices.length)];
      x += gapBeats * pxPerBeat;
      const type = weightedPick(cfg.types, rng);
      const side = gravityDir === 1 ? 'floor' : 'ceiling';

      if (type === 'gravityPortal' && sinceGravityFlip < 3) { x -= gapBeats * pxPerBeat * 0.5; continue; }

      switch (type) {
        case 'spike':
          obstacles.push({ type: 'spike', x, side });
          sinceGravityFlip++;
          break;
        case 'block': {
          const h = 46 + rng() * 36;
          obstacles.push({ type: 'block', x, width: 30 + rng() * 12, height: h, side });
          sinceGravityFlip++;
          break;
        }
        case 'gap': {
          const w = 95 + rng() * 70;
          obstacles.push({ type: 'gap', x, width: w, side });
          x += w * 0.55 + 40;
          sinceGravityFlip++;
          break;
        }
        case 'pad':
          obstacles.push({ type: 'pad', x, side });
          sinceGravityFlip++;
          break;
        case 'orb':
          obstacles.push({ type: 'orb', x, side });
          sinceGravityFlip++;
          break;
        case 'gravityPortal':
          gravityDir *= -1;
          obstacles.push({ type: 'portalGravity', x, dir: gravityDir });
          sinceGravityFlip = 0;
          x += pxPerBeat * 0.5;
          break;
        case 'speedPortal': {
          const mult = rng() < 0.5 ? 0.78 : 1.4;
          obstacles.push({ type: 'portalSpeed', x, mult });
          x += pxPerBeat * 0.5;
          sinceGravityFlip++;
          break;
        }
      }
    }
    obstacles.sort((a, b) => a.x - b.x);
    return {
      id: cfg.id, name: cfg.name, bpm: cfg.bpm, baseSpeed: cfg.speed,
      palette: PALETTES[cfg.id % PALETTES.length],
      obstacles, length: lengthPx, pxPerBeat,
    };
  }

  const LEVELS = {};
  DIFFICULTY_KEYS.forEach((dk) => { LEVELS[dk] = LEVEL_CONFIGS.map((cfg) => buildLevel(cfg, dk)); });
  let currentDifficultyKey = 'normal';
  let activeDiff = DIFFICULTIES.normal;

  /* ---------------------------------------------------------------------
     4. Perfis de jogador e progresso salvo (localStorage, por nome)
     --------------------------------------------------------------------- */
  const PROFILES_KEY = 'geometry-game-profiles-v1';
  const OLD_PROGRESS_KEY = 'geometry-game-progress-v1'; // versão anterior, sem perfis

  function emptyProgress() {
    const p = { best: {}, unlocked: 1 };
    DIFFICULTY_KEYS.forEach((dk) => { p.best[dk] = new Array(LEVEL_CONFIGS.length).fill(0); });
    return p;
  }
  function loadProfilesStore() {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignora */ }
    return { active: null, profiles: {} };
  }
  function saveProfilesStore() {
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profilesStore)); } catch (e) { /* ignora */ }
  }
  // se a pessoa já tinha progresso salvo na versão antiga (sem perfis), preserva
  // esse progresso num perfil chamado "Jogador" em vez de perdê-lo.
  function migrateOldProgressIfNeeded(store) {
    if (Object.keys(store.profiles).length > 0) return store;
    try {
      const raw = localStorage.getItem(OLD_PROGRESS_KEY);
      if (!raw) return store;
      const old = JSON.parse(raw);
      if (!old || !Array.isArray(old.best)) return store;
      const migrated = emptyProgress();
      old.best.forEach((v, i) => { if (i < migrated.best.normal.length) migrated.best.normal[i] = v; });
      migrated.unlocked = old.unlocked || 1;
      store.profiles['Jogador'] = migrated;
      store.active = 'Jogador';
    } catch (e) { /* ignora */ }
    return store;
  }

  let profilesStore = migrateOldProgressIfNeeded(loadProfilesStore());
  let currentProfileName = null;
  let progress = emptyProgress();

  function setActiveProfile(name) {
    currentProfileName = name;
    if (!profilesStore.profiles[name]) profilesStore.profiles[name] = emptyProgress();
    progress = profilesStore.profiles[name];
    profilesStore.active = name;
    saveProfilesStore();
    updatePlayerBadge();
  }
  function updatePlayerBadge() {
    if (currentProfileName) {
      $('player-name-label').textContent = currentProfileName;
      playerBadgeEl.classList.remove('hidden');
    } else {
      playerBadgeEl.classList.add('hidden');
    }
  }
  function renderExistingProfiles() {
    const wrap = $('existing-profiles');
    const names = Object.keys(profilesStore.profiles);
    wrap.innerHTML = '';
    wrap.classList.toggle('hidden', names.length === 0);
    names.forEach((name) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'profile-chip';
      chip.textContent = name;
      chip.addEventListener('click', () => { setActiveProfile(name); goToMenu(); });
      wrap.appendChild(chip);
    });
  }

  /* ---------------------------------------------------------------------
     5. Áudio procedural (sintetizado — sem arquivos externos)
     --------------------------------------------------------------------- */
  const Audio_ = (function () {
    let actx = null, master = null, muted = false;
    let schedulerTimer = null, nextNoteTime = 0, step = 0, bpm = 128, stepDur = 0.25;

    function ensureCtx() {
      if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        master = actx.createGain();
        master.gain.value = 0.55;
        master.connect(actx.destination);
      }
    }
    function kick(t) {
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
    }
    function hat(t, vol) {
      const bufferSize = actx.sampleRate * 0.05;
      const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      const src = actx.createBufferSource(); src.buffer = buffer;
      const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = actx.createGain(); g.gain.value = vol;
      src.connect(hp); hp.connect(g); g.connect(master); src.start(t);
    }
    function blip(t, freq, vol) {
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = 'triangle'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
    }
    const ARP = [220, 277.18, 329.63, 277.18, 392, 329.63, 277.18, 220];
    function scheduleLoop() {
      if (!actx) return;
      while (nextNoteTime < actx.currentTime + 0.12) {
        if (step % 4 === 0) kick(nextNoteTime);
        if (step % 2 === 1) hat(nextNoteTime, 0.18);
        if (step % 8 === 0) blip(nextNoteTime, ARP[(step / 8) % ARP.length] || 220, 0.10);
        nextNoteTime += stepDur;
        step++;
      }
      schedulerTimer = setTimeout(scheduleLoop, 50);
    }
    return {
      start(newBpm) {
        ensureCtx();
        if (actx.state === 'suspended') actx.resume();
        bpm = newBpm || 128;
        stepDur = 60 / bpm / 4;
        step = 0; nextNoteTime = actx.currentTime + 0.05;
        clearTimeout(schedulerTimer);
        scheduleLoop();
      },
      setBpm(newBpm) { bpm = newBpm; stepDur = 60 / bpm / 4; },
      stop() { clearTimeout(schedulerTimer); schedulerTimer = null; },
      jumpSfx() { if (!actx || muted) return; blip(actx.currentTime, 520, 0.12); },
      deathSfx() {
        if (!actx || muted) return;
        const t = actx.currentTime;
        const o = actx.createOscillator(); const g = actx.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
        g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4);
      },
      winSfx() {
        if (!actx || muted) return;
        const t = actx.currentTime;
        [0, 0.1, 0.2, 0.32].forEach((d, i) => blip(t + d, [392, 440, 494, 587][i], 0.16));
      },
      toggleMute() {
        muted = !muted;
        ensureCtx();
        master.gain.setTargetAtTime(muted ? 0 : 0.55, actx.currentTime, 0.05);
        return muted;
      },
      isMuted() { return muted; },
    };
  })();

  /* ---------------------------------------------------------------------
     6. Estado do jogo
     --------------------------------------------------------------------- */
  const STATE = { LOGIN: 'login', MENU: 'menu', LEVELS: 'levels', PLAYING: 'playing', PAUSED: 'paused', WIN: 'win' };
  let state = STATE.MENU;

  let currentLevel = null;
  let distance = 0;            // posição do jogador ao longo do nível (mundo)
  let speedMult = 1;
  let player = { y: 0, vy: 0, gravityDir: 1, rotation: 0, grounded: true };
  let attempts = 1;
  let bestPercentRun = 0;
  let practiceMode = false;
  let checkpoints = [];        // pilha de {distance, y, vy, gravityDir, speedMult}
  let triggered = new Set();   // ids de obstáculos já acionados nesta tentativa (portais/pads/orbs)
  let particles = [];
  let runStartTime = 0;
  let lastTime = 0;
  let rafId = null;

  function obstacleId(o) { return o.x + ':' + o.type; }

  function resetRun(toCheckpoint) {
    if (toCheckpoint && checkpoints.length) {
      const cp = checkpoints[checkpoints.length - 1];
      distance = cp.distance; player.y = cp.y; player.vy = 0;
      player.gravityDir = cp.gravityDir; speedMult = cp.speedMult;
    } else {
      distance = 0; speedMult = 1; player.gravityDir = 1;
      player.y = groundY() - PLAYER_SIZE; player.vy = 0;
      checkpoints = [];
    }
    player.grounded = true; player.rotation = 0;
    triggered = new Set();
    particles = [];
    Audio_.setBpm(currentLevel.bpm * speedMult); // ressincroniza a música com a velocidade atual
  }

  function startLevel(idx, practice) {
    currentLevel = LEVELS[currentDifficultyKey][idx];
    activeDiff = DIFFICULTIES[currentDifficultyKey];
    practiceMode = !!practice;
    attempts = 1;
    bestPercentRun = 0;
    runStartTime = performance.now();
    resetRun(false);
    state = STATE.PLAYING;
    showScreen(null);
    showHud(true);
    playerBadgeEl.classList.add('hidden');
    practiceBannerEl.classList.toggle('hidden', !practiceMode);
    $('hud-attempts').textContent = attempts;
    $('hud-best').textContent = Math.round((progress.best[currentDifficultyKey][idx] || 0)) + '%';
    Audio_.start(currentLevel.bpm);
    lastTime = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function die() {
    Audio_.deathSfx();
    flashEl.classList.remove('hit'); void flashEl.offsetWidth; flashEl.classList.add('hit');
    spawnExplosion();
    const pct = Math.min(100, (distance / currentLevel.length) * 100);
    bestPercentRun = Math.max(bestPercentRun, pct);
    if (!practiceMode) {
      attempts++;
      $('hud-attempts').textContent = attempts;
    }
    resetRun(practiceMode && checkpoints.length > 0);
  }

  function winLevel() {
    Audio_.stop();
    Audio_.winSfx();
    if (100 > (progress.best[currentDifficultyKey][currentLevel.id] || 0)) {
      progress.best[currentDifficultyKey][currentLevel.id] = 100;
    }
    progress.unlocked = Math.max(progress.unlocked, currentLevel.id + 2);
    saveProfilesStore();
    const elapsed = ((performance.now() - runStartTime) / 1000).toFixed(1);
    $('win-attempts').textContent = attempts;
    $('win-time').textContent = elapsed + 's';
    const hasNext = currentLevel.id + 1 < LEVEL_CONFIGS.length;
    $('btn-next-level').classList.toggle('hidden', !hasNext);
    state = STATE.WIN;
    showHud(false);
    practiceBannerEl.classList.add('hidden');
    showScreen('win');
  }

  /* ---------------------------------------------------------------------
     7. Partículas (explosão na morte)
     --------------------------------------------------------------------- */
  function spawnExplosion() {
    const sx = playerScreenX() + PLAYER_SIZE / 2;
    const sy = player.y + PLAYER_SIZE / 2;
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.3;
      const sp = 140 + Math.random() * 220;
      particles.push({
        x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.3, age: 0,
        size: 4 + Math.random() * 5,
      });
    }
  }
  function updateParticles(dt) {
    particles = particles.filter((p) => p.age < p.life);
    particles.forEach((p) => {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt;
    });
  }

  /* ---------------------------------------------------------------------
     8. Entrada (teclado, mouse, toque)
     --------------------------------------------------------------------- */
  function doJump() {
    if (state !== STATE.PLAYING) return;
    const dir = -player.gravityDir;
    if (player.grounded) {
      player.vy = dir * JUMP_VELOCITY;
      player.grounded = false;
      Audio_.jumpSfx();
    }
    tryUseOrb(dir);
  }

  function tryUseOrb(dir) {
    const px = distance + PLAYER_SIZE / 2;
    for (const o of currentLevel.obstacles) {
      if (o.type !== 'orb') continue;
      if (Math.abs(o.x - px) < activeDiff.orbRadius && !triggered.has(obstacleId(o))) {
        player.vy = dir * ORB_BOOST;
        triggered.add(obstacleId(o));
      }
    }
  }

  function placeCheckpoint() {
    if (!practiceMode || state !== STATE.PLAYING) return;
    checkpoints.push({ distance, y: player.y, vy: player.vy, gravityDir: player.gravityDir, speedMult });
    flashCheckpointFeedback();
  }
  function removeCheckpoint() {
    if (!practiceMode) return;
    checkpoints.pop();
    flashCheckpointFeedback();
  }
  function flashCheckpointFeedback() {
    practiceBannerEl.style.transition = 'none';
    practiceBannerEl.style.filter = 'brightness(1.8)';
    requestAnimationFrame(() => {
      practiceBannerEl.style.transition = 'filter 0.3s ease';
      practiceBannerEl.style.filter = 'brightness(1)';
    });
  }

  window.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return; // não captura teclas ao digitar nome
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); doJump(); }
    else if (e.code === 'Escape') { togglePause(); }
    else if (e.key === 'c' || e.key === 'C') { placeCheckpoint(); }
    else if (e.key === 'x' || e.key === 'X') { removeCheckpoint(); }
  });
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); doJump(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------------------------------------------------------------------
     9. Física e colisão
     --------------------------------------------------------------------- */
  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function update(dt) {
    dt = Math.min(dt, 1 / 30);
    const speed = currentLevel.baseSpeed * speedMult;
    distance += speed * dt;

    // física vertical
    player.vy += GRAVITY * player.gravityDir * dt;
    player.y += player.vy * dt;
    player.rotation += (player.grounded ? 0 : 1) * dt * 9 * player.gravityDir;

    const gY = groundY(), cY = ceilY();
    let onFloorSurface = player.gravityDir === 1;
    let surfaceY = onFloorSurface ? gY - PLAYER_SIZE : cY;

    // verifica se está sobre um vão (gap) na superfície atual
    const px = distance;
    let overGap = false;
    for (const o of currentLevel.obstacles) {
      if (o.type === 'gap' && o.side === (onFloorSurface ? 'floor' : 'ceiling')) {
        if (px + PLAYER_SIZE * 0.5 > o.x && px + PLAYER_SIZE * 0.5 < o.x + o.width) { overGap = true; break; }
      }
    }

    player.grounded = false;
    if (!overGap) {
      if (onFloorSurface && player.y >= surfaceY) { player.y = surfaceY; player.vy = 0; player.grounded = true; }
      if (!onFloorSurface && player.y <= surfaceY) { player.y = surfaceY; player.vy = 0; player.grounded = true; }
    }

    // morte por cair fora da tela (caiu num vão)
    if (player.y > VH + 200 || player.y < -200) { die(); return; }

    // colisões com obstáculos
    const pRect = { x: px, y: player.y, w: PLAYER_SIZE, h: PLAYER_SIZE };
    for (const o of currentLevel.obstacles) {
      const dx = o.x - px;
      if (dx > 420 || dx < -120) continue; // só processa obstáculos próximos

      if (o.type === 'spike') {
        const h = 32, w = 32;
        const oy = o.side === 'floor' ? gY - h : cY;
        const m = activeDiff.hitboxSpike; // margem de tolerância depende da dificuldade
        if (rectsOverlap(pRect.x + m, pRect.y + m, pRect.w - 2 * m, pRect.h - 2 * m, o.x, oy, w, h)) { die(); return; }
      } else if (o.type === 'block') {
        const oy = o.side === 'floor' ? gY - o.height : cY;
        const m = activeDiff.hitboxBlock;
        if (rectsOverlap(pRect.x + m, pRect.y + m, pRect.w - 2 * m, pRect.h - 2 * m, o.x, oy, o.width, o.height)) { die(); return; }
      } else if (o.type === 'pad') {
        const oy = o.side === 'floor' ? gY - 14 : cY;
        if (rectsOverlap(pRect.x, pRect.y, pRect.w, pRect.h, o.x - 18, oy, 36, 14)) {
          if (!triggered.has(obstacleId(o))) {
            player.vy = -player.gravityDir * PAD_BOOST;
            triggered.add(obstacleId(o));
            Audio_.jumpSfx();
          }
        }
      } else if (o.type === 'portalGravity') {
        if (Math.abs(dx) < 16 && !triggered.has(obstacleId(o))) {
          player.gravityDir = o.dir;
          triggered.add(obstacleId(o));
        }
      } else if (o.type === 'portalSpeed') {
        if (Math.abs(dx) < 16 && !triggered.has(obstacleId(o))) {
          speedMult = o.mult;
          Audio_.setBpm(currentLevel.bpm * speedMult); // a trilha acelera/desacelera junto com o jogo
          triggered.add(obstacleId(o));
        }
      }
    }

    // vitória
    if (distance >= currentLevel.length) { winLevel(); return; }

    updateParticles(dt);
  }

  /* ---------------------------------------------------------------------
     10. Renderização
     --------------------------------------------------------------------- */
  function drawBackground() {
    const pal = currentLevel.palette;
    const grad = ctx.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, pal.bg2);
    grad.addColorStop(1, pal.bg1);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VW, VH);

    // grade de paralaxe
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1;
    const offset = -(distance * 0.4) % 60;
    for (let x = offset; x < VW; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, VH); ctx.stroke();
    }
    ctx.restore();

    // chão e teto
    ctx.fillStyle = pal.bg1;
    ctx.fillRect(0, groundY(), VW, GROUND_HEIGHT);
    ctx.fillRect(0, 0, VW, ceilY());
    ctx.save();
    ctx.shadowColor = pal.accent; ctx.shadowBlur = 12;
    ctx.fillStyle = pal.accent;
    ctx.fillRect(0, groundY(), VW, 3);
    ctx.fillRect(0, ceilY() - 3, VW, 3);
    ctx.restore();
  }

  function drawPlayer() {
    const pal = currentLevel.palette;
    const sx = playerScreenX();
    ctx.save();
    ctx.translate(sx + PLAYER_SIZE / 2, player.y + PLAYER_SIZE / 2);
    ctx.rotate(player.rotation);
    ctx.shadowColor = pal.accent; ctx.shadowBlur = 18;
    const grad = ctx.createLinearGradient(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE / 2, PLAYER_SIZE / 2);
    grad.addColorStop(0, pal.accent); grad.addColorStop(1, pal.accent2);
    ctx.fillStyle = grad;
    const r = 6;
    roundedRect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE, r);
    ctx.fill();
    ctx.restore();
  }

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawObstacles() {
    const pal = currentLevel.palette;
    const sx0 = playerScreenX();
    const gY = groundY(), cY = ceilY();
    for (const o of currentLevel.obstacles) {
      const screenX = o.x - distance + sx0;
      if (screenX < -80 || screenX > VW + 80) continue;

      if (o.type === 'spike') {
        const h = 32, w = 32;
        const baseY = o.side === 'floor' ? gY : cY + h;
        ctx.save();
        ctx.fillStyle = '#ff3b5c'; ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = 10;
        ctx.beginPath();
        if (o.side === 'floor') {
          ctx.moveTo(screenX, baseY); ctx.lineTo(screenX + w / 2, baseY - h); ctx.lineTo(screenX + w, baseY);
        } else {
          ctx.moveTo(screenX, baseY - h); ctx.lineTo(screenX + w / 2, baseY); ctx.lineTo(screenX + w, baseY - h);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (o.type === 'block') {
        const by = o.side === 'floor' ? gY - o.height : cY;
        ctx.save();
        ctx.fillStyle = pal.accent2; ctx.shadowColor = pal.accent2; ctx.shadowBlur = 8;
        roundedRect(screenX, by, o.width, o.height, 4); ctx.fill();
        ctx.restore();
      } else if (o.type === 'gap') {
        ctx.fillStyle = currentLevel.palette.bg1;
        ctx.fillRect(screenX, o.side === 'floor' ? gY : cY - 3, o.width, o.side === 'floor' ? GROUND_HEIGHT : 6);
      } else if (o.type === 'pad') {
        const py = o.side === 'floor' ? gY - 14 : cY;
        ctx.save();
        ctx.fillStyle = '#ffd23f'; ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 12;
        roundedRect(screenX - 18, py, 36, 8, 3); ctx.fill();
        ctx.restore();
      } else if (o.type === 'orb') {
        const oy = o.side === 'floor' ? gY - 64 : cY + 64;
        ctx.save();
        ctx.fillStyle = '#3df0a6'; ctx.shadowColor = '#3df0a6'; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(screenX, oy, 11, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (o.type === 'portalGravity') {
        ctx.save();
        ctx.fillStyle = 'rgba(123,92,255,0.28)';
        ctx.fillRect(screenX - 10, cY, 20, gY - cY);
        ctx.strokeStyle = '#7b5cff'; ctx.lineWidth = 3; ctx.shadowColor = '#7b5cff'; ctx.shadowBlur = 14;
        ctx.strokeRect(screenX - 10, cY, 20, gY - cY);
        ctx.restore();
      } else if (o.type === 'portalSpeed') {
        ctx.save();
        const c = o.mult > 1 ? '#ff8a2d' : '#2de2e6';
        ctx.fillStyle = c + '38';
        ctx.fillRect(screenX - 10, cY, 20, gY - cY);
        ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.shadowColor = c; ctx.shadowBlur = 14;
        ctx.strokeRect(screenX - 10, cY, 20, gY - cY);
        ctx.restore();
      }
    }
  }

  function drawParticles() {
    particles.forEach((p) => {
      const a = 1 - p.age / p.life;
      ctx.fillStyle = currentLevel.palette.accent;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
    ctx.globalAlpha = 1;
  }

  function drawCheckpointMarkers() {
    if (!practiceMode || !checkpoints.length) return;
    const sx0 = playerScreenX();
    checkpoints.forEach((cp) => {
      const screenX = cp.distance - distance + sx0;
      if (screenX < -20 || screenX > VW + 20) return;
      ctx.save();
      ctx.strokeStyle = '#ffd23f'; ctx.globalAlpha = 0.55; ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(screenX, ceilY()); ctx.lineTo(screenX, groundY()); ctx.stroke();
      ctx.restore();
    });
  }

  function render() {
    drawBackground();
    drawCheckpointMarkers();
    drawObstacles();
    drawPlayer();
    drawParticles();
  }

  /* ---------------------------------------------------------------------
     11. Loop principal
     --------------------------------------------------------------------- */
  function loop(t) {
    const dt = (t - lastTime) / 1000;
    lastTime = t;
    if (state === STATE.PLAYING) {
      update(dt);
      render();
      const pct = clamp((distance / currentLevel.length) * 100, 0, 100);
      $('progress-fill').style.width = pct + '%';
      $('hud-percent').textContent = Math.round(pct) + '%';
    }
    rafId = requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------------------
     12. Pausa / navegação
     --------------------------------------------------------------------- */
  function togglePause() {
    if (state === STATE.PLAYING) {
      state = STATE.PAUSED;
      Audio_.stop();
      showScreen('pause');
    } else if (state === STATE.PAUSED) {
      state = STATE.PLAYING;
      Audio_.start(currentLevel.bpm * speedMult);
      showScreen(null);
    }
  }

  function goToMenu() {
    state = STATE.MENU;
    Audio_.stop();
    showHud(false);
    practiceBannerEl.classList.add('hidden');
    updatePlayerBadge();
    showScreen('start');
  }

  function goToLevelSelect() {
    state = STATE.LEVELS;
    Audio_.stop();
    showHud(false);
    practiceBannerEl.classList.add('hidden');
    updatePlayerBadge();
    syncDifficultyButtonsUI();
    renderLevelGrid();
    showScreen('levels');
  }

  function syncDifficultyButtonsUI() {
    document.querySelectorAll('.diff-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.diff === currentDifficultyKey);
    });
  }

  function renderLevelGrid() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    LEVEL_CONFIGS.forEach((cfg, i) => {
      const lvl = LEVELS[currentDifficultyKey][i];
      const unlocked = i < progress.unlocked;
      const card = document.createElement('button');
      card.className = 'level-card' + (unlocked ? '' : ' locked');
      card.style.setProperty('--lvl-accent', lvl.palette.accent);
      card.style.setProperty('--lvl-accent2', lvl.palette.accent2);
      const best = Math.round(progress.best[currentDifficultyKey][i] || 0);
      card.innerHTML =
        '<span class="level-num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="level-name">' + lvl.name + '</span>' +
        '<span class="level-meta">' + lvl.bpm + ' BPM · ' + lvl.obstacles.length + ' obstáculos</span>' +
        (unlocked
          ? '<span class="level-best">' + (best ? best + '%' : 'Não jogada') + '</span>'
          : '<span class="level-locked">🔒 Conclua a fase anterior</span>');
      if (unlocked) {
        card.addEventListener('click', () => {
          startLevel(i, practiceModePending);
          practiceModePending = false;
        });
      }
      grid.appendChild(card);
    });
    $('levels-title').textContent = practiceModePending ? 'Selecione a fase para praticar' : 'Selecione a fase';
  }

  /* ---------------------------------------------------------------------
     13. Ligações de UI
     --------------------------------------------------------------------- */
  let practiceModePending = false;
  $('btn-play').addEventListener('click', () => { practiceModePending = false; goToLevelSelect(); });
  $('btn-practice').addEventListener('click', () => { practiceModePending = true; goToLevelSelect(); });

  $('btn-pause').addEventListener('click', togglePause);
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-restart-pause').addEventListener('click', () => { state = STATE.PLAYING; showScreen(null); resetRun(false); Audio_.start(currentLevel.bpm); attempts = 1; $('hud-attempts').textContent = attempts; });
  $('btn-menu-pause').addEventListener('click', goToMenu);
  $('btn-menu-win').addEventListener('click', goToMenu);
  $('btn-replay').addEventListener('click', () => startLevel(currentLevel.id, false));

  $('btn-next-level').addEventListener('click', () => {
    const next = currentLevel.id + 1;
    if (next < LEVEL_CONFIGS.length) startLevel(next, false); else goToLevelSelect();
  });

  $('btn-mute').addEventListener('click', () => {
    const muted = Audio_.toggleMute();
    $('btn-mute').textContent = muted ? '🔇' : '🔊';
  });

  $('btn-back-levels').addEventListener('click', goToMenu);

  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentDifficultyKey = btn.dataset.diff;
      syncDifficultyButtonsUI();
      renderLevelGrid();
    });
  });

  // --- perfil de jogador ---
  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('login-name-input');
    let name = input.value.trim();
    if (!name) name = 'Jogador';
    name = name.slice(0, 18);
    input.value = '';
    setActiveProfile(name);
    goToMenu();
  });

  $('btn-switch-profile').addEventListener('click', () => {
    renderExistingProfiles();
    showHud(false);
    practiceBannerEl.classList.add('hidden');
    playerBadgeEl.classList.add('hidden');
    showScreen('login');
  });

  /* ---------------------------------------------------------------------
     14. Inicialização
     --------------------------------------------------------------------- */
  renderExistingProfiles();
  if (profilesStore.active && profilesStore.profiles[profilesStore.active]) {
    setActiveProfile(profilesStore.active);
    showScreen('start');
  } else {
    showScreen('login');
  }
})();
