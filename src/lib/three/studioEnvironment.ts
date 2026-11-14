import * as THREE from 'three';

export type StudioLightingPreset = 'atelier' | 'sunset' | 'saigon_night' | 'blueprint';

/**
 * Generates a high-dynamic-range virtual automotive softbox light-tent environment
 * via PMREMGenerator so metallic clearcoat paint, chrome exhausts, and glass lenses
 * reflect crisp linear studio highlights!
 */
export function buildStudioEnvMap(renderer: THREE.WebGLRenderer, preset: StudioLightingPreset): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();

  const palette = {
    atelier: { bg: 0x0c1018, top: 0xffffff, left: 0xdbeafe, right: 0xfde68a, rim: 0x38bdf8 },
    sunset: { bg: 0x1a1214, top: 0xffedd5, left: 0xfb923c, right: 0x93c5fd, rim: 0xf59e0b },
    saigon_night: { bg: 0x070a14, top: 0x67e8f9, left: 0xf43f5e, right: 0xf59e0b, rim: 0x2dd4bf },
    blueprint: { bg: 0xdbe3ee, top: 0xffffff, left: 0xf8fafc, right: 0xe2e8f0, rim: 0x94a3b8 },
  }[preset];

  envScene.background = new THREE.Color(palette.bg);

  // Overhead primary strip softbox (classic automotive studio reflection line!)
  const overhead = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 3.2),
    new THREE.MeshBasicMaterial({ color: palette.top, side: THREE.DoubleSide })
  );
  overhead.position.set(0, 7.5, 0);
  overhead.rotation.x = Math.PI / 2;
  envScene.add(overhead);

  // Left & Right side fill softboxes
  const sideL = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 3.4),
    new THREE.MeshBasicMaterial({ color: palette.left, side: THREE.DoubleSide })
  );
  sideL.position.set(7.5, 3.4, 0.5);
  sideL.rotation.y = -Math.PI / 2;
  envScene.add(sideL);

  const sideR = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 3.4),
    new THREE.MeshBasicMaterial({ color: palette.right, side: THREE.DoubleSide })
  );
  sideR.position.set(-7.5, 3.4, -0.5);
  sideR.rotation.y = Math.PI / 2;
  envScene.add(sideR);

  // Rear accent strip
  const backStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 1.4),
    new THREE.MeshBasicMaterial({ color: palette.rim, side: THREE.DoubleSide })
  );
  backStrip.position.set(0, 2.6, -8);
  envScene.add(backStrip);

  const rt = pmrem.fromScene(envScene, 0.035);
  pmrem.dispose();
  return rt.texture;
}

export class StudioStage {
  public group: THREE.Group;
  private floorMesh: THREE.Mesh;
  private ringMesh: THREE.Mesh;
  private gridHelper: THREE.PolarGridHelper;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private backdropMat: THREE.MeshStandardMaterial;
  private floorMat: THREE.MeshStandardMaterial;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'studio_stage';

    // Architectural brushed dark-slate concrete turntable floor
    this.floorMat = new THREE.MeshStandardMaterial({
      color: 0x101319,
      roughness: 0.42,
      metalness: 0.25,
    });
    this.floorMesh = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 0.12, 72), this.floorMat);
    this.floorMesh.position.y = -0.06;
    this.floorMesh.receiveShadow = true;
    this.group.add(this.floorMesh);

    // Precision automotive turntable outer chamfered plinth ring
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x1e2430,
      metalness: 0.82,
      roughness: 0.25,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.22,
    });
    this.ringMesh = new THREE.Mesh(new THREE.RingGeometry(2.15, 2.20, 96), ringMat);
    this.ringMesh.rotation.x = -Math.PI / 2;
    this.ringMesh.position.y = 0.002;
    this.group.add(this.ringMesh);

    // Subtle technical calibration radial lines
    this.gridHelper = new THREE.PolarGridHelper(2.15, 12, 4, 64, 0x2a3345, 0x1b212e);
    this.gridHelper.position.y = 0.0015;
    this.group.add(this.gridHelper);

    // Seamless curved studio cyclorama dome
    this.backdropMat = new THREE.MeshStandardMaterial({
      color: 0x0b0e14,
      roughness: 0.92,
      metalness: 0.05,
      side: THREE.BackSide,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(28, 36, 20), this.backdropMat);
    this.group.add(dome);

    // 3-Point Precision Automotive Lighting Rig
    this.hemiLight = new THREE.HemisphereLight(0xdce7f7, 0x11151d, 0.65);
    this.group.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfffaf0, 2.6);
    this.keyLight.position.set(4.5, 6.2, 4.2);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 18;
    const d = 2.8;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.group.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0x93c5fd, 1.15);
    this.fillLight.position.set(-5.0, 3.2, 2.5);
    this.group.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0xfde68a, 1.65);
    this.rimLight.position.set(-2.5, 3.8, -5.2);
    this.group.add(this.rimLight);
  }

  public applyPreset(preset: StudioLightingPreset, scene: THREE.Scene) {
    if (preset === 'atelier') {
      scene.background = new THREE.Color(0x0a0d13);
      scene.fog = new THREE.Fog(0x0a0d13, 14, 34);
      this.floorMat.color.setHex(0x11151d);
      this.floorMat.roughness = 0.38;
      this.backdropMat.color.setHex(0x0b0f17);
      this.keyLight.color.setHex(0xfff9ef);
      this.keyLight.intensity = 2.7;
      this.fillLight.color.setHex(0x93c5fd);
      this.fillLight.intensity = 1.25;
      this.rimLight.color.setHex(0xfde68a);
      this.rimLight.intensity = 1.75;
      this.hemiLight.intensity = 0.7;
      (this.ringMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x38bdf8);
    } else if (preset === 'sunset') {
      scene.background = new THREE.Color(0x1c1415);
      scene.fog = new THREE.Fog(0x1c1415, 14, 34);
      this.floorMat.color.setHex(0x21191a);
      this.floorMat.roughness = 0.44;
      this.backdropMat.color.setHex(0x261817);
      this.keyLight.color.setHex(0xffb86c);
      this.keyLight.intensity = 3.1;
      this.fillLight.color.setHex(0x7c93c3);
      this.fillLight.intensity = 1.05;
      this.rimLight.color.setHex(0xff6b35);
      this.rimLight.intensity = 2.2;
      this.hemiLight.intensity = 0.85;
      (this.ringMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xf59e0b);
    } else if (preset === 'saigon_night') {
      scene.background = new THREE.Color(0x06080f);
      scene.fog = new THREE.Fog(0x06080f, 12, 32);
      this.floorMat.color.setHex(0x0a0d16);
      this.floorMat.roughness = 0.20;
      this.backdropMat.color.setHex(0x060913);
      this.keyLight.color.setHex(0xa5f3fc);
      this.keyLight.intensity = 1.9;
      this.fillLight.color.setHex(0xf43f5e);
      this.fillLight.intensity = 1.45;
      this.rimLight.color.setHex(0xf59e0b);
      this.rimLight.intensity = 2.0;
      this.hemiLight.intensity = 0.4;
      (this.ringMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x14b8a6);
    } else {
      // Technical Blueprint Daylight
      scene.background = new THREE.Color(0xe5eaf2);
      scene.fog = new THREE.Fog(0xe5eaf2, 18, 42);
      this.floorMat.color.setHex(0xd6dde8);
      this.floorMat.roughness = 0.52;
      this.backdropMat.color.setHex(0xe8edf5);
      this.keyLight.color.setHex(0xffffff);
      this.keyLight.intensity = 2.5;
      this.fillLight.color.setHex(0xe0f2fe);
      this.fillLight.intensity = 1.4;
      this.rimLight.color.setHex(0xffffff);
      this.rimLight.intensity = 1.2;
      this.hemiLight.intensity = 1.15;
      (this.ringMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x0284c7);
    }
  }
}
