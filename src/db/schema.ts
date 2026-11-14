import {
  pgTable,
  text,
  integer,
  serial,
  real,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  VehiclePhysicsSpec,
  VehicleRigManifest,
  CompatiblePartsManifest,
  VehicleBuildConfig,
  VehicleCategory,
} from '@/lib/vehicles/types';

export const vehicles = pgTable('vehicles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  subtitle: text('subtitle').notNull(),
  category: text('category').$type<VehicleCategory>().notNull(),
  origin: text('origin').notNull(),
  year: integer('year').notNull(),
  description: text('description').notNull(),
  modelUrl: text('model_url').notNull(),
  sourceType: text('source_type').$type<'curated_glb' | 'custom_import'>().notNull().default('curated_glb'),
  attribution: text('attribution').notNull(),
  physicsSpec: jsonb('physics_spec').$type<VehiclePhysicsSpec>().notNull(),
  rigManifest: jsonb('rig_manifest').$type<VehicleRigManifest>().notNull(),
  configOptions: jsonb('config_options').$type<CompatiblePartsManifest>().notNull(),
  defaultBuild: jsonb('default_build').$type<VehicleBuildConfig>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const customBuilds = pgTable('custom_builds', {
  id: serial('id').primaryKey(),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  config: jsonb('config').$type<VehicleBuildConfig>().notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const testRideSessions = pgTable('test_ride_sessions', {
  id: serial('id').primaryKey(),
  vehicleId: text('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  buildId: integer('build_id').references(() => customBuilds.id, { onDelete: 'set null' }),
  topSpeedKmh: real('top_speed_kmh').notNull(),
  maxLeanDeg: real('max_lean_deg').notNull(),
  distanceMeters: real('distance_meters').notNull(),
  durationSec: real('duration_sec').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
