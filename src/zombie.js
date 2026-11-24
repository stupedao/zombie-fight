/* ============================================================
   DEAD HOURS - zombies
   Procedurally assembled bodies (boxes + skin/cloth PBR mats
   with per-instance variation), procedural walk / attack /
   death animation, steering AI with separation + obstacle
   push-out, three types (walker / runner / tank), pooled.
   ============================================================ */

import * as THREE from 'three';
import { CONFIG } from './config.js';

const _v = new THREE.Vector3();

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
    this.pools = { walker: [], runner: [], tank: [] };
    this.hitMeshes = [];

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
    this.pantsMats = this.clothMats;

    this.onKill = null;   // (zombie, headshot) => {}  set by main
  }

  /* ==================== model assembly ==================== */

  _buildModel(type) {
    const t = CONFIG.zombies.types[type];
    const g = new THREE.Group();

    const skinMat = this.skinMats[(Math.random() * this.skinMats.length) | 0];
    const shirtMat = this.clothMats[(Math.random() * this.clothMats.length) | 0];
    const pantsMat = this.pantsMats[(Math.random() * this.pantsMats.length) | 0];

    const hVar = 0.9 + Math.random() * 0.22;

    // torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.26), shirtMat);
    torso.position.y = 1.12;
    torso.castShadow = true;
    torso.userData = { part: 'torso' };
    g.add(torso);

    // pelvis
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.24), pantsMat);
    pelvis.position.y = 0.72;
    pelvis.castShadow = true;
    pelvis.userData = { part: 'torso' };
    g.add(pelvis);

    // head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.26), skinMat);
    head.position.y = 1.58;
    head.castShadow = true;
    head.userData = { part: 'head' };
    g.add(head);
    // jaw - hanging open
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.2), skinMat);
    jaw.position.set(0, -0.16, 0.035);
    jaw.rotation.x = 0.5;
    jaw.userData = { part: 'head' };
    head.add(jaw);
    // glowing eyes
    const eyeGeo = new THREE.SphereGeometry(0.026, 6, 6);
    const eyeMat = type === 'tank' ? this.eyeMatRed : this.eyeMat;
    for (const ex of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(ex, 0.045, 0.135);
      eye.userData = { part: 'head' };
      head.add(eye);
    }

    // hair patch / bald randomness
    if (Math.random() < 0.5) {
      const hair = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 0.27), this.clothMats[3]);
      hair.position.y = 0.14;
      hair.userData = { part: 'head' };
      head.add(hair);
    }

    // arms (pivot at shoulder)
    const armGeo = new THREE.BoxGeometry(0.11, 0.62, 0.12);
    armGeo.translate(0, -0.31, 0);
    const arms = [];
    for (const ax of [-0.28, 0.28]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(ax, 1.38, 0);
      const arm = new THREE.Mesh(armGeo, skinMat);
      arm.castShadow = true;
      arm.userData = { part: 'limb' };
      shoulder.add(arm);
      // hand
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.13), skinMat);
      hand.position.y = -0.66;
      hand.castShadow = true;
      hand.userData = { part: 'limb' };
      shoulder.add(hand);
      g.add(shoulder);
      arms.push(shoulder);
    }

    // legs (pivot at hip)
    const legGeo = new THREE.BoxGeometry(0.14, 0.7, 0.15);
    legGeo.translate(0, -0.35, 0);
    const legs = [];
    for (const lx of [-0.11, 0.11]) {
      const hip = new THREE.Group();
      hip.position.set(lx, 0.66, 0);
      const leg = new THREE.Mesh(legGeo, pantsMat);
      leg.castShadow = true;
      leg.userData = { part: 'limb' };
      hip.add(leg);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.24), this.clothMats[3]);
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
      head, torso, pelvis, arms, legs, jaw,
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
    };

    // tag every mesh with its zombie for raycasts
    g.traverse((o) => {
      if (o.isMesh) o.userData.zombie = z;
    });

    return z;
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

    // reset limb pose
    for (const a of z.arms) { a.rotation.set(0, 0, 0); }
    for (const l of z.legs) { l.rotation.set(0, 0, 0); }
    z.head.rotation.set(0, 0, 0);

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
      } else if (dist > z.attackRange * 0.8) {
        // move toward the player
        let vx = dx / dist, vz = dz / dist;

        // separation from other zombies
        for (const o of this.zombies) {
          if (o === z || o.dying || o.rising > 0) continue;
          const ox = z.group.position.x - o.group.position.x;
          const oz = z.group.position.z - o.group.position.z;
          const od = Math.hypot(ox, oz);
          if (od < ZC.separationRadius && od > 0.001) {
            const push = (ZC.separationRadius - od) / ZC.separationRadius;
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
      const gait = z.type === 'runner' ? 2.6 : z.type === 'tank' ? 0.8 : 1;
      z.phase += dt * z.speed * 3.2 * gait * 0.55;
      const sw = Math.sin(z.phase);
      const sw2 = Math.cos(z.phase);

      z.legs[0].rotation.x = sw * 0.6;
      z.legs[1].rotation.x = -sw * 0.6;

      if (z.attackT >= 0) {
        // attack swipe
        const a = z.attackT / 0.55;
        const raise = Math.sin(Math.min(1, a * 1.8) * Math.PI) * -2.1;
        z.arms[0].rotation.x = raise;
        z.arms[1].rotation.x = raise * 0.85;
        z.arms[0].rotation.z = -0.3;
        z.arms[1].rotation.z = 0.3;
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

      // torso lurch + head bob
      z.torso.rotation.z = sw2 * 0.06 * gait;
      z.torso.rotation.x = 0.14 + Math.sin(z.phase * 2) * 0.03;
      z.head.rotation.z = -sw2 * 0.08;
      z.head.rotation.x = 0.1 + Math.sin(z.phase * 0.7 + 1) * 0.06;
      z.jaw.rotation.x = 0.5 + Math.sin(time * 3 + z.phase) * 0.15;

      // pelvis counter-sway
      z.pelvis.rotation.z = -sw2 * 0.04;

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
  }

  reset() {
    for (const z of this.zombies) {
      this.scene.remove(z.group);
      this.pools[z.type].push(z);
    }
    this.zombies.length = 0;
    this.hitMeshes.length = 0;
  }
}
