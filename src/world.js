/* ============================================================
   DEAD HOURS - world / arena
   Night-time ruined block: PBR ground, ruined buildings, dead
   trees, burning barrels, street lamps, rain, lightning, exp
   fog, moonlit shadows and a far city silhouette. Also owns
   the AABB colliders and zombie spawn ring.
   ============================================================ */

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildEnvCanvas } from './textures.js';

const COLLIDER_PAD = 0.0;

export class World {
  constructor(scene, renderer, TEX, quality, particles) {
    this.scene = scene;
    this.renderer = renderer;
    this.TEX = TEX;
    this.quality = quality;
    this.particles = particles;

    this.aabbs = [];            // {minX,maxX,minZ,maxZ}
    this.collidables = [];      // meshes bullets can hit
    this.spawnPoints = [];
    this.barrels = [];
    this.lamps = [];
    this.fires = [];

    this.lightning = {
      next: 4 + Math.random() * 6,
      t: -1,                    // -1 = idle
      strikes: 0,
      baseFogColor: new THREE.Color(0x090f1a),
    };

    this._rand = mulberry32(20261124);

    this._buildEnvironment();
    this._buildLights();
    this._buildArena();
    this._buildRain();
    this._buildSpawns();
  }

  /* ==================== environment ==================== */

  _buildEnvironment() {
    const T = this.TEX;

    // PMREM environment for PBR reflections
    const envTex = new THREE.CanvasTexture(buildEnvCanvas());
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envRT = pmrem.fromEquirectangular(envTex);
    this.scene.environment = envRT.texture;
    pmrem.dispose();
    envTex.dispose();

    // fog
    this.fog = new THREE.FogExp2(0x090f1a, CONFIG.fx.fogDensity[this.quality]);
    this.scene.fog = this.fog;

    // sky dome
    const skyMat = new THREE.MeshBasicMaterial({
      map: T.sky, side: THREE.BackSide, fog: false, depthWrite: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 20), skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // moon
    this.moonDir = new THREE.Vector3(0.45, 0.62, -0.64).normalize();
    const moonMat = new THREE.MeshBasicMaterial({ map: T.moon, fog: false });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(17, 24, 16), moonMat);
    this.moon.position.copy(this.moonDir).multiplyScalar(360);
    this.scene.add(this.moon);

    // far city silhouette
    const cityMat = new THREE.MeshBasicMaterial({ color: 0x0a0e17 });
    const cityGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2 + this._rand() * 0.22;
      const r = 185 + this._rand() * 60;
      const w = 16 + this._rand() * 26;
      const h = 22 + this._rand() * 52;
      const m = new THREE.Mesh(cityGeo, cityMat);
      m.position.set(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r);
      m.scale.set(w, h, 14 + this._rand() * 20);
      m.rotation.y = -a;
      this.scene.add(m);
    }
  }

  _buildLights() {
    // moonlight
    this.moonLight = new THREE.DirectionalLight(0xa9c2ff, 2.6);
    this.moonLight.position.copy(this.moonDir).multiplyScalar(120);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.camera.left = -70;
    this.moonLight.shadow.camera.right = 70;
    this.moonLight.shadow.camera.top = 70;
    this.moonLight.shadow.camera.bottom = -70;
    this.moonLight.shadow.camera.far = 300;
    this.moonLight.shadow.bias = -0.0004;
    this.moonLight.shadow.normalBias = 0.03;
    const mapSize = CONFIG.fx.shadowMapSize[this.quality];
    this.moonLight.shadow.mapSize.set(mapSize || 512, mapSize || 512);
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    // hemisphere sky/ground bounce
    this.hemi = new THREE.HemisphereLight(0x2b3c58, 0x1d1812, 0.85);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0x232c3f, 0.5);
    this.scene.add(this.ambient);

    // lightning flash light
    this.flashLight = new THREE.DirectionalLight(0xdfe8ff, 0);
    this.flashLight.position.set(-40, 90, 30);
    this.scene.add(this.flashLight);

    const shadowOn = mapSize > 0;
    this.renderer.shadowMap.enabled = shadowOn;
  }

  /* ==================== arena ==================== */

  _mat(T, kind, extra = {}) {
    const t = T[kind];
    const m = new THREE.MeshStandardMaterial({
      map: t.map, roughnessMap: t.rough || null, roughness: 1,
      normalMap: t.normal || null,
      metalness: kind === 'metal' ? 0.75 : 0.02,
      envMapIntensity: kind === 'metal' ? 0.9 : 0.35,
      ...extra,
    });
    return m;
  }

  _addCollider(mesh, shrink = 0) {
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(mesh);
    this.aabbs.push({
      minX: box.min.x + shrink + COLLIDER_PAD,
      maxX: box.max.x - shrink - COLLIDER_PAD,
      minZ: box.min.z + shrink + COLLIDER_PAD,
      maxZ: box.max.z - shrink - COLLIDER_PAD,
    });
    this.collidables.push(mesh);
  }

  _buildArena() {
    const T = this.TEX;
    const S = CONFIG.arena.size;

    // ---- ground ----
    const groundMat = new THREE.MeshStandardMaterial({
      map: T.dirt.map, normalMap: T.dirt.normal, roughnessMap: T.dirt.rough,
      roughness: 1, metalness: 0.02, envMapIntensity: 0.3,
    });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(S, S, 1, 1), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.collidables.push(this.ground);

    // ---- ruined buildings ----
    const concreteMat = this._mat(T, 'concrete');
    const brickMat = this._mat(T, 'brick');
    const B = [
      // x, z, w, h, d, rotY, mat
      [-62, -58, 30, 13, 16, 0.18, concreteMat],
      [58, -66, 26, 10, 18, -0.1, concreteMat],
      [66, 58, 22, 15, 14, 0.32, brickMat],
      [-58, 62, 26, 11, 16, -0.22, brickMat],
      [0, -84, 34, 9, 12, 0.05, concreteMat],
      [-84, 4, 14, 17, 30, 0.0, brickMat],
      [84, -10, 16, 12, 26, 0.08, concreteMat],
      [4, 86, 30, 8, 12, -0.12, concreteMat],
    ];
    for (const [x, z, w, h, d, ry, mat] of B) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, h / 2, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this._addCollider(m);
      // broken rooftop chunk
      const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 2.4, d * 0.6), mat);
      top.position.set(x + (this._rand() - 0.5) * w * 0.3, h + 1.2, z + (this._rand() - 0.5) * d * 0.3);
      top.rotation.y = ry + (this._rand() - 0.5) * 0.5;
      top.castShadow = true;
      this.scene.add(top);
    }

    // ---- free-standing ruined walls ----
    const WALLS = [
      [-24, -30, 12, 3.4, 0.5, 0.7], [18, 34, 10, 3.0, 0.5, -0.5],
      [30, -18, 0.5, 2.6, 9, 0.2], [-34, 22, 0.5, 3.2, 10, -0.35],
    ];
    for (const [x, z, w, h, d, ry] of WALLS) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), brickMat);
      m.position.set(x, h / 2, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this._addCollider(m);
    }

    // ---- crates ----
    const woodMat = this._mat(T, 'wood');
    const crateGeo = new THREE.BoxGeometry(1.15, 1.15, 1.15);
    const CRATES = [
      [10, -12, 0.3], [11.4, -12.2, 0.9], [10.6, -12.1, 0, 1.15],
      [-16, 8, 0.7], [-17.4, 8.4, 1.4],
      [26, 20, 0.2], [27.2, 20.4, 0.8],
      [-30, -40, 0.4], [-29, -41.2, 1.1],
      [44, -30, 0.5], [-48, 40, 0.9], [2, 52, 0.25], [-8, -54, 0.6],
    ];
    for (const [x, z, ry, dy = 0] of CRATES) {
      const m = new THREE.Mesh(crateGeo, woodMat);
      m.position.set(x, 0.575 + dy, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      if (dy === 0) this._addCollider(m);
    }

    // ---- burning barrels ----
    const metalMat = this._mat(T, 'metal');
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.08, 12, 1, true);
    const capGeo = new THREE.CircleGeometry(0.42, 12);
    for (const [x, z] of [[6, 6], [-22, 18], [38, 34], [-42, -36], [18, -46]]) {
      const b = new THREE.Mesh(barrelGeo, metalMat);
      b.position.set(x, 0.54, z);
      b.castShadow = true; b.receiveShadow = true;
      this.scene.add(b);
      const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.9 }));
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(x, 1.081, z);
      this.scene.add(cap);
      // embers glow ring
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(0.5, 12),
        new THREE.MeshBasicMaterial({ map: this.TEX.glow, color: 0xff6a20, transparent: true, opacity: 0.55, depthWrite: false })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x, 1.084, z);
      this.scene.add(glow);

      const light = new THREE.PointLight(0xff7c2e, 26, 24, 2);
      light.position.set(x, 1.55, z);
      this.scene.add(light);

      this._addCollider(b);
      this.barrels.push({ x, z, light, glow, seed: this._rand() * 10 });
    }

    // ---- street lamps ----
    const lampMetal = new THREE.MeshStandardMaterial({
      map: T.metal.map, roughness: T.metal.rough, metalness: 0.7, envMapIntensity: 0.8,
    });
    for (const [x, z, ry] of [[-12, 40, 0.4], [36, -8, -1.2]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8), lampMetal);
      pole.position.set(x, 2.3, z);
      pole.castShadow = true;
      this.scene.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), lampMetal);
      arm.position.set(x + Math.cos(ry) * 0.7, 4.55, z + Math.sin(ry) * 0.7);
      arm.rotation.y = -ry;
      this.scene.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.22), lampMetal);
      head.position.set(x + Math.cos(ry) * 1.35, 4.5, z + Math.sin(ry) * 1.35);
      head.rotation.y = -ry;
      this.scene.add(head);
      // light cone (volumetric-ish)
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(2.6, 4.4, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xbcd2ff, transparent: true, opacity: 0.045,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      cone.position.set(x + Math.cos(ry) * 1.35, 2.3, z + Math.sin(ry) * 1.35);
      this.scene.add(cone);
      const light = new THREE.PointLight(0xcfe2ff, 34, 22, 2);
      light.position.set(x + Math.cos(ry) * 1.35, 4.4, z + Math.sin(ry) * 1.35);
      this.scene.add(light);
      this._addCollider(pole, 0.05);
      this.lamps.push({ light, cone, seed: this._rand() * 10, broken: false });
    }

    // ---- dead trees ----
    const barkMat = new THREE.MeshStandardMaterial({
      map: T.bark.map, normalMap: T.bark.normal, roughness: 0.95, metalness: 0, envMapIntensity: 0.25,
    });
    const TREES = [
      [-38, -12, 0.5], [22, -22, 1.2], [-8, 30, 2.1], [50, 18, 0.8],
      [-52, -50, 1.7], [62, 40, 0.3], [0, -20, 2.8],
    ];
    for (const [x, z, seed] of TREES) {
      const tree = new THREE.Group();
      const trunkH = 3 + (seed % 1) * 1.5;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.2, trunkH, 7), barkMat);
      trunk.position.y = trunkH / 2;
      trunk.castShadow = true;
      tree.add(trunk);
      const branches = 4 + ((seed * 7) | 0) % 3;
      for (let b = 0; b < branches; b++) {
        const bl = 0.9 + ((seed * (b + 3)) % 1) * 1.2;
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.07, bl, 5), barkMat);
        br.position.y = trunkH * (0.55 + 0.4 * ((b + 1) / branches));
        br.rotation.z = 0.6 + ((seed * (b + 2)) % 1) * 0.7;
        br.rotation.y = b * 2.3 + seed;
        br.castShadow = true;
        // offset outward along branch direction
        br.position.x = Math.cos(br.rotation.y) * 0.2;
        br.position.z = Math.sin(br.rotation.y) * 0.2;
        tree.add(br);
      }
      tree.position.set(x, 0, z);
      tree.rotation.y = seed * 3;
      this.scene.add(tree);
      this.aabbs.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35 });
    }

    // ---- rubble ----
    const rubbleMat = new THREE.MeshStandardMaterial({
      map: T.concrete.map, normalMap: T.concrete.normal, roughness: 0.95, envMapIntensity: 0.25,
    });
    const rubble = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.3, 0), rubbleMat, 90
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 90; i++) {
      const near = this._rand() < 0.55;
      let x, z;
      if (near) {
        const B = [[-62, -58], [58, -66], [66, 58], [-58, 62], [0, -84], [-84, 4], [84, -10], [4, 86]];
        const [bx, bz] = B[(this._rand() * B.length) | 0];
        x = bx + (this._rand() - 0.5) * 34;
        z = bz + (this._rand() - 0.5) * 26;
      } else {
        const a = this._rand() * Math.PI * 2;
        const r = 10 + this._rand() * 95;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      }
      dummy.position.set(x, this._rand() * 0.16, z);
      dummy.rotation.set(this._rand() * 3, this._rand() * 3, this._rand() * 3);
      const s = 0.4 + this._rand() * 1.3;
      dummy.scale.set(s, s * (0.5 + this._rand() * 0.5), s);
      dummy.updateMatrix();
      rubble.setMatrixAt(i, dummy.matrix);
    }
    rubble.castShadow = true;
    rubble.receiveShadow = true;
    rubble.instanceMatrix.needsUpdate = true;
    this.scene.add(rubble);

    // ---- dry grass tufts ----
    this.grass = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.85, 0.6),
      new THREE.MeshStandardMaterial({
        map: T.grassBlade, transparent: true, alphaTest: 0.32,
        side: THREE.DoubleSide, roughness: 1, envMapIntensity: 0.15,
      }),
      CONFIG.fx.grassCount[this.quality]
    );
    for (let i = 0; i < CONFIG.fx.grassCount[this.quality]; i++) {
      const a = this._rand() * Math.PI * 2;
      const r = 4 + this._rand() * 100;
      dummy.position.set(Math.cos(a) * r, 0.28, Math.sin(a) * r);
      dummy.rotation.set(0, this._rand() * Math.PI, 0);
      const s = 0.7 + this._rand() * 0.9;
      dummy.scale.set(s, s, 1);
      dummy.updateMatrix();
      this.grass.setMatrixAt(i, dummy.matrix);
    }
    this.grass.instanceMatrix.needsUpdate = true;
    this.scene.add(this.grass);
  }

  /* ==================== rain ==================== */

  _buildRain() {
    const count = CONFIG.fx.rainCount[this.quality];
    this.rainCount = count;
    this.rainGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 2 * 3);
    this.rainSpeeds = new Float32Array(count);
    for (let i = 0; i < count; i++) this.rainSpeeds[i] = 0.85 + Math.random() * 0.35;
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainMat = new THREE.LineBasicMaterial({
      color: 0x8fa3bd, transparent: true, opacity: 0.3, fog: true,
    });
    this.rain = new THREE.LineSegments(this.rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    if (count > 0) this.scene.add(this.rain);
    this._rainPos = pos;
  }

  _resetDrop(i, x, z, y) {
    const p = this._rainPos;
    const len = 1.3 + Math.random() * 0.6;
    p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
    p[i * 6 + 3] = x + 0.08; p[i * 6 + 4] = y - len; p[i * 6 + 5] = z;
  }

  _updateRain(dt, camPos) {
    if (this.rainCount <= 0) return;
    const p = this._rainPos;
    const speed = CONFIG.fx.rainSpeed;
    const wind = 6;
    for (let i = 0; i < this.rainCount; i++) {
      const yi = i * 6 + 1, yj = i * 6 + 4;
      const dy = speed * this.rainSpeeds[i] * dt;
      p[yi] -= dy; p[yj] -= dy;
      const dx = wind * dt;
      p[i * 6] += dx; p[i * 6 + 3] += dx;
      if (p[yj] < 0) {
        const x = camPos.x + (Math.random() - 0.5) * 80;
        const z = camPos.z + (Math.random() - 0.5) * 80;
        this._resetDrop(i, x, z, 26 + Math.random() * 8);
      }
      // keep rain volume around the camera
      const dxz = Math.abs(p[i * 6] - camPos.x) + Math.abs(p[i * 6 + 2] - camPos.z);
      if (dxz > 90) this._resetDrop(i, camPos.x + (Math.random() - 0.5) * 80, camPos.z + (Math.random() - 0.5) * 80, 26 + Math.random() * 8);
    }
    this.rainGeo.attributes.position.needsUpdate = true;
  }

  /* ==================== spawns ==================== */

  _buildSpawns() {
    const { spawnMinR, spawnMaxR } = CONFIG.arena;
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2 + this._rand() * 0.12;
      const r = spawnMinR + this._rand() * (spawnMaxR - spawnMinR);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      let ok = true;
      for (const b of this.aabbs) {
        if (x > b.minX - 1.4 && x < b.maxX + 1.4 && z > b.minZ - 1.4 && z < b.maxZ + 1.4) { ok = false; break; }
      }
      if (ok) this.spawnPoints.push({ x, z });
    }
    if (this.spawnPoints.length < 12) this.spawnPoints.push({ x: 0, z: -70 }, { x: 70, z: 0 }, { x: -70, z: 0 }, { x: 0, z: 70 });
  }

  pickSpawn(playerPos) {
    let best = null, bestD = -1;
    for (let k = 0; k < 6; k++) {
      const s = this.spawnPoints[(Math.random() * this.spawnPoints.length) | 0];
      const d = Math.hypot(s.x - playerPos.x, s.z - playerPos.z);
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /* ==================== collision ==================== */

  /** push a circle (pos.x, pos.z, radius) out of all AABBs; returns true if moved */
  collide(pos, radius) {
    let hit = false;
    for (const b of this.aabbs) {
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = (radius - d) / d;
        if (d2 < 1e-8) {
          // center inside the box - push out along smallest axis
          const l = pos.x - b.minX, r = b.maxX - pos.x, t = pos.z - b.minZ, bo = b.maxZ - pos.z;
          const m = Math.min(l, r, t, bo);
          if (m === l) pos.x = b.minX - radius;
          else if (m === r) pos.x = b.maxX + radius;
          else if (m === t) pos.z = b.minZ - radius;
          else pos.z = b.maxZ + radius;
        } else {
          pos.x += dx * push;
          pos.z += dz * push;
        }
        hit = true;
      }
    }
    // arena bounds
    const B = CONFIG.arena.bounds;
    if (pos.x < -B) { pos.x = -B; hit = true; }
    if (pos.x > B) { pos.x = B; hit = true; }
    if (pos.z < -B) { pos.z = -B; hit = true; }
    if (pos.z > B) { pos.z = B; hit = true; }
    return hit;
  }

  /* ==================== per-frame ==================== */

  update(dt, time, camPos, audio) {
    // barrel flames
    for (const b of this.barrels) {
      b.light.intensity = 26 * (0.82 + 0.28 * Math.sin(time * 7.3 + b.seed * 11) * Math.sin(time * 3.1 + b.seed));
      b.glow.material.opacity = 0.4 + 0.22 * Math.sin(time * 9 + b.seed * 7);
      this.particles.flamePuff(b.x, 1.15, b.z, 0.22);
      if (Math.random() < 0.06) this.particles.smokePuff(new THREE.Vector3(b.x, 1.9, b.z), 1);
    }

    // lamp flicker
    for (const l of this.lamps) {
      const f = 0.75 + 0.25 * Math.sin(time * 13.7 + l.seed * 9) + (Math.random() < 0.008 ? -0.55 : 0);
      l.light.intensity = 34 * Math.max(0.1, f);
      l.cone.material.opacity = 0.045 * Math.max(0.1, f) / 0.75;
    }

    // rain follows camera
    this._updateRain(dt, camPos);

    // lightning
    const L = this.lightning;
    if (L.t < 0) {
      L.next -= dt;
      if (L.next <= 0) {
        L.t = 0;
        L.strikes = 0;
        L.next = CONFIG.fx.lightningEvery[0] + Math.random() *
          (CONFIG.fx.lightningEvery[1] - CONFIG.fx.lightningEvery[0]);
      }
    } else {
      L.t += dt;
      // double-strike envelope
      let inten = 0;
      if (L.t < 0.09) inten = 9;
      else if (L.t < 0.16) inten = 1.2;
      else if (L.t < 0.26) inten = 6.5;
      else if (L.t < 0.4) inten = 2;
      if (inten > 4 && L.strikes < 2) {
        L.strikes++;
        if (audio) audio.thunder(0.8 + Math.random() * 1.8, 0.35 + Math.random() * 0.3);
      }
      this.flashLight.intensity = inten;
      // brighten fog & hemisphere during flash
      const f = Math.min(1, inten / 9);
      this.fog.color.copy(L.baseFogColor).lerp(new THREE.Color(0x1d2942), f * 0.8);
      this.hemi.intensity = 0.85 + f * 1.6;
      this.ambient.intensity = 0.5 + f * 0.5;
      if (L.t > 0.55) {
        L.t = -1;
        this.flashLight.intensity = 0;
        this.fog.color.copy(L.baseFogColor);
        this.hemi.intensity = 0.85;
        this.ambient.intensity = 0.5;
      }
    }
  }

  applyQuality(q) {
    this.quality = q;
    this.fog.density = CONFIG.fx.fogDensity[q];
    this.lightning.baseFogColor.set(0x090f1a);
    const mapSize = CONFIG.fx.shadowMapSize[q];
    this.renderer.shadowMap.enabled = mapSize > 0;
    if (mapSize > 0) {
      if (this.moonLight.shadow.map) {
        this.moonLight.shadow.map.dispose();
        this.moonLight.shadow.map = null;
      }
      this.moonLight.shadow.mapSize.set(mapSize, mapSize);
    }
    // rain density
    const wantRain = CONFIG.fx.rainCount[q];
    if (wantRain !== this.rainCount) {
      this.scene.remove(this.rain);
      this.rainGeo.dispose();
      this._buildRain();   // reads this.quality, adds to scene if count > 0
      this.rainCount = wantRain;
      this.rain.visible = wantRain > 0;
    }
    this.grass.count = Math.min(CONFIG.fx.grassCount[q], CONFIG.fx.grassCount.high);
    this.grass.visible = CONFIG.fx.grassCount[q] > 0;
  }

  reset() {
    for (const l of this.lamps) l.broken = false;
  }
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
