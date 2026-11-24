/* ============================================================
   DEAD HOURS - zombies
   Procedurally assembled bodies (rounded PBR primitives with
   skin/cloth maps + per-instance variation), procedural walk /
   attack / death animation, steering AI with separation +
   obstacle push-out, five types (walker / runner / spitter /
   tank / bloater), pooled. Spitters lob toxic acid projectiles,
   bloaters swell with a glowing belly and detonate on death.
   ============================================================ */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CONFIG } from './config.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

let zombieIdCounter = 1;

export class ZombieManager {
  constructor(scene, world, TEX, particles, decals, audio, player) {
    this.scene = scene;
    this.world = world;
    this.TEX = TEX;
    this.particles = particles;
    this.decals = decals;
    this.audio = audio;
    this.player = player;

    this.zombies = [];
    this.pools = { walker: [], runner: [], spitter: [], tank: [], bloater: [] };
    this.hitMeshes = [];
    this._losTargets = null;
    this._losRay = new THREE.Raycaster();

    // shared materials (variants give per-zombie skin/cloth differences)
    this.skinMats = TEX.skin.map((s) => new THREE.MeshStandardMaterial({
      map: s.map, normalMap: s.normal, roughnessMap: s.rough,
      roughness: 1, metalness: 0.02, envMapIntensity: 0.25,
    }));
    this.clothMats = TEX.cloth.map((c) => new THREE.MeshStandardMaterial({
      map: c.map, roughnessMap: c.rough, roughness: 1, metalness: 0, envMapIntensity: 0.2,
    }));
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xffb638 });
    this.eyeMatRed = new THREE.MeshBasicMaterial({ color: 0xff3826 });
    this.eyeMatGreen = new THREE.MeshBasicMaterial({ color: 0x8dff3c });
    this.pantsMats = this.clothMats;

    this.onKill = null;   // (zombie, headshot) => {}  set by main
    this.onPlayerHit = null;  // set by main each update call

    this._buildSpitPool();
  }

  /* ==================== model assembly ==================== */

  _buildModel(type) {
    const t = CONFIG.zombies.types[type];
    const g = new THREE.Group();

    const sickly = type === 'spitter';
    const skinIdx = sickly ? 1 : (Math.random() * this.skinMats.length) | 0;
    const skinMat = this.skinMats[skinIdx];
    const shirtMat = this.clothMats[(Math.random() * this.clothMats.length) | 0];
    const pantsMat = this.pantsMats[(Math.random() * this.pantsMats.length) | 0];

    const hVar = 0.9 + Math.random() * 0.22;

    // body proportions per type
    const fat = type === 'bloater';
    const torsoW = 0.42 * (fat ? 1.55 : 1);
    const torsoH = 0.62 * (fat ? 1.12 : 1);
    const torsoD = 0.26 * (fat ? 1.45 : 1);

    // torso
    const torso = new THREE.Mesh(new RoundedBoxGeometry(torsoW, torsoH, torsoD, 2, 0.05), shirtMat);
    torso.position.y = 1.12;
    torso.castShadow = true;
    torso.userData = { part: 'torso' };
    g.add(torso);

    // pelvis
    const pelvis = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.22, 0.24, 1, 0.04), pantsMat);
    pelvis.position.y = 0.72;
    pelvis.castShadow = true;
    pelvis.userData = { part: 'torso' };
    g.add(pelvis);

    // neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.12, 6), skinMat);
    neck.position.y = 1.5;
    g.add(neck);

    // head
    const headW = fat ? 0.22 : 0.24;
    const head = new THREE.Mesh(new RoundedBoxGeometry(headW, 0.28, 0.26, 2, 0.05), skinMat);
    head.position.y = 1.58;
    head.castShadow = true;
    head.userData = { part: 'head' };
    g.add(head);
    // jaw - hanging open (spitters unhinge wide)
    const jawW = sickly ? 0.2 : 0.18;
    const jaw = new THREE.Mesh(new RoundedBoxGeometry(jawW, 0.08, 0.2, 1, 0.02), skinMat);
    jaw.position.set(0, -0.16, 0.035);
    jaw.rotation.x = sickly ? 0.72 : 0.5;
    jaw.userData = { part: 'head' };
    head.add(jaw);
    // glowing eyes (green for spitters, red for tanks, yellow-green for bloaters)
    const eyeMat = type === 'tank' ? this.eyeMatRed
      : (sickly || fat) ? this.eyeMatGreen : this.eyeMat;
    const eyeGeo = new THREE.SphereGeometry(0.026, 6, 6);
    for (const ex of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(ex, 0.045, 0.135);
      eye.userData = { part: 'head' };
      head.add(eye);
    }

    // hair patch / bald randomness
    if (Math.random() < 0.5 && !fat) {
      const hair = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.06, 0.27, 1, 0.02), this.clothMats[3]);
      hair.position.y = 0.14;
      hair.userData = { part: 'head' };
      head.add(hair);
    }

    // bloater: swollen glowing belly + boils
    let bellyMat = null;
    if (fat) {
      bellyMat = new THREE.MeshStandardMaterial({
        color: 0x2e4415, emissive: 0x66d41e, emissiveIntensity: 1.2,
        roughness: 0.55, metalness: 0.05,
      });
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), bellyMat);
      belly.position.set(0, 0.98, 0.16);
      belly.scale.set(1.15, 1.0, 0.82);
      belly.userData = { part: 'torso' };
      belly.castShadow = true;
      torso.add(belly);
      // boils on shoulders
      for (const [bx, by, bz] of [[-0.16, 0.24, -0.08], [0.17, 0.2, -0.05], [0.02, 0.3, -0.12]]) {
        const boil = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.03, 6, 5), bellyMat);
        boil.position.set(bx, by, bz);
        boil.userData = { part: 'torso' };
        torso.add(boil);
      }
    }

    // arms (pivot at shoulder)
    const armGeo = new RoundedBoxGeometry(0.11, 0.62, 0.12, 1, 0.03);
    armGeo.translate(0, -0.31, 0);
    const arms = [];
    for (const ax of [-0.28 * (fat ? 1.4 : 1), 0.28 * (fat ? 1.4 : 1)]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(ax, 1.38, 0);
      const arm = new THREE.Mesh(armGeo, skinMat);
      arm.castShadow = true;
      arm.userData = { part: 'limb' };
      shoulder.add(arm);
      // hand
      const hand = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.12, 0.13, 1, 0.03), skinMat);
      hand.position.y = -0.66;
      hand.castShadow = true;
      hand.userData = { part: 'limb' };
      shoulder.add(hand);
      g.add(shoulder);
      arms.push(shoulder);
    }

    // legs (pivot at hip)
    const legGeo = new RoundedBoxGeometry(0.14, 0.7, 0.15, 1, 0.04);
    legGeo.translate(0, -0.35, 0);
    const legs = [];
    for (const lx of [-0.11 * (fat ? 1.5 : 1), 0.11 * (fat ? 1.5 : 1)]) {
      const hip = new THREE.Group();
      hip.position.set(lx, 0.66, 0);
      const leg = new THREE.Mesh(legGeo, pantsMat);
      leg.castShadow = true;
      leg.userData = { part: 'limb' };
      hip.add(leg);
      const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.09, 0.24, 1, 0.03), this.clothMats[3]);
      shoe.position.set(0, -0.72, 0.04);
      shoe.castShadow = true;
      shoe.userData = { part: 'limb' };
      hip.add(shoe);
      g.add(hip);
      legs.push(hip);
    }

    // scale by type + variation
    const s = t.scale * hVar;
    g.scale.set(s, s, s);

    const z = {
      id: zombieIdCounter++,
      type,
      group: g,
      head, torso, pelvis, arms, legs, jaw, bellyMat,
      hp: t.hp, maxHp: t.hp,
      speed: t.speed[0] + Math.random() * (t.speed[1] - t.speed[0]),
      damage: t.damage,
      attackRange: t.attackRange,
      attackCooldown: t.attackCooldown,
      points: t.points,
      scale: s,
      dead: false,
      dying: false,
      deathT: 0,
      rising: 0,
      phase: Math.random() * Math.PI * 2,
      attackT: -1,
      nextAttack: 0,
      nextGroan: 2 + Math.random() * 6,
      flinch: 0,
      deathDir: Math.random() < 0.5 ? 1 : -1,
      // spitter state
      spitT: -1,
      spat: false,
      nextSpit: 1.5 + Math.random() * 2,
    };

    // tag every mesh with its zombie for raycasts
    g.traverse((o) => {
      if (o.isMesh) o.userData.zombie = z;
    });

    return z;
  }

  /* ==================== acid projectile pool ==================== */

  _buildSpitPool() {
    this.spits = [];
    const geo = new THREE.SphereGeometry(0.085, 10, 8);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x24360f, emissive: 0x7ee02c, emissiveIntensity: 2.2, roughness: 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.TEX.acidGlow, color: 0x9fff4a, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.set(0.55, 0.55, 1);
      mesh.add(glow);
      mesh.visible = false;
      this.scene.add(mesh);
      this.spits.push({ mesh, vel: new THREE.Vector3(), life: 0, active: false, trailT: 0 });
    }
  }

  _getSpit() {
    for (const s of this.spits) if (!s.active) return s;
    return null;
  }

  _launchSpit(z, target) {
    const t = CONFIG.zombies.types.spitter;
    const s = this._getSpit();
    if (!s) return;
    // launch from the mouth
    z.head.getWorldPosition(_v);
    _v.y -= 0.08;
    const from = _v;
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const dz = target.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    const speed = t.spitSpeed;
    const tt = Math.max(0.25, dist / speed);
    const arc = CONFIG.zombies.types.spitter.spitArc;
    // ballistic solve: land on target under gravity "arc"
    s.vel.set(dx / tt, dy / tt + 0.5 * arc * tt, dz / tt);
    s.mesh.position.copy(from);
    s.mesh.visible = true;
    s.active = true;
    s.life = 3.5;
    s.trailT = 0;
    this.audio.spit(this._distToPlayer(z), this._panToPlayer(z));
    this.particles.acidSplash(from, 4);
  }

  _updateSpits(dt, onPlayerHit) {
    const t = CONFIG.zombies.types.spitter;
    const p = this.player;
    for (const s of this.spits) {
      if (!s.active) continue;
      s.life -= dt;
      s.vel.y -= t.spitArc * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += dt * 9;
      s.mesh.rotation.z += dt * 7;

      // green vapor trail
      s.trailT -= dt;
      if (s.trailT <= 0) {
        s.trailT = 0.05;
        this.particles.acidTrail(s.mesh.position);
      }

      // hit the player?
      const dx = s.mesh.position.x - p.pos.x;
      const dz = s.mesh.position.z - p.pos.z;
      const dy = s.mesh.position.y - (p.pos.y - 0.5);
      if (p.alive && dx * dx + dz * dz < 0.42 && Math.abs(dy) < 1.1) {
        this._spitSplash(s.mesh.position);
        s.active = false;
        s.mesh.visible = false;
        if (onPlayerHit) onPlayerHit(t.spitDamage);
        continue;
      }
      // hit the ground or timed out
      if (s.mesh.position.y < 0.06 || s.life <= 0) {
        s.mesh.position.y = Math.max(0.05, s.mesh.position.y);
        this._spitSplash(s.mesh.position);
        s.active = false;
        s.mesh.visible = false;
      }
    }
  }

  _spitSplash(pos) {
    this.particles.acidSplash(pos, 12);
    const p = this.player;
    const d = Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z);
    this.audio.sizzle(Math.max(0.15, 1 - d / 18), (pos.x - p.pos.x) * 0.03);
  }

  /** line-of-sight from a zombie head to the player eye (walls block acid) */
  _hasLOS(z) {
    if (!this._losTargets) {
      this._losTargets = this.world.collidables.filter((o) => o !== this.world.ground);
    }
    z.head.getWorldPosition(_v);
    _v2.copy(this.player.pos);
    const dir = _v2.clone().sub(_v);
    const dist = dir.length();
    dir.normalize();
    this._losRay.set(_v, dir);
    this._losRay.far = dist - 0.6;
    const hits = this._losRay.intersectObjects(this._losTargets, false);
    return hits.length === 0;
  }

  /* ==================== spawning ==================== */

  spawn(type, hpMult = 1, speedMult = 1) {
    const t = CONFIG.zombies.types[type];
    let z = this.pools[type].pop();
    if (!z) z = this._buildModel(type);

    const sp = this.world.pickSpawn(this.player.pos);
    z.group.position.set(sp.x, -1.75, sp.z);
    z.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
    z.group.visible = true;

    z.hp = t.hp * hpMult;
    z.maxHp = z.hp;
    z.speed = (t.speed[0] + Math.random() * (t.speed[1] - t.speed[0])) * speedMult;
    z.dead = false;
    z.dying = false;
    z.deathT = 0;
    z.rising = 0.85;
    z.attackT = -1;
    z.flinch = 0;
    z.nextGroan = 1 + Math.random() * 5;
    z.spitT = -1;
    z.spat = false;
    z.nextSpit = 1.5 + Math.random() * 2;

    // reset limb pose
    for (const a of z.arms) { a.rotation.set(0, 0, 0); }
    for (const l of z.legs) { l.rotation.set(0, 0, 0); }
    z.head.rotation.set(0, 0, 0);
    z.torso.rotation.set(type === 'spitter' ? 0.3 : 0, 0, 0);

    this.scene.add(z.group);
    this.zombies.push(z);
    this._refreshHitMeshes();

    // dirt burst as it claws out of the ground
    this.particles.dust(new THREE.Vector3(sp.x, 0.3, sp.z), 14);
    return z;
  }

  _refreshHitMeshes() {
    this.hitMeshes.length = 0;
    for (const z of this.zombies) {
      if (z.dead || z.dying) continue;
      z.group.traverse((o) => {
        if (o.isMesh && o.userData.part) this.hitMeshes.push(o);
      });
    }
  }

  get aliveCount() {
    let n = 0;
    for (const z of this.zombies) if (!z.dead && !z.dying) n++;
    return n;
  }

  /* ==================== damage ==================== */

  hit(z, part, point, dir, damage) {
    if (z.dead || z.dying) return null;
    const Z = CONFIG.zombies;
    let mult = 1;
    if (part === 'head') mult = Z.headshotMultiplier;
    else if (part === 'limb') mult = Z.limbMultiplier;
    const dmg = damage * mult;
    z.hp -= dmg;
    z.flinch = Math.min(0.25, z.flinch + 0.12);

    const headshot = part === 'head';
    if (headshot) this.audio.headshot();
    else this.audio.hitFlesh();

    if (z.hp <= 0) {
      this._kill(z, headshot, dir);
      return { died: true, headshot, zombie: z, points: z.points };
    }
    return { died: false, headshot, zombie: z, points: 0 };
  }

  _kill(z, headshot, dir) {
    z.dying = true;
    z.deathT = 0;
    z.spitT = -1;
    this._refreshHitMeshes();
    // blood pool under the corpse
    this.decals.bloodPool(z.group.position.x, z.group.position.z, z.scale);
    this.particles.blood(
      _v.set(z.group.position.x, 1.2 * z.scale, z.group.position.z),
      dir || _v.set(0, 1, 0), 16
    );
    this.audio.zombieDeath(this._distToPlayer(z), this._panToPlayer(z));
    if (this.onKill) this.onKill(z, headshot);
  }

  /* ==================== audio helpers ==================== */

  _distToPlayer(z) {
    return Math.hypot(z.group.position.x - this.player.pos.x, z.group.position.z - this.player.pos.z);
  }

  _panToPlayer(z) {
    // angle between camera forward and zombie dir -> stereo pan
    const dx = z.group.position.x - this.player.pos.x;
    const dz = z.group.position.z - this.player.pos.z;
    const f = this.player.forward(_v);
    const right = new THREE.Vector3(f.z, 0, -f.x); // perpendicular, camera-right on XZ
    const d = new THREE.Vector3(dx, 0, dz).normalize();
    return d.dot(right);
  }

  /* ==================== per-frame ==================== */

  update(dt, time, onPlayerHit) {
    const ZC = CONFIG.zombies;
    const p = this.player;

    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];

      // ---- spawn rise ----
      if (z.rising > 0) {
        z.rising -= dt;
        const t = 1 - Math.max(0, z.rising) / 0.85;
        z.group.position.y = -1.75 * (1 - t);
        // clawing upward pose
        z.arms[0].rotation.x = -1.2 - Math.sin(time * 18) * 0.3;
        z.arms[1].rotation.x = -1.5 - Math.cos(time * 16) * 0.3;
        continue;
      }

      // ---- dying ----
      if (z.dying) {
        z.deathT += dt;
        const fall = Math.min(1, z.deathT / 0.5);
        z.group.rotation.x = z.deathDir * fall * (Math.PI / 2) * 0.96;
        z.group.position.y = -0.12 * fall;
        // limp limbs during the fall
        z.arms[0].rotation.x = -0.3 + fall * 0.9;
        z.arms[1].rotation.x = -0.5 + fall * 0.5;
        z.legs[0].rotation.x = fall * 0.35;
        z.legs[1].rotation.x = -fall * 0.2;
        if (z.deathT > 1.9) {
          // sink & despawn
          const sink = Math.min(1, (z.deathT - 1.9) / 1.3);
          z.group.position.y = -0.12 - sink * 1.9;
          if (sink >= 1) {
            this.scene.remove(z.group);
            this.zombies.splice(i, 1);
            z.group.rotation.set(0, 0, 0);
            this.pools[z.type].push(z);
          }
        }
        continue;
      }

      // ---- steering ----
      const dx = p.pos.x - z.group.position.x;
      const dz = p.pos.z - z.group.position.z;
      const dist = Math.hypot(dx, dz);

      // face the player
      const targetYaw = Math.atan2(dx, dz);
      let dyaw = targetYaw - z.group.rotation.y;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      z.group.rotation.y += dyaw * Math.min(1, dt * 4);

      // ---- spitter ranged attack ----
      if (z.type === 'spitter' && z.spitT >= 0) {
        z.spitT += dt;
        // rear back then snap forward and launch
        const a = z.spitT / 0.55;
        z.head.rotation.x = a < 0.4 ? -0.55 * (a / 0.4) : 0.35 * ((a - 0.4) / 0.6);
        z.torso.rotation.x = 0.3 + (a < 0.4 ? -0.12 * (a / 0.4) : 0.1 * ((a - 0.4) / 0.6));
        if (!z.spat && z.spitT > 0.22) {
          z.spat = true;
          _v2.set(p.pos.x, p.pos.y - 0.55, p.pos.z);
          this._launchSpit(z, _v2);
        }
        if (z.spitT > 0.55) {
          z.spitT = -1;
          z.nextSpit = time + CONFIG.zombies.types.spitter.spitCooldown * (0.85 + Math.random() * 0.3);
        }
      } else if (
        z.type === 'spitter' &&
        dist > CONFIG.zombies.types.spitter.spitMinRange &&
        dist < CONFIG.zombies.types.spitter.spitMaxRange &&
        time > z.nextSpit &&
        p.alive && this._hasLOS(z)
      ) {
        z.spitT = 0;
        z.spat = false;
      }

      // attack state machine
      if (z.attackT >= 0) {
        z.attackT += dt;
        // strike lands mid-animation
        if (!z.struck && z.attackT > 0.28) {
          z.struck = true;
          if (dist < z.attackRange + 0.55 && p.alive) {
            onPlayerHit(z.damage);
          }
        }
        if (z.attackT > 0.55) {
          z.attackT = -1;
          z.nextAttack = time + z.attackCooldown * (0.85 + Math.random() * 0.3);
        }
      } else if (dist < z.attackRange && time > z.nextAttack && p.alive) {
        z.attackT = 0;
        z.struck = false;
        this.audio.snarl(this._distToPlayer(z), this._panToPlayer(z));
      } else if (dist > z.attackRange * 0.8 && z.spitT < 0) {
        // move toward the player
        let vx = dx / dist, vz = dz / dist;

        // separation from other zombies
        const sep = ZC.separationRadius * Math.max(1, z.scale * 0.9);
        for (const o of this.zombies) {
          if (o === z || o.dying || o.rising > 0) continue;
          const ox = z.group.position.x - o.group.position.x;
          const oz = z.group.position.z - o.group.position.z;
          const od = Math.hypot(ox, oz);
          if (od < sep && od > 0.001) {
            const push = (sep - od) / sep;
            vx += (ox / od) * push * 1.6;
            vz += (oz / od) * push * 1.6;
          }
        }

        const vl = Math.hypot(vx, vz) || 1;
        const spd = z.speed * (z.flinch > 0 ? 0.45 : 1);
        z.group.position.x += (vx / vl) * spd * dt;
        z.group.position.z += (vz / vl) * spd * dt;

        // push out of obstacles
        _v.set(z.group.position.x, 0, z.group.position.z);
        this.world.collide(_v, 0.34);
        z.group.position.x = _v.x;
        z.group.position.z = _v.z;
      }

      // ---- animation ----
      const gait = z.type === 'runner' ? 2.6 : z.type === 'tank' ? 0.8 : z.type === 'bloater' ? 0.9 : 1;
      z.phase += dt * z.speed * 3.2 * gait * 0.55;
      const sw = Math.sin(z.phase);
      const sw2 = Math.cos(z.phase);

      z.legs[0].rotation.x = sw * (0.6 * (z.type === 'bloater' ? 0.55 : 1));
      z.legs[1].rotation.x = -sw * (0.6 * (z.type === 'bloater' ? 0.55 : 1));

      if (z.attackT >= 0) {
        // attack swipe
        const a = z.attackT / 0.55;
        const raise = Math.sin(Math.min(1, a * 1.8) * Math.PI) * -2.1;
        z.arms[0].rotation.x = raise;
        z.arms[1].rotation.x = raise * 0.85;
        z.arms[0].rotation.z = -0.3;
        z.arms[1].rotation.z = 0.3;
      } else if (z.spitT >= 0) {
        // spitting: claws up to the throat
        z.arms[0].rotation.x = -1.9;
        z.arms[1].rotation.x = -1.9;
        z.arms[0].rotation.z = -0.4;
        z.arms[1].rotation.z = 0.4;
      } else if (z.type === 'runner') {
        // pumping arms
        z.arms[0].rotation.x = -sw * 1.1 - 0.3;
        z.arms[1].rotation.x = sw * 1.1 - 0.3;
        z.arms[0].rotation.z = 0;
        z.arms[1].rotation.z = 0;
      } else {
        // classic reaching arms with sway
        z.arms[0].rotation.x = -1.35 + sw2 * 0.12;
        z.arms[1].rotation.x = -1.42 - sw2 * 0.12;
        z.arms[0].rotation.z = -0.14 - sw2 * 0.06;
        z.arms[1].rotation.z = 0.14 + sw2 * 0.06;
      }

      // torso lurch + head bob (bloater waddles wide, spitter hunches)
      const waddle = z.type === 'bloater' ? 2.6 : 1;
      z.torso.rotation.z = sw2 * 0.06 * gait * waddle;
      const hunch = z.type === 'spitter' ? 0.3 : z.type === 'bloater' ? 0.18 : 0;
      z.torso.rotation.x = hunch + 0.14 + Math.sin(z.phase * 2) * 0.03;
      z.head.rotation.z = -sw2 * 0.08;
      z.head.rotation.x = (z.spitT >= 0 ? z.head.rotation.x : 0.1 + Math.sin(z.phase * 0.7 + 1) * 0.06);
      z.jaw.rotation.x = (z.type === 'spitter' ? 0.72 : 0.5) + Math.sin(time * 3 + z.phase) * 0.15;

      // pelvis counter-sway
      z.pelvis.rotation.z = -sw2 * 0.04;

      // bloater belly pulse
      if (z.bellyMat) {
        z.bellyMat.emissiveIntensity = 1.1 + Math.sin(time * 3.4 + z.phase) * 0.55 + (z.hp / z.maxHp < 0.35 ? Math.sin(time * 14) * 0.45 : 0);
      }

      // flinch decay
      z.flinch = Math.max(0, z.flinch - dt * 1.8);

      // ---- groans ----
      z.nextGroan -= dt;
      if (z.nextGroan <= 0) {
        z.nextGroan = 3 + Math.random() * 7;
        const d = this._distToPlayer(z);
        if (d < 48) this.audio.groan(d, this._panToPlayer(z));
      }
    }

    // acid projectiles fly even while zombies die
    this._updateSpits(dt, onPlayerHit);
  }

  reset() {
    for (const z of this.zombies) {
      this.scene.remove(z.group);
      this.pools[z.type].push(z);
    }
    this.zombies.length = 0;
    this.hitMeshes.length = 0;
    for (const s of this.spits) {
      s.active = false;
      s.mesh.visible = false;
    }
  }
}
