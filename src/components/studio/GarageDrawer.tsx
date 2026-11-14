'use client';

import React, { useState } from 'react';
import { X, Gauge, Weight, Cog, ShieldCheck, Trophy, Trash2, Check } from 'lucide-react';
import type { VehicleRecord, VehicleCategory } from '@/lib/vehicles/types';

export interface RideSessionRow {
  id: number;
  vehicleId: string;
  topSpeedKmh: number;
  maxLeanDeg: number;
  distanceMeters: number;
  durationSec: number;
  createdAt: string;
}

interface GarageDrawerProps {
  open: boolean;
  vehicles: VehicleRecord[];
  activeVehicleId: string;
  sessions: RideSessionRow[];
  onClose: () => void;
  onSelectVehicle: (v: VehicleRecord) => void;
  onDeleteCustomVehicle: (id: string) => Promise<void>;
}

const CATEGORY_LABELS: Record<VehicleCategory | 'all', string> = {
  all: 'Tất cả',
  underbone: 'Xe số phổ thông',
  classic: 'Côn tay cổ điển',
  scooter: 'Xe tay ga CVT',
  cruiser: 'Cruiser V-Twin',
  bobber: 'Custom Bobber',
  sport: 'Sportbike',
};

const TRANS_LABELS = {
  semi_auto_4: '4 số tròn bán tự động',
  manual_5: 'Côn tay 5 số',
  manual_6: 'Côn tay 6 số',
  cvt: 'Vô cấp CVT',
};

export function GarageDrawer({
  open,
  vehicles,
  activeVehicleId,
  sessions,
  onClose,
  onSelectVehicle,
  onDeleteCustomVehicle,
}: GarageDrawerProps) {
  const [filter, setFilter] = useState<VehicleCategory | 'all'>('all');

  if (!open) return null;

  const filtered = filter === 'all' ? vehicles : vehicles.filter((v) => v.category === filter);

  return (
    <div className="fixed inset-0 z-40 flex bg-black/55 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-2xl flex-col border-r border-white/12 bg-[#090d14]/96 text-slate-200 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-amber-400">
              Moto Atelier 3D • Collection
            </div>
            <h2 className="mt-0.5 text-lg font-semibold text-white">
              Thư Viện Xe Máy Cơ Khí ({vehicles.length} mẫu)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-1.5 border-b border-white/10 bg-white/[0.02] px-6 py-3">
          {(['all', 'underbone', 'classic', 'scooter', 'cruiser', 'bobber', 'sport'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilter(cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === cat
                  ? 'bg-amber-400 text-slate-950'
                  : 'border border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-white'
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {/* Vehicle Cards */}
        <div className="flex-1 space-y-3 overflow-y-auto p-6">
          {filtered.map((v) => {
            const active = v.id === activeVehicleId;
            const vSessions = sessions.filter((s) => s.vehicleId === v.id);
            const bestSpeed = vSessions.reduce((mx, s) => Math.max(mx, s.topSpeedKmh), 0);
            const bestLean = vSessions.reduce((mx, s) => Math.max(mx, s.maxLeanDeg), 0);
            const cap = v.rigManifest.capabilities;

            return (
              <div
                key={v.id}
                className={`rounded-2xl border p-4 transition ${
                  active
                    ? 'border-amber-400/70 bg-amber-400/[0.08] shadow-[0_0_24px_rgba(245,158,11,0.12)]'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-sky-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                        {CATEGORY_LABELS[v.category]}
                      </span>
                      <span className="text-[11px] text-slate-400">{v.year} • {v.origin}</span>
                      {v.sourceType === 'custom_import' && (
                        <span className="rounded-md bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          Custom Pipeline Import
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1.5 text-base font-semibold text-white">{v.name}</h3>
                    <p className="text-xs text-amber-200/90">{v.subtitle}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{v.description}</p>
                  </div>

                  <div className="flex flex-col items-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectVehicle(v);
                        onClose();
                      }}
                      className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                        active
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-white/10 text-white hover:bg-amber-400 hover:text-slate-950'
                      }`}
                    >
                      {active && <Check className="h-3.5 w-3.5" />}
                      <span>{active ? 'Đang chọn' : 'Chọn xe'}</span>
                    </button>
                    {v.sourceType === 'custom_import' && (
                      <button
                        type="button"
                        onClick={() => onDeleteCustomVehicle(v.id)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-rose-400 hover:bg-rose-500/15"
                      >
                        <Trash2 className="h-3 w-3" /> Xóa
                      </button>
                    )}
                  </div>
                </div>

                {/* Spec Grid */}
                <div className="mt-3 grid grid-cols-4 gap-2 rounded-xl bg-black/30 p-2.5 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <Cog className="h-3.5 w-3.5 text-sky-400" />
                    <div>
                      <div className="text-[9px] text-slate-500">ĐỘNG CƠ</div>
                      <div className="font-mono font-semibold text-white">{v.physicsSpec.engineCC} cc</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Gauge className="h-3.5 w-3.5 text-amber-400" />
                    <div>
                      <div className="text-[9px] text-slate-500">CÔNG SUẤT / MAX</div>
                      <div className="font-mono font-semibold text-white">{v.physicsSpec.horsepower} HP • {v.physicsSpec.topSpeedKmh} km/h</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Weight className="h-3.5 w-3.5 text-emerald-400" />
                    <div>
                      <div className="text-[9px] text-slate-500">TRỌNG LƯỢNG / RAKE</div>
                      <div className="font-mono font-semibold text-white">{v.physicsSpec.massKg} kg • {v.physicsSpec.rakeDeg}°</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">HỘP SỐ</div>
                    <div className="font-medium text-slate-200">{TRANS_LABELS[v.physicsSpec.transmissionType]}</div>
                  </div>
                </div>

                {/* Authentic Mechanical Capabilities */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                  {cap.hasHingedSeat && (
                    <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-200">
                      Yên mở: {cap.seatCompartmentLabel}
                    </span>
                  )}
                  {cap.hasSaddlebags && (
                    <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-200">
                      Túi da hông mở nắp
                    </span>
                  )}
                  {cap.hasGlovebox && (
                    <span className="rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-sky-200">
                      Hộc đồ trước mở thật
                    </span>
                  )}
                  {cap.hasAnalogNeedles && (
                    <span className="rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-sky-200">
                      Kim đồng hồ tốc độ & vòng tua thật
                    </span>
                  )}
                  {cap.hasKickstarter && (
                    <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-emerald-200">
                      Cần đạp khởi động + Cần số + Phanh chân
                    </span>
                  )}
                  {bestSpeed > 0 && (
                    <span className="ml-auto flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono text-emerald-300">
                      <Trophy className="h-3 w-3" /> Kỷ lục: {Math.round(bestSpeed)} km/h • {bestLean.toFixed(1)}°
                    </span>
                  )}
                </div>

                {/* Attribution */}
                <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
                  <ShieldCheck className="h-3 w-3 shrink-0 text-slate-500" />
                  <span>{v.attribution}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex-1" onClick={onClose} />
    </div>
  );
}
