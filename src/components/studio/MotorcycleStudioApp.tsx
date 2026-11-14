'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Eye,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Sunset,
  Layers,
  Crosshair,
  Sparkles,
  Play,
  Cpu,
  Camera,
  Loader2,
} from 'lucide-react';
import type {
  VehicleRecord,
  VehicleBuildConfig,
  CustomBuildRecord,
  MechanicalState,
  MechanicalActionKey,
  RideTelemetry,
} from '@/lib/vehicles/types';
import type { StudioLightingPreset } from '@/lib/three/studioEnvironment';
import type { RideTimeOfDay } from '@/lib/three/provingGround';
import type { AnalyzedVehicleRig, RigOverrideParams } from '@/lib/pipeline/glbRigAnalyzer';
import {
  MotorcycleViewport,
  type StudioMode,
  type StudioCameraPreset,
  type RideCameraMode,
} from './MotorcycleViewport';
import { MechanicalDock } from './MechanicalDock';
import { ConfiguratorDrawer } from './ConfiguratorDrawer';
import { RideTelemetryHUD } from './RideTelemetryHUD';
import { GarageDrawer, type RideSessionRow } from './GarageDrawer';
import { PipelineWorkshop } from './PipelineWorkshop';

interface MotorcycleStudioAppProps {
  initialVehicles: VehicleRecord[];
  initialBuilds: CustomBuildRecord[];
  initialSessions: RideSessionRow[];
  unavailableVehicleNames: string[];
}

const DEFAULT_MECH: MechanicalState = {
  ignitionOn: true,
  engineRunning: false,
  starterCranking: false,
  headlightMode: 'low',
  turnSignal: 'off',
  brakeLightOn: false,
  hornActive: false,
  kickstandDown: true,
  seatOpen: false,
  fuelCapOpen: false,
  saddlebagsOpen: false,
  gloveboxOpen: false,
  kickstarterImpulse: 0,
  shifterImpulse: 0,
  brakePedalPress: 0,
  throttleGrip: 0,
  steerPreviewDeg: 0,
  studioWheelSpin: false,
};

const DEFAULT_TELEMETRY: RideTelemetry = {
  speedKmh: 0,
  rpm: 0,
  gear: 0,
  gearLabel: 'N',
  leanDeg: 0,
  steerDeg: 0,
  pitchDeg: 0,
  throttle: 0,
  frontBrake: 0,
  rearBrake: 0,
  frontSuspCompression: 0.18,
  rearSuspCompression: 0.18,
  slipRatio: 0,
  distanceMeters: 0,
  topSpeedKmh: 0,
  maxLeanDeg: 0,
  onRoad: true,
  warningMessage: null,
};

const CAMERA_PRESETS: { key: StudioCameraPreset; label: string }[] = [
  { key: 'hero', label: 'Toàn cảnh 3/4' },
  { key: 'cockpit', label: 'Buồng lái' },
  { key: 'engine', label: 'Động cơ' },
  { key: 'front_fork', label: 'Phuộc & Bánh' },
  { key: 'rear', label: 'Đuôi & Pô' },
  { key: 'top', label: 'Góc trên' },
];

export function MotorcycleStudioApp({
  initialVehicles,
  initialBuilds,
  initialSessions,
  unavailableVehicleNames,
}: MotorcycleStudioAppProps) {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>(initialVehicles);
  const [activeVehicleId, setActiveVehicleId] = useState<string>(initialVehicles[0]?.id || 'super-cub-c90');
  const [builds, setBuilds] = useState<CustomBuildRecord[]>(initialBuilds);
  const [sessions, setSessions] = useState<RideSessionRow[]>(initialSessions);

  const activeVehicle = useMemo(
    () => vehicles.find((v) => v.id === activeVehicleId) || vehicles[0],
    [vehicles, activeVehicleId]
  );

  const [buildConfig, setBuildConfig] = useState<VehicleBuildConfig>(activeVehicle.defaultBuild);
  const [activeBuildId, setActiveBuildId] = useState<number | null>(null);
  const [mode, setMode] = useState<StudioMode>('studio');
  const [mech, setMech] = useState<MechanicalState>(DEFAULT_MECH);
  const [telemetry, setTelemetry] = useState<RideTelemetry>(DEFAULT_TELEMETRY);
  const [trafficPhase, setTrafficPhase] = useState<'green' | 'amber' | 'red'>('red');

  // Visual / Studio UI state
  const [studioLighting, setStudioLighting] = useState<StudioLightingPreset>('atelier');
  const [rideTimeOfDay, setRideTimeOfDay] = useState<RideTimeOfDay>('dusk');
  const [cameraPreset, setCameraPreset] = useState<StudioCameraPreset>('hero');
  const [cameraPresetNonce, setCameraPresetNonce] = useState(0);
  const [rideCameraMode, setRideCameraMode] = useState<RideCameraMode>('chase');
  const [autoShift, setAutoShift] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showRigXray, setShowRigXray] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [garageOpen, setGarageOpen] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState<{ loading: boolean; progress: number }>({ loading: true, progress: 15 });

  // Proving Ground Teleport & Ride timer
  const [teleportTarget, setTeleportTarget] = useState<{ x: number; z: number; heading: number; nonce: number } | null>(null);
  const rideStartTimeRef = useRef<number>(0);

  // Pipeline state
  const [rigReport, setRigReport] = useState<AnalyzedVehicleRig | null>(null);
  const [pipelinePreviewUrl, setPipelinePreviewUrl] = useState<string | null>(null);
  const [pipelineOverrides, setPipelineOverrides] = useState<Partial<RigOverrideParams>>({});

  // Toast notification
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2800);
  }, []);

  const vehicleBuilds = useMemo(
    () => builds.filter((b) => b.vehicleId === activeVehicle.id),
    [builds, activeVehicle.id]
  );

  // Switch vehicle cleanly
  const handleSelectVehicle = useCallback((v: VehicleRecord) => {
    setActiveVehicleId(v.id);
    setBuildConfig(v.defaultBuild);
    setActiveBuildId(null);
    setMech({
      ...DEFAULT_MECH,
      ignitionOn: true,
      headlightMode: 'low',
      kickstandDown: mode !== 'ride',
      engineRunning: mode === 'ride',
    });
    setCameraPreset('hero');
    setCameraPresetNonce((n) => n + 1);
  }, [mode]);

  const handlePatchMech = useCallback((patch: Partial<MechanicalState>) => {
    setMech((prev) => ({ ...prev, ...patch }));
  }, []);

  // Authentic Mechanical Action Dispatcher
  const handleMechanicalAction = useCallback(
    (action: MechanicalActionKey) => {
      const cap = activeVehicle.rigManifest.capabilities;
      setMech((prev) => {
        switch (action) {
          case 'ignition': {
            const nextIgn = !prev.ignitionOn;
            return {
              ...prev,
              ignitionOn: nextIgn,
              engineRunning: nextIgn ? prev.engineRunning : false,
              headlightMode: nextIgn ? prev.headlightMode : 'off',
              turnSignal: nextIgn ? prev.turnSignal : 'off',
            };
          }
          case 'starter': {
            if (prev.engineRunning) {
              return { ...prev, engineRunning: false, starterCranking: false };
            }
            // Start cranking sequence -> fires engine after 520ms!
            setTimeout(() => {
              setMech((cur) => ({ ...cur, starterCranking: false, engineRunning: true, ignitionOn: true }));
            }, 520);
            return { ...prev, ignitionOn: true, starterCranking: true };
          }
          case 'kickstarter': {
            // Physical kickstarter swing animation + fires engine!
            setTimeout(() => {
              setMech((cur) => ({ ...cur, kickstarterImpulse: 0, engineRunning: true, ignitionOn: true }));
            }, 380);
            return { ...prev, ignitionOn: true, kickstarterImpulse: 1 };
          }
          case 'headlight': {
            if (!prev.ignitionOn) {
              showToast('Hãy bật khóa điện trước khi bật đèn!');
              return { ...prev, ignitionOn: true, headlightMode: 'low' };
            }
            const next = prev.headlightMode === 'off' ? 'low' : prev.headlightMode === 'low' ? 'high' : 'off';
            return { ...prev, headlightMode: next };
          }
          case 'turnLeft':
            return { ...prev, ignitionOn: true, turnSignal: prev.turnSignal === 'left' ? 'off' : 'left' };
          case 'turnRight':
            return { ...prev, ignitionOn: true, turnSignal: prev.turnSignal === 'right' ? 'off' : 'right' };
          case 'hazard':
            return { ...prev, ignitionOn: true, turnSignal: prev.turnSignal === 'hazard' ? 'off' : 'hazard' };
          case 'horn':
            return { ...prev, hornActive: !prev.hornActive };
          case 'kickstand':
            return { ...prev, kickstandDown: !prev.kickstandDown };
          case 'seat': {
            if (!cap.hasHingedSeat) return prev;
            const nextOpen = !prev.seatOpen;
            if (nextOpen) {
              showToast(`Đã mở yên: ${cap.seatCompartmentLabel}`);
            }
            return {
              ...prev,
              seatOpen: nextOpen,
              fuelCapOpen: !nextOpen && cap.fuelCapUnderSeat ? false : prev.fuelCapOpen,
            };
          }
          case 'fuelCap': {
            if (!cap.hasFuelCap) return prev;
            const nextOpen = !prev.fuelCapOpen;
            // On models with an under-seat cap, open the seat first so the cap is reachable.
            return {
              ...prev,
              seatOpen: cap.fuelCapUnderSeat && nextOpen ? true : prev.seatOpen,
              fuelCapOpen: nextOpen,
            };
          }
          case 'saddlebags':
            if (!cap.hasSaddlebags) return prev;
            return { ...prev, saddlebagsOpen: !prev.saddlebagsOpen };
          case 'glovebox':
            if (!cap.hasGlovebox) return prev;
            return { ...prev, gloveboxOpen: !prev.gloveboxOpen };
          default:
            return prev;
        }
      });
    },
    [activeVehicle, showToast]
  );

  // Seamless Studio <-> Test Ride <-> Pipeline Mode Transition
  const handleModeChange = useCallback(
    (nextMode: StudioMode) => {
      setMode(nextMode);
      if (nextMode === 'ride') {
        rideStartTimeRef.current = Date.now();
        // Prepare bike ready to roll on the proving ground (close seat/bags, retract kickstand, start engine!)
        setMech((prev) => ({
          ...prev,
          ignitionOn: true,
          engineRunning: true,
          kickstandDown: false,
          seatOpen: false,
          fuelCapOpen: false,
          saddlebagsOpen: false,
          gloveboxOpen: false,
          studioWheelSpin: false,
          steerPreviewDeg: 0,
        }));
        showToast(`Chế độ Chạy Thử 3D: ${activeVehicle.name} — Nhấn W để vặn ga!`);
      } else if (nextMode === 'studio') {
        setMech((prev) => ({
          ...prev,
          kickstandDown: true,
          throttleGrip: 0,
        }));
      }
    },
    [activeVehicle.name, showToast]
  );

  // Save / Load / Delete Custom Builds in PostgreSQL
  const handleSaveBuild = async (name: string, notes: string) => {
    const res = await fetch('/api/builds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicleId: activeVehicle.id,
        name,
        notes,
        config: buildConfig,
      }),
    });
    const data = await res.json();
    if (res.ok && data.build) {
      setBuilds((prev) => [data.build, ...prev]);
      setActiveBuildId(data.build.id);
      showToast(`Đã lưu bản độ "${data.build.name}" vào PostgreSQL!`);
    }
  };

  const handleLoadBuild = (b: CustomBuildRecord) => {
    setBuildConfig(b.config);
    setActiveBuildId(b.id);
    showToast(`Đã áp dụng cấu hình "${b.name}"`);
  };

  const handleDeleteBuild = async (id: number) => {
    const res = await fetch(`/api/builds/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setBuilds((prev) => prev.filter((b) => b.id !== id));
      if (activeBuildId === id) setActiveBuildId(null);
      showToast('Đã xóa bản độ khỏi Garage');
    }
  };

  const handleSaveSession = async () => {
    const durationSec = Math.max(1, (Date.now() - rideStartTimeRef.current) / 1000);
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicleId: activeVehicle.id,
        buildId: activeBuildId,
        topSpeedKmh: telemetry.topSpeedKmh,
        maxLeanDeg: telemetry.maxLeanDeg,
        distanceMeters: telemetry.distanceMeters,
        durationSec,
      }),
    });
    const data = await res.json();
    if (res.ok && data.session) {
      setSessions((prev) => [data.session, ...prev]);
      showToast(`Đã lưu kỷ lục: ${Math.round(telemetry.topSpeedKmh)} km/h • Nghiêng ${telemetry.maxLeanDeg.toFixed(1)}°`);
    }
  };

  const handleRegisteredVehicle = (v: VehicleRecord) => {
    setVehicles((prev) => {
      const exists = prev.some((item) => item.id === v.id);
      return exists ? prev.map((item) => (item.id === v.id ? v : item)) : [...prev, v];
    });
    setPipelinePreviewUrl(null);
    setPipelineOverrides({});
    handleSelectVehicle(v);
    setMode('studio');
  };

  const handleDeleteCustomVehicle = async (id: string) => {
    const res = await fetch(`/api/vehicles/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setVehicles((prev) => prev.filter((v) => v.id !== id));
      if (activeVehicleId === id && vehicles[0]) {
        handleSelectVehicle(vehicles[0]);
      }
      showToast('Đã xóa xe nhập tùy chỉnh');
    }
  };

  const cycleRideCamera = useCallback(() => {
    setRideCameraMode((prev) =>
      prev === 'chase' ? 'close' : prev === 'close' ? 'cockpit' : prev === 'cockpit' ? 'orbit' : 'chase'
    );
  }, []);

  // Prevent spacebar scrolling the viewport
  useEffect(() => {
    const stopSpace = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', stopSpace);
    return () => window.removeEventListener('keydown', stopSpace);
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#090c12] text-slate-100">
      {unavailableVehicleNames.length > 0 && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-4 left-4 z-40 max-w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-amber-300/25 bg-[#0a0e16]/90 px-3 py-2 text-[10px] leading-relaxed text-amber-100/85 shadow-xl backdrop-blur-xl"
        >
          Thiếu GLB nguồn gốc: {unavailableVehicleNames.join(', ')}. Mẫu này được ẩn; không dùng model thay thế.
        </div>
      )}

      {/* FULL-BLEED 3D WEBGL VIEWPORT */}
      <MotorcycleViewport
        vehicle={activeVehicle}
        buildConfig={buildConfig}
        mode={mode}
        mechState={mech}
        studioLighting={studioLighting}
        rideTimeOfDay={rideTimeOfDay}
        cameraPreset={cameraPreset}
        cameraPresetNonce={cameraPresetNonce}
        rideCameraMode={rideCameraMode}
        autoShift={autoShift}
        showHotspots={showHotspots}
        showRigXray={showRigXray}
        audioMuted={audioMuted}
        teleportTarget={teleportTarget}
        pipelinePreviewUrl={pipelinePreviewUrl}
        pipelineOverrides={pipelineOverrides}
        onHotspotAction={handleMechanicalAction}
        onTelemetryUpdate={setTelemetry}
        onTrafficPhaseUpdate={setTrafficPhase}
        onMechPatch={handlePatchMech}
        onRigAnalyzed={setRigReport}
        onRideCameraCycle={cycleRideCamera}
        onEngineToggleKey={() => handleMechanicalAction('starter')}
        onKickstandToggleKey={() => handleMechanicalAction('kickstand')}
        onHeadlightCycleKey={() => handleMechanicalAction('headlight')}
        onLoadingChange={(loading, progress) => setLoadingInfo({ loading, progress })}
      />

      {/* MODEL LOADING OVERLAY */}
      {loadingInfo.loading && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-[#080b12]/55 backdrop-blur-sm">
          <div className="flex w-72 flex-col items-center gap-3 rounded-3xl border border-white/15 bg-[#0a0f18]/92 p-6 shadow-2xl">
            <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
            <div className="text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">Đang Nạp Hình Học 3D</div>
              <div className="mt-1 text-sm font-semibold text-white">{activeVehicle.name}</div>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-400 transition-all duration-150"
                style={{ width: `${Math.max(12, loadingInfo.progress)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* TOP FLOATING AUTOMOTIVE HEADER BAR */}
      <header className="pointer-events-none fixed left-0 right-0 top-0 z-20 flex items-center justify-between gap-3 px-4 py-3">
        {/* Left: Brand & Vehicle Library Picker */}
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-2xl border border-white/12 bg-[#0a0e16]/86 px-3.5 py-2 shadow-xl backdrop-blur-xl sm:flex">
            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-tr from-amber-400 to-sky-400 shadow-[0_0_12px_rgba(245,158,11,0.8)]" />
            <div>
              <div className="text-[11px] font-bold tracking-[0.22em] text-white">MOTO ATELIER 3D</div>
              <div className="text-[9px] tracking-wider text-slate-400">VEHICLE DIGITAL TWIN STUDIO</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setGarageOpen(true)}
            className="flex items-center gap-2.5 rounded-2xl border border-white/14 bg-[#0a0e16]/88 px-3.5 py-2 text-left shadow-xl backdrop-blur-xl transition hover:border-amber-400/50"
          >
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-400">
                Garage ({vehicles.length} xe)
              </div>
              <div className="text-xs font-semibold text-white">{activeVehicle.name}</div>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {/* Center: 3 Seamless Mode Switcher Pills */}
        <nav className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/14 bg-[#0a0e16]/88 p-1 shadow-2xl backdrop-blur-2xl">
          <button
            type="button"
            onClick={() => handleModeChange('studio')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              mode === 'studio'
                ? 'bg-amber-400 text-slate-950 shadow-lg'
                : 'text-slate-300 hover:bg-white/8 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Studio & Tùy Biến</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('ride')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              mode === 'ride'
                ? 'bg-emerald-400 text-slate-950 shadow-lg'
                : 'text-slate-300 hover:bg-white/8 hover:text-white'
            }`}
          >
            <Play className="h-3.5 w-3.5" />
            <span>Chạy Thử 3D</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('pipeline')}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              mode === 'pipeline'
                ? 'bg-sky-400 text-slate-950 shadow-lg'
                : 'text-slate-300 hover:bg-white/8 hover:text-white'
            }`}
          >
            <Cpu className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Pipeline & Nhập Xe</span>
            <span className="md:hidden">Pipeline</span>
          </button>
        </nav>

        {/* Right: Lighting / Time-of-Day + Inspection Controls + Audio */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          {mode !== 'ride' ? (
            <div className="hidden items-center gap-0.5 rounded-2xl border border-white/12 bg-[#0a0e16]/86 p-1 backdrop-blur-xl lg:flex">
              {(
                [
                  { key: 'atelier', label: 'Atelier' },
                  { key: 'sunset', label: 'Hoàng Hôn' },
                  { key: 'saigon_night', label: 'Sài Gòn Đêm' },
                  { key: 'blueprint', label: 'Kỹ Thuật' },
                ] as { key: StudioLightingPreset; label: string }[]
              ).map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setStudioLighting(l.key)}
                  className={`rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition ${
                    studioLighting === l.key
                      ? 'bg-white/16 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-0.5 rounded-2xl border border-white/12 bg-[#0a0e16]/86 p-1 backdrop-blur-xl">
              {(
                [
                  { key: 'day', icon: Sun, label: 'Ngày' },
                  { key: 'dusk', icon: Sunset, label: 'Chiều' },
                  { key: 'night', icon: Moon, label: 'Đêm' },
                ] as { key: RideTimeOfDay; icon: typeof Sun; label: string }[]
              ).map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRideTimeOfDay(key)}
                  className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition ${
                    rideTimeOfDay === key
                      ? 'bg-amber-400/25 text-amber-200'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          )}

          {mode === 'studio' && (
            <>
              <button
                type="button"
                onClick={() => setShowHotspots((v) => !v)}
                title="Ẩn/Hiện điểm tương tác cơ khí 3D trên thân xe"
                className={`rounded-xl border p-2.5 backdrop-blur-xl transition ${
                  showHotspots
                    ? 'border-amber-400/50 bg-amber-400/18 text-amber-300'
                    : 'border-white/12 bg-[#0a0e16]/86 text-slate-400 hover:text-white'
                }`}
              >
                <Crosshair className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowRigXray((v) => !v)}
                title="Bật/Tắt lớp X-Ray kiểm tra trục bánh xe & góc cổ lái"
                className={`rounded-xl border p-2.5 backdrop-blur-xl transition ${
                  showRigXray
                    ? 'border-sky-400/60 bg-sky-400/20 text-sky-300'
                    : 'border-white/12 bg-[#0a0e16]/86 text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="h-4 w-4" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setAudioMuted((m) => !m)}
            title={audioMuted ? 'Bật âm thanh động cơ' : 'Tắt âm thanh'}
            className="rounded-xl border border-white/12 bg-[#0a0e16]/86 p-2.5 text-slate-300 backdrop-blur-xl transition hover:border-white/30 hover:text-white"
          >
            {audioMuted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-emerald-400" />}
          </button>
        </div>
      </header>

      {/* TOAST FEEDBACK */}
      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-20 z-30 -translate-x-1/2">
          <div className="rounded-2xl border border-amber-400/35 bg-[#0a0e16]/92 px-4 py-2 text-xs font-medium text-amber-200 shadow-2xl backdrop-blur-xl">
            {toast}
          </div>
        </div>
      )}

      {/* STUDIO MODE OVERLAYS */}
      {mode === 'studio' && (
        <>
          {/* Left Floating Camera Presets & Concise Vehicle Technical Sheet */}
          <div className="pointer-events-none fixed left-4 top-20 z-10 hidden w-60 flex-col gap-2.5 lg:flex">
            <div className="pointer-events-auto rounded-2xl border border-white/10 bg-[#0a0e16]/78 p-3 backdrop-blur-xl">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <Camera className="h-3 w-3 text-sky-400" />
                <span>Góc Quan Sát Cận Cảnh</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {CAMERA_PRESETS.map((cp) => (
                  <button
                    key={cp.key}
                    type="button"
                    onClick={() => {
                      setCameraPreset(cp.key);
                      setCameraPresetNonce((n) => n + 1);
                    }}
                    className={`rounded-xl border px-2 py-1.5 text-[11px] font-medium transition ${
                      cameraPreset === cp.key
                        ? 'border-sky-400/60 bg-sky-400/18 text-sky-200'
                        : 'border-white/8 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:text-white'
                    }`}
                  >
                    {cp.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pointer-events-auto rounded-2xl border border-white/10 bg-[#0a0e16]/76 p-3.5 text-[11px] text-slate-300 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Thông Số Cơ Khí</span>
                <span className="font-mono text-[10px] text-slate-400">{activeVehicle.year}</span>
              </div>
              <div className="mt-1 text-xs font-semibold text-white">{activeVehicle.physicsSpec.engineLayout}</div>
              <div className="mt-2.5 grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div>
                  <div className="text-[9px] text-slate-500">DUNG TÍCH</div>
                  <div className="text-white">{activeVehicle.physicsSpec.engineCC} cc</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">CÔNG SUẤT</div>
                  <div className="text-white">{activeVehicle.physicsSpec.horsepower} HP / {activeVehicle.physicsSpec.torqueNm} Nm</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">TRỤC CƠ SỞ</div>
                  <div className="text-white">{activeVehicle.physicsSpec.wheelbaseM.toFixed(2)} m</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">RAKE / NGHIÊNG</div>
                  <div className="text-amber-300">{activeVehicle.physicsSpec.rakeDeg}° / {activeVehicle.physicsSpec.maxLeanDeg}°</div>
                </div>
              </div>
              <div className="mt-2.5 border-t border-white/10 pt-2 text-[10px] leading-snug text-slate-400">
                <Eye className="mr-1 inline h-3 w-3 text-sky-400" />
                Cuộn chuột để zoom sát từng con ốc, nan hoa, đồng hồ và bề mặt sơn Clearcoat.
              </div>
            </div>
          </div>

          {/* Right Collapsible Bespoke Configurator */}
          <div className="pointer-events-none fixed right-4 top-20 z-20">
            <ConfiguratorDrawer
              vehicle={activeVehicle}
              config={buildConfig}
              savedBuilds={vehicleBuilds}
              activeBuildId={activeBuildId}
              collapsed={drawerCollapsed}
              onToggleCollapsed={() => setDrawerCollapsed((c) => !c)}
              onChangeConfig={(cfg) => {
                setBuildConfig(cfg);
                setActiveBuildId(null);
              }}
              onResetDefault={() => {
                setBuildConfig(activeVehicle.defaultBuild);
                setActiveBuildId(null);
                showToast('Đã khôi phục cấu hình nguyên bản');
              }}
              onSaveBuild={handleSaveBuild}
              onLoadBuild={handleLoadBuild}
              onDeleteBuild={handleDeleteBuild}
            />
          </div>

          {/* Bottom Mechanical Command Dock */}
          <div className="pointer-events-none fixed bottom-4 left-1/2 z-20 -translate-x-1/2">
            <MechanicalDock
              vehicle={activeVehicle}
              mech={mech}
              rpm={telemetry.rpm}
              onAction={handleMechanicalAction}
              onPatch={handlePatchMech}
            />
          </div>
        </>
      )}

      {/* TEST RIDE MODE OVERLAYS */}
      {mode === 'ride' && (
        <RideTelemetryHUD
          vehicle={activeVehicle}
          telemetry={telemetry}
          mech={mech}
          trafficPhase={trafficPhase}
          rideCameraMode={rideCameraMode}
          autoShift={autoShift}
          onToggleAutoShift={() => setAutoShift((a) => !a)}
          onCycleCamera={cycleRideCamera}
          onTeleport={(x, z, heading) =>
            setTeleportTarget({ x, z, heading, nonce: Date.now() })
          }
          onAction={handleMechanicalAction}
          onPatchMech={handlePatchMech}
          onSaveSession={handleSaveSession}
        />
      )}

      {/* VEHICLE PIPELINE & CUSTOM GLB INGESTION MODE */}
      {mode === 'pipeline' && (
        <div className="pointer-events-none fixed right-4 top-20 z-20">
          <PipelineWorkshop
            activeVehicle={activeVehicle}
            rigReport={rigReport}
            mech={mech}
            previewUrl={pipelinePreviewUrl}
            overrides={pipelineOverrides}
            onPreviewUrlChange={setPipelinePreviewUrl}
            onOverridesChange={setPipelineOverrides}
            onMechPatch={handlePatchMech}
            onRegisteredVehicle={handleRegisteredVehicle}
          />
        </div>
      )}

      {/* MOTORCYCLE GARAGE DRAWER */}
      <GarageDrawer
        open={garageOpen}
        vehicles={vehicles}
        activeVehicleId={activeVehicle.id}
        sessions={sessions}
        onClose={() => setGarageOpen(false)}
        onSelectVehicle={handleSelectVehicle}
        onDeleteCustomVehicle={handleDeleteCustomVehicle}
      />
    </main>
  );
}
