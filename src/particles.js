/* ============================================================
   DEAD HOURS - particles + decals
   v1.1: adds toxic acid splashes for the spitter zombies.
   ============================================================ */

import * as THREE from 'three';

const MAX_PARTICLES = 900;

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aLife;
  attribute float aFog;
  varying vec3 vColor;
  varying float vLife;
  varying float vFog;
  void main() {
    vColor = aColor;
    vLife = aLife;
    vFog = aFog;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (240.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vLife;
  varying float vFog;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    if (tex.a < 0.02) discard;
    float a = tex.a * vLife;
    vec3 col = mix(vColor, uFogColor, vFog);
    gl_FragColor = vec4(col, a);
  }
`;

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.count = MAX_PARTICLES;
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.size = new Float32Array(MAX_PARTICLES);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.grav = new Float32Array(MAX_PARTICLES);
    this.drag = new Float32Array(MAX_PARTICLES);
    this.grow = new Float32Array(MAX_PARTICLES);
    this.fog = new Float32Array(MAX_PARTICLES);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aFog', new THREE.BufferAttribute(this.fog, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 500);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uFogColor: { value: new THREE.Color(0x090f1a) },
        uFogDensity: { value: 0.03 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    this._maps = {};
    this._fogParams = { color: new THREE.Color(0x090f1a), density: 0.03 };
  }

  setMap(name, texture) {
    this._maps[name] = texture;
    if (name === 'smoke') {
      this.mat.uniforms.uMap.value = texture;
    }
  }

  setFog(color, density) {
    this._fogParams.color.set(color);
    this._fogParams.density = density;
    this.mat.uniforms.uFogColor.value.copy(this._fogParams.color);
    this.mat.uniforms.uFogDensity.value = density;
  }

  _emit(x, y, z, vx, vy, vz, r, g, b, size, life, grav, drag, grow) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size;
    this.life[i] = 1; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
    this.fog[i] = 0;
  }

  blood(point, dir, amount = 12) {
    for (let k = 0; k < amount; k++) {
      const sp = 1.5 + Math.random() * 4;
      this._emit(
        point.x, point.y, point.z,
        dir.x * sp * 0.4 + (Math.random() - 0.5) * 3,
        1.2 + Math.random() * 2.6,
        dir.z * sp * 0.4 + (Math.random() - 0.5) * 3,
        0.32 + Math.random() * 0.2, 0.03, 0.02,
        0.05 + Math.random() * 0.09,
        0.5 + Math.random() * 0.4,
        12, 2.5, 0
      );
    }
  }

  /* -------- NEW v1.1: toxic acid (spitter projectiles) -------- */

  acidSplash(point, amount = 12) {
    for (let k = 0; k < amount; k++) {
      const sp = 1 + Math.random() * 3.5;
      this._emit(
        point.x, point.y, point.z,
        (Math.random() - 0.5) * sp,
        0.8 + Math.random() * 2.2,
        (Math.random() - 0.5) * sp,
        0.35 + Math.random() * 0.35, 0.8 + Math.random() * 0.2, 0.12 + Math.random() * 0.1,
        0.045 + Math.random() * 0.08,
        0.5 + Math.random() * 0.4,
        10, 2.2, 0
      );
    }
  }

  acidTrail(point) {
    this._emit(
      point.x + (Math.random() - 0.5) * 0.06,
      point.y + (Math.random() - 0.5) * 0.06,
      point.z + (Math.random() - 0.5) * 0.06,
      (Math.random() - 0.5) * 0.3, 0.1 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3,
      0.5, 0.9, 0.2,
      0.04 + Math.random() * 0.05,
      0.35 + Math.random() * 0.25,
      0.5, 2.4, 0.6
    );
  }

  sparks(point, normal) {
    for (let k = 0; k < 10; k++) {
      const sp = 3 + Math.random() * 7;
      this._emit(
        point.x + normal.x * 0.02, point.y + normal.y * 0.02, point.z + normal.z * 0.02,
        normal.x * sp + (Math.random() - 0.5) * 5,
        normal.y * sp + Math.random() * 4,
        normal.z * sp + (Math.random() - 0.5) * 5,
        1.0, 0.75, 0.3,
        0.03 + Math.random() * 0.03,
        0.25 + Math.random() * 0.3,
        14, 1.5, 0
      );
    }
  }

  dust(point, amount = 8) {
    for (let k = 0; k < amount; k++) {
      this._emit(
        point.x + (Math.random() - 0.5) * 0.6, point.y + Math.random() * 0.4, point.z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 1.4, 0.5 + Math.random() * 1.4, (Math.random() - 0.5) * 1.4,
        0.24, 0.2, 0.16,
        0.12 + Math.random() * 0.16,
        0.7 + Math.random() * 0.6,
        1.2, 1.8, 0.8
      );
    }
  }

  smokePuff(point, amount = 5) {
    for (let k = 0; k < amount; k++) {
      this._emit(
        point.x + (Math.random() - 0.5) * 0.1, point.y + Math.random() * 0.1, point.z + (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.5,
        0.16, 0.16, 0.17,
        0.1 + Math.random() * 0.12,
        0.9 + Math.random() * 0.7,
        -0.4, 1.4, 1.6
      );
    }
  }

  muzzleSmoke(point, dir) {
    for (let k = 0; k < 3; k++) {
      this._emit(
        point.x, point.y, point.z,
        dir.x * (0.8 + Math.random()) + (Math.random() - 0.5) * 0.4,
        0.3 + Math.random() * 0.5,
        dir.z * (0.8 + Math.random()) + (Math.random() - 0.5) * 0.4,
        0.2, 0.2, 0.21,
        0.05 + Math.random() * 0.06,
        0.5 + Math.random() * 0.3,
        -0.3, 2, 1.2
      );
    }
  }

  flamePuff(x, y, z, spread = 0.14) {
    this._emit(
      x + (Math.random() - 0.5) * spread, y + Math.random() * 0.1, z + (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * 0.25, 1.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.25,
      1.0, 0.5 + Math.random() * 0.25, 0.12,
      0.09 + Math.random() * 0.08,
      0.45 + Math.random() * 0.3,
      -1.5, 0.8, 0.5
    );
  }

  update(dt, cameraPos) {
    const fogD = this._fogParams.density;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      const t = this.maxLife[i];
      this.life[i] -= dt / t;
      if (this.life[i] <= 0) { this.life[i] = 0; continue; }
      const i3 = i * 3;
      this.vel[i3 + 1] += this.grav[i] * dt;
      const dr = 1 - this.drag[i] * dt;
      this.vel[i3] *= dr; this.vel[i3 + 1] *= dr; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02 && this.vel[i3 + 1] < 0) {
        this.pos[i3 + 1] = 0.02;
        this.vel[i3] *= 0.4; this.vel[i3 + 1] = 0; this.vel[i3 + 2] *= 0.4;
      }
      if (this.grow[i] !== 0) this.size[i] += this.grow[i] * dt * 0.12;
      if (this.size[i] < 0.005) this.life[i] = 0;
      // distance fog for particles
      const dx = this.pos[i3] - cameraPos.x, dz = this.pos[i3 + 2] - cameraPos.z;
      const d2 = dx * dx + dz * dz;
      const f = 1 - Math.exp(-fogD * fogD * d2 * 1.4);
      this.fog[i] = f;
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aLife.needsUpdate = true;
    geo.attributes.aFog.needsUpdate = true;
  }

  reset() {
    this.life.fill(0);
    this.points.geometry.attributes.aLife.needsUpdate = true;
  }
}

/* ============================================================
   Decals - pooled planes for blood pools & bullet holes
   ============================================================ */

export class Decals {
  constructor(scene) {
    this.scene = scene;
    this.max = 46;
    this.idx = 0;
    this.meshes = [];
    this._bloodTex = null;
    this._holeTex = null;
    this._tmpMat4 = new THREE.Matrix4();
  }

  setTextures(bloodTex, holeTex) {
    this._bloodTex = bloodTex;
    this._holeTex = holeTex;
  }

  _get(tex, opacity) {
    if (this.meshes.length < this.max) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false,
        opacity, polygonOffset: true, polygonOffsetFactor: -2,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      m.rotation.order = 'YXZ';
      this.scene.add(m);
      this.meshes.push(m);
      return m;
    }
    const m = this.meshes[this.idx];
    this.idx = (this.idx + 1) % this.max;
    m.material.map = tex;
    m.material.opacity = opacity;
    m.visible = true;
    return m;
  }

  bloodPool(x, z, scale = 1) {
    const m = this._get(this._bloodTex, 0.9);
    m.position.set(x, 0.021 + Math.random() * 0.004, z);
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    const s = (0.8 + Math.random() * 0.7) * scale;
    m.scale.set(s, s, 1);
  }

  bulletHole(point, normal) {
    const m = this._get(this._holeTex, 0.95);
    // orient plane to the surface
    const target = new THREE.Vector3().copy(point).addScaledVector(normal, 0.012);
    m.position.copy(target);
    m.lookAt(target.x + normal.x, target.y + normal.y, target.z + normal.z);
    m.rotateZ(Math.random() * Math.PI * 2);
    const s = 0.07 + Math.random() * 0.05;
    m.scale.set(s, s, 1);
  }

  reset() {
    for (const m of this.meshes) m.visible = false;
    this.idx = 0;
  }
}
