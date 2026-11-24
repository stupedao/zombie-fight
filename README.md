# DEAD HOURS - Zombie Wave Survival

A first-person, wave-based zombie survival shooter that runs entirely in the
browser. Built with **Three.js + Vite + vanilla JavaScript**. Every texture is
generated on a canvas, every sound is synthesized with the Web Audio API -
there are **zero external assets**. Static output deploys straight to
**Cloudflare Pages**, with an optional Worker/Pages-Function leaderboard API & gay.

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
| `R` | Reload |
| `1 / 2 / 3` | Pistol / Rifle / Shotgun |
| `Shift` | Sprint |
| `Space` | Jump |
| `Esc` / `P` | Pause |
| `F` | FPS counter |

Headshots deal x2 damage. Zombies drop health, ammo and a 10s damage boost.
Health regenerates after 5s without taking damage.

## Project structure

```
zombie-shooter/
├── index.html              # markup: HUD, menus, overlays
├── package.json
├── vite.config.js          # base './', three.js chunk split
├── wrangler.toml           # Pages config (+ optional KV binding for Functions)
├── public/
│   └── _headers            # long-cache /assets/*
├── src/
│   ├── main.js             # bootstrap, fixed-timestep loop, input, state machine
│   ├── config.js           # ALL gameplay tuning values (see below)
│   ├── world.js            # arena, lighting, canvas textures, AABB collision helpers
│   ├── player.js           # movement, camera, health, regen, death cam
│   ├── weapons.js          # weapon defs, procedural view models, hitscan, tracers
│   ├── zombie.js           # zombie model, AI steering, animation, pooling
│   ├── waves.js            # wave composition, scaling, intermission
│   ├── pickups.js          # health / ammo / damage-boost drops
│   ├── particles.js        # pooled GPU particle system (blood, sparks, smoke)
│   ├── audio.js            # Web Audio synthesized SFX (no audio files)
│   ├── ui.js               # HUD + menus + leaderboard rendering
│   └── leaderboard.js      # remote API client with localStorage fallback
├── functions/api/          # Cloudflare Pages Functions (leaderboard API)
│   ├── _core.js            # shared logic: validation, rate limit, KV storage
│   ├── leaderboard.js      # GET /api/leaderboard
│   └── score.js            # POST /api/score
└── worker/                 # OPTIONAL standalone Cloudflare Worker
    ├── wrangler.toml       # KV binding + optional custom-domain routes
    └── src/index.js        # same endpoints as the Pages Functions
```

## Deployment

### Option A - Cloudflare Pages via Git integration (recommended)

1. Push this folder to a GitHub/GitLab repository.
2. In the Cloudflare dashboard: **Workers & Pages -> Create -> Pages ->
   Connect to Git** and pick the repo.
3. Build settings:
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Deploy. Cloudflare detects the `functions/` directory automatically, so
   `/api/*` is served by the Pages Functions.

#### Enabling the leaderboard (KV)

1. Create the namespace:
   ```bash
   npx wrangler login
   npx wrangler kv namespace create LEADERBOARD
   ```
2. Paste the printed `id` into the `[[kv_namespaces]]` block in the root
   `wrangler.toml` and uncomment it. (For Git-integration builds you can also
   add the binding in the dashboard: Pages project -> Settings -> Bindings ->
   KV namespace -> binding name `LEADERBOARD`.)
3. Redeploy. Verify with `curl https://your-site.pages.dev/api/leaderboard`.

Without KV the site still deploys and plays fine - the game falls back to a
localStorage leaderboard automatically.

### Option B - Cloudflare Pages via CLI

```bash
npm install
npm run build
npx wrangler pages deploy dist
```

First run asks for a project name (creates it) and handles everything else.
The KV binding from `wrangler.toml` is applied to the deployment.

### Option C - Standalone Worker (optional)

Only needed if you want the API on its own URL/domain instead of Pages
Functions. Do **not** route both Workers and Pages Functions to `/api/*` -
pick one backend.

```bash
npx wrangler kv namespace create LEADERBOARD       # once
# paste the namespace id into worker/wrangler.toml
npx wrangler deploy -c worker/wrangler.toml
```

The API is then live at `https://dead-hours-api.<your-subdomain>.workers.dev`.
Point the frontend at it in either way:

1. **Build-time env var** (CORS is already `*`):
   ```bash
   VITE_API_BASE=https://dead-hours-api.<you>.workers.dev npm run build
   ```
2. **Custom domain route** (keeps the frontend same-origin): uncomment the
   `routes` block in `worker/wrangler.toml`, e.g.
   `pattern = "example.com/api/*", zone_name = "example.com"`. This requires
   the domain to live in your Cloudflare account.

Local Worker development: `npm run worker:dev` (simulates KV locally), then
`curl http://localhost:8787/api/leaderboard`.

### Routing summary

| Backend | Where /api/* lives | Extra setup |
| --- | --- | --- |
| Pages Functions | same Pages domain (auto-detected `functions/`) | KV binding only |
| Standalone Worker | workers.dev or custom route | KV binding + `VITE_API_BASE` or a route |

## API

| Method | Path | Body / Result |
| --- | --- | --- |
| GET | `/api/leaderboard` | `{ ok, entries: [{ name, score, wave }] }` (top 10) |
| POST | `/api/score` | `{ name, score, wave }` -> `{ ok, rank }` |

Validation: name is sanitized (control/HTML chars stripped, max 16 chars),
score/wave must be sane integers, impossible scores are rejected
(`score <= wave * 6000 + 2000`), and submissions are rate-limited to 5 per IP
per minute via KV counters.

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
- `runnerFromWave` / `tankFromWave` - when special types join. Type mix ratios
  are in `WaveManager._pickType()` (`src/waves.js`).

### Zombies (`CONFIG.zombies`)

- Per-type `hp`, `speed`, `damage`, `attackRange`, `attackCooldown`, `points`,
  `scale`. Walk animation speed follows `speed`; the death tip and groan
  cadence live in `src/zombie.js`.
- `headshotMultiplier` (2), `separationRadius` (anti-clumping push distance).

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

- `fogDensity` per quality tier, `shadowMapSize`, `pixelRatioCap`.
- Arena layout: the `BUILDING DEFS`, crate count and barrel/lamp positions are
  plain arrays in `src/world.js` - move them freely; colliders and spawn
  points adapt automatically.

## Performance notes

- Fixed-timestep simulation (60 Hz) decoupled from `requestAnimationFrame`
  rendering; frame deltas are clamped after tab switches.
- Zombies, particles and tracers are pooled - no allocations during play.
- One shared `THREE.Points` cloud for all particles; InstancedMesh rubble.
- Shadow casting limited to walls/buildings/crates/zombie bodies; quality
  presets toggle shadows, pixel ratio and fog (changeable live in menus).
- Pixel ratio capped (1 / 1.5 / 2), 60 FPS target on mid-range laptops.

## Troubleshooting

- **Black screen** - a WebGL2-capable browser is required; the game shows an
  explicit error panel if context creation fails.
- **Cursor stays visible / mouse look dead** - pointer lock was refused (e.g.
  too soon after Esc). Click the screen once; the hint is in the pause menu.
- **Leaderboard shows "LOCAL (OFFLINE)"** - the API is not deployed or the KV
  binding is missing; scores still save to localStorage.
