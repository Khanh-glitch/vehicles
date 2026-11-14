import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { customBuilds } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      return NextResponse.json({ error: 'Invalid build ID' }, { status: 400 });
    }
    const body = await req.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = String(body.name).trim().slice(0, 80);
    if (body.config !== undefined) updates.config = body.config;
    if (body.notes !== undefined) updates.notes = body.notes ? String(body.notes).trim().slice(0, 300) : null;

    const [updated] = await db
      .update(customBuilds)
      .set(updates)
      .where(eq(customBuilds.id, numericId))
      .returning();
    if (!updated) return NextResponse.json({ error: 'Build not found' }, { status: 404 });
    return NextResponse.json({ build: updated });
  } catch (err) {
    console.error('PATCH /api/builds/[id] failed:', err);
    return NextResponse.json({ error: 'Failed to update build' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      return NextResponse.json({ error: 'Invalid build ID' }, { status: 400 });
    }
    const deleted = await db
      .delete(customBuilds)
      .where(eq(customBuilds.id, numericId))
      .returning();
    if (!deleted.length) return NextResponse.json({ error: 'Build not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /api/builds/[id] failed:', err);
    return NextResponse.json({ error: 'Failed to delete build' }, { status: 500 });
  }
}
