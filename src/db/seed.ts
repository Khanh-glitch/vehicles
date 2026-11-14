import { db } from './index';
import { vehicles, customBuilds } from './schema';
import { CURATED_VEHICLES } from '@/lib/vehicles/catalog';
import { eq, count } from 'drizzle-orm';

let seededOnce = false;

export async function ensureCuratedVehiclesSeeded() {
  if (seededOnce) return;
  try {
    // Upsert all curated vehicles cleanly so updates to specs/manifests sync automatically
    for (const v of CURATED_VEHICLES) {
      await db
        .insert(vehicles)
        .values({
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
        })
        .onConflictDoUpdate({
          target: vehicles.id,
          set: {
            name: v.name,
            subtitle: v.subtitle,
            category: v.category,
            origin: v.origin,
            year: v.year,
            description: v.description,
            modelUrl: v.modelUrl,
            attribution: v.attribution,
            physicsSpec: v.physicsSpec,
            rigManifest: v.rigManifest,
            configOptions: v.configOptions,
            defaultBuild: v.defaultBuild,
          },
        });
    }

    // Remove the retired generated scooter from databases created by earlier versions.
    await db.delete(vehicles).where(eq(vehicles.id, 'saigon-scooter-125i'));

    // Seed showcase signature builds if table is empty
    const [{ total }] = await db.select({ total: count() }).from(customBuilds);
    if (Number(total) === 0) {
      await db.insert(customBuilds).values([
        {
          vehicleId: 'super-cub-c90',
          name: 'Sài Gòn Heritage 1986',
          notes: 'Bản sơn ngà hoài cổ, tem heritage, yên Cognac và chóa đèn vàng Pháp.',
          config: {
            paintHex: '#efe5cf',
            paintFinish: 'pearl',
            livery: 'heritage_pin',
            seat: 'cognac_tan',
            rim: 'chrome',
            headlight: 'vintage_yellow',
          },
        },
        {
          vehicleId: 'honda-cg-125',
          name: 'British Café Racer 125',
          notes: 'Phong cách Café Racer tối giản với sơn xanh British Green ánh kim và yên chần quả trám.',
          config: {
            paintHex: '#144230',
            paintFinish: 'metallic',
            livery: 'cafe_gold',
            seat: 'diamond_cafe',
            rim: 'brushed_gold',
            headlight: 'bi_led_halo',
          },
        },
        {
          vehicleId: 'fat-boy-cruiser',
          name: 'Midnight Outlaw 1868',
          notes: 'Cruiser sơn xám Gunmetal nhám, tem Stealth, yên đỏ rượu và đèn LED Daymaker.',
          config: {
            paintHex: '#4b5563',
            paintFinish: 'matte',
            livery: 'stealth',
            seat: 'oxblood_vintage',
            rim: 'matte_black',
            headlight: 'bi_led_halo',
          },
        },
      ]);
    }

    seededOnce = true;
  } catch (err) {
    console.error('ensureCuratedVehiclesSeeded error:', err);
  }
}

export async function getVehicleOrNull(id: string) {
  await ensureCuratedVehiclesSeeded();
  const rows = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
  return rows[0] ?? null;
}
