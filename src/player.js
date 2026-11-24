/* ============================================================
   DEAD HOURS - player
   Pointer-lock FPS movement with acceleration/friction, sprint,
   jump, AABB collision, head bob, landing dip, damage shake,
   health regen and a death cam.
   ============================================================ */

import * as THREE from 'three';
import { CONFIG } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(camera, world, audio, ui) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.ui = ui;

    this.pos = new THREE.Vector3(0, CONFIG.arena.eyeHeight, 20);
    this.vel = new THREE.Vector3();
    this.yaw = 0;              // facing -z => toward arena center from +z
    this.pitch = 0;

    this.onGround = true;
    this.sprinting = false;
    this.bobPhase = 0;
    this.stepAccum = 0;
    this.hp = CONFIG.player.maxHealth;
    this.regenTimer = 0;

    this.shake = 0;
    this.landDip = 0;
    this.fovKick = 0;

    this.dying = false;
    this.deathT = 0;
    this.roll = 0;

    // look velocity for weapon sway (decays each frame)
    this._lookVelX = 0;
    this._lookVelY = 0;

    this.camera.rotation.order = 'YXZ';
  }

  reset() {
    this.pos.set(0, CONFIG.arena.eyeHeight, 20);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.hp = CONFIG.player.maxHealth;
    this.regenTimer = 0;
    this.onGround = true;
    this.dying = false;
    this.deathT = 0;
    this.roll = 0;
    this.shake = 0;
    this.landDip = 0;
    this.updateCamera(0);
  }

  look(dx, dy) {
    if (this.dying) return;
    this._lookVelX = dx;
    this._lookVelY = dy;
    this.yaw -= dx * CONFIG.camera.mouseSens;
    this.pitch -= dy * CONFIG.camera.mouseSens;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  addRecoil(pitch, yaw) {
    this.pitch = Math.min(Math.PI / 2 - 0.01, this.pitch + pitch);
    this.yaw += yaw * (Math.random() - 0.5);
  }

  jump() {
    if (this.onGround && !this.dying) {
      this.vel.y = CONFIG.player.jumpSpeed;
      this.onGround = false;
      this.audio.jump();
    }
  }

  update(dt, input) {
    if (this.dying) { this._updateDying(dt); return; }

    const P = CONFIG.player;

    // --- movement input in local space ---
    const fwd = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
    const strafe = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
    this.sprinting = input.keys.has('ShiftLeft') && fwd > 0 && !input.rmb;

    const maxSpeed = P.maxSpeed * (this.sprinting ? P.sprintMult : 1);
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // forward vector (yaw=0 faces -z)
    const fx = -sinY, fz = -cosY;
    const rx = cosY, rz = -sinY;

    let wishX = fx * fwd + rx * strafe;
    let wishZ = fz * fwd + rz * strafe;
    const wl = Math.hypot(wishX, wishZ);
    if (wl > 0) { wishX /= wl; wishZ /= wl; }

    const accel = this.onGround ? P.accel : P.airAccel;
    this.vel.x += wishX * accel * dt;
    this.vel.z += wishZ * accel * dt;

    // friction on ground
    if (this.onGround) {
      const f = Math.max(0, 1 - P.friction * dt);
      // only apply friction when not actively pushing at max speed
      if (wl === 0) { this.vel.x *= f; this.vel.z *= f; }
      else {
        // soft cap toward max speed
        const sp = Math.hypot(this.vel.x, this.vel.z);
        if (sp > maxSpeed) {
          const k = Math.max(maxSpeed, sp - P.accel * dt * 1.5) / sp;
          this.vel.x *= k; this.vel.z *= k;
        }
      }
    }

    // gravity
    this.vel.y -= P.gravity * dt;

    // integrate + collide
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    const wasAir = !this.onGround;
    if (this.pos.y <= CONFIG.arena.eyeHeight) {
      this.pos.y = CONFIG.arena.eyeHeight;
      if (wasAir && this.vel.y < -6) {
        this.landDip = Math.min(0.22, -this.vel.y * 0.016);
        this.audio.land();
      }
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    this.world.collide(this.pos, CONFIG.arena.playerRadius);

    // --- head bob & footsteps ---
    const groundSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && groundSpeed > 0.5) {
      this.bobPhase += dt * P.bobFreq * (groundSpeed / P.maxSpeed);
      this.stepAccum += groundSpeed * dt;
      const stride = this.sprinting ? P.stepDist * 1.25 : P.stepDist;
      if (this.stepAccum > stride) {
        this.stepAccum = 0;
        this.audio.footstep(this.sprinting);
      }
    } else {
      this.stepAccum = 0;
    }

    // --- health regen ---
    this.regenTimer += dt;
    if (this.regenTimer > P.regenDelay && this.hp < P.maxHealth) {
      this.hp = Math.min(P.maxHealth, this.hp + P.regenRate * dt);
    }

    // decay camera effects
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.landDip = Math.max(0, this.landDip - dt * 0.9);
    this._lookVelX = THREE.MathUtils.lerp(this._lookVelX, 0, Math.min(1, dt * 12));
    this._lookVelY = THREE.MathUtils.lerp(this._lookVelY, 0, Math.min(1, dt * 12));

    this.updateCamera(dt, groundSpeed);
  }

  updateCamera(dt, groundSpeed = 0) {
    const P = CONFIG.player;
    const bobY = this.onGround ? Math.sin(this.bobPhase * 2) * P.bobAmp * Math.min(1, groundSpeed / P.maxSpeed) : 0;
    const bobX = this.onGround ? Math.sin(this.bobPhase) * P.bobAmp * 0.7 * Math.min(1, groundSpeed / P.maxSpeed) : 0;

    const shakeAmp = this.shake * 0.05;
    const sx = (Math.random() - 0.5) * shakeAmp;
    const sy = (Math.random() - 0.5) * shakeAmp;

    this.camera.position.set(
      this.pos.x + bobX * Math.cos(this.yaw) + sx,
      this.pos.y - this.landDip + bobY + sy,
      this.pos.z - bobX * Math.sin(this.yaw)
    );
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  _updateDying(dt) {
    this.deathT += dt;
    const t = Math.min(1, this.deathT / 1.15);
    // camera falls to the ground and rolls
    const ease = t * t;
    this.camera.position.set(this.pos.x, this.pos.y - (CONFIG.arena.eyeHeight - 0.35) * ease, this.pos.z);
    this.roll = ease * 0.62;
    this.pitch = THREE.MathUtils.lerp(this.pitch, -0.25, dt * 2);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  damage(amount) {
    if (this.dying) return false;
    this.hp -= amount;
    this.regenTimer = 0;
    this.shake = Math.min(1.6, this.shake + 0.5 + amount * 0.014);
    this.audio.hurt();
    this.ui.flashDamage(Math.min(0.85, 0.35 + amount * 0.012));
    if (this.hp <= 0) {
      this.hp = 0;
      this.dying = true;
      this.deathT = 0;
      return true;   // died
    }
    return false;
  }

  heal(amount) {
    this.hp = Math.min(CONFIG.player.maxHealth, this.hp + amount);
    this.regenTimer = -2;
  }

  get alive() { return !this.dying; }

  /** direction the player is facing (for zombie audio pan etc.) */
  forward(out = new THREE.Vector3()) {
    return out.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
  }
}
