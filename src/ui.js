/* ============================================================
   DEAD HOURS - UI
   Binds the HUD / menus / overlays in index.html and exposes
   small update methods. No rendering of its own - just DOM.
   ============================================================ */

import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      canvas: $('game-canvas'),
      hud: $('hud'),
      vignette: $('vignette'),
      damageFlash: $('damage-flash'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      waveNum: $('wave-num'),
      zombiesLeft: $('zombies-left'),
      scoreNum: $('score-num'),
      hpNum: $('hp-num'),
      hpFill: $('hp-fill'),
      weaponName: $('weapon-name'),
      ammoMag: $('ammo-mag'),
      ammoReserve: $('ammo-reserve'),
      reloadHint: $('reload-hint'),
      boostTimer: $('boost-timer'),
      boostFill: $('boost-fill'),
      interTimer: $('inter-timer'),
      banner: $('banner'),
      bannerMain: $('banner-main'),
      bannerSub: $('banner-sub'),
      toasts: $('toasts'),
      fps: $('fps'),

      menu: $('menu'),
      controlsPanel: $('controls-panel'),
      pause: $('pause'),
      gameover: $('gameover'),

      btnPlay: $('btn-play'),
      btnControls: $('btn-controls'),
      btnControlsBack: $('btn-controls-back'),
      btnResume: $('btn-resume'),
      btnRestart: $('btn-restart'),
      btnQuit: $('btn-quit'),
      btnAgain: $('btn-again'),
      btnMenu: $('btn-menu'),
      btnSubmit: $('btn-submit'),
      nameInput: $('name-input'),
      saveStatus: $('save-status'),

      goScore: $('go-score'),
      goWave: $('go-wave'),
      goKills: $('go-kills'),
      goHeadshots: $('go-headshots'),
      goAccuracy: $('go-accuracy'),
      goBoard: $('go-board'),
      menuBoard: $('menu-board'),

      mobileNotice: $('mobile-notice'),
      mobileNoticeClose: $('mobile-notice-close'),
      webglError: $('webgl-error'),
    };

    this.damageOpacity = 0;
    this._hmTimer = null;
    this.quality = 'high';

    // callbacks set by main
    this.onPlay = null;
    this.onRestart = null;
    this.onResume = null;
    this.onQuit = null;
    this.onAgain = null;
    this.onMenu = null;
    this.onQuality = null;
    this.onVolume = null;
    this.onSubmit = null;

    this._bind();
  }

  _bind() {
    const E = this.el;
    E.btnPlay.addEventListener('click', () => this.onPlay && this.onPlay());
    E.btnControls.addEventListener('click', () => {
      E.menu.classList.add('hidden');
      E.controlsPanel.classList.remove('hidden');
    });
    E.btnControlsBack.addEventListener('click', () => {
      E.controlsPanel.classList.add('hidden');
      E.menu.classList.remove('hidden');
    });
    E.btnResume.addEventListener('click', () => this.onResume && this.onResume());
    E.btnRestart.addEventListener('click', () => this.onRestart && this.onRestart());
    E.btnQuit.addEventListener('click', () => this.onQuit && this.onQuit());
    E.btnAgain.addEventListener('click', () => this.onAgain && this.onAgain());
    E.btnMenu.addEventListener('click', () => this.onMenu && this.onMenu());
    E.btnSubmit.addEventListener('click', () => {
      const name = E.nameInput.value.trim();
      if (name && this.onSubmit) this.onSubmit(name);
    });
    E.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const name = E.nameInput.value.trim();
        if (name && this.onSubmit) this.onSubmit(name);
      }
    });
    E.mobileNoticeClose.addEventListener('click', () => E.mobileNotice.classList.add('hidden'));

    // quality segments (menu + pause)
    document.querySelectorAll('.seg-btn[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.quality = btn.dataset.quality;
        document.querySelectorAll('.seg-btn[data-quality]').forEach((b) => {
          b.classList.toggle('active', b.dataset.quality === this.quality);
        });
        if (this.onQuality) this.onQuality(this.quality);
      });
    });

    // volume sliders (menu + pause)
    document.querySelectorAll('.volume-slider').forEach((slider) => {
      slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10) / 100;
        document.querySelectorAll('.volume-slider').forEach((s) => { s.value = slider.value; });
        if (this.onVolume) this.onVolume(v);
      });
    });
  }

  /** set the quality segment buttons (menu + pause) without firing callbacks */
  setQuality(q) {
    this.quality = q;
    document.querySelectorAll('.seg-btn[data-quality]').forEach((b) => {
      b.classList.toggle('active', b.dataset.quality === q);
    });
  }

  /* ---------------- HUD ---------------- */

  showHud(on) { this.el.hud.classList.toggle('hidden', !on); }

  setWave(n, remaining) {
    this.el.waveNum.textContent = n;
    this.el.zombiesLeft.textContent = remaining > 0 ? `${remaining} REMAIN` : '';
  }

  setScore(s) { this.el.scoreNum.textContent = s.toLocaleString(); }

  setHealth(hp) {
    const max = CONFIG.player.maxHealth;
    const frac = Math.max(0, hp / max);
    this.el.hpNum.textContent = Math.ceil(hp);
    this.el.hpFill.style.width = `${frac * 100}%`;
    this.el.hpFill.style.background = frac > 0.5 ? 'var(--green)'
      : frac > 0.25 ? 'var(--amber)' : 'var(--blood)';
    this.el.vignette.classList.toggle('critical', frac <= 0.3);
  }

  setAmmo(name, mag, reserve) {
    this.el.weaponName.textContent = name;
    this.el.ammoMag.textContent = mag;
    this.el.ammoReserve.textContent = reserve === Infinity
      ? ' / \u221E' : ` / ${reserve}`;
  }

  setReloading(on) { this.el.reloadHint.classList.toggle('hidden', !on); }

  setIntermission(seconds) {
    if (seconds === null || seconds === undefined) {
      this.el.interTimer.classList.add('hidden');
      return;
    }
    this.el.interTimer.classList.remove('hidden');
    this.el.interTimer.textContent =
      `NEXT WAVE IN ${Math.ceil(seconds)}...`;
  }

  setBoost(frac) {
    if (frac === null) {
      this.el.boostTimer.classList.add('hidden');
      return;
    }
    this.el.boostTimer.classList.remove('hidden');
    this.el.boostFill.style.width = `${Math.max(0, frac) * 100}%`;
  }

  banner(main, sub) {
    this.el.bannerMain.textContent = main;
    this.el.bannerSub.textContent = sub || '';
    this.el.banner.classList.remove('show');
    // retrigger animation
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
  }

  toast(msg, type = '') {
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = msg;
    this.el.toasts.appendChild(div);
    setTimeout(() => div.remove(), 2000);
  }

  hitmarker(head) {
    const hm = this.el.hitmarker;
    hm.classList.toggle('head', !!head);
    hm.classList.remove('show');
    void hm.offsetWidth;
    hm.classList.add('show');
  }

  crosshairFire() {
    const c = this.el.crosshair;
    c.classList.add('fire');
    clearTimeout(this._chTimer);
    this._chTimer = setTimeout(() => c.classList.remove('fire'), 80);
  }

  setCrosshairAds(adsT) {
    this.el.crosshair.style.opacity = String(1 - adsT * 0.75);
  }

  flashDamage(opacity = 0.6) {
    this.damageOpacity = Math.max(this.damageOpacity, opacity);
  }

  tick(dt) {
    if (this.damageOpacity > 0) {
      this.damageOpacity = Math.max(0, this.damageOpacity - dt * 1.8);
      this.el.damageFlash.style.opacity = String(this.damageOpacity);
    }
  }

  setFps(text) {
    this.el.fps.textContent = text;
  }

  showFps(on) { this.el.fps.classList.toggle('hidden', !on); }

  /* ---------------- screens ---------------- */

  showMenu(on) { this.el.menu.classList.toggle('hidden', !on); }
  showPause(on) { this.el.pause.classList.toggle('hidden', !on); }

  showGameOver(stats) {
    this.el.goScore.textContent = stats.score.toLocaleString();
    this.el.goWave.textContent = stats.wave;
    this.el.goKills.textContent = stats.kills;
    this.el.goHeadshots.textContent = stats.headshots;
    this.el.goAccuracy.textContent = `${stats.accuracy}%`;
    this.el.saveStatus.textContent = '';
    this.el.btnSubmit.disabled = false;
    this.el.gameover.classList.remove('hidden');
  }

  hideGameOver() { this.el.gameover.classList.add('hidden'); }

  setSaveStatus(text, done) {
    this.el.saveStatus.textContent = text;
    if (done) this.el.btnSubmit.disabled = true;
  }

  showWebglError() { this.el.webglError.classList.remove('hidden'); }

  showMobileNotice() { this.el.mobileNotice.classList.remove('hidden'); }

  /* ---------------- leaderboard rendering ---------------- */

  renderBoard(el, entries, highlightName) {
    if (!entries || entries.length === 0) {
      el.innerHTML = '<div class="board-title">LEADERBOARD - LOCAL (OFFLINE)</div><div class="empty">No survivors yet. Be the first.</div>';
      return;
    }
    const offline = entries.offline ? ' - LOCAL (OFFLINE)' : '';
    let html = `<div class="board-title">LEADERBOARD${offline}</div><ol>`;
    entries.forEach((e, i) => {
      const me = (highlightName && e.name === highlightName) ? ' me' : '';
      html += `<li class="${me}"><span class="rk">${i + 1}</span><span class="nm">${escapeHtml(e.name)}</span><span class="wv">W${e.wave}</span><span class="sc">${e.score.toLocaleString()}</span></li>`;
    });
    html += '</ol>';
    el.innerHTML = html;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
