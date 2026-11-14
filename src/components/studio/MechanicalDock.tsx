'use client';

import React from 'react';
import {
  KeyRound,
  Power,
  Sun,
  Volume2,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Gauge,
  Disc3,
  Briefcase,
  Fuel,
  Box,
  Footprints,
  Wrench,
} from 'lucide-react';
import type { VehicleRecord, MechanicalState, MechanicalActionKey } from '@/lib/vehicles/types';

interface MechanicalDockProps {
  vehicle: VehicleRecord;
  mech: MechanicalState;
  rpm: number;
  onAction: (action: MechanicalActionKey) => void;
  onPatch: (patch: Partial<MechanicalState>) => void;
}

export function MechanicalDock({ vehicle, mech, rpm, onAction, onPatch }: MechanicalDockProps) {
  const cap = vehicle.rigManifest.capabilities;

  const btnBase =
    'flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-medium transition-all active:scale-95';
  const btnOff = 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:bg-white/[0.09] hover:text-white';
  const btnActiveAmber = 'border-amber-400/60 bg-amber-400/20 text-amber-200 shadow-[0_0_16px_rgba(245,158,11,0.22)]';
  const btnActiveCyan = 'border-sky-400/60 bg-sky-400/20 text-sky-200 shadow-[0_0_16px_rgba(56,189,248,0.22)]';
  const btnActiveEmerald = 'border-emerald-400/60 bg-emerald-400/20 text-emerald-200 shadow-[0_0_16px_rgba(52,211,153,0.22)]';

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      {/* Studio Rig Verification Mini-Bar (Steering Angle + Dyno Wheel Spin + Live RPM) */}
      <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#0b0f17]/82 px-3.5 py-1.5 text-[11px] text-slate-300 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Thử Cổ Lái</span>
          <input
            type="range"
            min={-vehicle.physicsSpec.maxSteerDeg}
            max={vehicle.physicsSpec.maxSteerDeg}
            step={1}
            value={mech.steerPreviewDeg}
            onChange={(e) => onPatch({ steerPreviewDeg: Number(e.target.value) })}
            className="h-1 w-24 accent-sky-400 cursor-pointer"
          />
          <span className="w-9 text-right font-mono text-sky-300">{mech.steerPreviewDeg > 0 ? `+${mech.steerPreviewDeg}°` : `${mech.steerPreviewDeg}°`}</span>
          {mech.steerPreviewDeg !== 0 && (
            <button
              type="button"
              onClick={() => onPatch({ steerPreviewDeg: 0 })}
              className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white"
            >
              Thẳng
            </button>
          )}
        </div>

        <div className="h-3.5 w-px bg-white/10" />

        <button
          type="button"
          onClick={() => onPatch({ studioWheelSpin: !mech.studioWheelSpin })}
          className={`flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-medium transition ${
            mech.studioWheelSpin ? 'bg-sky-400/25 text-sky-200 ring-1 ring-sky-400/50' : 'text-slate-300 hover:bg-white/10'
          }`}
        >
          <Disc3 className={`h-3.5 w-3.5 ${mech.studioWheelSpin ? 'animate-spin' : ''}`} />
          Quay bánh Dyno
        </button>

        <div className="h-3.5 w-px bg-white/10" />

        <div className="flex items-center gap-1.5 font-mono">
          <Gauge className="h-3.5 w-3.5 text-amber-400" />
          <span className={mech.engineRunning ? 'text-amber-300' : 'text-slate-500'}>
            {Math.round(rpm).toLocaleString()} RPM
          </span>
        </div>
      </div>

      {/* Main Mechanical Control Dock */}
      <div className="flex max-w-[96vw] flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-white/12 bg-[#0a0e16]/88 p-2 shadow-2xl backdrop-blur-2xl">
        {/* 1. Ignition & Starter */}
        <button
          type="button"
          onClick={() => onAction('ignition')}
          className={`${btnBase} ${mech.ignitionOn ? btnActiveAmber : btnOff}`}
          title="Bật / Tắt khóa điện"
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span>Khóa điện</span>
        </button>

        <button
          type="button"
          onClick={() => onAction('starter')}
          className={`${btnBase} ${mech.engineRunning ? btnActiveEmerald : btnOff}`}
          title="Đề nổ / Tắt động cơ [I]"
        >
          <Power className="h-3.5 w-3.5" />
          <span>{mech.starterCranking ? 'Đang đề...' : mech.engineRunning ? 'Đang nổ máy' : 'Đề nổ'}</span>
        </button>

        {cap.hasKickstarter && (
          <button
            type="button"
            onClick={() => onAction('kickstarter')}
            className={`${btnBase} ${btnOff}`}
            title="Đạp cần khởi động cơ khí CG125"
          >
            <Footprints className="h-3.5 w-3.5" />
            <span>Đạp nổ</span>
          </button>
        )}

        {/* Rev Throttle Hold Button */}
        <button
          type="button"
          onMouseDown={() => onPatch({ throttleGrip: 0.92 })}
          onMouseUp={() => onPatch({ throttleGrip: 0 })}
          onMouseLeave={() => onPatch({ throttleGrip: 0 })}
          onTouchStart={() => onPatch({ throttleGrip: 0.92 })}
          onTouchEnd={() => onPatch({ throttleGrip: 0 })}
          disabled={!mech.engineRunning}
          className={`${btnBase} ${
            mech.throttleGrip > 0.1
              ? 'border-rose-400/70 bg-rose-500/25 text-rose-200'
              : mech.engineRunning
              ? btnOff
              : 'cursor-not-allowed border-white/5 bg-white/[0.02] text-slate-600'
          }`}
          title="Giữ để nẹt ga nghe tiếng pô và quan sát tua máy"
        >
          <Gauge className="h-3.5 w-3.5" />
          <span>Vặn ga</span>
        </button>

        <div className="mx-0.5 h-6 w-px bg-white/10" />

        {/* 2. Electrical Lights & Horn */}
        <button
          type="button"
          onClick={() => onAction('headlight')}
          className={`${btnBase} ${
            mech.headlightMode === 'high'
              ? btnActiveCyan
              : mech.headlightMode === 'low'
              ? btnActiveAmber
              : btnOff
          }`}
          title="Chuyển chế độ Đèn: Tắt -> Chiếu gần -> Chiếu xa [L]"
        >
          <Sun className="h-3.5 w-3.5" />
          <span>{mech.headlightMode === 'off' ? 'Đèn: Tắt' : mech.headlightMode === 'low' ? 'Cốt (Low)' : 'Pha (High)'}</span>
        </button>

        <div className="flex items-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
          <button
            type="button"
            onClick={() => onAction('turnLeft')}
            className={`px-2 py-2 transition ${mech.turnSignal === 'left' ? 'bg-amber-400/25 text-amber-300' : 'text-slate-400 hover:text-white'}`}
            title="Xi nhan trái"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onAction('hazard')}
            className={`border-x border-white/10 px-2 py-2 transition ${mech.turnSignal === 'hazard' ? 'bg-rose-500/25 text-rose-300' : 'text-slate-400 hover:text-white'}`}
            title="Đèn cảnh báo Hazard"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onAction('turnRight')}
            className={`px-2 py-2 transition ${mech.turnSignal === 'right' ? 'bg-amber-400/25 text-amber-300' : 'text-slate-400 hover:text-white'}`}
            title="Xi nhan phải"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onMouseDown={() => onPatch({ brakeLightOn: true, brakePedalPress: 1 })}
          onMouseUp={() => onPatch({ brakeLightOn: false, brakePedalPress: 0 })}
          onMouseLeave={() => onPatch({ brakeLightOn: false, brakePedalPress: 0 })}
          className={`${btnBase} ${mech.brakeLightOn ? 'border-rose-500/70 bg-rose-500/25 text-rose-200' : btnOff}`}
          title="Giữ để bóp/đạp phanh kiểm tra đèn hậu & bàn đạp phanh"
        >
          <span>Phanh</span>
        </button>

        <button
          type="button"
          onMouseDown={() => onPatch({ hornActive: true })}
          onMouseUp={() => onPatch({ hornActive: false })}
          onMouseLeave={() => onPatch({ hornActive: false })}
          className={`${btnBase} ${mech.hornActive ? btnActiveAmber : btnOff}`}
          title="Giữ để bấm còi [H]"
        >
          <Volume2 className="h-3.5 w-3.5" />
          <span>Còi</span>
        </button>

        <div className="mx-0.5 h-6 w-px bg-white/10" />

        {/* 3. Authentic Bike-Specific Mechanical Parts */}
        {cap.hasMovingKickstand && (
          <button
            type="button"
            onClick={() => onAction('kickstand')}
            className={`${btnBase} ${mech.kickstandDown ? btnActiveCyan : btnOff}`}
            title="Gạt chân chống [K]"
          >
            <Wrench className="h-3.5 w-3.5" />
            <span>{vehicle.rigManifest.standType === 'center' ? 'Chống giữa' : 'Chống nghiêng'}</span>
          </button>
        )}

        {cap.hasHingedSeat && (
          <button
            type="button"
            onClick={() => onAction('seat')}
            className={`${btnBase} ${mech.seatOpen ? btnActiveAmber : btnOff}`}
            title={cap.seatCompartmentLabel}
          >
            <Box className="h-3.5 w-3.5" />
            <span>{mech.seatOpen ? 'Đóng yên' : 'Mở yên'}</span>
          </button>
        )}

        {cap.hasFuelCap && (
          <button
            type="button"
            onClick={() => onAction('fuelCap')}
            className={`${btnBase} ${mech.fuelCapOpen ? btnActiveAmber : btnOff}`}
            title={cap.fuelCapUnderSeat ? 'Mở nắp bình xăng dưới yên' : 'Mở nắp bình xăng trên thân'}
          >
            <Fuel className="h-3.5 w-3.5" />
            <span>Nắp xăng</span>
          </button>
        )}

        {cap.hasSaddlebags && (
          <button
            type="button"
            onClick={() => onAction('saddlebags')}
            className={`${btnBase} ${mech.saddlebagsOpen ? btnActiveAmber : btnOff}`}
            title="Mở nắp đôi túi da hông Cruiser"
          >
            <Briefcase className="h-3.5 w-3.5" />
            <span>Túi da hông</span>
          </button>
        )}

        {cap.hasGlovebox && (
          <button
            type="button"
            onClick={() => onAction('glovebox')}
            className={`${btnBase} ${mech.gloveboxOpen ? btnActiveAmber : btnOff}`}
            title="Mở hộc đựng đồ trước yếm xe tay ga"
          >
            <Box className="h-3.5 w-3.5" />
            <span>Hộc đồ trước</span>
          </button>
        )}
      </div>
    </div>
  );
}
