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
    this.queue = { walker: 0, runner: 0, tank: 0, spitter: 0, bloater: 0 };
    this.spawnTimer = 0;
    this.timer = 0;        // intermission countdown
    this.subIdx = 0;
    this.hpMult = 1;
    this.speedMult = 1;
  }

  start() {
    this.wave = 0;
    this.queue = { walker: 0, runner: 0, tank: 0, spitter: 0, bloater: 0 };
    this.subIdx = 0;
    this.state = 'intermission';
    this.timer = CONFIG.waves.firstDelay;
    this.ui.setIntermission(CONFIG.waves.firstDelay);
  }

  get remaining() {
    return this.queue.walker + this.queue.runner + this.queue.tank
      + this.queue.spitter + this.queue.bloater + this.zm.aliveCount;
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
    const spitters = this.wave >= W.spitterFromWave
      ? Math.round(count * Math.min(W.spitterRatio, 0.06 + this.wave * 0.015))
      : 0;
    const tanks = this.wave >= W.tankFromWave
      ? Math.min(4, Math.floor((this.wave - W.tankFromWave) / 3) + 1)
      : 0;
    const bloaters = this.wave >= W.bloaterFromWave
      ? Math.min(3, Math.floor((this.wave - W.bloaterFromWave) / 4) + 1)
      : 0;
    const walkers = Math.max(0, count - runners - spitters - tanks - bloaters);
    this.queue = { walker: walkers, runner: runners, tank: tanks, spitter: spitters, bloater: bloaters };
    this.hpMult = Math.min(W.hpMaxMult, 1 + W.hpGrowth * (this.wave - 1));
    this.speedMult = Math.min(W.speedMaxMult, 1 + W.speedGrowth * (this.wave - 1));

    this.spawnTimer = 0.4;

    const sub = WAVE_SUBS[this.subIdx % WAVE_SUBS.length];
    this.subIdx++;
    let subExtra = '';
    if (tanks > 0) subExtra = ` - ${tanks} BRUTE${tanks > 1 ? 'S' : ''} INBOUND`;
    else if (bloaters > 0) subExtra = ` - ${bloaters} BLOATER${bloaters > 1 ? 'S' : ''} DETECTED - DO NOT SHOOT THE BELLY`;
    else if (spitters > 0) subExtra = ` - ACID SPITTER${spitters > 1 ? 'S' : ''} DETECTED`;
    this.ui.banner(`WAVE ${this.wave}`, sub + subExtra);
    this.ui.setWave(this.wave, this.remaining);
    this.audio.waveHorn();
  }

  _pickType() {
    const q = this.queue;
    // prefer spawning tanks a bit later in the wave
    const total = q.walker + q.runner + q.tank + q.spitter + q.bloater;
    if (total <= 0) return null;
    const r = Math.random() * total;
    if (r < q.tank && q.tank > 0 && total < 8) return 'tank';
    if (r < q.tank + q.bloater && q.bloater > 0) return 'bloater';
    if (r < q.tank + q.bloater + q.spitter && q.spitter > 0) return 'spitter';
    if (r < q.tank + q.bloater + q.spitter + q.runner && q.runner > 0) return 'runner';
    if (q.walker > 0) return 'walker';
    if (q.runner > 0) return 'runner';
    if (q.spitter > 0) return 'spitter';
    if (q.bloater > 0) return 'bloater';
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
      if (this.queue.walker + this.queue.runner + this.queue.tank + this.queue.spitter + this.queue.bloater > 0) {
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
    this.queue = { walker: 0, runner: 0, tank: 0, spitter: 0, bloater: 0 };
    this.timer = 0;
    this.ui.setIntermission(null);
  }
}
