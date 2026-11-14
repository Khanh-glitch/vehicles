import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing GLB file upload' }, { status: 400 });
    }
    const origName = file.name || 'custom-bike.glb';
    if (!origName.toLowerCase().endsWith('.glb')) {
      return NextResponse.json({ error: 'Only binary .glb files are supported' }, { status: 400 });
    }
    if (file.size > 40 * 1024 * 1024) {
      return NextResponse.json({ error: 'GLB file exceeds 40MB limit' }, { status: 413 });
    }

    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    // Verify glTF binary magic header "glTF"
    if (buf.length < 12 || buf.subarray(0, 4).toString('ascii') !== 'glTF') {
      return NextResponse.json({ error: 'Invalid GLB binary header' }, { status: 400 });
    }

    const safeBase = origName
      .replace(/\.glb$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .slice(0, 48);
    const fileName = `${safeBase}-${Date.now()}.glb`;
    const targetDir = path.resolve('public/models/custom');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, fileName), buf);

    return NextResponse.json({
      modelUrl: `/models/custom/${fileName}`,
      fileName,
      sizeBytes: buf.length,
    });
  } catch (err) {
    console.error('POST /api/upload-glb failed:', err);
    return NextResponse.json({ error: 'Failed to upload GLB' }, { status: 500 });
  }
}
