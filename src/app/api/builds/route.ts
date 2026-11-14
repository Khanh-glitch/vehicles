import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { customBuilds } from '@/db/schema';
import { ensureCuratedVehiclesSeeded } from '@/db/seed';
import { desc, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    await ensureCuratedVehiclesSeeded();
    const vehicleId = req.nextUrl.searchParams.get('vehicleId');
    const rows = vehicleId
      ? await db
          .select()
          .from(customBuilds)
          .where(eq(customBuilds.vehicleId, vehicleId))
          .orderBy(desc(customBuilds.updatedAt))
      : await db.select().from(customBuilds).orderBy(desc(customBuilds.updatedAt));
    return NextResponse.json({ builds: rows });
  } catch (err) {
    console.error('GET /api/builds failed:', err);
    return NextResponse.json({ error: 'Failed to load custom builds' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureCuratedVehiclesSeeded();
    const body = await req.json();
    const { vehicleId, name, config, notes } = body;
    if (!vehicleId || !name || !config) {
      return NextResponse.json({ error: 'vehicleId, name, and config are required' }, { status: 400 });
    }
    const [created] = await db
      .insert(customBuilds)
      .values({
        vehicleId: String(vehicleId),
        name: String(name).trim().slice(0, 80),
        config,
        notes: notes ? String(notes).trim().slice(0, 300) : null,
      })
      .returning();
    return NextResponse.json({ build: created }, { status: 201 });
  } catch (err) {
    console.error('POST /api/builds failed:', err);
    return NextResponse.json({ error: 'Failed to save custom build' }, { status: 500 });
  }
}
