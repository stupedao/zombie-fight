/* ============================================================
   DEAD HOURS - weapons
   Three guns built from primitives (no model files), hip/ADS
   poses, sway + bob + recoil animation, hitscan raycasting with
   spread, tracers, muzzle flash light, ejected casings.
   ============================================================ */

import * as THREE from 'three';
import { CONFIG } from './config.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export class WeaponSystem {
  constructor(camera, scene, TEX, particles, decals, audio, ui, world) {
    this.camera = camera;
    this.scene = scene;
    this.TEX = TEX;
    this.particles = particles;
    this.decals = decals;
    this.audio = audio;
    this.ui = ui;
    this.world = world;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 180;

    this.weapons = CONFIG.weapons.map((def) => ({
      def,
      mag: def.mag,
      reserve: def.reserve,
      cooldown: 0,
      reloading: 0,
      fireHeld: false,
      semiLatch: false,
    }));
    this.index = 0;

    this.adsT = 0;
    this.wantAds = false;
    this.recoilAnim = 0;
    this.reloadAnim = 0;
    this.swayX = 0; this.swayY = 0;
    this.sprintTilt = 0;

    this.boostUntil = -1;

    // muzzle flash
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.flash, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0,
    }));
    this.flashSprite.scale.set(0.32, 0.32, 1);
    this.scene.add(this.flashSprite);
    this.flashLight = new THREE.PointLight(0xffc27a, 0, 14, 2);
    this.scene.add(this.flashLight);
    this.flashTime = 0;

    this._buildViewModels();
    this._buildTracers();
    this._buildCasings();

    // callbacks set by main
    this.onShot = null;      // (weaponDef) => {}
    this.onHit = null;       // (result) => {}
    this.player = null;      // set on first update()
  }

  /* ==================== view models ==================== */

  _mats() {
    const T = this.TEX;
    const dark = new THREE.MeshStandardMaterial({
      map: T.metal.map, normalMap: T.metal.normal, roughnessMap: T.metal.rough,
      roughness: 1, metalness: 0.85, envMapIntensity: 1.1, color: 0xb8bcc2,
    });
    const black = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.55, metalness: 0.6, envMapIntensity: 0.9 });
    const wood = new THREE.MeshStandardMaterial({
      map: T.wood.map, normalMap: T.wood.normal, roughness: 0.8, envMapIntensity: 0.4,
    });
    return { dark, black, wood };
  }

  _buildViewModels() {
    const M = this._mats();
    this.models = [];

    // ---- pistol ----
    {
      const g = new THREE.Group();
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.052, 0.2), M.black);
      slide.position.set(0, 0.02, -0.1);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.035, 0.16), M.dark);
      frame.position.set(0, -0.018, -0.08);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.11, 0.055), M.black);
      grip.position.set(0, -0.075, 0.005);
      grip.rotation.x = 0.28;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 8), M.dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.215);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.014, 0.01), M.dark);
      sight.position.set(0, 0.055, -0.185);
      g.add(slide, frame, grip, barrel, sight);
      g.userData.muzzle = new THREE.Object3D();
      g.userData.muzzle.position.set(0, 0.02, -0.24);
      g.add(g.userData.muzzle);
      this.models.push(g);
    }

    // ---- rifle ----
    {
      const g = new THREE.Group();
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.062, 0.26), M.dark);
      receiver.position.set(0, 0.01, -0.1);
      const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.05, 0.22), M.wood);
      handguard.position.set(0, 0.005, -0.32);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), M.black);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.018, -0.5);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.07), M.black);
      mag.position.set(0, -0.09, -0.13);
      mag.rotation.x = 0.42;
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.075, 0.2), M.wood);
      stock.position.set(0, -0.015, 0.12);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.09, 0.05), M.black);
      grip.position.set(0, -0.07, 0.015);
      grip.rotation.x = 0.25;
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.012), M.black);
      sight.position.set(0, 0.055, -0.18);
      g.add(receiver, handguard, barrel, mag, stock, grip, sight);
      g.userData.muzzle = new THREE.Object3D();
      g.userData.muzzle.position.set(0, 0.018, -0.66);
      g.add(g.userData.muzzle);
      this.models.push(g);
    }

    // ---- shotgun ----
    {
      const g = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 10), M.dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.03, -0.32);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.42, 8), M.black);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, -0.012, -0.3);
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.14), M.dark);
      receiver.position.set(0, 0.02, -0.06);
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.12), M.wood);
      pump.position.set(0, -0.012, -0.28);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.085, 0.22), M.wood);
      stock.position.set(0, -0.02, 0.14);
      stock.rotation.x = 0.12;
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6), M.black);
      bead.position.set(0, 0.05, -0.55);
      g.add(barrel, tube, receiver, pump, stock, bead);
      g.userData.muzzle = new THREE.Object3D();
      g.userData.muzzle.position.set(0, 0.03, -0.58);
      g.add(g.userData.muzzle);
      this.models.push(g);
    }

    this.holder = new THREE.Group();
    this.camera.add(this.holder);
    for (const g of this.models) {
      g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 20; } });
      g.visible = false;
      this.holder.add(g);
    }
    this.models[0].visible = true;
  }

  /* ==================== tracers & casings ==================== */

  _buildTracers() {
    const geo = new THREE.BoxGeometry(0.012, 0.012, 1);
    this.tracers = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      this.scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
  }

  _spawnTracer(from, to) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    const m = t.mesh;
    const dist = from.distanceTo(to);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to);
    m.scale.set(1, 1, Math.max(0.5, dist * 0.9));
    m.visible = true;
    m.material.opacity = 0.85;
    t.life = 0.055;
  }

  _buildCasings() {
    const geo = new THREE.BoxGeometry(0.014, 0.014, 0.032);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8a24a, roughness: 0.35, metalness: 0.9, envMapIntensity: 1 });
    this.casings = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.scene.add(m);
      this.casings.push({ mesh: m, life: 0, vel: new THREE.Vector3(), rot: new THREE.Vector3() });
    }
  }

  _ejectCasing(muzzleWorld) {
    const c = this.casings.find((x) => x.life <= 0) || this.casings[0];
    c.mesh.position.copy(muzzleWorld).add(_v1.set(0.06, -0.02, 0.08));
    c.vel.set(1.6 + Math.random(), 2.2 + Math.random() * 1.4, (Math.random() - 0.5) * 0.8);
    // to world space orientation
    c.vel.applyQuaternion(this.camera.quaternion);
    c.rot.set(Math.random() * 14, Math.random() * 14, Math.random() * 14);
    c.life = 1.1;
    c.mesh.visible = true;
    this.audio.casing();
  }

  /* ==================== firing ==================== */

  get current() { return this.weapons[this.index]; }

  switchTo(i) {
    if (i === this.index || i < 0 || i >= this.weapons.length) return;
    if (this.current.reloading > 0) return;
    this.index = i;
    for (let k = 0; k < this.models.length; k++) this.models[k].visible = (k === i);
    this.recoilAnim = 0.6;   // raise animation
    this.audio.click();
    this._hud();
  }

  reload() {
    const w = this.current;
    if (w.reloading > 0 || w.mag >= w.def.mag || w.reserve <= 0) return;
    w.reloading = w.def.reloadTime;
    this.reloadAnim = 1;
    this.audio.reload();
    this.ui.setReloading(true);
  }

  addAmmo(mags) {
    for (const w of this.weapons) {
      if (w.reserve !== Infinity) w.reserve = Math.min(w.def.reserve * 3, w.reserve + w.def.mag * mags);
    }
    this._hud();
  }

  setBoost(ms) { this.boostUntil = performance.now() + ms; }

  get boostActive() { return performance.now() < this.boostUntil; }

  _spreadDir(out) {
    const w = this.current;
    this.camera.getWorldDirection(out);
    const spread = w.def.spread * (1 - 0.7 * this.adsT);
    out.x += (Math.random() - 0.5) * spread * 2;
    out.y += (Math.random() - 0.5) * spread * 2;
    out.z += (Math.random() - 0.5) * spread * 2;
    return out.normalize();
  }

  _fire(zombieManager) {
    const w = this.current;
    const player = this.player;
    w.mag--;
    w.cooldown = 60 / w.def.rpm;
    this.audio.gunshot(w.def.id);
    if (this.onShot) this.onShot(w.def);

    const muzzle = this.models[this.index].userData.muzzle.getWorldPosition(_v1.clone());
    const camPos = this.camera.getWorldPosition(_v2.clone());

    // muzzle flash
    this.flashSprite.position.copy(muzzle);
    this.flashSprite.material.rotation = Math.random() * Math.PI * 2;
    this.flashSprite.material.opacity = 1;
    this.flashSprite.scale.set(0.24 + Math.random() * 0.14, 0.24 + Math.random() * 0.14, 1);
    this.flashLight.position.copy(muzzle);
    this.flashLight.intensity = 60;
    this.flashTime = 0.05;

    const dir = _v3.set(0, 0, 0);
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());

    let anyHitZombie = null;
    for (let p = 0; p < w.def.pellets; p++) {
      this._spreadDir(dir);
      this.raycaster.set(camPos, dir);
      const targets = [];
      if (zombieManager) targets.push(...zombieManager.hitMeshes);
      targets.push(...this.world.collidables);
      const hits = this.raycaster.intersectObjects(targets, false);

      if (hits.length > 0) {
        const h = hits[0];
        const ud = h.object.userData;
        if (ud && ud.zombie && !ud.zombie.dead) {
          const res = zombieManager.hit(ud.zombie, ud.part, h.point, dir, w.def.damage * (this.boostActive ? CONFIG.pickups.boostMultiplier : 1));
          if (res) {
            anyHitZombie = res;
            if (this.onHit) this.onHit(res);
          }
          this.particles.blood(h.point, dir, 10);
        } else {
          const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
          this.particles.sparks(h.point, n);
          this.particles.dust(h.point, 5);
          this.decals.bulletHole(h.point, n);
        }
        if (w.def.pellets === 1) this._spawnTracer(muzzle, h.point);
      } else {
        const far = camPos.clone().addScaledVector(dir, 120);
        if (w.def.pellets === 1) this._spawnTracer(muzzle, far);
      }
    }

    this.particles.muzzleSmoke(muzzle, camDir);
    this._ejectCasing(muzzle);

    // recoil kick (camera pitch/yaw via player)
    const pitch = w.def.recoilPitch * (Math.PI / 180) * (1 - 0.35 * this.adsT);
    if (player) player.addRecoil(pitch, w.def.recoilYaw * 0.004);
    this.recoilAnim = 1;
    this.ui.crosshairFire();

    this._hud();
    if (w.mag === 0 && (w.reserve > 0)) this.reload();
  }

  update(dt, input, player, zombieManager) {
    this.player = player;
    const w = this.current;
    w.cooldown = Math.max(0, w.cooldown - dt);
    this.flashTime = Math.max(0, this.flashTime - dt);
    if (this.flashTime <= 0) {
      this.flashLight.intensity = 0;
      this.flashSprite.material.opacity = 0;
    } else {
      this.flashSprite.material.opacity = Math.min(1, this.flashTime / 0.05);
    }

    // reload timer
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        const need = w.def.mag - w.mag;
        const take = w.reserve === Infinity ? need : Math.min(need, w.reserve);
        w.mag += take;
        if (w.reserve !== Infinity) w.reserve -= take;
        this.reloadAnim = 0;
        this.ui.setReloading(false);
        this._hud();
      }
    }

    // weapon switching
    if (input.keys.has('Digit1')) this.switchTo(0);
    if (input.keys.has('Digit2')) this.switchTo(1);
    if (input.keys.has('Digit3')) this.switchTo(2);

    // ADS
    this.wantAds = input.rmb && !player.sprinting && w.reloading <= 0;
    const adsSpeed = 8;
    this.adsT = THREE.MathUtils.clamp(this.adsT + (this.wantAds ? 1 : -1) * dt * adsSpeed, 0, 1);

    // fire
    const wantFire = input.lmb && w.reloading <= 0;
    if (wantFire && w.mag > 0 && w.cooldown <= 0) {
      if (w.def.auto || !w.semiLatch) {
        this._fire(zombieManager);
        w.semiLatch = true;
      }
    }
    if (!input.lmb) w.semiLatch = false;
    if (wantFire && w.mag <= 0 && w.cooldown <= 0) {
      this.audio.empty();
      w.cooldown = 0.25;
      if (w.reserve > 0) this.reload();
    }
    if (input.reloadQueued) {
      input.reloadQueued = false;
      this.reload();
    }

    // fov for ADS / sprint
    const baseFov = CONFIG.camera.fov;
    const sprintAdd = player.sprinting ? CONFIG.camera.sprintFovAdd : 0;
    const targetFov = baseFov + sprintAdd - this.adsT * (baseFov - CONFIG.camera.adsFov);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();

    this._animate(dt, player);
    this._updateTracers(dt);
    this._updateCasings(dt);
    this.ui.setCrosshairAds(this.adsT);
  }

  _animate(dt, player) {
    const w = this.current;
    const model = this.models[this.index];
    const def = w.def;

    // sway from mouse (input accumulates look velocity)
    this.swayX = THREE.MathUtils.lerp(this.swayX, -player._lookVelX * 0.0006, Math.min(1, dt * 8));
    this.swayY = THREE.MathUtils.lerp(this.swayY, player._lookVelY * 0.0006, Math.min(1, dt * 8));
    this.swayX = THREE.MathUtils.clamp(this.swayX, -0.03, 0.03);
    this.swayY = THREE.MathUtils.clamp(this.swayY, -0.03, 0.03);

    // walk bob
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const bobAmt = Math.min(1, speed / CONFIG.player.maxSpeed) * (1 - this.adsT * 0.8);
    const bx = Math.sin(player.bobPhase) * 0.012 * bobAmt;
    const by = Math.sin(player.bobPhase * 2) * 0.008 * bobAmt;

    // sprint tilt
    const sprintT = player.sprinting ? 1 : 0;
    this.sprintTilt = THREE.MathUtils.lerp(this.sprintTilt, sprintT, Math.min(1, dt * 6));

    // recoil / reload animation scalars
    this.recoilAnim = Math.max(0, this.recoilAnim - dt * 7);
    this.reloadAnim = w.reloading > 0 ? Math.min(1, this.reloadAnim + dt * 5) : Math.max(0, this.reloadAnim - dt * 5);
    const rA = this.recoilAnim, rL = this.reloadAnim;

    const hip = def.hipPos, ads = def.adsPos;
    const px = THREE.MathUtils.lerp(hip[0], ads[0], this.adsT);
    const py = THREE.MathUtils.lerp(hip[1], ads[1], this.adsT);
    const pz = THREE.MathUtils.lerp(hip[2], ads[2], this.adsT);

    this.holder.position.set(
      px + bx + this.swayX,
      py + by + this.swayY - rL * 0.16 - this.sprintTilt * 0.05,
      pz + rA * 0.05
    );
    this.holder.rotation.set(
      rA * 0.14 + this.swayY * 2.2 - rL * 0.5,
      -this.swayX * 2.4 + rL * 0.25,
      this.sprintTilt * 0.45 + Math.sin(player.bobPhase) * 0.008 * bobAmt
    );
  }

  _updateTracers(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.055) * 0.85;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  _updateCasings(dt) {
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.vel.y -= 14 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.rot.x * dt;
      c.mesh.rotation.y += c.rot.y * dt;
      if (c.mesh.position.y < 0.03) {
        c.mesh.position.y = 0.03;
        c.vel.set(0, 0, 0);
        c.rot.multiplyScalar(0.9);
      }
      if (c.life <= 0) c.mesh.visible = false;
    }
  }

  _hud() {
    const w = this.current;
    this.ui.setAmmo(w.def.name, w.mag, w.reserve);
  }

  reset() {
    for (const w of this.weapons) {
      w.mag = w.def.mag;
      w.reserve = w.def.reserve;
      w.cooldown = 0;
      w.reloading = 0;
      w.semiLatch = false;
    }
    this.index = 0;
    for (let k = 0; k < this.models.length; k++) this.models[k].visible = (k === 0);
    this.adsT = 0;
    this.recoilAnim = 0;
    this.reloadAnim = 0;
    this.boostUntil = -1;
    this.ui.setReloading(false);
    this._hud();
  }
}
