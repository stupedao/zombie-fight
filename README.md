# DEAD HOURS - Zombie Wave Survival

A first-person, wave-based zombie survival shooter that runs entirely in the
browser. Built with **Three.js + Vite + vanilla JavaScript**. Every texture is
generated on a canvas, every sound is synthesized with the Web Audio API -
there are **zero external assets**. The site is **fully static** (no server,
no database - the leaderboard lives in each player's localStorage) and deploys
straight to **Cloudflare Pages** or any static host.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Build for production:

```bash
npm run build      # outputs static site to dist/
npm run preview    # serve the production build locally
```

The whole bundle is well under 1 MB gzipped (three.js ~170 KB gz + ~40 KB app).

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Look (pointer lock) |
| Left click | Shoot (hold for automatic) |
| Right click | Aim down sights |
| `R` | Reload |
| `1` - `5` / wheel | Pistol / Rifle / SMG / Shotgun / LMG |
| `L` | Toggle weapon flashlight |
| `Shift` | Sprint |
| `Space` | Jump |
| `Esc` / `P` | Pause |
| `F` | FPS counter |

Headshots deal x2 damage **and pop heads clean off** - the head flies with
ballistic physics while the stump sprays. Limb kills can tear arms loose,
bloaters burst into meat chunks, hits physically shove zombies back and badly
wounded ones leak blood. Zombies also drop health, ammo and a 10s damage
boost. Health regenerates after 5s without taking damage.

## Project structure

```
zombie-fight/
├── index.html              # markup: HUD, menus, overlays
├── package.json
├── vite.config.js          # base './', three.js chunk split
├── wrangler.toml           # Cloudflare Pages config (static - no bindings)
├── public/
│   └── _headers            # long-cache /assets/*
└── src/
    ├── main.js             # bootstrap, cinematic post-processing chain, fixed-timestep loop, state machine
    ├── config.js           # ALL gameplay tuning values (see below)
    ├── textures.js         # procedural canvas texture painters (every surface in the game)
    ├── world.js            # arena, lighting, weather (rain, lightning, mist, puddles), collision helpers
    ├── player.js           # movement, camera, health, regen, death cam
    ├── weapons.js          # weapon defs, procedural view models, hitscan, tracers, weapon flashlight
    ├── zombie.js           # zombie models, AI steering, animation, gore (dismemberment, gibs)
    ├── waves.js            # wave composition, scaling, intermission
    ├── pickups.js          # health / ammo / damage-boost drops
    ├── particles.js        # pooled GPU particle system + decal system
    ├── audio.js            # Web Audio synthesized SFX (no audio files)
    ├── ui.js               # HUD + menus + leaderboard rendering
    └── leaderboard.js      # localStorage leaderboard (offline by design)
```

## Deployment

The game is 100% static - any static host works.

### Cloudflare Pages via Git integration (recommended)

1. Push this repository to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages -> Create -> Pages ->
   Connect to Git** and pick the repo.
3. Build settings:
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Deploy.

### Cloudflare Pages via CLI

```bash
npm install
npm run build
npx wrangler pages deploy dist
```

First run asks for a project name (creates it) and handles everything else.
No bindings are needed - `wrangler.toml` only sets the output directory.

### Any other static host

Build with `npm run build` and upload the contents of `dist/` (Netlify,
GitHub Pages, S3, nginx...). No server-side runtime is required - scores are
stored in the player's own browser.

## How to tweak

Everything gameplay-related lives in **`src/config.js`** - edit it and hot
reload does the rest. The useful knobs:

### Difficulty & waves (`CONFIG.waves`)

- `baseCount` / `perWaveCount` - zombies in wave 1 and the increase per wave
  (6 / 3 by default, hard cap `maxCount` 46).
- `hpGrowth` (+12% hp per wave) and `speedGrowth` (+3.5% speed per wave),
  capped by `hpMaxMult` / `speedMaxMult`.
- `intermission` - seconds between waves; `maxAliveCap` - the most zombies
  that may be alive at once (performance ceiling).
- `runnerFromWave` / `spitterFromWave` / `tankFromWave` / `bloaterFromWave` -
  when special types join. Type mix ratios are in `WaveManager._pickType()`
  (`src/waves.js`).

### Zombies (`CONFIG.zombies`)

- Per-type `hp`, `speed`, `damage`, `attackRange`, `attackCooldown`, `points`,
  `scale`. Walk animation speed follows `speed`; the death animation and groan
  cadence live in `src/zombie.js`.
- `headshotMultiplier` (2), `separationRadius` (anti-clumping push distance).

### Gore (`CONFIG.gore`)

- `headPopChance` (1) - headshot kills pop the head off as a physics gib.
- `armPopChance` (0.35) - chance a killing limb hit tears the arm off.
- `bloaterChunks` (6) - meat chunks flung by a bloater detonation.
- `woundedBleedBelow` (0.35) - hp fraction under which zombies leak blood.
- `knockback` (0.055) - meters a zombie is shoved per bullet hit.

### Weapons (`CONFIG.weapons`)

- `damage`, `rpm` (fire rate), `auto` (hold-to-fire), `pellets` (shotgun
  spread count), `mag`, `reserve` (use `Infinity` for infinite reserve),
  `reloadTime`, `spread`, `recoilPitch`. View models are built from boxes in
  `WeaponSystem._buildViewModels()` (`src/weapons.js`).

### Player & pickups

- `CONFIG.player` - move/sprint speed, jump, gravity, regen delay/rate.
- `CONFIG.pickups` - `dropChance` (0.18), type weights, heal amount, ammo
  mags granted, boost duration/multiplier.

### Score (`CONFIG.score`)

- Points for headshot hits/kills and the wave-clear bonus
  (`waveBase + wavePerWave * wave`).

### Atmosphere (`CONFIG.fx` + `src/world.js`)

- `fogDensity` per quality tier, `shadowMapSize`, `pixelRatioCap`, bloom/SSAO
  toggles, rain/lightning/mist/moon-ray flags.
- Arena layout: the building defs, crate count and barrel/lamp positions are
  plain arrays in `src/world.js` - move them freely; colliders and spawn
  points adapt automatically.

## Performance notes

- Fixed-timestep simulation (60 Hz) decoupled from `requestAnimationFrame`
  rendering; frame deltas are clamped after tab switches.
- Zombies, particles, tracers and gibs are pooled - no allocations during play.
- One shared `THREE.Points` cloud for all particles; InstancedMesh rubble.
- Shadow casting limited to walls/buildings/crates/zombie bodies; quality
  presets toggle shadows, pixel ratio and fog (changeable live in menus).
- Pixel ratio capped (1 / 1.25 / 2), 60 FPS target on mid-range laptops.

## Troubleshooting

- **Black screen** - a WebGL2-capable browser is required; the game shows an
  explicit error panel if context creation fails.
- **Cursor stays visible / mouse look dead** - pointer lock was refused (e.g.
  too soon after Esc). Click the screen once; the hint is in the pause menu.
- **Leaderboard says "LOCAL"** - that is by design: the game is fully static
  and scores are saved in your browser only.
