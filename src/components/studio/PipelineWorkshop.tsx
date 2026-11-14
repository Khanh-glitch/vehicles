'use client';

import React, { useState } from 'react';
import {
  Upload,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Save,
  RotateCw,
  Sliders,
} from 'lucide-react';
import type {
  VehicleRecord,
  VehicleCategory,
  TransmissionType,
  AudioProfileType,
  MechanicalState,
} from '@/lib/vehicles/types';
import type { AnalyzedVehicleRig, RigOverrideParams } from '@/lib/pipeline/glbRigAnalyzer';

interface PipelineWorkshopProps {
  activeVehicle: VehicleRecord;
  rigReport: AnalyzedVehicleRig | null;
  mech: MechanicalState;
  previewUrl: string | null;
  overrides: Partial<RigOverrideParams>;
  onPreviewUrlChange: (url: string | null) => void;
  onOverridesChange: (next: Partial<RigOverrideParams>) => void;
  onMechPatch: (patch: Partial<MechanicalState>) => void;
  onRegisteredVehicle: (v: VehicleRecord) => void;
}

export function PipelineWorkshop({
  activeVehicle,
  rigReport,
  mech,
  previewUrl,
  overrides,
  onPreviewUrlChange,
  onOverridesChange,
  onMechPatch,
  onRegisteredVehicle,
}: PipelineWorkshopProps) {
  const [uploading, setUploading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Vehicle registration metadata
  const [name, setName] = useState('');
  const [category, setCategory] = useState<VehicleCategory>('classic');
  const [engineCC, setEngineCC] = useState(250);
  const [massKg, setMassKg] = useState(145);
  const [horsepower, setHorsepower] = useState(26);
  const [topSpeedKmh, setTopSpeedKmh] = useState(145);
  const [transmission, setTransmission] = useState<TransmissionType>('manual_5');
  const [audioProfile, setAudioProfile] = useState<AudioProfileType>('classic_ohv');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccessMsg(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload-glb', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tải tệp GLB thất bại');
      onPreviewUrlChange(data.modelUrl);
      onOverridesChange({});
      if (!name) {
        setName(file.name.replace(/\.glb$/i, '').replace(/[_-]+/g, ' '));
      }
      setSuccessMsg(`Đã nạp ${file.name} (${(data.sizeBytes / 1024 / 1024).toFixed(2)} MB) — hệ thống đang phân tích & tách đảo đa giác!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tải GLB');
    } finally {
      setUploading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!previewUrl || !rigReport || !name.trim()) return;
    setRegistering(true);
    setError(null);
    try {
      const wheelbase = Math.max(1.15, Math.abs(rigReport.frontAxle[2] - rigReport.rearAxle[2]));
      const payload = {
        name: name.trim(),
        subtitle: `Custom Pipeline Vehicle • ${engineCC}cc ${transmission.toUpperCase()}`,
        category,
        origin: 'Custom GLB Pipeline',
        year: new Date().getFullYear(),
        description: `Được nạp và tự động tách cơ cấu (${rigReport.islandCount} đảo đa giác, ${rigReport.totalTriangles.toLocaleString()} tam giác) qua Moto Atelier Vehicle Ingestion Pipeline.`,
        modelUrl: previewUrl,
        attribution: 'Custom User GLB • Rigged via Moto Atelier Connected-Component Pipeline',
        physicsSpec: {
          massKg,
          engineCC,
          engineLayout: `${engineCC}cc Custom Powertrain`,
          horsepower,
          torqueNm: Math.round(horsepower * 0.9),
          transmissionType: transmission,
          gearCount: transmission === 'cvt' ? 1 : transmission === 'semi_auto_4' ? 4 : transmission === 'manual_6' ? 6 : 5,
          gearRatios:
            transmission === 'cvt' ? [2.35] :
            transmission === 'semi_auto_4' ? [2.8, 1.7, 1.25, 0.96] :
            transmission === 'manual_6' ? [2.75, 2.0, 1.6, 1.35, 1.18, 1.0] :
            [2.77, 1.88, 1.40, 1.13, 0.94],
          finalDrive: 2.85,
          idleRpm: audioProfile === 'vtwin_45' ? 950 : 1400,
          redlineRpm: audioProfile === 'inline4_sport' ? 13000 : audioProfile === 'vtwin_45' ? 6000 : 9200,
          peakTorqueRpm: audioProfile === 'vtwin_45' ? 3400 : 6800,
          topSpeedKmh,
          wheelbaseM: +wheelbase.toFixed(3),
          frontWheelRadiusM: rigReport.frontWheelRadius,
          rearWheelRadiusM: rigReport.rearWheelRadius,
          rakeDeg: rigReport.rakeDeg,
          maxSteerDeg: 36,
          maxLeanDeg: category === 'sport' ? 46 : category === 'cruiser' ? 32 : 38,
          leanRateRad: 3.0,
          tireGrip: 1.05,
          frontBrakeAccel: 9.2,
          rearBrakeAccel: 6.0,
          frontSuspStiffness: 24000,
          frontSuspDamping: 2500,
          rearSuspStiffness: 27000,
          rearSuspDamping: 2800,
          suspTravelM: 0.10,
          wheelieFactor: 0.3,
          audioProfile,
        },
        rigManifest: {
          standType: 'side',
          parkedLeanDeg: 8.5,
          headlightPos: [0, rigReport.steeringHead[1] + 0.08, rigReport.frontAxle[2] - 0.1],
          taillightPos: [0, rigReport.steeringHead[1] - 0.15, rigReport.rearAxle[2] - 0.2],
          cockpitCamPos: [0, rigReport.boundingSize[1] + 0.05, 0],
          cockpitCamLook: [0, rigReport.steeringHead[1], 1.2],
          frontAxlePos: rigReport.frontAxle,
          rearAxlePos: rigReport.rearAxle,
          steeringHeadPos: rigReport.steeringHead,
          capabilities: {
            hasHingedSeat: false,
            hasMovingKickstand: false,
            seatCompartmentLabel: 'Yên tiêu chuẩn',
            hasFuelCap: false,
            fuelCapUnderSeat: false,
            hasSaddlebags: false,
            hasGlovebox: false,
            hasKickstarter: false,
            hasAnalogNeedles: false,
            hasMovingShifter: false,
            hasMovingBrakePedal: false,
          },
          paintableMaterials: [],
          seatMaterials: [],
          rimMaterials: [],
          hotspots: [],
        },
        configOptions: activeVehicle.configOptions,
        defaultBuild: activeVehicle.defaultBuild,
      };

      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể đăng ký xe mới');
      setSuccessMsg(`Đã lưu "${data.vehicle.name}" vào PostgreSQL! Xe đã sẵn sàng chạy thử và tùy biến.`);
      onRegisteredVehicle(data.vehicle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi đăng ký xe');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <aside className="pointer-events-auto flex max-h-[calc(100vh-120px)] w-[370px] flex-col overflow-hidden rounded-3xl border border-sky-400/25 bg-[#090e17]/92 text-slate-200 shadow-2xl backdrop-blur-2xl">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-400">
          <Cpu className="h-3.5 w-3.5" />
          <span>Vehicle Ingestion & Rig Pipeline</span>
        </div>
        <h2 className="mt-0.5 text-sm font-semibold text-white">
          Phân Tích Hình Học & Tiếp Nhận Mẫu Xe Mới
        </h2>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {/* Step 1: Upload Any External GLB */}
        <div className="rounded-2xl border border-dashed border-sky-400/40 bg-sky-400/[0.05] p-3.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sky-200">1. Nhập tệp mô hình .GLB mới</span>
            {previewUrl && (
              <button
                type="button"
                onClick={() => {
                  onPreviewUrlChange(null);
                  onOverridesChange({});
                }}
                className="text-[10px] text-slate-400 hover:text-white"
              >
                Xem xe hiện tại
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Hỗ trợ cả mô hình đã tách node lẫn mô hình bị gộp toàn bộ mesh (hệ thống tự động phân tách cụm đảo liên thông để tìm bánh trước, bánh sau & cổ lái).
          </p>
          <label className="mt-2.5 flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-sky-400">
            <Upload className="h-3.5 w-3.5" />
            <span>{uploading ? 'Đang tải & phân tích...' : 'Chọn tệp .GLB từ máy tính'}</span>
            <input type="file" accept=".glb" onChange={handleFileUpload} disabled={uploading} className="hidden" />
          </label>
          {error && <div className="mt-2 rounded-lg bg-rose-500/20 px-2.5 py-1.5 text-[11px] text-rose-300">{error}</div>}
          {successMsg && <div className="mt-2 rounded-lg bg-emerald-500/20 px-2.5 py-1.5 text-[11px] text-emerald-300">{successMsg}</div>}
        </div>

        {/* Step 2: Live Structural & Topological Inspection Report */}
        {rigReport && (
          <div className="space-y-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">2. Kết Quả Phân Tích Cấu Trúc 3D</span>
              <span
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  rigReport.isPreRigged
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-amber-400/20 text-amber-200'
                }`}
              >
                {rigReport.isPreRigged ? <CheckCircle2 className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                {rigReport.isPreRigged ? 'Chuẩn Rig Studio' : 'Đã Tách Tự Động'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
              <div className="rounded-lg bg-black/35 p-2">
                <div className="text-[9px] text-slate-500">TAM GIÁC</div>
                <div className="font-semibold text-white">{rigReport.totalTriangles.toLocaleString()}</div>
              </div>
              <div className="rounded-lg bg-black/35 p-2">
                <div className="text-[9px] text-slate-500">ĐẢO HÌNH HỌC</div>
                <div className="font-semibold text-sky-300">{rigReport.islandCount}</div>
              </div>
              <div className="rounded-lg bg-black/35 p-2">
                <div className="text-[9px] text-slate-500">GÓC RAKE</div>
                <div className="font-semibold text-amber-300">{rigReport.rakeDeg}°</div>
              </div>
            </div>

            <div className="space-y-1 rounded-xl bg-black/30 p-2.5 font-mono text-[10px] text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">Kích thước (W×H×L):</span>
                <span>{rigReport.boundingSize.join(' × ')} m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-cyan-400">Trục Bánh Trước:</span>
                <span>[{rigReport.frontAxle.join(', ')}] R={rigReport.frontWheelRadius}m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-cyan-400">Trục Bánh Sau:</span>
                <span>[{rigReport.rearAxle.join(', ')}] R={rigReport.rearWheelRadius}m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-amber-400">Cổ Lái (Steering Head):</span>
                <span>[{rigReport.steeringHead.join(', ')}]</span>
              </div>
            </div>

            {rigReport.partSummary.articulatedParts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {rigReport.partSummary.articulatedParts.map((p) => (
                  <span key={p} className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">
                    {p}
                  </span>
                ))}
              </div>
            )}

            {rigReport.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded-lg bg-amber-500/15 p-2 text-[10px] text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Step 3: Live Mechanical Rig Verification Test */}
        <div className="space-y-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <div className="flex items-center gap-1.5 font-semibold text-white">
            <Sliders className="h-3.5 w-3.5 text-amber-400" />
            <span>3. Kiểm Chứng & Hiệu Chỉnh Cơ Cấu X-Ray</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">Đánh lái thử:</span>
            <input
              type="range"
              min={-38}
              max={38}
              value={mech.steerPreviewDeg}
              onChange={(e) => onMechPatch({ steerPreviewDeg: Number(e.target.value) })}
              className="h-1 flex-1 accent-amber-400"
            />
            <span className="w-8 text-right font-mono text-[11px] text-amber-300">{mech.steerPreviewDeg}°</span>
          </div>
          <button
            type="button"
            onClick={() => onMechPatch({ studioWheelSpin: !mech.studioWheelSpin })}
            className={`flex w-full items-center justify-center gap-1.5 rounded-xl border py-1.5 text-[11px] font-semibold transition ${
              mech.studioWheelSpin
                ? 'border-sky-400/60 bg-sky-400/20 text-sky-200'
                : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            <RotateCw className={`h-3.5 w-3.5 ${mech.studioWheelSpin ? 'animate-spin' : ''}`} />
            <span>{mech.studioWheelSpin ? 'Đang quay kiểm tra đồng tâm bánh xe...' : 'Chạy thử quay bánh kiểm tra đồng tâm'}</span>
          </button>

          {previewUrl && (
            <div className="space-y-2 border-t border-white/10 pt-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Hiệu Chỉnh Trục Thủ Công (Khi Cần)</div>
              <div className="grid grid-cols-4 gap-1">
                {(['+Z', '-Z', '+X', '-X'] as const).map((ax) => (
                  <button
                    key={ax}
                    type="button"
                    onClick={() => onOverridesChange({ ...overrides, forwardAxis: ax })}
                    className={`rounded-lg border py-1 font-mono text-[10px] ${
                      (overrides.forwardAxis || rigReport?.detectedForwardAxis) === ax
                        ? 'border-sky-400 bg-sky-400/20 text-sky-200'
                        : 'border-white/10 bg-black/30 text-slate-400'
                    }`}
                  >
                    Hướng {ax}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-slate-400">
                  Góc Rake (°)
                  <input
                    type="number"
                    min={18}
                    max={42}
                    step={0.5}
                    value={overrides.rakeDeg ?? rigReport?.rakeDeg ?? 26}
                    onChange={(e) => onOverridesChange({ ...overrides, rakeDeg: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-white/12 bg-black/40 px-2 py-1 font-mono text-white"
                  />
                </label>
                <label className="text-[10px] text-slate-400">
                  Bán kính bánh (m)
                  <input
                    type="number"
                    min={0.18}
                    max={0.45}
                    step={0.01}
                    value={overrides.wheelRadiusM ?? rigReport?.frontWheelRadius ?? 0.31}
                    onChange={(e) => onOverridesChange({ ...overrides, wheelRadiusM: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-white/12 bg-black/40 px-2 py-1 font-mono text-white"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Step 4: Declare Dynamics & Register New Vehicle to PostgreSQL */}
        {previewUrl && (
          <form onSubmit={handleRegister} className="space-y-2.5 rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.05] p-3.5">
            <div className="font-semibold text-emerald-300">4. Khai Báo Vật Lý & Lưu Xe Vào Studio</div>
            <input
              type="text"
              required
              placeholder="Tên mẫu xe (VD: Yamaha Exciter 155)..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-400">
                Phân khúc
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as VehicleCategory)}
                  className="mt-1 w-full rounded-lg border border-white/12 bg-[#0d121d] px-2 py-1.5 text-white"
                >
                  <option value="underbone">Xe số phổ thông</option>
                  <option value="classic">Côn tay cổ điển</option>
                  <option value="scooter">Xe tay ga CVT</option>
                  <option value="cruiser">Cruiser V-Twin</option>
                  <option value="bobber">Custom Bobber</option>
                  <option value="sport">Sportbike</option>
                </select>
              </label>
              <label className="text-[10px] text-slate-400">
                Hộp số
                <select
                  value={transmission}
                  onChange={(e) => setTransmission(e.target.value as TransmissionType)}
                  className="mt-1 w-full rounded-lg border border-white/12 bg-[#0d121d] px-2 py-1.5 text-white"
                >
                  <option value="semi_auto_4">4 số bán tự động</option>
                  <option value="manual_5">Côn tay 5 số</option>
                  <option value="manual_6">Côn tay 6 số</option>
                  <option value="cvt">Tay ga vô cấp CVT</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[10px] text-slate-400">
                Dung tích (cc)
                <input
                  type="number"
                  value={engineCC}
                  onChange={(e) => setEngineCC(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-white/12 bg-black/40 px-2 py-1 font-mono text-white"
                />
              </label>
              <label className="text-[10px] text-slate-400">
                Khối lượng (kg)
                <input
                  type="number"
                  value={massKg}
                  onChange={(e) => setMassKg(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-white/12 bg-black/40 px-2 py-1 font-mono text-white"
                />
              </label>
              <label className="text-[10px] text-slate-400">
                Max (km/h)
                <input
                  type="number"
                  value={topSpeedKmh}
                  onChange={(e) => setTopSpeedKmh(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-white/12 bg-black/40 px-2 py-1 font-mono text-white"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-400">
                Công suất (HP)
                <input
                  type="number"
                  value={horsepower}
                  onChange={(e) => setHorsepower(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-white/12 bg-black/40 px-2 py-1 font-mono text-white"
                />
              </label>
              <label className="text-[10px] text-slate-400">
                Âm thanh động cơ
                <select
                  value={audioProfile}
                  onChange={(e) => setAudioProfile(e.target.value as AudioProfileType)}
                  className="mt-1 w-full rounded-lg border border-white/12 bg-[#0d121d] px-2 py-1.5 text-white"
                >
                  <option value="single_thumper">1 xy-lanh Cub</option>
                  <option value="classic_ohv">1 xy-lanh OHV</option>
                  <option value="vtwin_45">V-Twin 45° Cruiser</option>
                  <option value="inline4_sport">4 xy-lanh Sport</option>
                  <option value="cvt_scooter">Tay ga CVT</option>
                </select>
              </label>
            </div>

            <button
              type="submit"
              disabled={registering || !name.trim()}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-400 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{registering ? 'Đang đăng ký vào Studio...' : 'Đăng Ký Xe Mới & Chạy Thử Ngay'}</span>
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}
