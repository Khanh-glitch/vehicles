import * as THREE from 'three';
import type {
  VehicleRecord,
  VehicleBuildConfig,
  MechanicalState,
  HeadlightStyle,
} from '@/lib/vehicles/types';
import type { MotorcycleDynamics } from '@/lib/physics/motorcyclePhysics';

function createLiveryCanvasTexture(baseHex: string, livery: VehicleBuildConfig['livery']): THREE.CanvasTexture | null {
  if (livery === 'factory') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 512, 512);

  if (livery === 'racing_stripe') {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(216, 0, 26, 512);
    ctx.fillRect(270, 0, 26, 512);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(248, 0, 16, 512);
  } else if (livery === 'heritage_pin') {
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 6;
    ctx.strokeRect(24, 24, 464, 464);
    ctx.lineWidth = 2;
    ctx.strokeRect(38, 38, 436, 436);
    ctx.fillStyle = '#f5eedc';
    ctx.fillRect(0, 226, 512, 60);
    ctx.fillStyle = '#d4af37';
    ctx.fillRect(0, 220, 512, 5);
    ctx.fillRect(0, 287, 512, 5);
  } else if (livery === 'cafe_gold') {
    ctx.fillStyle = '#c9a23f';
    ctx.fillRect(190, 0, 132, 512);
    ctx.fillStyle = '#141416';
    ctx.fillRect(180, 0, 10, 512);
    ctx.fillRect(322, 0, 10, 512);
    // Subtle checkered racing band
    for (let y = 0; y < 512; y += 32) {
      ctx.fillStyle = (y / 32) % 2 === 0 ? '#f8fafc' : '#111111';
      ctx.fillRect(164, y, 16, 32);
      ctx.fillRect(332, y, 16, 32);
    }
  } else if (livery === 'stealth') {
    // Diagonal carbon weave pattern
    ctx.fillStyle = '#121418';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#1f232b';
    for (let y = 0; y < 512; y += 16) {
      for (let x = 0; x < 512; x += 16) {
        if (((x + y) / 16) % 2 === 0) ctx.fillRect(x, y, 8, 8);
        else ctx.fillRect(x + 8, y + 8, 8, 8);
      }
    }
    ctx.fillStyle = baseHex;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(0, 0, 512, 512);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function createLeatherNormalCanvas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  // Subtle leather grain + diamond quilting
  ctx.strokeStyle = '#383838';
  ctx.lineWidth = 2;
  for (let i = -256; i < 512; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 256, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + 256, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

export class VehicleRigController {
  public root: THREE.Group;
  public vehicle: VehicleRecord;

  // Core mechanical pivots
  public chassisRoot: THREE.Object3D;
  public steeringPivot: THREE.Object3D | null;
  public steeringUpper: THREE.Object3D | null;
  public frontSlider: THREE.Object3D | null;
  public frontWheelPivot: THREE.Object3D | null;
  public rearSwingarmPivot: THREE.Object3D | null;
  public rearWheelPivot: THREE.Object3D | null;

  // Bike-specific articulated pivots
  public seatHinge: THREE.Object3D | null;
  public fuelCapPivot: THREE.Object3D | null;
  public kickstandPivot: THREE.Object3D | null;
  public saddlebagLeftLid: THREE.Object3D | null;
  public saddlebagRightLid: THREE.Object3D | null;
  public gloveboxHinge: THREE.Object3D | null;
  public gearShifterPivot: THREE.Object3D | null;
  public brakePedalPivot: THREE.Object3D | null;
  public kickstarterPivot: THREE.Object3D | null;
  public speedoNeedlePivot: THREE.Object3D | null;
  public tachoNeedlePivot: THREE.Object3D | null;

  // Emissive lamp meshes
  private headlightMeshes: THREE.Mesh[] = [];
  private taillightMeshes: THREE.Mesh[] = [];
  private turnLeftMeshes: THREE.Mesh[] = [];
  private turnRightMeshes: THREE.Mesh[] = [];
  private gaugeBacklightMeshes: THREE.Mesh[] = [];

  // Real dynamic Three.js lights attached to bike!
  private headlightSpot: THREE.SpotLight;
  private headlightTarget: THREE.Object3D;
  private taillightPoint: THREE.PointLight;
  private turnLeftPoint: THREE.PointLight;
  private turnRightPoint: THREE.PointLight;

  private rigDebugGroup: THREE.Group;

  // Preserved original material snapshots so paint/finish changes can always revert cleanly!
  private originalMatMaps = new Map<THREE.Material, THREE.Texture | null>();
  private originalMatColors = new Map<THREE.Material, THREE.Color>();
  private grayscaleMatMaps = new Map<THREE.Material, THREE.CanvasTexture>();
  private activeLiveryTexture: THREE.Texture | null = null;
  private diamondBumpTex: THREE.CanvasTexture | null = null;

  private getLuminanceTexture(mat: THREE.Material, origTex: THREE.Texture): THREE.CanvasTexture | null {
    const cached = this.grayscaleMatMaps.get(mat);
    if (cached) return cached;
    const img = origTex.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined;
    if (!img || typeof document === 'undefined') return null;
    try {
      const w = Math.min(1024, (img as HTMLImageElement).width || 512);
      const h = Math.min(1024, (img as HTMLImageElement).height || 512);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      const id = ctx.getImageData(0, 0, w, h);
      const d = id.data;
      // Lift normalized luminance into [0.55..1.0] so custom automotive paint stays vibrant while preserving all panel seams, AO & rivets!
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const lifted = Math.min(255, Math.round(135 + (lum / 255) * 120));
        d[i] = lifted;
        d[i + 1] = lifted;
        d[i + 2] = lifted;
      }
      ctx.putImageData(id, 0, 0);
      const grayTex = new THREE.CanvasTexture(canvas);
      grayTex.colorSpace = THREE.SRGBColorSpace;
      grayTex.flipY = origTex.flipY;
      grayTex.wrapS = origTex.wrapS;
      grayTex.wrapT = origTex.wrapT;
      grayTex.needsUpdate = true;
      this.grayscaleMatMaps.set(mat, grayTex);
      return grayTex;
    } catch {
      return null;
    }
  }

  // Smooth interpolated articulation states
  private curSeatAngle = 0;
  private curFuelCapLift = 0;
  private curBagsAngle = 0;
  private curGloveboxAngle = 0;
  private curKickstandFactor = 1; // 1 = deployed, 0 = retracted
  private curKickstarterAngle = 0;
  private curShifterAngle = 0;
  private curBrakePedalAngle = 0;
  private baseSteeringRotX = 0;
  private baseChassisY = 0;
  private headlightColorHex = 0xfff0d4;
  private vibPhase = 0;
  private studioWheelAngle = 0;

  constructor(riggedObject: THREE.Object3D, vehicle: VehicleRecord) {
    this.vehicle = vehicle;
    this.root = new THREE.Group();
    this.root.name = `vehicle_${vehicle.id}`;
    this.root.add(riggedObject);

    this.chassisRoot = riggedObject.getObjectByName('chassis_root') || riggedObject;
    this.steeringPivot = riggedObject.getObjectByName('steering_pivot') || null;
    this.steeringUpper = riggedObject.getObjectByName('steering_upper') || this.steeringPivot;
    this.frontSlider = riggedObject.getObjectByName('front_suspension_slider') || null;
    this.frontWheelPivot = riggedObject.getObjectByName('front_wheel_pivot') || null;
    this.rearSwingarmPivot = riggedObject.getObjectByName('rear_swingarm_pivot') || null;
    this.rearWheelPivot = riggedObject.getObjectByName('rear_wheel_pivot') || null;

    this.seatHinge = riggedObject.getObjectByName('seat_hinge') || null;
    this.fuelCapPivot = riggedObject.getObjectByName('fuel_cap_pivot') || null;
    this.kickstandPivot = riggedObject.getObjectByName('kickstand_pivot') || null;
    this.saddlebagLeftLid = riggedObject.getObjectByName('saddlebag_left_lid') || null;
    this.saddlebagRightLid = riggedObject.getObjectByName('saddlebag_right_lid') || null;
    this.gloveboxHinge = riggedObject.getObjectByName('glovebox_hinge') || null;
    this.gearShifterPivot = riggedObject.getObjectByName('gear_shifter_pivot') || null;
    this.brakePedalPivot = riggedObject.getObjectByName('brake_pedal_pivot') || null;
    this.kickstarterPivot = riggedObject.getObjectByName('kickstarter_pivot') || null;
    this.speedoNeedlePivot = riggedObject.getObjectByName('speedo_needle_pivot') || null;
    this.tachoNeedlePivot = riggedObject.getObjectByName('tacho_needle_pivot') || null;

    if (this.steeringPivot) {
      this.baseSteeringRotX = this.steeringPivot.rotation.x;
    }
    this.baseChassisY = this.chassisRoot.position.y;

    // Enable shadows & upgrade materials + catalog lamp meshes
    this.root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;

      const nm = mesh.name.toLowerCase();
      // Clone lamp materials so Left Turn, Right Turn, Headlight & Taillight NEVER share material state!
      if (nm.includes('lamp_headlight')) {
        if (!Array.isArray(mesh.material)) mesh.material = mesh.material.clone();
        this.headlightMeshes.push(mesh);
      } else if (nm.includes('lamp_taillight')) {
        if (!Array.isArray(mesh.material)) mesh.material = mesh.material.clone();
        this.taillightMeshes.push(mesh);
      } else if (nm.includes('lamp_turn_fl') || nm.includes('lamp_turn_rl')) {
        if (!Array.isArray(mesh.material)) mesh.material = mesh.material.clone();
        this.turnLeftMeshes.push(mesh);
      } else if (nm.includes('lamp_turn_fr') || nm.includes('lamp_turn_rr')) {
        if (!Array.isArray(mesh.material)) mesh.material = mesh.material.clone();
        this.turnRightMeshes.push(mesh);
      } else if (nm.includes('gauge_backlight')) {
        if (!Array.isArray(mesh.material)) mesh.material = mesh.material.clone();
        this.gaugeBacklightMeshes.push(mesh);
      }

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          const sm = m as THREE.MeshStandardMaterial;
          if (!this.originalMatMaps.has(sm)) {
            this.originalMatMaps.set(sm, sm.map || null);
            this.originalMatColors.set(sm, sm.color.clone());
          }
          sm.envMapIntensity = 1.35;
        }
      });
    });

    // Attach real Three.js Headlight SpotLight inside steeringUpper (turns with handlebars!)
    const hlWorld = new THREE.Vector3(...vehicle.rigManifest.headlightPos);
    const hlAnchor = this.steeringUpper || this.chassisRoot;
    this.root.updateMatrixWorld(true);
    const hlLocal = hlAnchor.worldToLocal(hlWorld.clone());

    this.headlightSpot = new THREE.SpotLight(0xfff1d6, 0, 52, Math.PI * 0.28, 0.55, 1.35);
    this.headlightSpot.position.copy(hlLocal);
    this.headlightTarget = new THREE.Object3D();
    this.headlightTarget.position.set(hlLocal.x, hlLocal.y - 1.2, hlLocal.z + 14);
    hlAnchor.add(this.headlightSpot);
    hlAnchor.add(this.headlightTarget);
    this.headlightSpot.target = this.headlightTarget;

    // Real Taillight + Brake Light PointLight
    const tlPos = vehicle.rigManifest.taillightPos;
    this.taillightPoint = new THREE.PointLight(0xff1414, 0, 5.5, 1.8);
    this.taillightPoint.position.set(tlPos[0], tlPos[1], tlPos[2] - 0.08);
    this.chassisRoot.add(this.taillightPoint);

    // Turn signal glow lights
    this.turnLeftPoint = new THREE.PointLight(0xff8c00, 0, 3.0, 2.0);
    this.turnLeftPoint.position.set(0.26, 0.78, 0.45);
    this.chassisRoot.add(this.turnLeftPoint);

    this.turnRightPoint = new THREE.PointLight(0xff8c00, 0, 3.0, 2.0);
    this.turnRightPoint.position.set(-0.26, 0.78, 0.45);
    this.chassisRoot.add(this.turnRightPoint);

    // 3D Mechanical Rig Inspection X-Ray Overlay
    this.rigDebugGroup = this.buildRigDebugOverlay();
    this.rigDebugGroup.visible = false;
    this.chassisRoot.add(this.rigDebugGroup);
  }

  private buildRigDebugOverlay(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'rig_debug_overlay';
    const rig = this.vehicle.rigManifest;

    const cyanMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85, depthTest: false });
    const amberMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.9, depthTest: false });
    const greenMat = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.8, depthTest: false });

    // Front & Rear Axle rods
    const axleGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.55, 12);
    axleGeom.rotateZ(Math.PI / 2);
    const fAxle = new THREE.Mesh(axleGeom, cyanMat);
    fAxle.position.set(...rig.frontAxlePos);
    const rAxle = new THREE.Mesh(axleGeom, cyanMat);
    rAxle.position.set(...rig.rearAxlePos);
    g.add(fAxle, rAxle);

    // Wheel circumference rings
    const fRing = new THREE.Mesh(
      new THREE.TorusGeometry(this.vehicle.physicsSpec.frontWheelRadiusM, 0.006, 10, 48).rotateY(Math.PI / 2),
      greenMat
    );
    fRing.position.set(...rig.frontAxlePos);
    const rRing = new THREE.Mesh(
      new THREE.TorusGeometry(this.vehicle.physicsSpec.rearWheelRadiusM, 0.006, 10, 48).rotateY(Math.PI / 2),
      greenMat
    );
    rRing.position.set(...rig.rearAxlePos);
    g.add(fRing, rRing);

    // Steering stem rake axis line
    const rakeRad = (this.vehicle.physicsSpec.rakeDeg * Math.PI) / 180;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.95, 12), amberMat);
    stem.position.set(rig.steeringHeadPos[0], rig.steeringHeadPos[1] - 0.15, rig.steeringHeadPos[2] + 0.08);
    stem.rotation.x = -rakeRad;
    g.add(stem);

    // Steering pivot sphere marker
    const headDot = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 14), amberMat);
    headDot.position.set(...rig.steeringHeadPos);
    g.add(headDot);

    return g;
  }

  public setRigDebugVisible(visible: boolean) {
    this.rigDebugGroup.visible = visible;
  }

  /**
   * Deep Modular Customizer: updates PBR clearcoat paint, livery, seat upholstery,
   * rim finish and the source headlight lens color temperature.
   */
  public applyBuildConfig(config: VehicleBuildConfig) {
    const rig = this.vehicle.rigManifest;
    const paintTargetSet = new Set(rig.paintableMaterials.map((s) => s.toLowerCase()));
    const seatTargetSet = new Set(rig.seatMaterials.map((s) => s.toLowerCase()));
    const rimTargetSet = new Set(rig.rimMaterials.map((s) => s.toLowerCase()));

    // Finish PBR properties
    const finishParams: Record<VehicleBuildConfig['paintFinish'], { metalness: number; roughness: number }> = {
      gloss: { metalness: 0.25, roughness: 0.14 },
      metallic: { metalness: 0.68, roughness: 0.19 },
      matte: { metalness: 0.12, roughness: 0.62 },
      pearl: { metalness: 0.42, roughness: 0.12 },
      brushed: { metalness: 0.88, roughness: 0.30 },
    };
    const fp = finishParams[config.paintFinish];

    const seatPalette: Record<VehicleBuildConfig['seat'], { hex: string; rough: number; quilted: boolean }> = {
      black_leather: { hex: '#141518', rough: 0.62, quilted: false },
      cognac_tan: { hex: '#6e3718', rough: 0.55, quilted: false },
      oxblood_vintage: { hex: '#4f1218', rough: 0.52, quilted: false },
      alcantara_sport: { hex: '#1d2026', rough: 0.90, quilted: false },
      diamond_cafe: { hex: '#542a12', rough: 0.56, quilted: true },
    };
    const sp = seatPalette[config.seat];

    const rimPalette: Record<VehicleBuildConfig['rim'], { hex: string | null; metal: number; rough: number }> = {
      factory: { hex: null, metal: 0.85, rough: 0.22 },
      chrome: { hex: '#eef2f6', metal: 0.98, rough: 0.06 },
      matte_black: { hex: '#181a1f', metal: 0.35, rough: 0.58 },
      brushed_gold: { hex: '#c89e3c', metal: 0.90, rough: 0.24 },
      machined_silver: { hex: '#cfd6de', metal: 0.92, rough: 0.16 },
    };
    const rp = rimPalette[config.rim];

    if (this.activeLiveryTexture) {
      this.activeLiveryTexture.dispose();
      this.activeLiveryTexture = null;
    }
    const newLiveryTex = createLiveryCanvasTexture(config.paintHex, config.livery);
    this.activeLiveryTexture = newLiveryTex;

    if (sp.quilted && !this.diamondBumpTex && typeof document !== 'undefined') {
      this.diamondBumpTex = createLeatherNormalCanvas();
    }

    // Apply material upgrades across vehicle mesh tree
    this.root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      for (const m of mats) {
        if (!m || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
        const sm = m as THREE.MeshStandardMaterial;
        const mn = sm.name.toLowerCase();

        // 1. Paintable body panels (with luminance-preserving recoloring + clearcoat reflectivity!)
        if (paintTargetSet.has(mn)) {
          const origMap = this.originalMatMaps.get(sm) ?? null;
          if (config.livery !== 'factory' && newLiveryTex && !origMap) {
            sm.map = newLiveryTex;
            sm.color.set('#ffffff');
          } else if (origMap && config.paintHex.toLowerCase() !== '#ffffff') {
            const lumTex = this.getLuminanceTexture(sm, origMap);
            sm.map = lumTex || origMap;
            sm.color.set(config.paintHex);
          } else {
            sm.map = origMap;
            sm.color.set(config.paintHex);
          }
          sm.metalness = fp.metalness;
          sm.roughness = fp.roughness;
          if ((sm as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
            const pm = sm as THREE.MeshPhysicalMaterial;
            pm.clearcoat = config.paintFinish === 'matte' ? 0.06 : 0.92;
            pm.clearcoatRoughness = config.paintFinish === 'matte' ? 0.45 : 0.08;
          }
          sm.needsUpdate = true;
        }

        // 2. Seat upholstery (independent from body paint!)
        if (seatTargetSet.has(mn) || mesh.name.toLowerCase().includes('seat_cushion')) {
          const origMap = this.originalMatMaps.get(sm) ?? null;
          if (origMap) {
            const lumTex = this.getLuminanceTexture(sm, origMap);
            sm.map = config.seat === 'black_leather' ? origMap : (lumTex || origMap);
            sm.color.set(config.seat === 'black_leather' ? '#ffffff' : sp.hex);
          } else {
            sm.color.set(sp.hex);
          }
          sm.roughness = sp.rough;
          sm.metalness = 0.04;
          sm.bumpMap = sp.quilted ? this.diamondBumpTex : null;
          sm.bumpScale = sp.quilted ? 0.015 : 0;
          sm.needsUpdate = true;
        }

        // 3. Rim finish
        if (rimTargetSet.has(mn)) {
          if (rp.hex) {
            sm.color.set(rp.hex);
          } else {
            const origCol = this.originalMatColors.get(sm);
            if (origCol) sm.color.copy(origCol);
          }
          sm.metalness = rp.metal;
          sm.roughness = rp.rough;
          sm.needsUpdate = true;
        }
      }
    });

    // 4. Headlight color temperature (affects the real SpotLight and source lens mesh).
    const hlColorMap: Record<HeadlightStyle, number> = {
      halogen_warm: 0xffe4b3,
      bi_led_halo: 0xeef6ff,
      vintage_yellow: 0xffd23f,
    };
    this.headlightColorHex = hlColorMap[config.headlight];
    this.headlightSpot.color.setHex(this.headlightColorHex);
  }

  /**
   * Synchronizes every mechanical pivot, suspension link, analog needle, and real light
   * from the live physics & mechanical interaction state!
   */
  public applyPose(
    physics: MotorcycleDynamics,
    mech: MechanicalState,
    dt: number,
    mode: 'studio' | 'ride' | 'pipeline',
    blinkOn: boolean
  ) {
    const smooth = Math.min(1, dt * 8.5);
    const rig = this.vehicle.rigManifest;
    const spec = this.vehicle.physicsSpec;

    // 1. World placement & Roll/Pitch
    if (mode === 'ride') {
      this.root.position.set(physics.x, physics.y, physics.z);
      this.root.rotation.order = 'YXZ';
      this.root.rotation.y = physics.heading;
      this.root.rotation.x = physics.pitch;
      this.root.rotation.z = -physics.visLean; // +ve lean = lean LEFT (+X) => negative rotation.z!
    } else {
      // Studio / Pipeline turntable position (y=0)
      this.root.position.set(0, 0, 0);
      this.root.rotation.order = 'YXZ';
      this.root.rotation.y = 0;
      this.root.rotation.x = 0;
      const targetStandLean = mech.kickstandDown ? (rig.parkedLeanDeg * Math.PI) / 180 : 0;
      this.root.rotation.z += (-targetStandLean - this.root.rotation.z) * smooth;
    }

    // Subtle real engine idle micro-vibration when running!
    if (mech.engineRunning) {
      const vibFreq = spec.audioProfile === 'vtwin_45' ? 32 : 52;
      const vibAmp = spec.audioProfile === 'vtwin_45' ? 0.0022 : 0.0010;
      this.vibPhase += dt * vibFreq;
      this.chassisRoot.position.y = this.baseChassisY + Math.sin(this.vibPhase) * vibAmp;
    } else {
      this.chassisRoot.position.y += (this.baseChassisY - this.chassisRoot.position.y) * smooth;
    }

    // 2. Steering Assembly around real inclined rake stem!
    if (this.steeringPivot) {
      const steerRad =
        mode === 'ride'
          ? physics.steerAngle
          : (mech.steerPreviewDeg * Math.PI) / 180;
      this.steeringPivot.rotation.order = 'XYZ';
      this.steeringPivot.rotation.x = this.baseSteeringRotX;
      this.steeringPivot.rotation.y = steerRad;
    }

    // 3. Front Telescopic / Leading-Link Suspension & Rear Swingarm Travel!
    const fTravel = (physics.frontSuspComp - 0.18) * spec.suspTravelM;
    const rTravel = (physics.rearSuspComp - 0.18) * spec.suspTravelM;
    if (this.frontSlider) {
      this.frontSlider.position.y = mode === 'ride' ? fTravel : 0;
    }
    if (this.rearSwingarmPivot) {
      // Pivoting swingarm around X lifts rear wheel cleanly over bumps!
      this.rearSwingarmPivot.rotation.x = mode === 'ride' ? -rTravel * 1.45 : 0;
    }

    // 4. True Wheel Rotation (Distance / Radius in Ride Mode; Dyno Test in Studio if toggled)
    if (mode === 'ride') {
      if (this.frontWheelPivot) this.frontWheelPivot.rotation.x = physics.frontWheelAngle;
      if (this.rearWheelPivot) this.rearWheelPivot.rotation.x = physics.rearWheelAngle;
    } else if (mech.studioWheelSpin) {
      const omega = (mech.engineRunning ? 14 : 6);
      this.studioWheelAngle += omega * dt;
      if (this.frontWheelPivot) this.frontWheelPivot.rotation.x = this.studioWheelAngle;
      if (this.rearWheelPivot) this.rearWheelPivot.rotation.x = this.studioWheelAngle;
    }

    // 5. Bike-Specific Hinged Articulations
    if (this.seatHinge) {
      // Positive X rotation tilts rear of seat UP around front hinge!
      const targetSeat = mech.seatOpen ? 1.05 : 0;
      this.curSeatAngle += (targetSeat - this.curSeatAngle) * smooth;
      this.seatHinge.rotation.x = -this.curSeatAngle;
    }

    if (this.fuelCapPivot) {
      const canOpenCap = !rig.capabilities.fuelCapUnderSeat || mech.seatOpen;
      const targetCap = mech.fuelCapOpen && canOpenCap ? 1 : 0;
      this.curFuelCapLift += (targetCap - this.curFuelCapLift) * smooth;
      if (rig.capabilities.fuelCapUnderSeat) {
        // Twist-off chrome cap lifts & spins!
        this.fuelCapPivot.position.y = (this.fuelCapPivot.userData.baseY ?? (this.fuelCapPivot.userData.baseY = this.fuelCapPivot.position.y)) + this.curFuelCapLift * 0.045;
        this.fuelCapPivot.rotation.y = this.curFuelCapLift * Math.PI * 1.5;
      } else {
        // Hinged flip-up tank cap!
        this.fuelCapPivot.rotation.x = -this.curFuelCapLift * 1.35;
      }
    }

    if (this.saddlebagLeftLid && this.saddlebagRightLid) {
      const targetBags = mech.saddlebagsOpen ? 1.25 : 0;
      this.curBagsAngle += (targetBags - this.curBagsAngle) * smooth;
      this.saddlebagLeftLid.rotation.z = this.curBagsAngle;
      this.saddlebagRightLid.rotation.z = -this.curBagsAngle;
    }

    if (this.gloveboxHinge) {
      const targetGlove = mech.gloveboxOpen ? 0.92 : 0;
      this.curGloveboxAngle += (targetGlove - this.curGloveboxAngle) * smooth;
      this.gloveboxHinge.rotation.x = -this.curGloveboxAngle;
    }

    if (this.kickstandPivot) {
      const targetKS = mech.kickstandDown ? 1 : 0;
      this.curKickstandFactor += (targetKS - this.curKickstandFactor) * smooth;
      if (rig.standType === 'center') {
        // Center stand rotates backward (-X) up neatly under engine when retracted!
        this.kickstandPivot.rotation.x = (1 - this.curKickstandFactor) * -1.35;
      } else {
        // Side stand folds back & up alongside frame when retracted!
        this.kickstandPivot.rotation.x = (1 - this.curKickstandFactor) * -1.25;
        this.kickstandPivot.rotation.z = (1 - this.curKickstandFactor) * 0.42;
      }
    }

    // Honda CG125 real mechanical linkages (shifter, brake pedal, kickstarter, analog needles!)
    if (this.gearShifterPivot) {
      const targetShifter = mech.shifterImpulse * 0.32;
      this.curShifterAngle += (targetShifter - this.curShifterAngle) * Math.min(1, dt * 20);
      this.gearShifterPivot.rotation.x = this.curShifterAngle;
    }
    if (this.brakePedalPivot) {
      const targetBp = mech.brakePedalPress * 0.34;
      this.curBrakePedalAngle += (targetBp - this.curBrakePedalAngle) * Math.min(1, dt * 16);
      this.brakePedalPivot.rotation.x = this.curBrakePedalAngle;
    }
    if (this.kickstarterPivot) {
      const targetKs = mech.kickstarterImpulse * 1.45;
      this.curKickstarterAngle += (targetKs - this.curKickstarterAngle) * Math.min(1, dt * 15);
      this.kickstarterPivot.rotation.x = this.curKickstarterAngle;
    }
    if (this.speedoNeedlePivot) {
      const speedNorm = Math.min(1, (mode === 'ride' ? Math.abs(physics.speed) * 3.6 : 0) / spec.topSpeedKmh);
      this.speedoNeedlePivot.rotation.y = -speedNorm * Math.PI * 1.25;
    }
    if (this.tachoNeedlePivot) {
      const rpmNorm = Math.min(1, physics.rpm / spec.redlineRpm);
      this.tachoNeedlePivot.rotation.y = -rpmNorm * Math.PI * 1.3;
    }

    // 6. Electrical lighting (source lamp meshes + real Three.js lights, without a fake beam mesh).
    const powerOn = mech.ignitionOn;
    const hlOn = powerOn && mech.headlightMode !== 'off';
    const isHighBeam = powerOn && mech.headlightMode === 'high';

    const hlIntensity = isHighBeam ? 95 : hlOn ? 48 : 0;
    this.headlightSpot.intensity = hlIntensity;
    this.headlightSpot.angle = isHighBeam ? Math.PI * 0.34 : Math.PI * 0.25;
    this.headlightSpot.distance = isHighBeam ? 72 : 44;
    this.headlightTarget.position.y = this.headlightSpot.position.y - (isHighBeam ? 0.5 : 1.55);

    const hlEmissive = new THREE.Color(this.headlightColorHex);
    for (const m of this.headlightMeshes) {
      const sm = m.material as THREE.MeshStandardMaterial;
      if (sm.emissive) {
        sm.emissive.copy(hlEmissive);
        sm.emissiveIntensity = isHighBeam ? 4.5 : hlOn ? 2.4 : 0;
      }
    }

    // Taillight & Brake Light
    const tailOn = powerOn && (hlOn || mech.brakeLightOn);
    const brakeBright = powerOn && mech.brakeLightOn;
    this.taillightPoint.intensity = brakeBright ? 10.5 : tailOn ? 2.6 : 0;
    for (const m of this.taillightMeshes) {
      const sm = m.material as THREE.MeshStandardMaterial;
      if (sm.emissive) {
        sm.emissive.setHex(0xff1111);
        sm.emissiveIntensity = brakeBright ? 5.2 : tailOn ? 1.5 : 0;
      }
    }

    // Turn Signals (Left / Right / Hazard)
    const leftBlink = powerOn && blinkOn && (mech.turnSignal === 'left' || mech.turnSignal === 'hazard');
    const rightBlink = powerOn && blinkOn && (mech.turnSignal === 'right' || mech.turnSignal === 'hazard');
    this.turnLeftPoint.intensity = leftBlink ? 4.2 : 0;
    this.turnRightPoint.intensity = rightBlink ? 4.2 : 0;

    for (const m of this.turnLeftMeshes) {
      const sm = m.material as THREE.MeshStandardMaterial;
      if (sm.emissive) {
        sm.emissive.setHex(0xff8c00);
        sm.emissiveIntensity = leftBlink ? 4.0 : 0;
      }
    }
    for (const m of this.turnRightMeshes) {
      const sm = m.material as THREE.MeshStandardMaterial;
      if (sm.emissive) {
        sm.emissive.setHex(0xff8c00);
        sm.emissiveIntensity = rightBlink ? 4.0 : 0;
      }
    }

    // Gauge Cluster Backlight (CG125)
    for (const m of this.gaugeBacklightMeshes) {
      const sm = m.material as THREE.MeshStandardMaterial;
      if (sm.emissive) {
        sm.emissive.setHex(0x38bdf8);
        sm.emissiveIntensity = powerOn ? 1.4 : 0;
      }
    }
  }

  public dispose() {
    this.activeLiveryTexture?.dispose();
    this.diamondBumpTex?.dispose();
    for (const tex of this.grayscaleMatMaps.values()) tex.dispose();
    this.grayscaleMatMaps.clear();
  }
}
