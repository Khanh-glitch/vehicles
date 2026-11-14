'use client';

import React, { useState } from 'react';
import {
  Palette,
  Disc,
  Sliders,
  BookmarkCheck,
  Save,
  Trash2,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Check,
} from 'lucide-react';
import type {
  VehicleRecord,
  VehicleBuildConfig,
  CustomBuildRecord,
  PaintFinishType,
  LiveryStyle,
  SeatStyle,
  RimStyle,
} from '@/lib/vehicles/types';

interface ConfiguratorDrawerProps {
  vehicle: VehicleRecord;
  config: VehicleBuildConfig;
  savedBuilds: CustomBuildRecord[];
  activeBuildId: number | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onChangeConfig: (next: VehicleBuildConfig) => void;
  onResetDefault: () => void;
  onSaveBuild: (name: string, notes: string) => Promise<void>;
  onLoadBuild: (b: CustomBuildRecord) => void;
  onDeleteBuild: (id: number) => Promise<void>;
}

type TabKey = 'paint' | 'wheels' | 'lighting' | 'builds';

const FINISH_LABELS: Record<PaintFinishType, string> = {
  gloss: 'Bóng Clearcoat',
  metallic: 'Ánh Kim',
  matte: 'Nhám Satin',
  pearl: 'Ngọc Trai',
  brushed: 'Kim Loại Xước',
};

const LIVERY_LABELS: Record<LiveryStyle, string> = {
  factory: 'Nguyên Bản Hãng',
  racing_stripe: 'Sọc Đua Đôi',
  heritage_pin: 'Chỉ Vàng Cổ Điển',
  cafe_gold: 'Café Racer Vàng',
  stealth: 'Carbon Stealth',
};

const SEAT_LABELS: Record<SeatStyle, { label: string; swatch: string }> = {
  black_leather: { label: 'Da Đen Cổ Điển', swatch: '#141518' },
  cognac_tan: { label: 'Da Bò Cognac', swatch: '#7c3f1d' },
  oxblood_vintage: { label: 'Da Đỏ Rượu Vintage', swatch: '#59151c' },
  alcantara_sport: { label: 'Alcantara Thể Thao', swatch: '#232730' },
  diamond_cafe: { label: 'Da Chần Quả Trám Café', swatch: '#5e3015' },
};

const RIM_LABELS: Record<RimStyle, { label: string; swatch: string }> = {
  factory: { label: 'Nguyên bản', swatch: '#94a3b8' },
  chrome: { label: 'Chrome Gương', swatch: '#f1f5f9' },
  matte_black: { label: 'Đen Nhám', swatch: '#181a1f' },
  brushed_gold: { label: 'Vàng Đồng CNC', swatch: '#c9a13b' },
  machined_silver: { label: 'Nhôm Phay Bạc', swatch: '#cbd5e1' },
};



export function ConfiguratorDrawer({
  vehicle,
  config,
  savedBuilds,
  activeBuildId,
  collapsed,
  onToggleCollapsed,
  onChangeConfig,
  onResetDefault,
  onSaveBuild,
  onLoadBuild,
  onDeleteBuild,
}: ConfiguratorDrawerProps) {
  const [tab, setTab] = useState<TabKey>('paint');
  const [buildName, setBuildName] = useState('');
  const [buildNotes, setBuildNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const opts = vehicle.configOptions;
  const patch = (partial: Partial<VehicleBuildConfig>) => onChangeConfig({ ...config, ...partial });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buildName.trim()) return;
    setSaving(true);
    try {
      await onSaveBuild(buildName.trim(), buildNotes.trim());
      setBuildName('');
      setBuildNotes('');
    } finally {
      setSaving(false);
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/15 bg-[#0b0f17]/85 px-3.5 py-2.5 text-xs font-semibold tracking-wide text-slate-200 shadow-2xl backdrop-blur-xl transition hover:border-amber-400/50 hover:text-amber-300"
      >
        <ChevronLeft className="h-4 w-4" />
        <span>Tùy Biến Atelier</span>
      </button>
    );
  }

  return (
    <aside className="pointer-events-auto flex max-h-[calc(100vh-175px)] w-[330px] flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#0a0e16]/88 text-slate-200 shadow-2xl backdrop-blur-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-400">
            <Sparkles className="h-3 w-3" />
            <span>Bespoke Configurator</span>
          </div>
          <h2 className="mt-0.5 text-sm font-semibold text-white">{vehicle.name}</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onResetDefault}
            title="Khôi phục nguyên bản"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Thu gọn tủ tùy biến"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="grid grid-cols-4 gap-1 border-b border-white/10 bg-white/[0.02] p-1.5 text-[11px]">
        {(
          [
            { key: 'paint', label: 'Sơn & Tem', icon: Palette },
            { key: 'wheels', label: 'Yên & Bánh', icon: Disc },
            { key: 'lighting', label: 'Đèn Xe', icon: Sliders },
            { key: 'builds', label: `Lưu (${savedBuilds.length})`, icon: BookmarkCheck },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex flex-col items-center gap-1 rounded-xl py-1.5 font-medium transition ${
              tab === key
                ? 'bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/40'
                : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {tab === 'paint' && (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Bảng Màu Sơn</span>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300 hover:border-amber-400/40">
                  <span>Tự chọn</span>
                  <input
                    type="color"
                    value={config.paintHex}
                    onChange={(e) => patch({ paintHex: e.target.value })}
                    className="h-3.5 w-3.5 cursor-pointer border-0 bg-transparent p-0"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {opts.paintPresets.map((p) => {
                  const active = config.paintHex.toLowerCase() === p.hex.toLowerCase();
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => patch({ paintHex: p.hex, paintFinish: p.finish })}
                      className={`flex items-center gap-2 rounded-xl border p-2 text-left transition ${
                        active
                          ? 'border-amber-400/70 bg-amber-400/12 text-white'
                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span
                        className="h-5 w-5 shrink-0 rounded-full border border-white/30 shadow-inner"
                        style={{ backgroundColor: p.hex }}
                      />
                      <span className="line-clamp-2 text-[11px] leading-tight">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Bề Mặt Sơn (PBR Clearcoat)</div>
              <div className="flex flex-wrap gap-1.5">
                {(['gloss', 'metallic', 'matte', 'pearl', 'brushed'] as PaintFinishType[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => patch({ paintFinish: f })}
                    className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition ${
                      config.paintFinish === f
                        ? 'border-sky-400/70 bg-sky-400/20 text-sky-200'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {FINISH_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Họa Tiết Tem Xe</div>
              <div className="grid grid-cols-2 gap-1.5">
                {opts.allowedLiveries.map((liv) => (
                  <button
                    key={liv}
                    type="button"
                    onClick={() => patch({ livery: liv })}
                    className={`rounded-xl border px-2.5 py-2 text-left text-[11px] font-medium transition ${
                      config.livery === liv
                        ? 'border-amber-400/70 bg-amber-400/15 text-amber-200'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {LIVERY_LABELS[liv]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'wheels' && (
          <>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Chất Liệu Bọc Yên</div>
              <div className="space-y-1.5">
                {opts.allowedSeats.map((s) => {
                  const info = SEAT_LABELS[s];
                  const active = config.seat === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => patch({ seat: s })}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 transition ${
                        active
                          ? 'border-amber-400/70 bg-amber-400/15 text-white'
                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="h-4 w-4 rounded-full border border-white/25" style={{ backgroundColor: info.swatch }} />
                        <span>{info.label}</span>
                      </span>
                      {active && <Check className="h-3.5 w-3.5 text-amber-300" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Hoàn Thiện Mâm / Vành</div>
              <div className="grid grid-cols-2 gap-1.5">
                {opts.allowedRims.map((r) => {
                  const info = RIM_LABELS[r];
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => patch({ rim: r })}
                      className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition ${
                        config.rim === r
                          ? 'border-sky-400/70 bg-sky-400/15 text-sky-200'
                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span className="h-3.5 w-3.5 rounded-full border border-white/30" style={{ backgroundColor: info.swatch }} />
                      <span className="text-[11px]">{info.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>


          </>
        )}

        {tab === 'lighting' && (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Nhiệt Màu Đèn Pha</div>
            <div className="space-y-1.5">
              {opts.allowedHeadlights.map((hl) => (
                <button
                  key={hl.id}
                  type="button"
                  onClick={() => patch({ headlight: hl.id })}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
                    config.headlight === hl.id
                      ? 'border-sky-400/70 bg-sky-400/15 text-sky-200'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                  }`}
                >
                  <span>{hl.label}</span>
                  {config.headlight === hl.id && <Check className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'builds' && (
          <div className="space-y-4">
            <form onSubmit={handleSave} className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">Lưu Bản Độ Hiện Tại (PostgreSQL)</div>
              <input
                type="text"
                placeholder="Tên bản độ (VD: Cub Sài Gòn 1986)..."
                value={buildName}
                onChange={(e) => setBuildName(e.target.value)}
                required
                className="w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-400/60"
              />
              <input
                type="text"
                placeholder="Ghi chú ngắn (tùy chọn)..."
                value={buildNotes}
                onChange={(e) => setBuildNotes(e.target.value)}
                className="w-full rounded-xl border border-white/12 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-400/60"
              />
              <button
                type="submit"
                disabled={saving || !buildName.trim()}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-300 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? 'Đang lưu...' : 'Lưu Cấu Hình Vào Garage'}</span>
              </button>
            </form>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Bản Độ Đã Lưu Cho {vehicle.name}
              </div>
              {savedBuilds.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-[11px] text-slate-500">
                  Chưa có bản độ nào được lưu cho dòng xe này. Hãy tùy biến và lưu cấu hình đầu tiên của bạn!
                </div>
              ) : (
                savedBuilds.map((b) => {
                  const isActive = activeBuildId === b.id;
                  return (
                    <div
                      key={b.id}
                      className={`group rounded-2xl border p-3 transition ${
                        isActive
                          ? 'border-amber-400/60 bg-amber-400/10'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onLoadBuild(b)}
                          className="flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3.5 w-3.5 rounded-full border border-white/30"
                              style={{ backgroundColor: b.config.paintHex }}
                            />
                            <span className="font-semibold text-white">{b.name}</span>
                          </div>
                          {b.notes && <p className="mt-1 text-[11px] leading-snug text-slate-400">{b.notes}</p>}
                          <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-slate-400">
                            <span className="rounded bg-white/5 px-1.5 py-0.5">{FINISH_LABELS[b.config.paintFinish]}</span>
                            <span className="rounded bg-white/5 px-1.5 py-0.5">{SEAT_LABELS[b.config.seat].label}</span>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteBuild(b.id)}
                          title="Xóa bản độ"
                          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
