/* ============================================================
   DEAD HOURS - central tuning table
   Every gameplay-relevant number lives here. Hot reload picks
   changes up instantly (Vite HMR re-runs main.js).
   ============================================================ */

export const CONFIG = {
  arena: {
    size: 240,          // ground plane size (m)
    bounds: 106,        // playable half-extent (player clamp)
    eyeHeight: 1.7,
    playerRadius: 0.45,
    spawnMinR: 55,      // zombie spawn ring
    spawnMaxR: 92,
  },

  player: {
    maxHealth: 100,
    accel: 60,          // ground acceleration m/s^2
    airAccel: 12,
    friction: 11,
    maxSpeed: 5.2,
    sprintMult: 1.55,
    jumpSpeed: 7.4,
    gravity: 22,
    regenDelay: 5,      // seconds after damage before regen
    regenRate: 6,       // hp per second
    bobFreq: 8.6,       // walk cycle
    bobAmp: 0.028,
    stepDist: 2.3,      // meters per footstep
  },

  weapons: [
    {
      id: 'pistol', name: 'M9 SIDEARM',
      damage: 34, rpm: 330, auto: false, pellets: 1,
      mag: 12, reserve: Infinity,
      reloadTime: 1.15, spread: 0.012, recoilPitch: 1.1, recoilYaw: 0.28,
      hipPos: [0.26, -0.24, -0.5], adsPos: [0, -0.155, -0.34],
    },
    {
      id: 'rifle', name: 'AK RIFLE',
      damage: 27, rpm: 640, auto: true, pellets: 1,
      mag: 30, reserve: 150,
      reloadTime: 2.05, spread: 0.02, recoilPitch: 1.5, recoilYaw: 0.45,
      hipPos: [0.24, -0.26, -0.55], adsPos: [0, -0.145, -0.36],
    },
    {
      id: 'smg', name: 'VECTOR SMG',
      damage: 19, rpm: 900, auto: true, pellets: 1,
      mag: 33, reserve: 165,
      reloadTime: 1.7, spread: 0.03, recoilPitch: 0.9, recoilYaw: 0.3,
      hipPos: [0.24, -0.25, -0.52], adsPos: [0, -0.15, -0.35],
    },
    {
      id: 'shotgun', name: 'PUMP SHOTGUN',
      damage: 13, rpm: 78, auto: false, pellets: 9,
      mag: 6, reserve: 36,
      reloadTime: 2.6, spread: 0.052, recoilPitch: 3.4, recoilYaw: 0.5,
      hipPos: [0.25, -0.25, -0.55], adsPos: [0, -0.16, -0.38],
    },
  ],

  zombies: {
    headshotMultiplier: 2,
    limbMultiplier: 0.7,
    separationRadius: 1.15,
    types: {
      walker: { hp: 100, speed: [1.5, 2.3], damage: 9,  attackRange: 1.5, attackCooldown: 1.0, scale: 1,    points: 100 },
      runner: { hp: 60,  speed: [3.9, 4.7], damage: 7,  attackRange: 1.4, attackCooldown: 0.8, scale: 0.92, points: 160 },
      spitter: { hp: 130, speed: [1.8, 2.5], damage: 9, attackRange: 1.5, attackCooldown: 1.2, scale: 1.05, points: 250, spitCooldown: 2.4, spitSpeed: 13, spitDamage: 15 },
      tank:   { hp: 340, speed: [1.0, 1.3], damage: 22, attackRange: 1.9, attackCooldown: 1.4, scale: 1.35, points: 400 },
    },
  },

  waves: {
    baseCount: 6,
    perWave: 3,
    maxCount: 46,
    hpGrowth: 0.12,        // +12% hp per wave
    hpMaxMult: 3.2,
    speedGrowth: 0.035,    // +3.5% speed per wave
    speedMaxMult: 1.35,
    intermission: 8,       // seconds between waves
    maxAliveCap: 22,
    runnerFromWave: 3,
    tankFromWave: 5,
    spitterFromWave: 4,
    runnerRatio: 0.32,     // cap share of runners once introduced
    spitterRatio: 0.18,    // cap share of spitters once introduced
    spawnInterval: [0.9, 1.6],
    firstDelay: 3.5,
  },

  pickups: {
    dropChance: 0.18,
    weights: { health: 0.45, ammo: 0.4, boost: 0.15 },
    heal: 35,
    ammoMags: 2,
    boostDuration: 10,
    boostMultiplier: 2,
    lifetime: 25,
  },

  score: {
    bodyHit: 10,
    headHit: 25,
    killBonus: 60,
    headKillBonus: 120,
    waveBase: 200,
    wavePerWave: 150,
  },

  fx: {
    fogDensity:    { low: 0.042, medium: 0.032, high: 0.027 },
    shadowMapSize: { low: 0,     medium: 1024,  high: 2048 },
    pixelRatioCap: { low: 1,     medium: 1.25,  high: 2 },
    bloom:         { low: false, medium: true,  high: true },
    ssao:          { low: false, medium: true,  high: true },
    rainCount:     { low: 0,     medium: 900,   high: 1700 },
    grassCount:    { low: 0,     medium: 150,   high: 260 },
    rainSpeed: 21,
    lightningEvery: [7, 18],   // s, random range
  },

  camera: {
    fov: 75,
    adsFov: 55,
    sprintFovAdd: 6,
    mouseSens: 0.0021,
  },
};
