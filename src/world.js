/* ============================================================
   DEAD HOURS - world / arena
   Night-time ruined block: PBR ground, ruined buildings with
   lit/flickering windows, dead trees, burning barrels, street
   lamps, car wrecks, chain-link fences, power poles with
   sagging wires + electric sparks, ground mist cards,
   rain-reflection puddles, rain, lightning, exp fog, a
   drifting cloud shell, moon halo, moonlit shadows and a far
   city silhouette. Also owns the AABB colliders and the
   zombie spawn ring.
   ============================================================ */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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
    this.litWindows = [];       // {mat, seed}
    this.fogCards = [];         // {mesh, r, a, speed, y}
    this.wires = [];            // {curve, len}
    this.poles = [];
    this.puddles = [];

    this.lightning = {
      next: 4 + Math.random() * 6,
      t: -1,                    // -1 = idle
      strikes: 0,
      baseFogColor: new THREE.Color(0x090f1a),
    };
    this.flashAmt = 0;          // 0..1 for main.js bloom/godray boosts

    this._rand = mulberry32(20261124);

    this._buildEnvironment();
    this._buildLights();
    this._buildArena();
    this._buildCars();
    this._buildFences();
    this._buildPowerLines();
    this._buildPuddles();
    this._buildFogCards();
    this._buildRain();
    this._buildSpawns();
    this.applyQuality(quality);
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

    // NEW: drifting cloud shell (slightly inside the sky dome, rotates slowly)
    this.cloudMat = new THREE.MeshBasicMaterial({
      map: T.clouds, transparent: true, side: THREE.BackSide,
      fog: false, depthWrite: false, opacity: 0.9,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 20), this.cloudMat);
    this.clouds.renderOrder = -9;
    this.scene.add(this.clouds);

    // moon + halo
    this.moonDir = new THREE.Vector3(0.45, 0.62, -0.64).normalize();
    const moonMat = new THREE.MeshBasicMaterial({ map: T.moon, fog: false });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(17, 24, 16), moonMat);
    this.moon.position.copy(this.moonDir).multiplyScalar(360);
    this.scene.add(this.moon);
    this.moonWorldPos = this.moon.position;

    const haloMat = new THREE.SpriteMaterial({
      map: T.glow, color: 0xbfd2ff, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.moonHalo = new THREE.Sprite(haloMat);
    this.moonHalo.position.copy(this.moonDir).multiplyScalar(348);
    this.moonHalo.scale.set(150, 150, 1);
    this.scene.add(this.moonHalo);

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

    // NEW: shared burst light for power-line sparks
    this.sparkLight = new THREE.PointLight(0x9fd4ff, 0, 30, 2);
    this.sparkLight.position.set(0, 6, 0);
    this.scene.add(this.sparkLight);
    this.sparkLightT = 0;
    this.nextWireSpark = 3 + Math.random() * 6;

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

    // ---- ruined buildings + windows ----
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
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.12), mat);
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

      this._addBuildingWindows(x, z, w, h, d, ry);
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

    // ---- crates (rounded for light-catching edges) ----
    const woodMat = this._mat(T, 'wood');
    const crateGeo = new RoundedBoxGeometry(1.15, 1.15, 1.15, 2, 0.03);
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
      // lamp head glow sprite (the visible bright bulb)
      const bulb = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.TEX.glow, color: 0xd6e4ff, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      bulb.position.set(x + Math.cos(ry) * 1.35, 4.42, z + Math.sin(ry) * 1.35);
      bulb.scale.set(1.1, 0.55, 1);
      this.scene.add(bulb);
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
      this.lamps.push({ light, cone, bulb, seed: this._rand() * 10, broken: false });
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
      CONFIG.fx.grassCount.high
    );
    for (let i = 0; i < CONFIG.fx.grassCount.high; i++) {
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

  /** NEW: window grid on the arena-facing side of a building, some lit */
  _addBuildingWindows(x, z, w, h, d, ry) {
    const T = this.TEX;
    const winMat = new THREE.MeshStandardMaterial({
      map: T.window, roughness: 0.25, metalness: 0.4, envMapIntensity: 1.3,
    });
    const litBase = new THREE.MeshBasicMaterial({ color: 0xffc98a });
    // which face points at the arena center?
    const ax = Math.abs(x) > Math.abs(z) ? 'x' : 'z';
    const sign = ax === 'x' ? -Math.sign(x) : -Math.sign(z);
    const faceH = Math.min(h, 8);
    const rows = Math.max(1, Math.floor(faceH / 2.6));
    const cols = Math.max(2, Math.floor((ax === 'x' ? d : w) / 2.9));
    const winW = 1.05, winH = 1.35;
    const faceOff = (ax === 'x' ? (sign > 0 ? w : -w) : (sign > 0 ? d : -d)) / 2 + 0.07;

    const face = new THREE.Group();
    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const lit = this._rand() < 0.14;
        const mat = lit ? litBase.clone() : winMat;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), mat);
        const u = (cIdx - (cols - 1) / 2) * 2.9;
        const y = 2.4 + r * 2.6;
        if (ax === 'x') {
          m.position.set(x + faceOff, y, z + u);
          m.rotation.y = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          m.position.set(x + u, y, z + faceOff);
          m.rotation.y = sign > 0 ? 0 : Math.PI;
        }
        // rotate with the building a bit
        m.rotation.y += ry * 0.4;
        face.add(m);
        if (lit) this.litWindows.push({ mat, seed: this._rand() * 10, base: 0.75 + this._rand() * 0.35 });
      }
    }
    this.scene.add(face);
  }

  /* ==================== NEW v1.1: car wrecks ==================== */

  _buildCars() {
    const T = this.TEX;
    const CARS = [
      // x, z, rotY, paintVariant, missingWheels
      [-14, -22, 0.7, 0, 1],
      [30, 26, -2.4, 1, 2],
      [-44, 38, 0.3, 0, 0],
      [12, 62, 1.9, 1, 1],
      [-36, -56, -1.1, 0, 2],
    ];
    const paintMats = T.car.map((p) => new THREE.MeshPhysicalMaterial({
      map: p.map, normalMap: p.normal, roughnessMap: p.rough,
      roughness: 1, metalness: 0.55, envMapIntensity: 1.0,
      clearcoat: 0.65, clearcoatRoughness: 0.32,
    }));
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0c1015, roughness: 0.12, metalness: 0.6, envMapIntensity: 1.7,
    });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95, envMapIntensity: 0.2 });
    const hubMat = new THREE.MeshStandardMaterial({ map: T.metal.map, roughness: 0.4, metalness: 0.85, envMapIntensity: 1.2 });

    for (const [x, z, ry, variant, missing] of CARS) {
      const g = new THREE.Group();
      const paint = paintMats[variant % paintMats.length];

      // body
      const body = new THREE.Mesh(new RoundedBoxGeometry(1.78, 0.52, 4.2, 2, 0.1), paint);
      body.position.y = 0.62;
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);

      // cabin (glass) + roof
      const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.58, 0.55, 2.05, 2, 0.08), glassMat);
      cabin.position.set(0, 1.12, -0.3);
      cabin.castShadow = true;
      g.add(cabin);
      const roof = new THREE.Mesh(new RoundedBoxGeometry(1.62, 0.09, 1.95, 1, 0.03), paint);
      roof.position.set(0, 1.42, -0.3);
      g.add(roof);

      // hood + trunk lines (dark insets)
      const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.02), rubberMat);
      hood.position.set(0, 0.87, 0.9);
      g.add(hood);

      // wheels (some missing on wrecks)
      const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.25, 14);
      wheelGeo.rotateZ(Math.PI / 2);
      const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.27, 8);
      hubGeo.rotateZ(Math.PI / 2);
      const positions = [
        [-0.86, 1.35], [0.86, 1.35], [-0.86, -1.35], [0.86, -1.35],
      ];
      for (let i = 0; i < positions.length; i++) {
        if (i < missing) continue;   // wheels torn off
        const [wx, wz] = positions[i];
        const w = new THREE.Mesh(wheelGeo, rubberMat);
        w.position.set(wx, 0.33, wz);
        w.castShadow = true;
        g.add(w);
        const hub = new THREE.Mesh(hubGeo, hubMat);
        hub.position.set(wx, 0.33, wz);
        g.add(hub);
      }
      // where wheels are gone, the axle rests on a block (sunk look)
      for (let i = 0; i < missing; i++) {
        const [wx, wz] = positions[i];
        const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), hubMat);
        axle.rotateZ(Math.PI / 2);
        axle.position.set(wx, 0.28, wz);
        g.add(axle);
      }

      // broken bumper detail
      const bumper = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.16, 0.2, 1, 0.04), hubMat);
      bumper.position.set(0, 0.34, 2.08);
      bumper.rotation.z = 0.04;
      g.add(bumper);

      g.position.set(x, 0, z);
      g.rotation.y = ry;
      // sunk / tilted wreck
      g.rotation.z = (this._rand() - 0.5) * 0.05;
      g.rotation.x = (this._rand() - 0.5) * 0.03;
      g.position.y = -0.04;
      this.scene.add(g);
      this._addCollider(g, 0.15);
    }
  }

  /* ==================== NEW v1.1: chain-link fences ==================== */

  _buildFences() {
    const T = this.TEX;
    const postMat = new THREE.MeshStandardMaterial({
      map: T.metal.map, roughness: 0.6, metalness: 0.7, envMapIntensity: 0.8,
    });
    const SECTIONS = [
      // x, z, length, rotY
      [-60, 20, 14, 0.1],
      [-52, 34, 10, 1.15],
      [40, -20, 12, 0.4],
      [52, -30, 12, 1.8],
      [-6, 60, 16, 0.05],
    ];
    for (const [x, z, len, ry] of SECTIONS) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        map: T.fence.clone(), alphaTest: 0.4, side: THREE.DoubleSide,
        roughness: 0.55, metalness: 0.75, envMapIntensity: 0.5,
      });
      mat.map.needsUpdate = true;
      mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
      mat.map.repeat.set(len / 1.9, 1);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.85), mat);
      mesh.position.y = 0.92;
      mesh.receiveShadow = true;
      g.add(mesh);
      // top rail + posts
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), postMat);
      rail.rotation.z = Math.PI / 2;
      rail.position.y = 1.86;
      g.add(rail);
      const postCount = Math.floor(len / 2.6) + 1;
      for (let p = 0; p < postCount; p++) {
        const px = -len / 2 + (p / (postCount - 1)) * len;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), postMat);
        post.position.set(px, 1.0, 0);
        post.castShadow = true;
        g.add(post);
      }
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      this.scene.add(g);
      // blocks movement, but bullets pass through the mesh gaps: only
      // add an AABB collider, not a raycast target
      const dx = Math.cos(ry) * len / 2, dz = -Math.sin(ry) * len / 2;
      this.aabbs.push({
        minX: Math.min(x - dx, x + dx) - 0.05, maxX: Math.max(x - dx, x + dx) + 0.05,
        minZ: Math.min(z - dz, z + dz) - 0.05, maxZ: Math.max(z - dz, z + dz) + 0.05,
      });
    }
  }

  /* ==================== NEW v1.1: power poles + sagging wires ==================== */

  _buildPowerLines() {
    const T = this.TEX;
    const poleMat = new THREE.MeshStandardMaterial({
      map: T.bark.map, normalMap: T.bark.normal, roughness: 0.9, envMapIntensity: 0.3,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      map: T.metal.map, roughness: 0.6, metalness: 0.8, envMapIntensity: 0.8,
    });
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x0e1116, roughness: 0.7, metalness: 0.3 });
    const POLES = [
      [-30, 48], [6, 56], [42, 44],
    ];
    const tops = [];
    for (const [x, z] of POLES) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 6.6, 8), poleMat);
      pole.position.set(x, 3.3, z);
      pole.castShadow = true;
      this.scene.add(pole);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.12), metalMat);
      cross.position.set(x, 6.1, z);
      cross.castShadow = true;
      this.scene.add(cross);
      const insA = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), metalMat);
      insA.position.set(x - 0.85, 6.0, z);
      this.scene.add(insA);
      const insB = insA.clone();
      insB.position.x = x + 0.85;
      this.scene.add(insB);
      tops.push(new THREE.Vector3(x, 6.15, z));
      this.aabbs.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 });
      this.poles.push({ x, z });
    }
    // two sagging wires between consecutive poles (both offsets)
    for (let i = 0; i < tops.length - 1; i++) {
      const a = tops[i], b = tops[i + 1];
      for (const off of [-0.85, 0.85]) {
        const pa = new THREE.Vector3(a.x + off, a.y, a.z);
        const pb = new THREE.Vector3(b.x + off, b.y, b.z);
        const mid = pa.clone().add(pb).multiplyScalar(0.5);
        mid.y -= 1.15;   // sag
        const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
        const geo = new THREE.TubeGeometry(curve, 24, 0.014, 4, false);
        const wire = new THREE.Mesh(geo, wireMat);
        this.scene.add(wire);
        this.wires.push({ curve, len: pa.distanceTo(pb) });
      }
    }
  }

  /* ==================== NEW v1.1: puddles ==================== */

  _buildPuddles() {
    const T = this.TEX;
    const spots = [];
    // puddles collect near buildings, cars and craters
    const near = [
      [-14, -22], [30, 26], [-44, 38], [12, 62],   // cars
      [-20, -12], [24, 34], [-52, 26], [8, -18],   // open ground
      [-60, -40], [55, 30], [-12, 52], [40, -34],
    ];
    for (const [x, z] of near) spots.push([x + (this._rand() - 0.5) * 6, z + (this._rand() - 0.5) * 6]);

    for (const [x, z] of spots) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0b1220, roughness: 0.05, metalness: 0.88,
        envMapIntensity: 2.1, transparent: true, opacity: 0.82,
        alphaMap: T.puddleMask, depthWrite: false,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = this._rand() * Math.PI * 2;
      const s = 0.6 + this._rand() * 1.5;
      m.scale.set(s, s, 1);
      m.position.set(x, 0.013, z);
      m.renderOrder = 1;
      this.scene.add(m);
      this.puddles.push(m);
    }
  }

  /* ==================== NEW v1.1: drifting ground-mist cards ==================== */

  _buildFogCards() {
    const T = this.TEX;
    const count = CONFIG.fx.fogCards.high;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: T.smoke, color: 0x33465e, transparent: true,
        opacity: 0.055 + this._rand() * 0.05, depthWrite: false,
      });
      const w = 26 + this._rand() * 26;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.55), mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = this._rand() * Math.PI * 2;
      const card = {
        mesh: m,
        r: 18 + this._rand() * 72,
        a: this._rand() * Math.PI * 2,
        speed: 0.012 + this._rand() * 0.02,
        y: 0.5 + this._rand() * 2.2,
        rotSpeed: (this._rand() - 0.5) * 0.02,
      };
      m.position.set(Math.cos(card.a) * card.r, card.y, Math.sin(card.a) * card.r);
      m.renderOrder = 2;
      this.scene.add(m);
      this.fogCards.push(card);
    }
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
      l.bulb.material.opacity = 0.75 * Math.max(0.1, f);
    }

    // NEW: drifting clouds + moon halo breathing
    this.clouds.rotation.y += dt * 0.004;
    this.moonHalo.material.opacity = 0.3 + 0.05 * Math.sin(time * 0.7);

    // NEW: lit window flicker (dying fluorescents)
    for (const w of this.litWindows) {
      const f = 0.55 + 0.45 * Math.sin(time * (2.3 + w.seed * 0.7) + w.seed * 13) > 0.7
        ? w.base * (0.7 + 0.3 * Math.sin(time * 31 + w.seed))
        : w.base * 0.12;
      w.mat.color.setRGB(f, f * 0.77, f * 0.45);
    }

    // NEW: ground-mist cards drift
    for (const c of this.fogCards) {
      c.a += c.speed * dt;
      c.mesh.rotation.z += c.rotSpeed * dt;
      c.mesh.position.set(Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r);
    }

    // NEW: occasional electric sparks on the sagging power wires
    this.nextWireSpark -= dt;
    if (this.nextWireSpark <= 0 && this.wires.length > 0) {
      this.nextWireSpark = 4 + Math.random() * 9;
      const wire = this.wires[(Math.random() * this.wires.length) | 0];
      const t = 0.25 + Math.random() * 0.5;
      const p = wire.curve.getPoint(t);
      this.particles.sparks(p, new THREE.Vector3(0, 1, 0));
      this.particles.sparks(p, new THREE.Vector3(0, 1, 0));
      this.sparkLight.position.copy(p);
      this.sparkLightT = 0.14;
      if (audio) audio.zap(Math.hypot(p.x - camPos.x, p.z - camPos.z), (p.x - camPos.x) * 0.02);
    }
    if (this.sparkLightT > 0) {
      this.sparkLightT -= dt;
      this.sparkLight.intensity = this.sparkLightT > 0 ? 30 * (0.4 + Math.random() * 0.6) : 0;
    } else {
      this.sparkLight.intensity = 0;
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
      this.flashAmt = Math.max(0, this.flashAmt - dt * 4);
    } else {
      L.t += dt;
      // double-strike envelope
      let inten = 0;
      if (L.t < 0.09) inten = 11;
      else if (L.t < 0.16) inten = 1.4;
      else if (L.t < 0.26) inten = 8;
      else if (L.t < 0.4) inten = 2.4;
      if (inten > 4 && L.strikes < 2) {
        L.strikes++;
        if (audio) audio.thunder(0.8 + Math.random() * 1.8, 0.35 + Math.random() * 0.3);
      }
      this.flashLight.intensity = inten;
      this.flashAmt = Math.min(1, inten / 11);
      // brighten fog & hemisphere during flash
      const f = this.flashAmt;
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
    // NEW: puddles / mist cards visibility
    const puddles = CONFIG.fx.puddleCount[q];
    this.puddles.forEach((m, i) => { m.visible = i < puddles; });
    const cards = CONFIG.fx.fogCards[q];
    this.fogCards.forEach((c, i) => { c.mesh.visible = i < cards; });
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
