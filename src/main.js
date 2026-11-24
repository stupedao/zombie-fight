/* ============================================================
   DEAD HOURS - bootstrap & game loop
   Renderer + cinematic post-processing (ACES filmic tone mapping,
   UnrealBloom, FXAA, film grain / chromatic aberration / vignette),
   fixed 60 Hz simulation decoupled from rendering, input,
   state machine (menu / playing / paused / dying / over),
   score & stats, leaderboard wiring.
   ============================================================ */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import { CONFIG } from './config.js';
import { buildTextures } from './textures.js';
import { World } from './world.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapons.js';
import { ZombieManager } from './zombie.js';
import { WaveManager } from './waves.js';
import { Pickups } from './pickups.js';
import { Particles, Decals } from './particles.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { Leaderboard } from './leaderboard.js';

const STEP = 1 / 60;

/* ============================================================
   Cinematic pass - the "filmic" layer.
   Runs AFTER tone mapping (OutputPass) on the sRGB buffer:
   chromatic aberration at the frame edges, an animated film
   grain, a soft vignette, a cold-night color grade and the
   damage / death screen states. Cheap: one fullscreen quad.
   ============================================================ */

const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDamage: { value: 0 },   // 0..1 red pain pulse
    uDeath: { value: 0 },    // 0..1 drain toward cold sepia
    uGrain: { value: 0.05 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uDamage, uDeath, uGrain;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // chromatic aberration - stronger toward the frame edge
      vec2 off = c * (0.0016 + r2 * 0.006);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      // cold-night grade: blue shadows, neutral highs
      col = mix(col, col * vec3(0.97, 1.0, 1.07), 0.5);
      col += vec3(0.0, 0.004, 0.012) * (1.0 - col);

      // soft vignette
      float vig = 1.0 - smoothstep(0.12, 0.92, r2 * 1.45);
      col *= mix(0.6, 1.0, vig);

      // damage pulse
      float pulse = 0.5 + 0.5 * sin(uTime * 6.3);
      vec3 hurt = col * vec3(1.5, 0.38, 0.34) + vec3(0.09, 0.0, 0.0);
      col = mix(col, hurt, uDamage * (0.4 + 0.28 * pulse));

      // death: drain to a cold, dark monochrome
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 dead = vec3(lum) * vec3(1.02, 0.95, 0.88) * 0.55 + vec3(0.015, 0.0, 0.0);
      col = mix(col, dead, uDeath * 0.92);

      // animated film grain
      float g = hash(uv * uResolution + fract(uTime * 13.7) * 191.0) - 0.5;
      col += g * uGrain * (1.0 - uDeath * 0.4);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

class Game {
  constructor() {
    this.state = 'boot';   // boot | menu | playing | paused | dying | over
    this.ui = new UI();

    this._initRenderer();
    if (!this.renderer) return;

    this._buildScene();
    this._bindInput();
    this._bindUI();

    this.stats = { score: 0, kills: 0, headshots: 0, shots: 0, hits: 0 };
    this.hudTimer = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fpsOn = false;
    this.deathTimer = 0;
    this.simTime = 0;
    this.fxDamage = 0;
    this.fxDeath = 0;

    this.loadBoards();

    this._last = performance.now();
    this._acc = 0;
    requestAnimationFrame((t) => this._frame(t));
  }

  /* ==================== renderer ==================== */

  _initRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.ui.el.canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch (e) {
      console.error('WebGL init failed:', e);
      this.ui.showWebglError();
      this.renderer = null;
      return;
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._applyPixelRatio();
  }

  _applyPixelRatio() {
    const cap = CONFIG.fx.pixelRatioCap[this.quality || 'high'];
    this.renderer.setPixelRatio(Math.min(cap, window.devicePixelRatio || 1));
    // size the drawing buffer to the viewport (CSS only stretches it otherwise)
    if (window.innerWidth > 0 && window.innerHeight > 0) {
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  }

  _buildScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.08, 500
    );
    this.scene.add(this.camera);   // weapon viewmodel is a camera child

    const TEX = buildTextures();

    this.audio = new AudioSys();
    this.particles = new Particles(this.scene);
    this.particles.setMap('smoke', TEX.smoke);
    this.decals = new Decals(this.scene);
    this.decals.setTextures(TEX.blood, TEX.hole);

    this.world = new World(this.scene, this.renderer, TEX, this.quality || 'high', this.particles);
    this.particles.setFog(this.world.fog.color, this.world.fog.density);

    this.player = new Player(this.camera, this.world, this.audio, this.ui);
    this.weapons = new WeaponSystem(this.camera, this.scene, TEX, this.particles, this.decals, this.audio, this.ui, this.world);
    this.zm = new ZombieManager(this.scene, this.world, TEX, this.particles, this.decals, this.audio, this.player);
    this.waves = new WaveManager(this.zm, this.ui, this.audio);
    this.pickups = new Pickups(this.scene, TEX, this.particles, this.audio, this.ui, this.player, this.weapons);

    // callbacks
    this.zm.onKill = (z, headshot) => this._onKill(z, headshot);
    this.weapons.onShot = () => { this.stats.shots++; };
    this.weapons.onHit = (res) => {
      if (res.died) return;
      this.stats.hits++;
      this.ui.hitmarker(res.headshot);
      this.stats.score += res.headshot ? CONFIG.score.headHit : CONFIG.score.bodyHit;
    };

    // post-processing: render -> bloom -> tonemap/sRGB -> FXAA -> cinematic
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.55, 0.85, 0.5      // strength, radius, threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaaPass);
    this.cinePass = new ShaderPass(CinematicShader);
    this.composer.addPass(this.cinePass);
    this._applyPixelRatio();
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this._updatePassResolutions();

    window.addEventListener('resize', () => this._resize());

    this.state = 'menu';
    this.ui.showMenu(true);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this._updatePassResolutions();
  }

  _updatePassResolutions() {
    const pr = this.renderer.getPixelRatio();
    const w = Math.floor(window.innerWidth * pr);
    const h = Math.floor(window.innerHeight * pr);
    if (this.fxaaPass) this.fxaaPass.material.uniforms['resolution'].value.set(1 / w, 1 / h);
    if (this.cinePass) this.cinePass.uniforms.uResolution.value.set(w, h);
  }

  /* ==================== input ==================== */

  _bindInput() {
    this.input = {
      keys: new Set(),
      lmb: false,
      rmb: false,
      reloadQueued: false,
    };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.input.keys.add(e.code);
      if (this.state !== 'playing') return;
      if (e.code === 'KeyR') this.input.reloadQueued = true;
      if (e.code === 'Space') this.player.jump();
      if (e.code === 'KeyF') {
        this.fpsOn = !this.fpsOn;
        this.ui.showFps(this.fpsOn);
      }
      if (e.code === 'KeyP') this._pause();
    });
    window.addEventListener('keyup', (e) => this.input.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.input.keys.clear();
      this.input.lmb = false;
      this.input.rmb = false;
      if (this.state === 'playing') this._pause();
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.ui.el.canvas) return;
      if (this.state === 'playing') {
        this.player.look(e.movementX, e.movementY);
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return;
      if (e.button === 0) this.input.lmb = true;
      if (e.button === 2) this.input.rmb = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.input.lmb = false;
      if (e.button === 2) this.input.rmb = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (this.state !== 'playing') return;
      const n = this.weapons.weapons.length;
      const dir = e.deltaY > 0 ? 1 : -1;
      this.weapons.switchTo((this.weapons.index + dir + n) % n);
    }, { passive: true });

    // click canvas to re-lock pointer during play
    this.ui.el.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && document.pointerLockElement !== this.ui.el.canvas) {
        this._requestLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.ui.el.canvas && this.state === 'playing') {
        this._pause();
      }
    });

    // mobile notice
    if ('ontouchstart' in window && !window.matchMedia('(pointer:fine)').matches) {
      this.ui.showMobileNotice();
    }
  }

  _requestLock() {
    const p = this.ui.el.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { /* too soon after unlock - user will click again */ });
  }

  /* ==================== UI wiring ==================== */

  _bindUI() {
    // restore last quality choice (default high)
    let q = 'high';
    try {
      const saved = localStorage.getItem('dh-quality');
      if (saved && CONFIG.fx.fogDensity[saved]) q = saved;
    } catch (e) { /* ignore */ }
    this.quality = q;
    this.ui.setQuality(q);

    this.ui.onPlay = () => this._startGame();
    this.ui.onResume = () => this._resume();
    this.ui.onRestart = () => { this.ui.showPause(false); this._startGame(); };
    this.ui.onQuit = () => this._quitToMenu();
    this.ui.onAgain = () => { this.ui.hideGameOver(); this._startGame(); };
    this.ui.onMenu = () => { this.ui.hideGameOver(); this._quitToMenu(); };
    this.ui.onQuality = (q) => this._applyQuality(q);
    this.ui.onVolume = (v) => this.audio.setVolume(v);
    this.ui.onSubmit = (name) => this._submitScore(name);
  }

  _applyQuality(q) {
    this.quality = q;
    try { localStorage.setItem('dh-quality', q); } catch (e) { /* ignore */ }
    this._applyPixelRatio();
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this._updatePassResolutions();
    this.world.applyQuality(q);
    this.particles.setFog(this.world.fog.color, this.world.fog.density);
    this.bloomPass.enabled = !!CONFIG.fx.bloom[q];
  }

  /* ==================== state transitions ==================== */

  _startGame() {
    this.audio.init();
    this.audio.resume();
    this.audio.startAmbient();

    // full reset
    this.stats = { score: 0, kills: 0, headshots: 0, shots: 0, hits: 0 };
    this.fxDamage = 0;
    this.fxDeath = 0;
    this.player.reset();
    this.weapons.reset();
    this.zm.reset();
    this.pickups.reset();
    this.particles.reset();
    this.decals.reset();
    this.world.reset();
    this.waves.start();
    this.camera.fov = CONFIG.camera.fov;
    this.camera.updateProjectionMatrix();

    this.state = 'playing';
    this.ui.showMenu(false);
    this.ui.showPause(false);
    this.ui.hideGameOver();
    this.ui.showHud(true);
    this.ui.setHealth(this.player.hp);
    this.ui.setScore(0);
    this.ui.setBoost(null);
    this.weapons._hud();
    this._requestLock();
  }

  _pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showPause(true);
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.stopAmbient();
  }

  _resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.showPause(false);
    this.audio.startAmbient();
    this._requestLock();
  }

  _quitToMenu() {
    this.state = 'menu';
    this.ui.showPause(false);
    this.ui.hideGameOver();
    this.ui.showHud(false);
    this.ui.showMenu(true);
    this.audio.stopAmbient();
    this.loadBoards();
  }

  _onKill(z, headshot) {
    this.stats.kills++;
    if (headshot) this.stats.headshots++;
    this.stats.hits++;   // the killing shot also hit
    this.stats.score += z.points + (headshot ? CONFIG.score.headKillBonus : CONFIG.score.killBonus);
    this.pickups.tryDrop(z.group.position, this.waves.wave);
    this.ui.hitmarker(headshot);
    if (z.type === 'bloater') this._bloaterExplosion(z);
  }

  /** bloaters detonate when they die - acid blast + falloff damage */
  _bloaterExplosion(z) {
    const B = CONFIG.bloater;
    const p = z.group.position;
    this.particles.blood(new THREE.Vector3(p.x, 1.05 * z.scale, p.z), new THREE.Vector3(0, 1, 0), 34);
    this.particles.dust(new THREE.Vector3(p.x, 0.6, p.z), 18);
    this.decals.bloodPool(p.x, p.z, 1.7);
    const d = Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z);
    this.audio.boom(d, this.zm._panToPlayer(z));
    if (d < B.explosionRadius && this.player.alive) {
      const dmg = Math.max(8, B.explosionDamage * (1 - d / B.explosionRadius));
      this._onPlayerHit(dmg);
    }
  }

  _onPlayerHit(damage) {
    if (this.state !== 'playing') return;
    this.fxDamage = Math.min(1, this.fxDamage + 0.45 + damage * 0.012);
    const died = this.player.damage(damage);
    if (died) {
      this.state = 'dying';
      this.deathTimer = 1.6;
      this.input.lmb = false;
      this.input.rmb = false;
    }
  }

  _playerDeath() {
    this.state = 'over';
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.stopAmbient();
    this.ui.showHud(false);
    this.ui.setIntermission(null);
    this.ui.setBoost(null);
    const acc = this.stats.shots > 0 ? Math.round((this.stats.hits / this.stats.shots) * 100) : 0;
    this.ui.showGameOver({
      score: this.stats.score,
      wave: this.waves.wave,
      kills: this.stats.kills,
      headshots: this.stats.headshots,
      accuracy: acc,
    });
    this.loadBoards(this.ui.el.goBoard);
  }

  async _submitScore(name) {
    this.ui.setSaveStatus('SAVING...', false);
    const res = await Leaderboard.submit(name, this.stats.score, this.waves.wave);
    if (res.error) {
      this.ui.setSaveStatus(`REJECTED: ${res.error}`, false);
      return;
    }
    if (res.offline) {
      this.ui.setSaveStatus('SAVED LOCALLY (API OFFLINE)', true);
    } else if (res.rank) {
      this.ui.setSaveStatus(`SAVED - RANK #${res.rank}`, true);
    } else {
      this.ui.setSaveStatus('SAVED', true);
    }
    this.loadBoards(this.ui.el.goBoard, name);
    this.loadBoards(this.ui.el.menuBoard, name);
  }

  async loadBoards(el, highlight) {
    const target = el || this.ui.el.menuBoard;
    const { entries, offline } = await Leaderboard.fetch();
    const wrapped = entries.map((e) => ({ ...e }));
    wrapped.offline = offline;
    this.ui.renderBoard(target, wrapped, highlight);
  }

  /* ==================== simulation step ==================== */

  _step(dt) {
    this.simTime += dt;

    this.world.update(dt, this.simTime, this.player.pos, this.audio);
    this.player.update(dt, this.input);

    if (this.player.alive) {
      this.weapons.update(dt, this.input, this.player, this.zm);
    }

    const cleared = this.waves.update(dt, this.simTime);
    if (cleared) {
      this.stats.score += CONFIG.score.waveBase + CONFIG.score.wavePerWave * this.waves.wave;
      this.player.heal(15);
    }

    this.zm.update(dt, this.simTime, (dmg) => this._onPlayerHit(dmg));
    this.pickups.update(dt);
    this.particles.update(dt, this.camera.position);
    this.audio.tick(dt, this.player.hp, CONFIG.player.maxHealth);

    // boost bar
    if (this.weapons.boostActive) {
      const left = (this.weapons.boostUntil - performance.now()) / 1000;
      this.ui.setBoost(left / CONFIG.pickups.boostDuration);
    } else {
      this.ui.setBoost(null);
    }

    // death sequence
    if (this.state === 'dying') {
      this.fxDeath = Math.min(1, this.fxDeath + dt * 0.75);
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this._playerDeath();
    }

    // HUD (10 Hz is enough for numbers)
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.ui.setHealth(this.player.hp);
      this.ui.setScore(this.stats.score);
      this.ui.setWave(this.waves.wave, this.waves.remaining);
    }
  }

  /* ==================== frame ==================== */

  _frame(now) {
    requestAnimationFrame((t) => this._frame(t));
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1;

    if (this.state === 'playing' || this.state === 'dying') {
      this._acc += dt;
      let steps = 0;
      while (this._acc >= STEP && steps < 5) {
        this._step(STEP);
        this._acc -= STEP;
        steps++;
      }
      if (steps === 5) this._acc = 0;
    } else {
      this._acc = 0;
      // keep embers flickering behind the menu
      if (this.state === 'menu' || this.state === 'over') {
        this.simTime += dt;
        this.world.update(dt, this.simTime, this.player.pos, null);
        this.particles.update(dt, this.camera.position);
      }
    }

    // cinematic uniforms
    if (this.cinePass) {
      const u = this.cinePass.uniforms;
      u.uTime.value = now / 1000;
      u.uDamage.value = this.fxDamage;
      u.uDeath.value = this.fxDeath;
    }
    this.fxDamage = Math.max(0, this.fxDamage - dt * 1.5);

    // render - the composer chain IS the look (bloom + tonemap + FXAA + film pass)
    this.composer.render();

    this.ui.tick(dt);

    // fps counter
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      if (this.fpsOn) this.ui.setFps(`${Math.round(this.fpsFrames / this.fpsTime)} FPS`);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }
}

/* ============ boot ============ */
try {
  const game = new Game();
  window.__game = game;   // exposed for debugging / automated tests
} catch (e) {
  console.error('Fatal boot error:', e);
  const err = document.getElementById('webgl-error');
  if (err) {
    err.classList.remove('hidden');
    const hint = err.querySelector('.hint');
    if (hint) hint.textContent = 'Something failed while starting the game: ' + e.message;
  }
}
