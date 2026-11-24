/* ============================================================
   DEAD HOURS - pickups
   Zombies drop medkits, ammo boxes and damage boosts.
   Floating / spinning models, blink before despawning.
   ============================================================ */

import * as THREE from 'three';
import { CONFIG } from './config.js';

export class Pickups {
  constructor(scene, TEX, particles, audio, ui, player, weapons) {
    this.scene = scene;
    this.TEX = TEX;
    this.particles = particles;
    this.audio = audio;
    this.ui = ui;
    this.player = player;
    this.weapons = weapons;
    this.items = [];

    this._buildAssets();
  }

  _buildAssets() {
    const glowMat = (color) => new THREE.SpriteMaterial({
      map: this.TEX.glow, color, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // medkit: white box with red cross (canvas-free - vertex colored boxes)
    this.kinds = {};
    {
      const g = new THREE.Group();
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.22, 0.24),
        new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.5, envMapIntensity: 0.7 })
      );
      box.castShadow = true;
      g.add(box);
      const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.052, 0.25), new THREE.MeshBasicMaterial({ color: 0xd42a1e }));
      const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.16, 0.25), new THREE.MeshBasicMaterial({ color: 0xd42a1e }));
      g.add(cross1, cross2);
      g.add(new THREE.Sprite(glowMat(0x58d68d)));
      this.kinds.health = g;
    }
    {
      const g = new THREE.Group();
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.2, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.6, metalness: 0.4, envMapIntensity: 0.6 })
      );
      box.castShadow = true;
      g.add(box);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.05, 0.21), new THREE.MeshBasicMaterial({ color: 0xffb454 }));
      g.add(stripe);
      g.add(new THREE.Sprite(glowMat(0xffb454)));
      this.kinds.ammo = g;
    }
    {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0xc22a20, roughness: 0.35, envMapIntensity: 0.9 })
      );
      body.castShadow = true;
      const needle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.014, 0.16, 6),
        new THREE.MeshStandardMaterial({ color: 0xdde4ec, roughness: 0.15, metalness: 0.7 })
      );
      needle.position.y = 0.22;
      g.add(body, needle);
      g.add(new THREE.Sprite(glowMat(0xff4a3d)));
      this.kinds.boost = g;
    }
  }

  tryDrop(pos, wave) {
    if (Math.random() > CONFIG.pickups.dropChance) return;
    const P = CONFIG.pickups;
    const r = Math.random();
    let kind;
    if (r < P.weights.health) kind = 'health';
    else if (r < P.weights.health + P.weights.ammo) kind = 'ammo';
    else kind = 'boost';

    const model = this.kinds[kind].clone();
    model.position.set(pos.x, 0.55, pos.z);
    this.scene.add(model);
    this.items.push({ model, kind, t: Math.random() * 10, life: P.lifetime });
  }

  update(dt) {
    const P = CONFIG.pickups;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.life -= dt;
      it.model.rotation.y = it.t * 1.6;
      it.model.position.y = 0.55 + Math.sin(it.t * 2.2) * 0.09;

      // blink in the last 5 seconds
      if (it.life < 5) {
        it.model.visible = Math.sin(it.t * 10) > -0.4;
      }
      if (it.life <= 0) {
        this.scene.remove(it.model);
        this.items.splice(i, 1);
        continue;
      }

      // pickup check
      const dx = it.model.position.x - this.player.pos.x;
      const dz = it.model.position.z - this.player.pos.z;
      if (dx * dx + dz * dz < 1.7 && this.player.alive) {
        this._apply(it.kind);
        this.scene.remove(it.model);
        this.items.splice(i, 1);
      }
    }
  }

  _apply(kind) {
    const P = CONFIG.pickups;
    if (kind === 'health') {
      this.player.heal(P.heal);
      this.audio.pickupHealth();
      this.ui.toast(`+${P.heal} HEALTH`, 'good');
    } else if (kind === 'ammo') {
      this.weapons.addAmmo(P.ammoMags);
      this.audio.pickupAmmo();
      this.ui.toast(`+${P.ammoMags} MAGS`, 'ammo');
    } else {
      this.weapons.setBoost(P.boostDuration * 1000);
      this.audio.pickupBoost();
      this.ui.toast('DAMAGE x2', 'boost');
    }
    this.ui.setHealth(this.player.hp);
  }

  reset() {
    for (const it of this.items) this.scene.remove(it.model);
    this.items.length = 0;
  }
}
