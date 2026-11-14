'use client';

import React, { useState } from 'react';
import {
  Camera,
  Flag,
  MapPin,
  Power,
  Sun,
  Wrench,
  Save,
  Check,
  Volume2,
  AlertCircle,
} from 'lucide-react';
import type { VehicleRecord, RideTelemetry, MechanicalState, MechanicalActionKey } from '@/lib/vehicles/types';
import type { RideCameraMode } from './MotorcycleViewport';

interface RideTelemetryHUDProps {
  vehicle: VehicleRecord;
  telemetry: RideTelemetry;
  mech: MechanicalState;
  trafficPhase: 'green' | 'amber' | 'red';
  rideCameraMode: RideCameraMode;
  autoShift: boolean;
  onToggleAutoShift: () => void;
  onCycleCamera: () => void;
  onTeleport: (x: number, z: number, heading: number) => void;
  onAction: (action: MechanicalActionKey) => void;
  onPatchMech: (patch: Partial<MechanicalState>) => void;
  onSaveSession: () => Promise<void>;
}

const CAM_LABELS: Record<RideCameraMode, string> = {
  chase: 'Chase Cam',
  close: 'Đuôi Cận Cảnh',
  cockpit: 'Góc Nhìn Buồng Lái (FPV)',
  orbit: 'Orbit Tự Do',
};

export function RideTelemetryHUD({
  vehicle,
  telemetry,
  mech,
  trafficPhase,
  rideCameraMode,
  autoShift,
  onToggleAutoShift,
  onCycleCamera,
  onTeleport,
  onAction,
  onPatchMech,
  onSaveSession,
}: RideTelemetryHUDProps) {
  const [savedFlag, setSavedFlag] = useState(false);

  const rpmRatio = Math.min(1, telemetry.rpm / vehicle.physicsSpec.redlineRpm);
  const redlineStart = 0.82;
  const arcLen = 220;
  const dashOffset = arcLen * (1 - rpmRatio);

  const handleSave = async () => {
    await onSaveSession();
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 2200);
  };

  return (
    <>
      {/* Warning Banner (e.g. Kickstand Down / Engine Off) */}
      {telemetry.warningMessage && (
        <div className="pointer-events-none fixed left-1/2 top-20 z-30 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-2xl border border-amber-400/50 bg-[#140e06]/90 px-4 py-2 text-xs font-medium text-amber-200 shadow-2xl backdrop-blur-xl">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>{telemetry.warningMessage}</span>
          </div>
        </div>
      )}

      {/* Left Proving Ground Landmark Navigator & Traffic Light Status */}
      <div className="pointer-events-auto fixed left-4 top-20 z-20 flex w-60 flex-col gap-2">
        <div className="rounded-2xl border border-white/12 bg-[#0a0e16]/82 p-3 text-xs text-slate-200 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Ngã Tư Đèn Giao Thông</span>
            <span
              className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                trafficPhase === 'red'
                  ? 'bg-rose-500/25 text-rose-300 ring-1 ring-rose-500/50'
                  : trafficPhase === 'amber'
                  ? 'bg-amber-400/25 text-amber-300 ring-1 ring-amber-400/50'
                  : 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/50'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  trafficPhase === 'red' ? 'bg-rose-400' : trafficPhase === 'amber' ? 'bg-amber-300' : 'bg-emerald-400'
                }`}
              />
              {trafficPhase === 'red' ? 'Đèn Đỏ' : trafficPhase === 'amber' ? 'Đèn Vàng' : 'Đèn Xanh'}
            </span>
          </div>

          <div className="mt-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Khu Vực Thử Nghiệm</div>
          <div className="mt-1.5 grid grid-cols-1 gap-1">
            {[
              { label: 'Đại lộ chính & Ngã tư', x: 0, z: -10, h: 0 },
              { label: 'Dải Gờ Giảm Xóc & Đá Hộc', x: 12, z: -2, h: 0 },
              { label: 'Bài Slalom Cọc Tiêu', x: -18, z: -18, h: 0 },
              { label: 'Đồi Dốc Ven Biển (Phía Bắc)', x: -45, z: 124, h: Math.PI / 2 },
            ].map((loc) => (
              <button
                key={loc.label}
                type="button"
                onClick={() => onTeleport(loc.x, loc.z, loc.h)}
                className="flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-left text-[11px] text-slate-300 transition hover:border-sky-400/40 hover:bg-sky-400/10 hover:text-white"
              >
                <MapPin className="h-3 w-3 text-sky-400" />
                <span>{loc.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Session Peak Telemetry + Save Record */}
        <div className="rounded-2xl border border-white/12 bg-[#0a0e16]/82 p-3 text-[11px] text-slate-300 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span className="flex items-center gap-1"><Flag className="h-3 w-3 text-amber-400" /> Thông Số Phiên Chạy</span>
            <span className="font-mono text-slate-300">{(telemetry.distanceMeters / 1000).toFixed(2)} km</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 font-mono">
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-[9px] text-slate-400">MAX SPEED</div>
              <div className="text-sm font-bold text-white">{Math.round(telemetry.topSpeedKmh)} <span className="text-[10px] font-normal text-slate-400">km/h</span></div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-[9px] text-slate-400">MAX LEAN</div>
              <div className="text-sm font-bold text-amber-300">{telemetry.maxLeanDeg.toFixed(1)}°</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSave}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/15 py-1.5 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
          >
            {savedFlag ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            <span>{savedFlag ? 'Đã lưu kỷ lục vào DB!' : 'Lưu Kết Quả Chạy Thử'}</span>
          </button>
        </div>
      </div>

      {/* Right Compact Controls Reference & Camera Switch */}
      <div className="pointer-events-auto fixed right-4 top-20 z-20 flex w-56 flex-col gap-2">
        <button
          type="button"
          onClick={onCycleCamera}
          className="flex items-center justify-between rounded-2xl border border-white/12 bg-[#0a0e16]/84 px-3 py-2.5 text-xs font-medium text-white shadow-xl backdrop-blur-xl transition hover:border-sky-400/50"
        >
          <span className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-sky-400" />
            <span>{CAM_LABELS[rideCameraMode]}</span>
          </span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">C</span>
        </button>

        <div className="rounded-2xl border border-white/10 bg-[#0a0e16]/78 p-3 text-[11px] text-slate-300 shadow-xl backdrop-blur-xl">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Điều Khiển Lái Thực Tế</div>
          <div className="space-y-1">
            {[
              ['W / ↑', 'Vặn ga tăng tốc'],
              ['S / ↓', 'Phanh trước (Nhún phuộc)'],
              ['Space', 'Phanh sau (Drift đuôi)'],
              ['A / D', 'Đánh lái & Nghiêng cua'],
              ['E / Q', 'Lên số / Xuống số'],
              ['K / L', 'Chân chống / Đèn pha'],
              ['H / I', 'Còi / Tắt-Mở máy'],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center justify-between">
                <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">{key}</kbd>
                <span className="text-slate-400">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Center Automotive Telemetry Instrument Cluster */}
      <div className="pointer-events-auto fixed bottom-4 left-1/2 z-20 -translate-x-1/2">
        <div className="flex items-center gap-4 rounded-3xl border border-white/14 bg-[#080b12]/90 px-5 py-3 shadow-2xl backdrop-blur-2xl">
          {/* Quick Ride Switches */}
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onAction('starter')}
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                mech.engineRunning
                  ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                  : 'border-rose-400/40 bg-rose-500/15 text-rose-200'
              }`}
            >
              <Power className="h-3.5 w-3.5" />
              <span>{mech.engineRunning ? 'Đang nổ' : 'Đề nổ'}</span>
            </button>
            <button
              type="button"
              onClick={() => onAction('kickstand')}
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                mech.kickstandDown
                  ? 'border-amber-400/60 bg-amber-400/20 text-amber-200'
                  : 'border-white/10 bg-white/[0.04] text-slate-300'
              }`}
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>{mech.kickstandDown ? 'Chống: HẠ' : 'Chống: GẠT'}</span>
            </button>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onAction('headlight')}
                className={`flex flex-1 items-center justify-center rounded-xl border py-1.5 text-[10px] font-semibold ${
                  mech.headlightMode !== 'off' ? 'border-sky-400/50 bg-sky-400/20 text-sky-200' : 'border-white/10 bg-white/[0.04] text-slate-400'
                }`}
                title="Đèn pha [L]"
              >
                <Sun className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={() => onPatchMech({ hornActive: true })}
                onMouseUp={() => onPatchMech({ hornActive: false })}
                onMouseLeave={() => onPatchMech({ hornActive: false })}
                className={`flex flex-1 items-center justify-center rounded-xl border py-1.5 text-[10px] font-semibold ${
                  mech.hornActive ? 'border-amber-400/60 bg-amber-400/25 text-amber-200' : 'border-white/10 bg-white/[0.04] text-slate-400'
                }`}
                title="Còi [H]"
              >
                <Volume2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Front & Rear Live Suspension Travel Bars */}
          <div className="flex items-end gap-2 px-1">
            {[
              { label: 'F', val: telemetry.frontSuspCompression, color: 'bg-sky-400' },
              { label: 'R', val: telemetry.rearSuspCompression, color: 'bg-amber-400' },
            ].map((bar) => (
              <div key={bar.label} className="flex flex-col items-center gap-1">
                <div className="relative h-16 w-2.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`absolute bottom-0 left-0 right-0 rounded-full transition-all duration-75 ${bar.color}`}
                    style={{ height: `${Math.round(bar.val * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[9px] text-slate-400">{bar.label}-SUSP</span>
              </div>
            ))}
          </div>

          {/* Central SVG Tachometer + Speedometer + Gear */}
          <div className="relative flex h-24 w-44 flex-col items-center justify-center">
            <svg viewBox="0 0 180 105" className="h-full w-full overflow-visible">
              {/* Background Arc */}
              <path
                d="M 18 92 A 72 72 0 0 1 162 92"
                fill="none"
                stroke="rgba(255,255,255,0.10)"
                strokeWidth="9"
                strokeLinecap="round"
              />
              {/* Active RPM Arc */}
              <path
                d="M 18 92 A 72 72 0 0 1 162 92"
                fill="none"
                stroke={rpmRatio > redlineStart ? '#f43f5e' : '#38bdf8'}
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={arcLen}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="absolute bottom-1 flex flex-col items-center">
              <div className="font-mono text-3xl font-bold leading-none tracking-tight text-white">
                {Math.round(telemetry.speedKmh)}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold tracking-widest text-slate-400">
                KM/H • {Math.round(telemetry.rpm).toLocaleString()} RPM
              </div>
            </div>
          </div>

          {/* Gear & Transmission Pill */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex h-12 w-14 items-center justify-center rounded-2xl border border-amber-400/40 bg-amber-400/12 font-mono text-2xl font-bold text-amber-300">
              {telemetry.gear === -1 ? 'D' : telemetry.gear === 0 ? 'N' : telemetry.gear}
            </div>
            {vehicle.physicsSpec.transmissionType !== 'cvt' ? (
              <button
                type="button"
                onClick={onToggleAutoShift}
                className="rounded-lg border border-white/12 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-300 hover:border-sky-400/50 hover:text-white"
                title="Chuyển giữa Số Tay (Q/E) và Tự Động Sang Số"
              >
                {autoShift ? 'SỐ: TỰ ĐỘNG' : 'SỐ: TAY (Q/E)'}
              </button>
            ) : (
              <span className="rounded-lg bg-sky-400/15 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                CVT VÔ CẤP
              </span>
            )}
          </div>

          {/* Live Lean Angle Inclinometer */}
          <div className="flex flex-col items-center gap-1 pl-1">
            <div className="relative flex h-14 w-20 items-center justify-center">
              <div
                className="h-0.5 w-14 rounded-full bg-gradient-to-r from-sky-400 via-white to-amber-400 transition-transform duration-75"
                style={{ transform: `rotate(${-telemetry.leanDeg}deg)` }}
              />
              <div className="absolute h-2.5 w-2.5 rounded-full border-2 border-white bg-[#080b12]" />
            </div>
            <div className="font-mono text-xs font-semibold text-amber-300">
              {Math.abs(telemetry.leanDeg).toFixed(1)}° {telemetry.leanDeg > 1 ? 'L' : telemetry.leanDeg < -1 ? 'R' : ''}
            </div>
            <span className="text-[9px] uppercase tracking-wider text-slate-400">GÓC NGHIÊNG</span>
          </div>
        </div>
      </div>
    </>
  );
}
