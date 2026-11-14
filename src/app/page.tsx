import React from 'react';
import { db } from '@/db';
import { vehicles, customBuilds, testRideSessions } from '@/db/schema';
import { ensureCuratedVehiclesSeeded } from '@/db/seed';
import { CURATED_VEHICLES } from '@/lib/vehicles/catalog';
import { hasLocalVehicleModel } from '@/lib/vehicles/localAssets';
import { asc, desc } from 'drizzle-orm';
import { MotorcycleStudioApp } from '@/components/studio/MotorcycleStudioApp';
import type { VehicleRecord, CustomBuildRecord } from '@/lib/vehicles/types';
import type { RideSessionRow } from '@/components/studio/GarageDrawer';

export const dynamic = 'force-dynamic';

const bundledCuratedVehicles = CURATED_VEHICLES.filter((vehicle) => hasLocalVehicleModel(vehicle.modelUrl));
const unavailableCuratedVehicleNames = CURATED_VEHICLES
  .filter((vehicle) => !hasLocalVehicleModel(vehicle.modelUrl))
  .map((vehicle) => vehicle.name);

export default async function HomePage() {
  let initialVehicles: VehicleRecord[] = bundledCuratedVehicles;
  let initialBuilds: CustomBuildRecord[] = [];
  let initialSessions: RideSessionRow[] = [];

  try {
    await ensureCuratedVehiclesSeeded();
    const [vRows, bRows, sRows] = await Promise.all([
      db.select().from(vehicles).orderBy(asc(vehicles.createdAt)),
      db.select().from(customBuilds).orderBy(desc(customBuilds.updatedAt)),
      db.select().from(testRideSessions).orderBy(desc(testRideSessions.createdAt)).limit(30),
    ]);

    const bundledRows = vRows.filter((v) => hasLocalVehicleModel(v.modelUrl));
    if (bundledRows.length > 0) {
      initialVehicles = bundledRows.map((v) => ({
        id: v.id,
        name: v.name,
        subtitle: v.subtitle,
        category: v.category,
        origin: v.origin,
        year: v.year,
        description: v.description,
        modelUrl: v.modelUrl,
        sourceType: v.sourceType,
        attribution: v.attribution,
        physicsSpec: v.physicsSpec,
        rigManifest: v.rigManifest,
        configOptions: v.configOptions,
        defaultBuild: v.defaultBuild,
      }));
    }

    initialBuilds = bRows.map((b) => ({
      id: b.id,
      vehicleId: b.vehicleId,
      name: b.name,
      config: b.config,
      notes: b.notes,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }));

    initialSessions = sRows.map((s) => ({
      id: s.id,
      vehicleId: s.vehicleId,
      topSpeedKmh: s.topSpeedKmh,
      maxLeanDeg: s.maxLeanDeg,
      distanceMeters: s.distanceMeters,
      durationSec: s.durationSec,
      createdAt: s.createdAt.toISOString(),
    }));
  } catch (err) {
    // Graceful fallback if DB has not pushed tables yet during initial bootstrap
    console.warn('HomePage DB query fallback to curated catalog:', err);
  }

  return (
    <MotorcycleStudioApp
      initialVehicles={initialVehicles}
      initialBuilds={initialBuilds}
      initialSessions={initialSessions}
      unavailableVehicleNames={unavailableCuratedVehicleNames}
    />
  );
}
