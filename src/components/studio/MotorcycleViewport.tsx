'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type {
  VehicleRecord,
  VehicleBuildConfig,
  MechanicalState,
  RideTelemetry,
  MechanicalActionKey,
} from '@/lib/vehicles/types';
import { MotorcycleDynamics } from '@/lib/physics/motorcyclePhysics';
import { MotorcycleAudioEngine } from '@/lib/audio/motorcycleAudio';
import { VehicleRigController } from '@/lib/three/vehicleAssembler';
import { StudioStage, buildStudioEnvMap, type StudioLightingPreset } from '@/lib/three/studioEnvironment';
import { ProvingGroundWorld, type RideTimeOfDay } from '@/lib/three/provingGround';
import { inspectAndRigThreeScene, type AnalyzedVehicleRig, type RigOverrideParams } from '@/lib/pipeline/glbRigAnalyzer';

export type StudioMode = 'studio' | 'ride' | 'pipeline';
export type StudioCameraPreset = 'hero' | 'cockpit' | 'engine' | 'front_fork' | 'rear' | 'top';
export type RideCameraMode = 'chase' | 'close' | 'cockpit' | 'orbit';

interface ProjectedHotspot {
  id: string;
  label: string;
  description: string;
  action: MechanicalActionKey;
  x: number;
  y: number;
  visible: boolean;
}

export interface MotorcycleViewportProps {
  vehicle: VehicleRecord;
  buildConfig: VehicleBuildConfig;
  mode: StudioMode;
  mechState: MechanicalState;
  studioLighting: StudioLightingPreset;
  rideTimeOfDay: RideTimeOfDay;
  cameraPreset: StudioCameraPreset;
  cameraPresetNonce: number;
  rideCameraMode: RideCameraMode;
  autoShift: boolean;
  showHotspots: boolean;
  showRigXray: boolean;
  audioMuted: boolean;
  teleportTarget: { x: number; z: number; heading: number; nonce: number } | null;
  pipelinePreviewUrl?: string | null;
  pipelineOverrides?: Partial<RigOverrideParams>;
  onHotspotAction: (action: MechanicalActionKey) => void;
  onTelemetryUpdate: (t: RideTelemetry) => void;
  onTrafficPhaseUpdate: (phase: 'green' | 'amber' | 'red') => void;
  onMechPatch: (patch: Partial<MechanicalState>) => void;
  onRigAnalyzed?: (report: AnalyzedVehicleRig) => void;
  onRideCameraCycle?: () => void;
  onEngineToggleKey?: () => void;
  onKickstandToggleKey?: () => void;
  onHeadlightCycleKey?: () => void;
  onLoadingChange?: (loading: boolean, progress: number) => void;
}

const STUDIO_CAMERAS: Record<StudioCameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  hero: { pos: [2.45, 1.38, 2.35], target: [0, 0.62, 0.05] },
  cockpit: { pos: [0.02, 1.36, -0.45], target: [0, 0.96, 0.65] },
  engine: { pos: [1.35, 0.58, -0.05], target: [0, 0.48, -0.05] },
  front_fork: { pos: [1.15, 0.72, 1.38], target: [0, 0.55, 0.72] },
  rear: { pos: [-1.55, 0.92, -1.75], target: [0, 0.52, -0.45] },
  top: { pos: [0.05, 3.25, 0.2], target: [0, 0.5, 0] },
};

export function MotorcycleViewport(props: MotorcycleViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hotspots, setHotspots] = useState<ProjectedHotspot[]>([]);
  const [hoveredHotspotId, setHoveredHotspotId] = useState<string | null>(null);

  // Latest prop refs for the zero-stale-closure animation loop
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);
  const modelVehicleId = props.vehicle.id;
  const modelUrl = props.vehicle.modelUrl;
  const pipelinePreviewUrl = props.pipelinePreviewUrl;
  const isPipelineMode = props.mode === 'pipeline';
  const pipelineOverrides = props.pipelineOverrides;
  const teleportTarget = props.teleportTarget;

  // Engine refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const studioStageRef = useRef<StudioStage | null>(null);
  const provingGroundRef = useRef<ProvingGroundWorld | null>(null);
  const vehicleRigRef = useRef<VehicleRigController | null>(null);
  const physicsRef = useRef<MotorcycleDynamics | null>(null);
  const audioRef = useRef<MotorcycleAudioEngine | null>(null);
  const envMapRef = useRef<THREE.Texture | null>(null);

  // Camera transition target for smooth Studio preset gliding
  const camLerpRef = useRef<{ active: boolean; pos: THREE.Vector3; target: THREE.Vector3 }>({
    active: false,
    pos: new THREE.Vector3(),
    target: new THREE.Vector3(),
  });

  // Live keyboard state
  const keysRef = useRef<Record<string, boolean>>({});
  const shiftQueuedRef = useRef<{ up: boolean; down: boolean }>({ up: false, down: false });

  // One-time WebGL + Scene + Studio + ProvingGround + Audio Initialization
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.08, 450);
    camera.position.set(2.45, 1.38, 2.35);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.minDistance = 0.38; // Macro close-up zoom!
    controls.maxDistance = 12.0;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.set(0, 0.62, 0.05);
    controls.addEventListener('start', () => {
      camLerpRef.current.active = false;
    });
    controlsRef.current = controls;

    // Build Studio Stage & Proving Ground World
    const studioStage = new StudioStage();
    scene.add(studioStage.group);
    studioStageRef.current = studioStage;

    const pg = new ProvingGroundWorld();
    pg.group.visible = false;
    scene.add(pg.group);
    provingGroundRef.current = pg;

    // Initial PMREM Studio environment map
    const env = buildStudioEnvMap(renderer, propsRef.current.studioLighting);
    scene.environment = env;
    envMapRef.current = env;
    studioStage.applyPreset(propsRef.current.studioLighting, scene);

    // Physics & Audio engines
    const phys = new MotorcycleDynamics(propsRef.current.vehicle.physicsSpec, propsRef.current.vehicle.rigManifest);
    physicsRef.current = phys;

    const audio = new MotorcycleAudioEngine();
    audio.setProfile(propsRef.current.vehicle.physicsSpec.audioProfile);
    audio.setMuted(propsRef.current.audioMuted);
    audioRef.current = audio;

    // Keyboard controls for riding & mechanical interactions
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const code = e.code;
      keysRef.current[code] = true;
      audio.ensure();

      if (e.repeat) return;
      if (code === 'KeyE' && propsRef.current.mode === 'ride') {
        shiftQueuedRef.current.up = true;
      } else if (code === 'KeyQ' && propsRef.current.mode === 'ride') {
        shiftQueuedRef.current.down = true;
      } else if (code === 'KeyC' && propsRef.current.mode === 'ride') {
        propsRef.current.onRideCameraCycle?.();
      } else if (code === 'KeyK') {
        propsRef.current.onKickstandToggleKey?.();
      } else if (code === 'KeyL') {
        propsRef.current.onHeadlightCycleKey?.();
      } else if (code === 'KeyI' || (code === 'KeyE' && propsRef.current.mode !== 'ride')) {
        propsRef.current.onEngineToggleKey?.();
      } else if (code === 'KeyH') {
        propsRef.current.onMechPatch({ hornActive: true });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
      if (e.code === 'KeyH') {
        propsRef.current.onMechPatch({ hornActive: false });
      }
    };

    const onResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);

    // Master 60fps Animation Loop
    let rafId = 0;
    let lastTime = performance.now();
    let blinkAccum = 0;
    let blinkState = false;
    let hudAccum = 0;
    let hotspotAccum = 0;
    const chaseCamPos = new THREE.Vector3();
    const chaseCamTarget = new THREE.Vector3();
    const tmpVec = new THREE.Vector3();

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const p = propsRef.current;
      const rig = vehicleRigRef.current;
      const dynamics = physicsRef.current;
      const world = provingGroundRef.current;
      const cam = cameraRef.current;
      const ctrl = controlsRef.current;
      if (!cam || !ctrl || !dynamics || !world) return;

      // 1.5 Hz Automotive Turn-Signal Relay + audio tick-tock
      blinkAccum += dt;
      if (blinkAccum >= 0.42) {
        blinkAccum = 0;
        blinkState = !blinkState;
        if (p.mechState.ignitionOn && p.mechState.turnSignal !== 'off') {
          audio.playSignalTick(blinkState);
        }
      }

      const k = keysRef.current;
      const inRide = p.mode === 'ride';

      // Gather inputs
      const keyThrottle = (k['KeyW'] || k['ArrowUp']) ? 1 : 0;
      const keyFrontBrake = (k['KeyS'] || k['ArrowDown']) ? 1 : 0;
      const keyRearBrake = k['Space'] ? 1 : 0;
      const keySteer = ((k['KeyA'] || k['ArrowLeft']) ? 1 : 0) - ((k['KeyD'] || k['ArrowRight']) ? 1 : 0);
      const keyHorn = !!k['KeyH'] || p.mechState.hornActive;

      const throttle = inRide ? Math.max(keyThrottle, p.mechState.throttleGrip) : p.mechState.throttleGrip;
      const frontBrake = inRide ? keyFrontBrake : 0;
      const rearBrake = inRide ? keyRearBrake : p.mechState.brakePedalPress;

      // Update Traffic Light in Proving Ground
      if (inRide) {
        world.updateTrafficLight(dt);
      }

      // Step Motorcycle Dynamics Engine!
      const telemetry = dynamics.step(
        {
          throttle,
          frontBrake,
          rearBrake,
          steer: inRide ? keySteer : 0,
          shiftUp: shiftQueuedRef.current.up,
          shiftDown: shiftQueuedRef.current.down,
          clutch: !!k['ShiftLeft'] || !!k['ShiftRight'],
          autoShift: p.autoShift,
          engineRunning: p.mechState.engineRunning,
          kickstandDown: p.mechState.kickstandDown,
        },
        dt,
        (x, z) => (inRide ? world.sampleTerrain(x, z) : { height: 0, surface: 'asphalt', gripMultiplier: 1, dragMultiplier: 1 })
      );
      shiftQueuedRef.current.up = false;
      shiftQueuedRef.current.down = false;

      if (dynamics.lastShiftDir !== 0) {
        audio.playShiftClunk();
      }

      // Effective live mechanical state (brake light illuminates automatically on front/rear brake!)
      const liveMech: MechanicalState = {
        ...p.mechState,
        brakeLightOn: p.mechState.brakeLightOn || frontBrake > 0.08 || rearBrake > 0.08,
        brakePedalPress: Math.max(p.mechState.brakePedalPress, rearBrake),
        shifterImpulse: dynamics.lastShiftDir !== 0 ? dynamics.lastShiftDir : p.mechState.shifterImpulse * Math.max(0, 1 - dt * 10),
        kickstarterImpulse: p.mechState.kickstarterImpulse,
      };

      // Update 3D Rig Pose, Suspension, Wheels, Needles & Real Lights!
      if (rig) {
        rig.applyPose(dynamics, liveMech, dt, p.mode, blinkState);
      }

      // Update Proving Ground sun shadow frustum around bike
      if (inRide) {
        world.updateSunTarget(dynamics.x, dynamics.z);
      }

      // Update Granular Combustion Audio
      audio.update({
        engineRunning: p.mechState.engineRunning,
        rpm: dynamics.rpm,
        redlineRpm: p.vehicle.physicsSpec.redlineRpm,
        throttle,
        speedKmh: telemetry.speedKmh,
        slipRatio: telemetry.slipRatio,
        hornActive: keyHorn && p.mechState.ignitionOn,
        shiftCut: dynamics.shiftCutTimer > 0,
      });

      // Camera Controller
      if (inRide && rig) {
        const sinH = Math.sin(dynamics.heading);
        const cosH = Math.cos(dynamics.heading);
        const camMode = p.rideCameraMode;

        if (camMode === 'orbit') {
          ctrl.enabled = true;
          ctrl.target.set(dynamics.x, dynamics.y + 0.72, dynamics.z);
          ctrl.update();
        } else if (camMode === 'cockpit') {
          ctrl.enabled = false;
          // True First-Person Cockpit Camera looking over real handlebars & speedometer!
          const cp = p.vehicle.rigManifest.cockpitCamPos;
          const cl = p.vehicle.rigManifest.cockpitCamLook;
          const worldEye = new THREE.Vector3(...cp).applyMatrix4(rig.root.matrixWorld);
          const worldLook = new THREE.Vector3(...cl).applyMatrix4(rig.root.matrixWorld);
          cam.position.lerp(worldEye, Math.min(1, dt * 18));
          cam.lookAt(worldLook);
        } else {
          ctrl.enabled = false;
          const dist = camMode === 'close' ? 2.55 : 4.25;
          const height = camMode === 'close' ? 1.28 : 1.72;
          const speedPullback = Math.min(1.1, telemetry.speedKmh / 140);
          const d = dist + speedPullback;
          chaseCamPos.set(
            dynamics.x - sinH * d + Math.sin(dynamics.visLean) * 0.45,
            dynamics.y + height,
            dynamics.z - cosH * d
          );
          chaseCamTarget.set(
            dynamics.x + sinH * 3.2,
            dynamics.y + 0.85,
            dynamics.z + cosH * 3.2
          );
          cam.position.lerp(chaseCamPos, Math.min(1, dt * 7.5));
          cam.lookAt(chaseCamTarget);
        }
      } else {
        // Studio / Pipeline Orbit Camera + smooth preset glide
        ctrl.enabled = true;
        if (camLerpRef.current.active) {
          cam.position.lerp(camLerpRef.current.pos, Math.min(1, dt * 6.5));
          ctrl.target.lerp(camLerpRef.current.target, Math.min(1, dt * 6.5));
          if (cam.position.distanceTo(camLerpRef.current.pos) < 0.025) {
            camLerpRef.current.active = false;
          }
        }
        ctrl.update();
      }

      renderer.render(scene, cam);

      // Throttled HUD Telemetry callback (~20 Hz for silky React rendering)
      hudAccum += dt;
      if (hudAccum >= 0.05) {
        hudAccum = 0;
        p.onTelemetryUpdate(telemetry);
        if (inRide) p.onTrafficPhaseUpdate(world.trafficPhase);
      }

      // Throttled 3D Hotspot Projection (~30 Hz in Studio mode)
      hotspotAccum += dt;
      if (hotspotAccum >= 0.033) {
        hotspotAccum = 0;
        if (p.mode === 'studio' && p.showHotspots && rig) {
          const w = container.clientWidth;
          const h = container.clientHeight;
          const projected: ProjectedHotspot[] = p.vehicle.rigManifest.hotspots.map((hs) => {
            tmpVec.set(hs.position[0], hs.position[1], hs.position[2]).applyMatrix4(rig.root.matrixWorld);
            tmpVec.project(cam);
            const isFront = tmpVec.z >= -1 && tmpVec.z <= 1;
            return {
              id: hs.id,
              label: hs.label,
              description: hs.description,
              action: hs.action,
              x: (tmpVec.x * 0.5 + 0.5) * w,
              y: (-tmpVec.y * 0.5 + 0.5) * h,
              visible: isFront,
            };
          });
          setHotspots(projected);
        } else {
          setHotspots((prev) => (prev.length > 0 ? [] : prev));
        }
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      envMapRef.current?.dispose();
      vehicleRigRef.current?.dispose();
      audio.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Load & Assemble Active Vehicle GLB (or Custom Pipeline GLB Preview!)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    let cancelled = false;

    const targetUrl = isPipelineMode && pipelinePreviewUrl ? pipelinePreviewUrl : modelUrl;
    propsRef.current.onLoadingChange?.(true, 10);

    const loader = new GLTFLoader();
    loader.load(
      targetUrl,
      (gltf) => {
        if (cancelled) return;
        // Remove previous vehicle
        if (vehicleRigRef.current) {
          scene.remove(vehicleRigRef.current.root);
          vehicleRigRef.current.dispose();
          vehicleRigRef.current = null;
        }

        // Run universal Rig Analyzer / Automatic Decomposer!
        const { riggedRoot, report } = inspectAndRigThreeScene(
          gltf.scene,
          isPipelineMode ? pipelineOverrides : undefined
        );
        propsRef.current.onRigAnalyzed?.(report);

        const rigCtrl = new VehicleRigController(riggedRoot, propsRef.current.vehicle);
        rigCtrl.applyBuildConfig(propsRef.current.buildConfig);
        rigCtrl.setRigDebugVisible(propsRef.current.showRigXray || propsRef.current.mode === 'pipeline');

        scene.add(rigCtrl.root);
        vehicleRigRef.current = rigCtrl;

        // Sync physics & audio to new vehicle
        physicsRef.current?.updateSpec(propsRef.current.vehicle.physicsSpec, propsRef.current.vehicle.rigManifest);
        if (propsRef.current.mode !== 'ride') {
          physicsRef.current?.reset(0, 0, 0, 0);
        }
        audioRef.current?.setProfile(propsRef.current.vehicle.physicsSpec.audioProfile);
        propsRef.current.onLoadingChange?.(false, 100);
      },
      (xhr) => {
        if (xhr.total > 0) {
          propsRef.current.onLoadingChange?.(true, Math.min(95, Math.round((xhr.loaded / xhr.total) * 100)));
        }
      },
      (err) => {
        console.error('GLTFLoader failed:', targetUrl, err);
        propsRef.current.onLoadingChange?.(false, 0);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [modelVehicleId, modelUrl, pipelinePreviewUrl, isPipelineMode, pipelineOverrides]);

  // Apply Live Customizer Changes WITHOUT reloading the 3D model!
  useEffect(() => {
    vehicleRigRef.current?.applyBuildConfig(props.buildConfig);
    audioRef.current?.setProfile(props.vehicle.physicsSpec.audioProfile);
  }, [props.buildConfig, props.vehicle.physicsSpec.audioProfile]);

  // Switch seamlessly between Studio Atelier <-> Proving Ground World!
  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const stage = studioStageRef.current;
    const pg = provingGroundRef.current;
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    const phys = physicsRef.current;
    const currentProps = propsRef.current;
    if (!scene || !renderer || !stage || !pg || !cam || !ctrl || !phys) return;

    if (currentProps.mode === 'ride') {
      stage.group.visible = false;
      pg.group.visible = true;
      pg.applyTimeOfDay(currentProps.rideTimeOfDay, scene);
      // Spawn cleanly on main boulevard facing north (+Z) toward the Traffic Light Intersection!
      const gy = pg.sampleTerrain(0, -10).height;
      phys.reset(0, -10, 0, gy);
      phys.resetSessionStats();
      cam.position.set(0, gy + 1.85, -14.8);
      cam.lookAt(0, gy + 0.9, -4);
      ctrl.maxDistance = 24;
    } else {
      stage.group.visible = true;
      pg.group.visible = false;
      stage.applyPreset(currentProps.studioLighting, scene);
      phys.reset(0, 0, 0, 0);
      ctrl.maxDistance = 12;
      const preset = STUDIO_CAMERAS[currentProps.cameraPreset] || STUDIO_CAMERAS.hero;
      camLerpRef.current = {
        active: true,
        pos: new THREE.Vector3(...preset.pos),
        target: new THREE.Vector3(...preset.target),
      };
    }

    vehicleRigRef.current?.setRigDebugVisible(currentProps.showRigXray || currentProps.mode === 'pipeline');
  }, [props.mode]);

  // Update Studio Lighting & PMREM reflections
  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const stage = studioStageRef.current;
    if (!scene || !renderer || !stage) return;

    if (props.mode !== 'ride') {
      stage.applyPreset(props.studioLighting, scene);
      const nextEnv = buildStudioEnvMap(renderer, props.studioLighting);
      envMapRef.current?.dispose();
      scene.environment = nextEnv;
      envMapRef.current = nextEnv;
    }
  }, [props.studioLighting, props.mode]);

  // Update Proving Ground Time of Day
  useEffect(() => {
    const scene = sceneRef.current;
    const pg = provingGroundRef.current;
    if (!scene || !pg || props.mode !== 'ride') return;
    pg.applyTimeOfDay(props.rideTimeOfDay, scene);
  }, [props.rideTimeOfDay, props.mode]);

  // Trigger Studio Focus Camera Glide
  useEffect(() => {
    if (props.mode === 'ride') return;
    const preset = STUDIO_CAMERAS[props.cameraPreset];
    if (!preset) return;
    camLerpRef.current = {
      active: true,
      pos: new THREE.Vector3(...preset.pos),
      target: new THREE.Vector3(...preset.target),
    };
  }, [props.cameraPreset, props.cameraPresetNonce, props.mode]);

  // Toggle X-Ray Mechanical Rig Overlay
  useEffect(() => {
    vehicleRigRef.current?.setRigDebugVisible(props.showRigXray || props.mode === 'pipeline');
  }, [props.showRigXray, props.mode]);

  // Sync Audio Mute & One-shot Mechanical Sound Effects
  useEffect(() => {
    audioRef.current?.setMuted(props.audioMuted);
  }, [props.audioMuted]);

  const prevMechRef = useRef(props.mechState);
  useEffect(() => {
    const prev = prevMechRef.current;
    const cur = props.mechState;
    const audio = audioRef.current;
    if (audio) {
      if (prev.ignitionOn !== cur.ignitionOn) audio.playIgnitionClick();
      if (!prev.starterCranking && cur.starterCranking) audio.playStarterCrank(false);
      if (prev.kickstarterImpulse < 0.5 && cur.kickstarterImpulse >= 0.5) audio.playStarterCrank(true);
      if (
        prev.seatOpen !== cur.seatOpen ||
        prev.fuelCapOpen !== cur.fuelCapOpen ||
        prev.saddlebagsOpen !== cur.saddlebagsOpen ||
        prev.gloveboxOpen !== cur.gloveboxOpen ||
        prev.kickstandDown !== cur.kickstandDown
      ) {
        audio.playMechanicalLatch();
      }
    }
    prevMechRef.current = cur;
  }, [props.mechState]);

  // Teleport bike to Proving Ground landmarks (Red Light, Speed Bumps, Slalom, Coastal Hill!)
  useEffect(() => {
    const currentTarget = propsRef.current.teleportTarget;
    if (!currentTarget || propsRef.current.mode !== 'ride') return;
    const pg = provingGroundRef.current;
    const phys = physicsRef.current;
    if (!pg || !phys) return;
    const gy = pg.sampleTerrain(currentTarget.x, currentTarget.z).height;
    phys.reset(currentTarget.x, currentTarget.z, currentTarget.heading, gy);
  }, [teleportTarget, props.mode]);

  return (
    <div className="relative h-full w-full overflow-hidden select-none">
      <div ref={containerRef} className="h-full w-full cursor-grab active:cursor-grabbing" />

      {/* Direct Interactive 3D Mechanical Hotspots in Studio Mode */}
      {props.mode === 'studio' && props.showHotspots && hotspots.map((hs) => (
        hs.visible && (
          <div
            key={hs.id}
            style={{ transform: `translate3d(${hs.x}px, ${hs.y}px, 0)` }}
            className="pointer-events-auto absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 z-10"
            onMouseEnter={() => setHoveredHotspotId(hs.id)}
            onMouseLeave={() => setHoveredHotspotId(null)}
          >
            <button
              type="button"
              onClick={() => props.onHotspotAction(hs.action)}
              className="group relative flex h-7 w-7 items-center justify-center rounded-full border border-amber-300/80 bg-[#0b0e14]/80 text-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.45)] backdrop-blur-md transition-transform hover:scale-125 hover:bg-amber-400 hover:text-slate-950"
              title={hs.label}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              <span className="absolute inset-0 animate-ping rounded-full border border-amber-400/50 opacity-50" />
            </button>
            {hoveredHotspotId === hs.id && (
              <div className="pointer-events-none absolute left-1/2 top-9 w-56 -translate-x-1/2 rounded-xl border border-white/15 bg-[#0b0f17]/92 px-3 py-2 text-left shadow-2xl backdrop-blur-xl">
                <div className="text-xs font-semibold tracking-wide text-amber-300">{hs.label}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-slate-300">{hs.description}</div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-sky-400">Nhấn để thao tác cơ cấu</div>
              </div>
            )}
          </div>
        )
      ))}
    </div>
  );
}
