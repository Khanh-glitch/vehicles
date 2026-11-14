import type { VehiclePhysicsSpec, VehicleRigManifest, RideTelemetry } from '@/lib/vehicles/types';

export interface TerrainSample {
  height: number;
  surface: 'asphalt' | 'bump' | 'cobble' | 'offroad';
  gripMultiplier: number;
  dragMultiplier: number;
}

export interface RiderInputs {
  throttle: number; // 0..1
  frontBrake: number; // 0..1
  rearBrake: number; // 0..1
  steer: number; // -1 (right) .. +1 (left)
  shiftUp: boolean;
  shiftDown: boolean;
  clutch: boolean;
  autoShift: boolean;
  engineRunning: boolean;
  kickstandDown: boolean;
}

const G = 9.81;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class MotorcycleDynamics {
  public spec: VehiclePhysicsSpec;
  public rig: VehicleRigManifest;

  // World pose (Y-up, +Z forward at heading=0, +X left)
  public x = 0;
  public y = 0;
  public z = 0;
  public vy = 0;
  public heading = 0; // rad, +ve turns LEFT (+X)
  public speed = 0; // m/s forward
  public lean = 0; // rad, +ve leans LEFT (+X)
  public visLean = 0; // rendered roll rad
  public steerAngle = 0; // rad, +ve steers LEFT (+X)
  public pitch = 0; // rad, +ve = nose dive, -ve = wheelie
  public slipAngle = 0; // rad rear slip
  public wheelie = 0;

  // Wheel & suspension mechanics
  public frontWheelAngle = 0; // rad
  public rearWheelAngle = 0; // rad
  public frontSuspComp = 0; // 0..1 normalized compression
  public rearSuspComp = 0; // 0..1 normalized compression
  private frontSuspVel = 0;
  private rearSuspVel = 0;
  private prevFrontGround = 0;
  private prevRearGround = 0;

  // Engine & transmission
  public gear = 0; // 0 = N, 1..N = manual/semi-auto, -1 = CVT Drive
  public rpm = 0;
  public cvtRatio = 2.35;
  public shiftCooldown = 0;
  public shiftCutTimer = 0; // brief torque/ignition cut on upshift
  public lastShiftDir = 0; // -1 or +1 for shifter pedal animation

  // Ride session stats
  public distanceMeters = 0;
  public topSpeedKmh = 0;
  public maxLeanDeg = 0;
  public airborne = false;
  public warningMessage: string | null = null;
  private warningTimer = 0;
  private prevLean = 0;

  // Exhaust sound/power modifier from configurator

  constructor(spec: VehiclePhysicsSpec, rig: VehicleRigManifest) {
    this.spec = spec;
    this.rig = rig;
    this.reset(0, 0, 0, 0);
  }

  public updateSpec(spec: VehiclePhysicsSpec, rig: VehicleRigManifest) {
    this.spec = spec;
    this.rig = rig;
    if (spec.transmissionType === 'cvt') {
      this.gear = -1;
    } else if (this.gear > spec.gearCount) {
      this.gear = 1;
    }
  }

  public reset(x = 0, z = 0, heading = 0, groundY = 0) {
    this.x = x;
    this.y = groundY;
    this.z = z;
    this.vy = 0;
    this.heading = heading;
    this.speed = 0;
    this.lean = 0;
    this.visLean = 0;
    this.prevLean = 0;
    this.steerAngle = 0;
    this.pitch = 0;
    this.slipAngle = 0;
    this.wheelie = 0;
    this.frontSuspComp = 0.15;
    this.rearSuspComp = 0.15;
    this.frontSuspVel = 0;
    this.rearSuspVel = 0;
    this.prevFrontGround = groundY;
    this.prevRearGround = groundY;
    this.gear = this.spec.transmissionType === 'cvt' ? -1 : 0;
    this.rpm = 0;
    this.airborne = false;
    this.warningMessage = null;
    this.warningTimer = 0;
  }

  public resetSessionStats() {
    this.distanceMeters = 0;
    this.topSpeedKmh = 0;
    this.maxLeanDeg = 0;
  }

  public setWarning(msg: string, duration = 2.0) {
    this.warningMessage = msg;
    this.warningTimer = duration;
  }

  public getGearLabel(): string {
    if (this.spec.transmissionType === 'cvt') return 'D (CVT)';
    if (this.gear === 0) return 'N';
    return String(this.gear);
  }

  /**
   * Computes realistic torque curve multiplier (0.45..1.05) across RPM band
   */
  private torqueCurve(rpm: number): number {
    const idle = this.spec.idleRpm;
    const red = this.spec.redlineRpm;
    const peak = this.spec.peakTorqueRpm;
    const norm = clamp((rpm - idle) / Math.max(1000, red - idle), 0, 1.15);
    const peakNorm = clamp((peak - idle) / Math.max(1000, red - idle), 0.2, 0.85);
    const dist = Math.abs(norm - peakNorm);
    // Cruisers have fat low-end torque; sportbikes surge above midrange
    const lowEndFloor = this.spec.audioProfile === 'vtwin_45' ? 0.78 : this.spec.audioProfile === 'inline4_sport' ? 0.42 : 0.62;
    let factor = 1.0 - dist * dist * 1.15;
    factor = clamp(factor, lowEndFloor, 1.05);
    if (rpm > red * 0.98) factor *= Math.max(0.05, 1 - (rpm - red * 0.98) / 600); // rev limiter
    return factor;
  }

  public step(
    inputs: RiderInputs,
    dtRaw: number,
    sampleTerrain: (x: number, z: number) => TerrainSample
  ): RideTelemetry {
    const dt = Math.min(dtRaw, 0.04);
    this.lastShiftDir = 0;

    if (this.warningTimer > 0) {
      this.warningTimer -= dt;
      if (this.warningTimer <= 0) this.warningMessage = null;
    }
    if (this.shiftCooldown > 0) this.shiftCooldown -= dt;
    if (this.shiftCutTimer > 0) this.shiftCutTimer -= dt;

    // Sample terrain independently under Front and Rear wheel contact patches!
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const fz = this.rig.frontAxlePos[2];
    const rz = this.rig.rearAxlePos[2];

    const frontSample = sampleTerrain(this.x + sinH * fz, this.z + cosH * fz);
    const rearSample = sampleTerrain(this.x + sinH * rz, this.z + cosH * rz);
    const midSample = sampleTerrain(this.x, this.z);

    const onRoad = midSample.surface !== 'offroad';
    const surfaceGrip = Math.min(frontSample.gripMultiplier, rearSample.gripMultiplier);
    const effGrip = this.spec.tireGrip * surfaceGrip;
    const maxLatAccel = effGrip * G;

    // ------------------------------------------------------------------------
    // 1. ENGINE RPM & TRANSMISSION LOGIC
    // ------------------------------------------------------------------------
    const isCVT = this.spec.transmissionType === 'cvt';
    const isSemiAuto = this.spec.transmissionType === 'semi_auto_4';

    // Handle explicit manual shifting
    if (!isCVT && this.shiftCooldown <= 0) {
      if (inputs.shiftUp) {
        if (this.gear === 0) {
          this.gear = 1;
          this.lastShiftDir = 1;
          this.shiftCooldown = 0.22;
        } else if (this.gear < this.spec.gearCount) {
          this.gear += 1;
          this.lastShiftDir = 1;
          this.shiftCooldown = 0.22;
          this.shiftCutTimer = 0.09;
        } else if (isSemiAuto && this.speed < 0.8) {
          // Rotary Cub 4->N at standstill!
          this.gear = 0;
          this.lastShiftDir = 1;
          this.shiftCooldown = 0.25;
        }
      } else if (inputs.shiftDown) {
        if (this.gear > 1) {
          this.gear -= 1;
          this.lastShiftDir = -1;
          this.shiftCooldown = 0.20;
        } else if (this.gear === 1) {
          this.gear = 0;
          this.lastShiftDir = -1;
          this.shiftCooldown = 0.22;
        }
      }
    }

    // Assist auto-shift if enabled (still respects bike's real gear ratios & shift cut!)
    if (!isCVT && inputs.autoShift && inputs.engineRunning && !inputs.kickstandDown && this.shiftCooldown <= 0) {
      if (this.gear === 0 && inputs.throttle > 0.12) {
        this.gear = 1;
        this.lastShiftDir = 1;
        this.shiftCooldown = 0.25;
      } else if (this.gear >= 1 && this.gear < this.spec.gearCount && this.rpm > this.spec.redlineRpm * 0.84 && inputs.throttle > 0.25) {
        this.gear += 1;
        this.lastShiftDir = 1;
        this.shiftCooldown = 0.35;
        this.shiftCutTimer = 0.10;
      } else if (this.gear > 1 && this.rpm < this.spec.idleRpm + (this.spec.redlineRpm - this.spec.idleRpm) * 0.26) {
        this.gear -= 1;
        this.lastShiftDir = -1;
        this.shiftCooldown = 0.30;
      }
    }

    // Kickstand safety interlock!
    let effectiveThrottle = inputs.throttle;
    if (inputs.kickstandDown && effectiveThrottle > 0.15) {
      effectiveThrottle = 0;
      this.setWarning('Chân chống đang hạ — nhấn [K] để gạt chân chống trước khi chạy!', 1.8);
    }
    if (!inputs.engineRunning && inputs.throttle > 0.15) {
      effectiveThrottle = 0;
      this.setWarning('Động cơ đang tắt — nhấn [E] để đề nổ máy!', 1.8);
    }

    const absV = Math.abs(this.speed);
    const wheelCircumf = 2 * Math.PI * this.spec.rearWheelRadiusM;

    // Authentic motorcycle primary reduction ratio (crankshaft-to-clutch gear reduction!)
    // Calibrated so top gear at redline matches real topSpeedKmh cleanly!
    const topSpeedMs = this.spec.topSpeedKmh / 3.6;
    const topGearRatio = this.spec.gearRatios[this.spec.gearRatios.length - 1] || 1.0;
    const topWheelRpm = (topSpeedMs / wheelCircumf) * 60;
    const primaryReduction = isCVT
      ? clamp((this.spec.redlineRpm * 0.88) / Math.max(1, topWheelRpm * 0.90 * this.spec.finalDrive), 1.4, 4.2)
      : clamp((this.spec.redlineRpm * 0.92) / Math.max(1, topWheelRpm * topGearRatio * this.spec.finalDrive), 1.45, 4.4);

    // Calculate drivetrain total ratio (primary * gear * final) and target RPM
    let totalRatio = 0;
    if (isCVT) {
      this.gear = -1;
      const speedFrac = clamp(absV / topSpeedMs, 0, 1);
      // CVT variator smoothly shifts from low ratio (2.45) to overdrive (0.90)
      const targetCvt = 2.45 - 1.55 * Math.pow(speedFrac, 0.72);
      this.cvtRatio += (targetCvt - this.cvtRatio) * Math.min(1, dt * 6);
      totalRatio = primaryReduction * this.cvtRatio * this.spec.finalDrive;
    } else if (this.gear >= 1) {
      const gIdx = clamp(this.gear - 1, 0, this.spec.gearRatios.length - 1);
      totalRatio = primaryReduction * this.spec.gearRatios[gIdx] * this.spec.finalDrive;
    }

    if (!inputs.engineRunning) {
      this.rpm += (0 - this.rpm) * Math.min(1, dt * 6);
    } else if (this.gear === 0 || inputs.clutch || inputs.kickstandDown) {
      // Free-revving in neutral or clutch pulled!
      const freeTarget = this.spec.idleRpm + inputs.throttle * (this.spec.redlineRpm - this.spec.idleRpm) * 0.92;
      const revRate = inputs.throttle > 0.05 ? 9.0 : 4.2;
      this.rpm += (freeTarget - this.rpm) * Math.min(1, dt * revRate);
    } else {
      const wheelRpm = (absV / wheelCircumf) * 60;
      const coupledRpm = wheelRpm * totalRatio;
      // Centrifugal / wet-plate clutch slip below launch speed
      const slipEngage = clamp(absV / 3.8, 0, 1);
      const launchRpm = this.spec.idleRpm + effectiveThrottle * (this.spec.peakTorqueRpm - this.spec.idleRpm) * 0.72;
      const targetRpm = Math.max(this.spec.idleRpm, coupledRpm * slipEngage + launchRpm * (1 - slipEngage));
      const clippedTarget = Math.min(this.spec.redlineRpm * 1.02, targetRpm);
      this.rpm += (clippedTarget - this.rpm) * Math.min(1, dt * 11);
    }

    // ------------------------------------------------------------------------
    // 2. LONGITUDINAL FORCES (DRIVE TORQUE + POWER BAND, AERO DRAG, ROLLING, FRONT/REAR BRAKES)
    // ------------------------------------------------------------------------
    let driveAccel = 0;

    if (inputs.engineRunning && !inputs.kickstandDown && !inputs.clutch && this.gear !== 0 && this.shiftCutTimer <= 0 && !this.airborne) {
      const tCurve = this.torqueCurve(this.rpm);
      const totalMass = this.spec.massKg + 72; // bike + rider
      // Mechanical wheel thrust = (crankTorque * primary * gear * final * drivetrainEff) / rearRadius
      const torqueForce = (this.spec.torqueNm * tCurve * totalRatio * 0.88) / this.spec.rearWheelRadiusM;
      // Cap traction force at rear tire friction limit (~1.05 * g * rearWeightShare) and power limit (P / v)
      const peakPowerWatts = this.spec.horsepower * 745.7;
      const powerCappedForce = peakPowerWatts / Math.max(absV, 4.2);
      const wheelForce = Math.min(torqueForce, powerCappedForce * 1.38);
      const rawDrive = (wheelForce / totalMass) * effectiveThrottle;
      // Smooth aerodynamic ceiling taper toward bike's authentic top speed
      const speedHeadroom = Math.max(0, 1 - Math.pow(Math.max(0, this.speed) / (topSpeedMs * 1.05), 3.0));
      driveAccel = Math.min(rawDrive, 10.8) * speedHeadroom;

      // Friction ellipse: cornering lean shares rear tire grip with acceleration!
      if (absV > 2) {
        const latDemand = Math.min(1, (G * Math.tan(Math.abs(this.lean))) / maxLatAccel);
        driveAccel *= 0.45 + 0.55 * Math.sqrt(Math.max(0, 1 - latDemand * latDemand));
      }
    }

    // Engine braking when off-throttle in gear
    let engineBrake = 0;
    if (inputs.engineRunning && this.gear !== 0 && effectiveThrottle < 0.05 && this.speed > 0.4 && !inputs.clutch) {
      engineBrake = (isCVT ? 0.45 : 1.15) * clamp(this.rpm / this.spec.redlineRpm, 0.2, 1);
    }

    // Aerodynamic drag + rolling resistance + slope gravity
    const roadSlope = Math.atan2(frontSample.height - rearSample.height, this.spec.wheelbaseM);
    const slopeAccel = -G * Math.sin(roadSlope);
    const aeroDrag = 0.0014 * this.speed * absV * (this.spec.categoryForce ?? 1);
    const rollingDrag = (0.28 + (onRoad ? 0 : 1.8) * midSample.dragMultiplier) * Math.sign(this.speed);

    // Cornering tire scrub
    const scrubDrag = (!this.airborne && absV > 2) ? G * Math.tan(Math.abs(this.lean)) * 0.025 * Math.sign(this.speed) : 0;

    // Independent Front & Rear Braking (scaled by available surface grip!)
    let brakeAccel = 0;
    if (!this.airborne && this.speed > 0.05) {
      const fBrake = inputs.frontBrake * this.spec.frontBrakeAccel * (0.4 + 0.6 * Math.min(1.2, effGrip));
      const rBrake = inputs.rearBrake * this.spec.rearBrakeAccel * (0.5 + 0.5 * Math.min(1.1, effGrip));
      brakeAccel = fBrake + rBrake;
    }

    let netAccel = driveAccel - engineBrake - aeroDrag - rollingDrag - scrubDrag - brakeAccel + slopeAccel;
    if (this.airborne) netAccel = -0.15 * Math.sign(this.speed);

    this.speed += netAccel * dt;

    // Walking foot-push reverse when holding brake at standstill (so you can back out of parking!)
    if (this.speed <= 0.08 && inputs.frontBrake > 0.5 && effectiveThrottle < 0.05 && !inputs.kickstandDown && !this.airborne) {
      this.speed = clamp(this.speed - 2.2 * dt, -1.8, 0.08);
    } else if (this.speed < 0 && inputs.frontBrake < 0.2) {
      this.speed = Math.min(0, this.speed + 5.0 * dt);
    }
    if (effectiveThrottle < 0.02 && inputs.frontBrake < 0.02 && inputs.rearBrake < 0.02 && Math.abs(this.speed) < 0.22 && Math.abs(roadSlope) < 0.04) {
      this.speed = 0;
    }

    // ------------------------------------------------------------------------
    // 3. TWO-WHEEL STEERING, COUNTERSTEERING & COORDINATED-TURN LEAN DYNAMICS
    // ------------------------------------------------------------------------
    const maxLeanRad = (this.spec.maxLeanDeg * Math.PI) / 180;
    const gripLeanRad = Math.atan(maxLatAccel / G);
    const usableLeanCap = Math.min(maxLeanRad, gripLeanRad * (onRoad ? 1.04 : 1.15));

    // Lean authority scales smoothly from 0 at parking speed to full above ~14 m/s (50 km/h)
    const leanAuthority = clamp((absV - 1.2) / 11.5, 0, 1);
    const targetLean = inputs.kickstandDown
      ? (this.rig.parkedLeanDeg * Math.PI) / 180 // leans left onto side stand!
      : inputs.steer * usableLeanCap * (0.12 + 0.88 * leanAuthority);

    const leanStep = this.spec.leanRateRad * dt;
    this.prevLean = this.lean;
    this.lean += clamp(targetLean - this.lean, -leanStep, leanStep);
    const leanRate = (this.lean - this.prevLean) / Math.max(dt, 0.001);

    // Low-speed kinematic bicycle yaw (v * tan(delta) / L) blended smoothly with high-speed coordinated-turn yaw (g * tan(phi) / v)!
    const maxSteerRad = (this.spec.maxSteerDeg * Math.PI) / 180;
    const lowSpeedBlend = clamp((absV - 3.2) / 5.5, 0, 1); // 0 = low-speed handlebar steer, 1 = high-speed lean turn!

    const kinSteer = inputs.steer * maxSteerRad * clamp(1.0 - absV / 12, 0.15, 1.0);
    const yawKinematic = (this.speed * Math.tan(kinSteer)) / Math.max(1.1, this.spec.wheelbaseM);
    const yawCoordinated = (G * Math.tan(this.lean)) / Math.max(absV, 3.6);

    let yawRate = yawKinematic * (1 - lowSpeedBlend) + yawCoordinated * lowSpeedBlend * Math.sign(this.speed || 1);

    // Traction circle & Rear-brake powerslide (inspired by motomad!)
    let slipRatio = 0;
    let targetSlip = 0;
    const latRequired = Math.abs(this.speed * yawRate);
    if (latRequired > maxLatAccel && absV > 2.5 && !this.airborne) {
      const gripFrac = maxLatAccel / latRequired;
      slipRatio = 1 - gripFrac;
      yawRate *= 0.55 + 0.45 * gripFrac;
      const maxSlip = onRoad ? 0.09 : 0.42;
      targetSlip = Math.sign(yawRate) * Math.min(slipRatio * 2.2, 1) * maxSlip;
      this.speed -= Math.min((latRequired - maxLatAccel) * 0.35, 5.0) * dt * Math.sign(this.speed || 1);
    }

    // Deliberate rear-brake tail kick when sliding into a corner
    if (inputs.rearBrake > 0.65 && !this.airborne && absV > 5.5 && Math.abs(inputs.steer) > 0.15) {
      yawRate *= 1.32;
      targetSlip += Math.sign(inputs.steer) * 0.24;
      slipRatio = Math.max(slipRatio, 0.55);
    }

    const slipTau = onRoad ? 0.09 : 0.28;
    this.slipAngle += (targetSlip - this.slipAngle) * Math.min(1, dt / slipTau);

    // Visual Roll = balanced cornering roll + slip angle (or parked kickstand lean at standstill!)
    let targetVisLean: number;
    if (inputs.kickstandDown && absV < 0.2) {
      targetVisLean = (this.rig.parkedLeanDeg * Math.PI) / 180;
    } else if (absV < 0.5) {
      targetVisLean = 0;
    } else {
      targetVisLean = Math.atan2(this.speed * yawRate, G) + this.slipAngle * 0.45;
    }
    this.visLean += (targetVisLean - this.visLean) * Math.min(1, dt * 10);

    // Visual Handlebar Steering Angle:
    // - Below 15 km/h: turns visibly INTO turn (up to maxSteerRad)
    // - At high speed: shows subtle COUNTERSTEERING flick proportional to -leanRate while initiating lean,
    //   plus natural trail-camber alignment into the corner!
    let targetSteerVis = 0;
    if (absV < 4.5) {
      targetSteerVis = inputs.steer * maxSteerRad * 0.85;
    } else {
      const counterSteerImpulse = -leanRate * 0.055 * lowSpeedBlend;
      const camberTrailSteer = this.visLean * 0.14;
      targetSteerVis = clamp(kinSteer * (1 - lowSpeedBlend) + (counterSteerImpulse + camberTrailSteer) * lowSpeedBlend, -maxSteerRad * 0.6, maxSteerRad * 0.6);
    }
    this.steerAngle += (targetSteerVis - this.steerAngle) * Math.min(1, dt * 14);

    // Integrate Heading & Horizontal World Position
    if (!inputs.kickstandDown || absV > 0.1) {
      this.heading = wrapAngle(this.heading + yawRate * dt);
      const moveDir = this.heading - this.slipAngle;
      const ds = this.speed * dt;
      this.x += Math.sin(moveDir) * ds;
      this.z += Math.cos(moveDir) * ds;
      this.distanceMeters += Math.abs(ds);
    }

    // ------------------------------------------------------------------------
    // 4. WHEEL ROTATION (TRUE GROUND DISTANCE — NO FAKE DECORATIVE SPINNING!)
    // ------------------------------------------------------------------------
    const ds = this.speed * dt;
    // Front wheel locks slightly only under extreme front braking on low grip
    const frontLock = inputs.frontBrake > 0.9 && !onRoad ? 0.55 : 1.0;
    // Rear wheel slows noticeably during rear-brake slide lockup
    const rearLock = inputs.rearBrake > 0.8 && absV > 4 ? 0.35 : 1.0;
    this.frontWheelAngle += (ds / this.spec.frontWheelRadiusM) * frontLock;
    this.rearWheelAngle += (ds / this.spec.rearWheelRadiusM) * rearLock;

    // ------------------------------------------------------------------------
    // 5. INDEPENDENT FRONT & REAR SPRING-DAMPER SUSPENSION + PITCH / WHEELIE / BRAKE DIVE
    // ------------------------------------------------------------------------
    const avgGroundY = (frontSample.height + rearSample.height) * 0.5;
    const frontGroundVel = (frontSample.height - this.prevFrontGround) / Math.max(dt, 0.001);
    const rearGroundVel = (rearSample.height - this.prevRearGround) / Math.max(dt, 0.001);
    this.prevFrontGround = frontSample.height;
    this.prevRearGround = rearSample.height;

    // Weight transfer from longitudinal acceleration / front braking
    const brakeDiveLoad = clamp(inputs.frontBrake * (absV > 1.5 ? 0.55 : 0.18), 0, 0.62);
    const accelSquatLoad = clamp((driveAccel / 10) * 0.32, 0, 0.35);

    // Cobble/bump excitation impulses
    const cobbleBuzz = (midSample.surface === 'cobble' && absV > 1.5)
      ? Math.sin(this.distanceMeters * 14) * 0.14 * clamp(absV / 10, 0.2, 1)
      : 0;

    // Spring-damper integration (normalized 0..1 travel — responsive to bumps, cobbles, braking & squat!)
    const fTargetComp = clamp(0.18 + brakeDiveLoad - accelSquatLoad * 0.4 + clamp(frontGroundVel * 0.36, -0.38, 0.78) + cobbleBuzz, 0, 1);
    const rTargetComp = clamp(0.18 + accelSquatLoad - brakeDiveLoad * 0.28 + clamp(rearGroundVel * 0.36, -0.38, 0.78) - cobbleBuzz * 0.8, 0, 1);

    const fK = this.spec.frontSuspStiffness / (this.spec.massKg * 2.2);
    const fC = this.spec.frontSuspDamping / (this.spec.massKg * 1.4);
    const rK = this.spec.rearSuspStiffness / (this.spec.massKg * 2.2);
    const rC = this.spec.rearSuspDamping / (this.spec.massKg * 1.4);

    this.frontSuspVel += ((fTargetComp - this.frontSuspComp) * fK - this.frontSuspVel * fC) * dt;
    this.frontSuspComp = clamp(this.frontSuspComp + this.frontSuspVel * dt, 0, 1);

    this.rearSuspVel += ((rTargetComp - this.rearSuspComp) * rK - this.rearSuspVel * rC) * dt;
    this.rearSuspComp = clamp(this.rearSuspComp + this.rearSuspVel * dt, 0, 1);

    // Vertical ground contact & crest jump check
    this.vy -= G * dt;
    this.y += this.vy * dt;
    if (this.y <= avgGroundY) {
      this.y = avgGroundY;
      this.vy = Math.max(0, (frontGroundVel + rearGroundVel) * 0.4);
      this.airborne = false;
    } else if (this.y > avgGroundY + 0.08) {
      this.airborne = true;
    }

    // Power wheelie on high-torque bikes in low gears + front brake dive pitch
    const wantWheelie =
      !this.airborne &&
      this.spec.wheelieFactor > 0.35 &&
      effectiveThrottle > 0.88 &&
      this.gear === 1 &&
      absV > 3 &&
      absV < topSpeedMs * 0.36 &&
      Math.abs(inputs.steer) < 0.35;
    const wheelieTarget = wantWheelie ? this.spec.wheelieFactor * 0.42 : 0;
    this.wheelie += (wheelieTarget - this.wheelie) * Math.min(1, dt * (wantWheelie ? 2.8 : 6.0));

    // Pitch: road slope + suspension dive/squat + wheelie (-ve lifts nose!)
    const suspPitch = ((this.frontSuspComp - this.rearSuspComp) * this.spec.suspTravelM) / this.spec.wheelbaseM;
    const targetPitch = -roadSlope + suspPitch * 1.25 - this.wheelie;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 12);

    // Track session peak stats
    const speedKmh = absV * 3.6;
    const leanDeg = (this.visLean * 180) / Math.PI;
    if (speedKmh > this.topSpeedKmh) this.topSpeedKmh = speedKmh;
    if (Math.abs(leanDeg) > this.maxLeanDeg) this.maxLeanDeg = Math.abs(leanDeg);

    return {
      speedKmh,
      rpm: this.rpm,
      gear: this.gear,
      gearLabel: this.getGearLabel(),
      leanDeg,
      steerDeg: (this.steerAngle * 180) / Math.PI,
      pitchDeg: (this.pitch * 180) / Math.PI,
      throttle: effectiveThrottle,
      frontBrake: inputs.frontBrake,
      rearBrake: inputs.rearBrake,
      frontSuspCompression: this.frontSuspComp,
      rearSuspCompression: this.rearSuspComp,
      slipRatio,
      distanceMeters: this.distanceMeters,
      topSpeedKmh: this.topSpeedKmh,
      maxLeanDeg: this.maxLeanDeg,
      onRoad,
      warningMessage: this.warningMessage,
    };
  }
}

// Type-safe optional field extension cleanly avoided; helper multiplier default
declare module '@/lib/vehicles/types' {
  interface VehiclePhysicsSpec {
    categoryForce?: number;
  }
}
