import * as THREE from 'three';
import type { TerrainSample } from '@/lib/physics/motorcyclePhysics';

export type RideTimeOfDay = 'day' | 'dusk' | 'night';

function createAsphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#262930';
  ctx.fillRect(0, 0, 512, 512);
  // Realistic asphalt aggregate noise
  for (let i = 0; i < 18000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 30 + Math.floor(Math.random() * 28);
    ctx.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
    ctx.fillRect(x, y, 2, 2);
  }
  // Lane markings
  ctx.fillStyle = 'rgba(248, 250, 252, 0.82)';
  ctx.fillRect(14, 0, 10, 512);
  ctx.fillRect(488, 0, 10, 512);
  ctx.fillStyle = 'rgba(245, 180, 40, 0.85)';
  ctx.fillRect(252, 32, 8, 190);
  ctx.fillRect(252, 288, 8, 190);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function createGroundTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#253328';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const g = 42 + Math.floor(Math.random() * 24);
    ctx.fillStyle = `rgb(${Math.floor(g * 0.72)},${g},${Math.floor(g * 0.68)})`;
    ctx.fillRect(x, y, 3, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  return tex;
}

/**
 * 400m x 400m Proving Ground & Coastal Boulevard:
 * - Main straightaway along X = 0 (Z from -130 to +140) with Traffic Light Intersection at Z = +42
 * - Suspension Test Strip (6 speed bumps + cobble washboard) along X = +12 (Z from 0 to +65)
 * - Outer Oval / Sweep Circuit (X = ±75, Z = ±125) with a smooth Coastal Crest Hill at Z = +125!
 * - Slalom Cones Agility Lane at X = -18 (Z from -20 to +60)
 */
export class ProvingGroundWorld {
  public group: THREE.Group;
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private streetLampLights: THREE.PointLight[] = [];

  // Traffic Light Signal State
  public trafficPhase: 'green' | 'amber' | 'red' = 'red';
  private trafficTimer = 0;
  private redLensMat: THREE.MeshStandardMaterial;
  private amberLensMat: THREE.MeshStandardMaterial;
  private greenLensMat: THREE.MeshStandardMaterial;

  // Bump definitions (xCenter, halfW, zCenter, height, halfLen)
  private readonly speedBumps = [
    { x: 12, hw: 4.0, z: 8, h: 0.11, hl: 0.55 },
    { x: 12, hw: 4.0, z: 16, h: 0.13, hl: 0.55 },
    { x: 12, hw: 4.0, z: 24, h: 0.15, hl: 0.60 },
    { x: 12, hw: 4.0, z: 32, h: 0.13, hl: 0.55 },
    { x: 12, hw: 4.0, z: 40, h: 0.11, hl: 0.55 },
  ];

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'proving_ground_world';

    const asphaltTex = createAsphaltTexture();
    const groundTex = createGroundTexture();

    // Base Terrain Mesh (subdivided so coastal crest hill renders accurately matching physics!)
    const groundGeom = new THREE.PlaneGeometry(460, 460, 92, 92);
    groundGeom.rotateX(-Math.PI / 2);
    const gPos = groundGeom.attributes.position;
    for (let i = 0; i < gPos.count; i++) {
      const gx = gPos.getX(i);
      const gz = gPos.getZ(i);
      gPos.setY(i, this.computeHillElevation(gx, gz) - 0.04);
    }
    groundGeom.computeVertexNormals();
    const groundMesh = new THREE.Mesh(
      groundGeom,
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.94, metalness: 0.02 })
    );
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);

    const makeRoadStrip = (w: number, len: number, x: number, z: number, rotY = 0, segsZ = 40) => {
      const t = asphaltTex.clone();
      t.needsUpdate = true;
      t.repeat.set(1, Math.max(1, len / 18));
      const geom = new THREE.PlaneGeometry(w, len, 4, segsZ);
      geom.rotateX(-Math.PI / 2);
      const p = geom.attributes.position;
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      for (let i = 0; i < p.count; i++) {
        const lx = p.getX(i);
        const lz = p.getZ(i);
        const wx = x + lx * cosR + lz * sinR;
        const wz = z - lx * sinR + lz * cosR;
        p.setY(i, this.computeHillElevation(wx, wz) + 0.015);
      }
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ map: t, roughness: 0.78, metalness: 0.06 })
      );
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rotY;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };

    // 1. Main Proving Ground Boulevard (X = 0, width 14m, length 260m)
    makeRoadStrip(14, 260, 0, 0, 0, 64);

    // 2. Cross Boulevard at Traffic Light Intersection (Z = +42, width 12m, length 180m)
    makeRoadStrip(12, 180, 0, 42, Math.PI / 2, 48);

    // 3. Outer Coastal Loop Circuit (West X=-78, East X=+78, North Crest Z=+124, South Z=-124)
    makeRoadStrip(12, 260, 78, 0, 0, 64);
    makeRoadStrip(12, 260, -78, 0, 0, 64);
    makeRoadStrip(12, 168, 0, 124, Math.PI / 2, 56);
    makeRoadStrip(12, 168, 0, -124, Math.PI / 2, 48);

    // 4. Suspension Test Strip Lane (Parallel right lane at X = +12, Z = 0..72)
    const stripMat = new THREE.MeshStandardMaterial({ color: 0x333842, roughness: 0.85 });
    const stripMesh = new THREE.Mesh(new THREE.BoxGeometry(8, 0.04, 72), stripMat);
    stripMesh.position.set(12, 0.0, 36);
    stripMesh.receiveShadow = true;
    this.group.add(stripMesh);

    // Yellow-black calibrated speed bumps on Suspension Test Strip!
    const bumpMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.55 });
    for (const b of this.speedBumps) {
      const bm = new THREE.Mesh(
        new THREE.CylinderGeometry(b.hl * 0.9, b.hl, b.hw * 2, 14, 1, false, 0, Math.PI),
        bumpMat
      );
      bm.rotation.z = Math.PI / 2;
      bm.scale.set(1, b.h / b.hl, 1);
      bm.position.set(b.x, 0.01, b.z);
      bm.castShadow = true;
      bm.receiveShadow = true;
      this.group.add(bm);
    }

    // Cobblestone washboard zone (X = +12, Z = 48..68)
    const cobbleMat = new THREE.MeshStandardMaterial({ color: 0x525866, roughness: 0.92 });
    const cobblePad = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.06, 20), cobbleMat);
    cobblePad.position.set(12, 0.01, 58);
    cobblePad.receiveShadow = true;
    this.group.add(cobblePad);

    // 5. Slalom Agility Cones (X = -18, Z = -12..+60) + Paved Slalom Pad
    const slalomPad = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.03, 92),
      new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.82 })
    );
    slalomPad.position.set(-18, 0.005, 24);
    slalomPad.receiveShadow = true;
    this.group.add(slalomPad);

    const coneMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 });
    const coneStripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x333333 });
    for (let z = -10; z <= 58; z += 9.5) {
      const coneGrp = new THREE.Group();
      coneGrp.position.set(-18, 0.02, z);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.38), coneMat);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, 0.56, 12), coneMat);
      body.position.y = 0.28;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.115, 0.12, 12), coneStripeMat);
      stripe.position.y = 0.34;
      body.castShadow = true;
      coneGrp.add(base, body, stripe);
      this.group.add(coneGrp);
    }

    // 6. WORKING TRAFFIC LIGHT INTERSECTION AT (X = 0, Z = +42)!
    const zebraMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });
    for (let sx = -5.5; sx <= 5.5; sx += 1.4) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.025, 2.8), zebraMat);
      bar.position.set(sx, 0.015, 34.5);
      this.group.add(bar);
    }
    const stopLine = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.026, 0.45), zebraMat);
    stopLine.position.set(-3.2, 0.016, 32.0);
    this.group.add(stopLine);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.35 });
    const tlPole = new THREE.Group();
    tlPole.position.set(-7.6, 0, 36.2);
    const vPost = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6.2, 14), poleMat);
    vPost.position.y = 3.1;
    vPost.castShadow = true;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.11, 7.6, 12), poleMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(3.8, 5.8, 0);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.45, 0.42), new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.6 }));
    housing.position.set(4.5, 5.4, 0);

    this.redLensMat = new THREE.MeshStandardMaterial({ color: 0x450a0a, emissive: 0xff1e1e, emissiveIntensity: 3.5 });
    this.amberLensMat = new THREE.MeshStandardMaterial({ color: 0x451a03, emissive: 0xf59e0b, emissiveIntensity: 0 });
    this.greenLensMat = new THREE.MeshStandardMaterial({ color: 0x052e16, emissive: 0x22c55e, emissiveIntensity: 0 });

    const lensGeom = new THREE.CylinderGeometry(0.15, 0.15, 0.08, 16).rotateX(Math.PI / 2);
    const redLens = new THREE.Mesh(lensGeom, this.redLensMat);
    redLens.position.set(4.5, 5.82, -0.22);
    const amberLens = new THREE.Mesh(lensGeom, this.amberLensMat);
    amberLens.position.set(4.5, 5.40, -0.22);
    const greenLens = new THREE.Mesh(lensGeom, this.greenLensMat);
    greenLens.position.set(4.5, 4.98, -0.22);

    tlPole.add(vPost, arm, housing, redLens, amberLens, greenLens);
    this.group.add(tlPole);

    // 7. Streetlamps & Modern Saigon Architectural Trees along the main boulevard
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.92 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x245534, roughness: 0.85 });
    const lampBulbMat = new THREE.MeshStandardMaterial({ color: 0xffefc2, emissive: 0xffd27d, emissiveIntensity: 2.2 });

    for (let z = -100; z <= 110; z += 30) {
      if (Math.abs(z - 42) < 12) continue;
      for (const side of [-1, 1]) {
        const lx = side * 9.2;
        const ly = this.computeHillElevation(lx, z);
        const lamp = new THREE.Group();
        lamp.position.set(lx, ly, z);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6.4, 10), poleMat);
        post.position.y = 3.2;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.34), poleMat);
        head.position.set(-side * 0.55, 6.3, 0);
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.22), lampBulbMat);
        bulb.position.set(-side * 0.65, 6.23, 0);
        lamp.add(post, head, bulb);

        // Add warm PointLights on select lamps for night riding ambiance!
        if (Math.abs(z) <= 75 && side === -1) {
          const pt = new THREE.PointLight(0xffcf87, 0, 26, 1.5);
          pt.position.set(-side * 1.2, 5.6, 0);
          lamp.add(pt);
          this.streetLampLights.push(pt);
        }
        this.group.add(lamp);

        // Architectural shade tree beside boulevard
        const tx = side * 28;
        const tz = z + 10;
        const ty = this.computeHillElevation(tx, tz);
        const tree = new THREE.Group();
        tree.position.set(tx, ty, tz);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 3.2, 10), trunkMat);
        trunk.position.y = 1.6;
        trunk.castShadow = true;
        const canopy = new THREE.Mesh(new THREE.DodecahedronGeometry(2.4, 1), leafMat);
        canopy.position.y = 4.4;
        canopy.scale.set(1.15, 0.85, 1.15);
        canopy.castShadow = true;
        tree.add(trunk, canopy);
        this.group.add(tree);
      }
    }

    // 8. Start/Finish Atelier Pit Pavilion on the left of spawn (X = -15, Z = -28)
    const pitMat = new THREE.MeshStandardMaterial({ color: 0x1e2430, metalness: 0.4, roughness: 0.55 });
    const pitAccent = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0ea5e9, emissiveIntensity: 0.9 });
    const pit = new THREE.Group();
    pit.position.set(-22, 0, -32);
    const pitBody = new THREE.Mesh(new THREE.BoxGeometry(12, 4.8, 22), pitMat);
    pitBody.position.y = 2.4;
    pitBody.castShadow = true;
    const pitTrim = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.22, 22.2), pitAccent);
    pitTrim.position.y = 4.55;
    pit.add(pitBody, pitTrim);
    this.group.add(pit);

    // 9. World Lights
    this.hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.95);
    this.group.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff7e6, 2.6);
    this.sunLight.position.set(45, 72, 38);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 220;
    const sd = 48;
    this.sunLight.shadow.camera.left = -sd;
    this.sunLight.shadow.camera.right = sd;
    this.sunLight.shadow.camera.top = sd;
    this.sunLight.shadow.camera.bottom = -sd;
    this.group.add(this.sunLight);
  }

  /**
   * Smooth coastal hill & crest along the northern loop (Z around +124)
   */
  public computeHillElevation(x: number, z: number): number {
    // Broad Gaussian coastal hill centered at (x = 0, z = +124)
    const dz = (z - 124) / 28;
    const dx = x / 56;
    const r2 = dx * dx + dz * dz;
    const hill = r2 < 4.5 ? Math.exp(-r2 * 1.15) * 3.8 : 0;
    return hill;
  }

  /**
   * Authoritative terrain sampler queried independently by Front Wheel, Rear Wheel, and Chassis!
   */
  public sampleTerrain(x: number, z: number): TerrainSample {
    let height = this.computeHillElevation(x, z);
    let surface: TerrainSample['surface'] = 'offroad';
    let gripMultiplier = 0.72;
    let dragMultiplier = 1.6;

    // Check asphalt roads
    const onMainRoad = Math.abs(x) <= 7.4 && Math.abs(z) <= 132;
    const onCrossRoad = Math.abs(z - 42) <= 6.4 && Math.abs(x) <= 92;
    const onOuterNS = (Math.abs(x - 78) <= 6.4 || Math.abs(x + 78) <= 6.4) && Math.abs(z) <= 132;
    const onOuterEW = (Math.abs(z - 124) <= 6.4 || Math.abs(z + 124) <= 6.4) && Math.abs(x) <= 86;
    const onSlalomPad = Math.abs(x + 18) <= 6.2 && z >= -24 && z <= 72;
    const onSuspStrip = Math.abs(x - 12) <= 4.2 && z >= -2 && z <= 74;

    if (onMainRoad || onCrossRoad || onOuterNS || onOuterEW || onSlalomPad || onSuspStrip) {
      surface = 'asphalt';
      gripMultiplier = 1.0;
      dragMultiplier = 1.0;
    }

    // Check calibrated speed bumps on Suspension Test Strip!
    if (onSuspStrip) {
      for (const b of this.speedBumps) {
        if (Math.abs(x - b.x) <= b.hw && Math.abs(z - b.z) <= b.hl) {
          const u = (z - b.z) / b.hl; // -1..1
          height += Math.cos(u * Math.PI * 0.5) * b.h;
          surface = 'bump';
          gripMultiplier = 0.92;
          break;
        }
      }
      // Cobblestone washboard zone
      if (z >= 48 && z <= 68) {
        height += Math.sin(z * 6.5) * 0.032 + 0.025;
        surface = 'cobble';
        gripMultiplier = 0.88;
      }
    }

    return { height, surface, gripMultiplier, dragMultiplier };
  }

  public updateTrafficLight(dt: number) {
    this.trafficTimer = (this.trafficTimer + dt) % 20;
    if (this.trafficTimer < 8) {
      this.trafficPhase = 'red';
      this.redLensMat.emissiveIntensity = 4.2;
      this.amberLensMat.emissiveIntensity = 0;
      this.greenLensMat.emissiveIntensity = 0;
    } else if (this.trafficTimer < 17) {
      this.trafficPhase = 'green';
      this.redLensMat.emissiveIntensity = 0;
      this.amberLensMat.emissiveIntensity = 0;
      this.greenLensMat.emissiveIntensity = 4.2;
    } else {
      this.trafficPhase = 'amber';
      this.redLensMat.emissiveIntensity = 0;
      this.amberLensMat.emissiveIntensity = 4.0;
      this.greenLensMat.emissiveIntensity = 0;
    }
  }

  public updateSunTarget(bikeX: number, bikeZ: number) {
    this.sunLight.position.set(bikeX + 35, 62, bikeZ + 28);
    this.sunLight.target.position.set(bikeX, 0, bikeZ);
    this.sunLight.target.updateMatrixWorld();
  }

  public applyTimeOfDay(tod: RideTimeOfDay, scene: THREE.Scene) {
    if (tod === 'day') {
      scene.background = new THREE.Color(0x9bc7eb);
      scene.fog = new THREE.Fog(0xb3d4ef, 75, 290);
      this.sunLight.color.setHex(0xfff8e7);
      this.sunLight.intensity = 2.6;
      this.hemiLight.color.setHex(0xdbeafe);
      this.hemiLight.groundColor.setHex(0x3a4a3f);
      this.hemiLight.intensity = 1.05;
      this.streetLampLights.forEach((l) => (l.intensity = 0));
    } else if (tod === 'dusk') {
      scene.background = new THREE.Color(0x2d1e2f);
      scene.fog = new THREE.Fog(0x3b2633, 55, 240);
      this.sunLight.color.setHex(0xff9b54);
      this.sunLight.intensity = 1.9;
      this.hemiLight.color.setHex(0xfdba74);
      this.hemiLight.groundColor.setHex(0x1f1926);
      this.hemiLight.intensity = 0.65;
      this.streetLampLights.forEach((l) => (l.intensity = 24));
    } else {
      // Deep Saigon Night -> motorcycle's real Low Beam / High Beam / Taillight / Turn Signals shine brilliantly!
      scene.background = new THREE.Color(0x050812);
      scene.fog = new THREE.Fog(0x060a16, 40, 195);
      this.sunLight.color.setHex(0x6488ea);
      this.sunLight.intensity = 0.25;
      this.hemiLight.color.setHex(0x1e293b);
      this.hemiLight.groundColor.setHex(0x090c14);
      this.hemiLight.intensity = 0.28;
      this.streetLampLights.forEach((l) => (l.intensity = 42));
    }
  }
}
