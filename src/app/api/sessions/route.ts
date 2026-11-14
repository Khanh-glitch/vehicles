import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { testRideSessions } from '@/db/schema';
import { ensureCuratedVehiclesSeeded } from '@/db/seed';
import { desc, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    await ensureCuratedVehiclesSeeded();
    const vehicleId = req.nextUrl.searchParams.get('vehicleId');
    const rows = vehicleId
      ? await db
          .select()
          .from(testRideSessions)
          .where(eq(testRideSessions.vehicleId, vehicleId))
          .orderBy(desc(testRideSessions.createdAt))
          .limit(20)
      : await db
          .select()
          .from(testRideSessions)
          .orderBy(desc(testRideSessions.createdAt))
          .limit(20);
    return NextResponse.json({ sessions: rows });
  } catch (err) {
    console.error('GET /api/sessions failed:', err);
    return NextResponse.json({ error: 'Failed to load sessions' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureCuratedVehiclesSeeded();
    const body = await req.json();
    const { vehicleId, buildId, topSpeedKmh, maxLeanDeg, distanceMeters, durationSec } = body;
    if (!vehicleId) {
      return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
    }
    const [created] = await db
      .insert(testRideSessions)
      .values({
        vehicleId: String(vehicleId),
        buildId: buildId ? Number(buildId) : null,
        topSpeedKmh: Math.max(0, Number(topSpeedKmh) || 0),
        maxLeanDeg: Math.max(0, Number(maxLeanDeg) || 0),
        distanceMeters: Math.max(0, Number(distanceMeters) || 0),
        durationSec: Math.max(0, Number(durationSec) || 0),
      })
      .returning();
    return NextResponse.json({ session: created }, { status: 201 });
  } catch (err) {
    console.error('POST /api/sessions failed:', err);
    return NextResponse.json({ error: 'Failed to save test ride session' }, { status: 500 });
  }
}
