import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { vehicles } from '@/db/schema';
import { ensureCuratedVehiclesSeeded } from '@/db/seed';
import { hasLocalVehicleModel } from '@/lib/vehicles/localAssets';
import { asc } from 'drizzle-orm';

export async function GET() {
  try {
    await ensureCuratedVehiclesSeeded();
    const list = await db.select().from(vehicles).orderBy(asc(vehicles.createdAt));
    return NextResponse.json({ vehicles: list.filter((vehicle) => hasLocalVehicleModel(vehicle.modelUrl)) });
  } catch (err) {
    console.error('GET /api/vehicles failed:', err);
    return NextResponse.json({ error: 'Failed to load vehicles' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureCuratedVehiclesSeeded();
    const body = await req.json();
    const {
      id,
      name,
      subtitle,
      category,
      origin,
      year,
      description,
      modelUrl,
      attribution,
      physicsSpec,
      rigManifest,
      configOptions,
      defaultBuild,
    } = body;

    if (!name || !modelUrl || !physicsSpec || !rigManifest) {
      return NextResponse.json({ error: 'Missing required vehicle fields' }, { status: 400 });
    }

    const slug =
      (id && String(id).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')) ||
      `custom-${Date.now()}`;

    const [created] = await db
      .insert(vehicles)
      .values({
        id: slug,
        name: String(name),
        subtitle: String(subtitle || 'Custom Rigged Vehicle • Moto Atelier Pipeline'),
        category: category || 'classic',
        origin: String(origin || 'Custom Workshop Import'),
        year: Number(year) || new Date().getFullYear(),
        description: String(description || 'Xe máy nhập và tách cơ cấu trực tiếp từ Vehicle Pipeline.'),
        modelUrl: String(modelUrl),
        sourceType: 'custom_import',
        attribution: String(attribution || 'User Imported GLB • Rigged via Moto Atelier Pipeline'),
        physicsSpec,
        rigManifest,
        configOptions,
        defaultBuild,
      })
      .onConflictDoUpdate({
        target: vehicles.id,
        set: {
          name: String(name),
          subtitle: String(subtitle || 'Custom Rigged Vehicle • Moto Atelier Pipeline'),
          category: category || 'classic',
          physicsSpec,
          rigManifest,
          configOptions,
          defaultBuild,
        },
      })
      .returning();

    return NextResponse.json({ vehicle: created }, { status: 201 });
  } catch (err) {
    console.error('POST /api/vehicles failed:', err);
    return NextResponse.json({ error: 'Failed to register vehicle' }, { status: 500 });
  }
}
