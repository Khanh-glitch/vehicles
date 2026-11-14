export type VehicleCategory =
  | 'underbone'
  | 'classic'
  | 'cruiser'
  | 'bobber'
  | 'sport'
  | 'scooter';

export type TransmissionType = 'semi_auto_4' | 'manual_5' | 'manual_6' | 'cvt';
export type AudioProfileType = 'single_thumper' | 'classic_ohv' | 'vtwin_45' | 'inline4_sport' | 'cvt_scooter';
export type PaintFinishType = 'gloss' | 'metallic' | 'matte' | 'pearl' | 'brushed';
export type LiveryStyle = 'factory' | 'racing_stripe' | 'heritage_pin' | 'cafe_gold' | 'stealth';
export type SeatStyle = 'black_leather' | 'cognac_tan' | 'oxblood_vintage' | 'alcantara_sport' | 'diamond_cafe';
export type RimStyle = 'factory' | 'chrome' | 'matte_black' | 'brushed_gold' | 'machined_silver';
export type HeadlightStyle = 'halogen_warm' | 'bi_led_halo' | 'vintage_yellow';

export interface VehiclePhysicsSpec {
  massKg: number;
  engineCC: number;
  engineLayout: string;
  horsepower: number;
  torqueNm: number;
  transmissionType: TransmissionType;
  gearCount: number;
  gearRatios: number[]; // Gear 1..N
  finalDrive: number;
  idleRpm: number;
  redlineRpm: number;
  peakTorqueRpm: number;
  topSpeedKmh: number;
  wheelbaseM: number;
  frontWheelRadiusM: number;
  rearWheelRadiusM: number;
  rakeDeg: number;
  maxSteerDeg: number;
  maxLeanDeg: number;
  leanRateRad: number;
  tireGrip: number;
  frontBrakeAccel: number;
  rearBrakeAccel: number;
  frontSuspStiffness: number;
  frontSuspDamping: number;
  rearSuspStiffness: number;
  rearSuspDamping: number;
  suspTravelM: number;
  wheelieFactor: number;
  audioProfile: AudioProfileType;
}

export interface HotspotDefinition {
  id: string;
  label: string;
  action: MechanicalActionKey;
  position: [number, number, number]; // local meters
  description: string;
}

export type MechanicalActionKey =
  | 'ignition'
  | 'starter'
  | 'headlight'
  | 'highBeam'
  | 'turnLeft'
  | 'turnRight'
  | 'hazard'
  | 'horn'
  | 'kickstand'
  | 'seat'
  | 'fuelCap'
  | 'saddlebags'
  | 'glovebox'
  | 'kickstarter';

export interface VehicleRigManifest {
  standType: 'side' | 'center';
  parkedLeanDeg: number;
  headlightPos: [number, number, number];
  taillightPos: [number, number, number];
  cockpitCamPos: [number, number, number];
  cockpitCamLook: [number, number, number];
  frontAxlePos: [number, number, number];
  rearAxlePos: [number, number, number];
  steeringHeadPos: [number, number, number];
  capabilities: {
    hasHingedSeat: boolean;
    hasMovingKickstand: boolean;
    seatCompartmentLabel: string; // e.g., "Bình xăng dưới yên" | "Cốp mũ bảo hiểm 22L" | "Ngăn ắc-quy & dụng cụ"
    hasFuelCap: boolean;
    fuelCapUnderSeat: boolean;
    hasSaddlebags: boolean;
    hasGlovebox: boolean;
    hasKickstarter: boolean;
    hasAnalogNeedles: boolean;
    hasMovingShifter: boolean;
    hasMovingBrakePedal: boolean;
  };
  paintableMaterials: string[];
  seatMaterials: string[];
  rimMaterials: string[];
  hotspots: HotspotDefinition[];
}

export interface CompatiblePartsManifest {
  paintPresets: { name: string; hex: string; finish: PaintFinishType }[];
  allowedLiveries: LiveryStyle[];
  allowedSeats: SeatStyle[];
  allowedRims: RimStyle[];
  allowedHeadlights: { id: HeadlightStyle; label: string }[];
}

export interface VehicleBuildConfig {
  paintHex: string;
  paintFinish: PaintFinishType;
  livery: LiveryStyle;
  seat: SeatStyle;
  rim: RimStyle;
  headlight: HeadlightStyle;
}

export interface VehicleRecord {
  id: string;
  name: string;
  subtitle: string;
  category: VehicleCategory;
  origin: string;
  year: number;
  description: string;
  modelUrl: string;
  sourceType: 'curated_glb' | 'custom_import';
  attribution: string;
  physicsSpec: VehiclePhysicsSpec;
  rigManifest: VehicleRigManifest;
  configOptions: CompatiblePartsManifest;
  defaultBuild: VehicleBuildConfig;
}

export interface CustomBuildRecord {
  id: number;
  vehicleId: string;
  name: string;
  config: VehicleBuildConfig;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MechanicalState {
  ignitionOn: boolean;
  engineRunning: boolean;
  starterCranking: boolean;
  headlightMode: 'off' | 'low' | 'high';
  turnSignal: 'off' | 'left' | 'right' | 'hazard';
  brakeLightOn: boolean;
  hornActive: boolean;
  kickstandDown: boolean;
  seatOpen: boolean;
  fuelCapOpen: boolean;
  saddlebagsOpen: boolean;
  gloveboxOpen: boolean;
  kickstarterImpulse: number; // 0..1 animation pulse
  shifterImpulse: number; // -1..1 animation pulse
  brakePedalPress: number; // 0..1
  throttleGrip: number; // 0..1
  steerPreviewDeg: number; // manual studio steering angle preview
  studioWheelSpin: boolean; // studio dyno spin test
}

export interface RideTelemetry {
  speedKmh: number;
  rpm: number;
  gear: number; // 0 = N, 1..6 = gears, -1 = CVT Drive
  gearLabel: string;
  leanDeg: number;
  steerDeg: number;
  pitchDeg: number;
  throttle: number;
  frontBrake: number;
  rearBrake: number;
  frontSuspCompression: number; // 0..1
  rearSuspCompression: number; // 0..1
  slipRatio: number; // 0..1
  distanceMeters: number;
  topSpeedKmh: number;
  maxLeanDeg: number;
  onRoad: boolean;
  warningMessage: string | null;
}
