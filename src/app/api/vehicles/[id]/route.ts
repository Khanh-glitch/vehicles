import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { vehicles } from '@/db/schema';
import { ensureCuratedVehiclesSeeded } from '@/db/seed';
import { hasLocalVehicleModel } from '@/lib/vehicles/localAssets';
import { eq } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCuratedVehiclesSeeded();
    const { id } = await context.params;
    const rows = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
    if (!rows[0] || !hasLocalVehicleModel(rows[0].modelUrl)) {
      return NextResponse.json({ error: 'Vehicle not found or its local model asset is unavailable' }, { status: 404 });
    }
    return NextResponse.json({ vehicle: rows[0] });
  } catch (err) {
    console.error('GET /api/vehicles/[id] failed:', err);
    return NextResponse.json({ error: 'Failed to fetch vehicle' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCuratedVehiclesSeeded();
    const { id } = await context.params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.physicsSpec !== undefined) updates.physicsSpec = body.physicsSpec;
    if (body.rigManifest !== undefined) updates.rigManifest = body.rigManifest;
    if (body.defaultBuild !== undefined) updates.defaultBuild = body.defaultBuild;

    const [updated] = await db
      .update(vehicles)
      .set(updates)
      .where(eq(vehicles.id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    return NextResponse.json({ vehicle: updated });
  } catch (err) {
    console.error('PATCH /api/vehicles/[id] failed:', err);
    return NextResponse.json({ error: 'Failed to update vehicle' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const rows = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
    if (!rows[0]) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    if (rows[0].sourceType !== 'custom_import') {
      return NextResponse.json({ error: 'Cannot delete core curated vehicle' }, { status: 400 });
    }
    await db.delete(vehicles).where(eq(vehicles.id, id));
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /api/vehicles/[id] failed:', err);
    return NextResponse.json({ error: 'Failed to delete vehicle' }, { status: 500 });
  }
}
