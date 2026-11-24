/* ============================================================
   DEAD HOURS - wave manager
   Composition, per-wave scaling, spawn scheduling and the
   intermission countdown between waves.
   ============================================================ */

import { CONFIG } from './config.js';

const WAVE_SUBS = [
  'THEY SMELL YOU',
  'NO ONE IS COMING',
  'SAVE YOUR AMMO',
  'AIM FOR THE HEAD',
  'THEY ARE GETTING FASTER',
  'HOLD THIS GROUND',
  'DAWN IS NOT CLOSE',
  'THE HORDE GROWS',
];

export class WaveManager {
  constructor(zombieManager, ui, audio) {
    this.zm = zombieManager;
    this.ui = ui;
    this.audio = audio;

    this.state = 'idle';   // idle | intermission | active
    this.wave = 0;
    this.queue = 0;
    this.spawnTimer = 0;
    this.timer = 0;        // intermission countdown
    this.subIdx = 0;
  }

  start() {
    this.wave = 0;
    this.queue = 0;
    this.subIdx = 0;
    this.state = 'intermission';
    this.timer = CONFIG.waves.firstDelay;
    this.ui.setIntermission(CONFIG.waves.firstDelay);
  }

  get remaining() {
    return this.queue.walker + this.queue.runner + this.queue.tank + this.zm.aliveCount;
  }

  _nextWave() {
    const W = CONFIG.waves;
    this.wave++;
    this.state = 'active';

    const count = Math.min(W.maxCount, W.baseCount + W.perWave * (this.wave - 1));
    // type composition
    const runners = this.wave >= W.runnerFromWave
      ? Math.round(count * Math.min(W.runnerRatio, 0.1 + this.wave * 0.03))
      : 0;
    const tanks = this.wave >= W.tankFromWave
      ? Math.min(4, Math.floor((this.wave - W.tankFromWave) / 3) + 1)
      : 0;
    const walkers = Math.max(0, count - runners - tanks);
    this.queue = { walker: walkers, runner: runners, tank: tanks };
    this.hpMult = Math.min(W.hpMaxMult, 1 + W.hpGrowth * (this.wave - 1));
    this.speedMult = Math.min(W.speedMaxMult, 1 + W.speedGrowth * (this.wave - 1));

    this.spawnTimer = 0.4;

    const sub = WAVE_SUBS[this.subIdx % WAVE_SUBS.length];
    this.subIdx++;
    const subExtra = tanks > 0 ? ` - ${tanks} BRUTE${tanks > 1 ? 'S' : ''} INBOUND` : '';
    this.ui.banner(`WAVE ${this.wave}`, sub + subExtra);
    this.ui.setWave(this.wave, this.remaining);
    this.audio.waveHorn();
  }

  _pickType() {
    const q = this.queue;
    // prefer spawning tanks a bit later in the wave
    const total = q.walker + q.runner + q.tank;
    if (total <= 0) return null;
    const r = Math.random() * total;
    if (r < q.tank && q.tank > 0 && total < 8) return 'tank';
    if (r < q.tank + q.runner && q.runner > 0) return 'runner';
    if (q.walker > 0) return 'walker';
    if (q.runner > 0) return 'runner';
    if (q.tank > 0) return 'tank';
    return null;
  }

  update(dt, time) {
    const W = CONFIG.waves;

    if (this.state === 'intermission') {
      this.timer -= dt;
      this.ui.setIntermission(Math.max(0, this.timer));
      if (this.timer <= 0) {
        this.ui.setIntermission(null);
        this._nextWave();
      }
      return false;
    }

    if (this.state === 'active') {
      // spawn scheduling
      if (this.queue.walker + this.queue.runner + this.queue.tank > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && this.zm.aliveCount < W.maxAliveCap) {
          const type = this._pickType();
          if (type) {
            this.queue[type]--;
            this.zm.spawn(type, this.hpMult, this.speedMult);
            this.ui.setWave(this.wave, this.remaining);
          }
          this.spawnTimer = W.spawnInterval[0] + Math.random() *
            (W.spawnInterval[1] - W.spawnInterval[0]);
        }
      } else if (this.zm.aliveCount === 0) {
        // wave cleared
        this.state = 'intermission';
        this.timer = W.intermission;
        this.ui.setIntermission(W.intermission);
        this.ui.banner('WAVE CLEARED', `BONUS +${CONFIG.score.waveBase + CONFIG.score.wavePerWave * this.wave}`);
        this.audio.waveClear();
        return true;   // signals wave-clear to main (for bonus score)
      }
    }
    return false;
  }

  reset() {
    this.state = 'idle';
    this.wave = 0;
    this.queue = { walker: 0, runner: 0, tank: 0 };
    this.timer = 0;
    this.ui.setIntermission(null);
  }
}
