import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';

const OUT_DIR = path.resolve('public/models');
const SOURCE_DIR = path.resolve(process.env.VEHICLE_SOURCE_DIR || 'assets/source');
const SOURCE_ASSETS = {
  superCub: path.join(SOURCE_DIR, 'honda_super_cub.glb'),
  cg125: path.join(SOURCE_DIR, 'motorbike_-_honda_cg_125.glb'),
  fatBoy: path.join(SOURCE_DIR, 'motorcycle_harley_davidson_fat_boy_inspired.glb'),
  xyn: path.join(SOURCE_DIR, 'harledson_XYN.glb'),
  sportbike: path.join(SOURCE_DIR, 'sportbike_eriklys.glb'),
};
fs.mkdirSync(OUT_DIR, { recursive: true });

// ============================================================================
// MATH HELPERS (Column-major 4x4 matrices matching glTF / Three.js)
// ============================================================================
function mat4Identity() {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
}
function mulMat4(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}
function mat4Translation(x, y, z) {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];
}
function mat4Scale(sx, sy, sz) {
  return [sx,0,0,0, 0,sy,0,0, 0,0,sz,0, 0,0,0,1];
}
function mat4RotX(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1];
}
function mat4RotY(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];
}
function mat4RotZ(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1];
}
function xformPt(m, x, y, z) {
  return [
    m[0]*x + m[4]*y + m[8]*z + m[12],
    m[1]*x + m[5]*y + m[9]*z + m[13],
    m[2]*x + m[6]*y + m[10]*z + m[14],
  ];
}
function xformDir(m, x, y, z) {
  const nx = m[0]*x + m[4]*y + m[8]*z;
  const ny = m[1]*x + m[5]*y + m[9]*z;
  const nz = m[2]*x + m[6]*y + m[10]*z;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}
function quatFromAxisAngle(ax, ay, az, rad) {
  const half = rad * 0.5;
  const s = Math.sin(half);
  const len = Math.hypot(ax, ay, az) || 1;
  return [(ax / len) * s, (ay / len) * s, (az / len) * s, Math.cos(half)];
}

// ============================================================================
// TEXTURE OPTIMIZER (Shrinks 4K PNGs to crisp 1K-1.5K JPEG/PNG for fast web load)
// ============================================================================
async function optimizeTextures(doc, maxDim = 1024, quality = 84) {
  const textures = doc.getRoot().listTextures();
  for (let i = 0; i < textures.length; i++) {
    const tex = textures[i];
    const img = tex.getImage();
    if (!img || img.byteLength < 60 * 1024) continue;
    try {
      const meta = await sharp(Buffer.from(img)).metadata();
      const hasAlpha = meta.hasAlpha && tex.getMimeType() === 'image/png';
      // Keep normal maps higher quality, convert opaque PNGs to JPEG for massive size savings
      const name = (tex.getName() || '').toLowerCase();
      const isNormal = name.includes('normal') || name.includes('nrm');
      const targetDim = isNormal ? Math.min(maxDim, 1024) : maxDim;
      let pipeline = sharp(Buffer.from(img)).resize({
        width: targetDim,
        height: targetDim,
        fit: 'inside',
        withoutEnlargement: true,
      });
      if (hasAlpha && !isNormal) {
        // Check if alpha channel is actually used (any pixel < 250)
        const stats = await sharp(Buffer.from(img)).stats();
        const alphaUsed = stats.channels.length >= 4 && stats.channels[3].min < 245;
        if (alphaUsed) {
          const outBuf = await pipeline.png({ compressionLevel: 9, palette: false }).toBuffer();
          tex.setImage(new Uint8Array(outBuf));
          tex.setMimeType('image/png');
        } else {
          const outBuf = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
          tex.setImage(new Uint8Array(outBuf));
          tex.setMimeType('image/jpeg');
        }
      } else {
        const outBuf = await pipeline.jpeg({ quality: isNormal ? 88 : quality, mozjpeg: true }).toBuffer();
        tex.setImage(new Uint8Array(outBuf));
        tex.setMimeType('image/jpeg');
      }
    } catch (e) {
      // Leave texture untouched if sharp cannot parse
    }
  }
}

// ============================================================================
// GEOMETRY SEGMENTATION & BAKE HELPERS
// ============================================================================
/**
 * Extracts all triangles from a primitive transformed into standardized world space
 * (with optional skinning), groups them into connected islands, and returns island objects.
 */
function extractIslandsFromPrimitive(prim, worldMat, globalXform, skinJointMats = null, weldRes = 500) {
  const posAcc = prim.getAttribute('POSITION');
  if (!posAcc) return [];
  const normAcc = prim.getAttribute('NORMAL');
  const uvAcc = prim.getAttribute('TEXCOORD_0');
  const tanAcc = prim.getAttribute('TANGENT');
  const j0Acc = skinJointMats ? prim.getAttribute('JOINTS_0') : null;
  const w0Acc = skinJointMats ? prim.getAttribute('WEIGHTS_0') : null;
  const idxAcc = prim.getIndices();

  const pos = posAcc.getArray();
  const norm = normAcc ? normAcc.getArray() : null;
  const uv = uvAcc ? uvAcc.getArray() : null;
  const tan = tanAcc ? tanAcc.getArray() : null;
  const j0 = j0Acc ? j0Acc.getArray() : null;
  const w0 = w0Acc ? w0Acc.getArray() : null;
  const indices = idxAcc ? idxAcc.getArray() : null;

  const vCount = pos.length / 3;
  const triCount = indices ? indices.length / 3 : vCount / 3;

  const wPos = new Float32Array(vCount * 3);
  const wNorm = norm ? new Float32Array(vCount * 3) : null;
  const wTan = tan ? new Float32Array(vCount * 4) : null;

  const combinedMat = mulMat4(globalXform, worldMat);

  for (let i = 0; i < vCount; i++) {
    const vx = pos[i*3], vy = pos[i*3+1], vz = pos[i*3+2];
    let px, py, pz;
    let nx = 0, ny = 1, nz = 0;
    if (skinJointMats && j0 && w0) {
      let sx=0, sy=0, sz=0, snx=0, sny=0, snz=0;
      for (let k = 0; k < 4; k++) {
        const wt = w0[i*4 + k];
        if (wt > 0) {
          const jm = mulMat4(globalXform, skinJointMats[j0[i*4 + k]]);
          const tp = xformPt(jm, vx, vy, vz);
          sx += tp[0]*wt; sy += tp[1]*wt; sz += tp[2]*wt;
          if (norm) {
            const tn = xformDir(jm, norm[i*3], norm[i*3+1], norm[i*3+2]);
            snx += tn[0]*wt; sny += tn[1]*wt; snz += tn[2]*wt;
          }
        }
      }
      px = sx; py = sy; pz = sz;
      if (norm) {
        const l = Math.hypot(snx, sny, snz) || 1;
        nx = snx/l; ny = sny/l; nz = snz/l;
      }
    } else {
      const tp = xformPt(combinedMat, vx, vy, vz);
      px = tp[0]; py = tp[1]; pz = tp[2];
      if (norm) {
        const tn = xformDir(combinedMat, norm[i*3], norm[i*3+1], norm[i*3+2]);
        nx = tn[0]; ny = tn[1]; nz = tn[2];
      }
    }
    wPos[i*3] = px; wPos[i*3+1] = py; wPos[i*3+2] = pz;
    if (wNorm) { wNorm[i*3] = nx; wNorm[i*3+1] = ny; wNorm[i*3+2] = nz; }
    if (wTan && tan) {
      const tt = xformDir(combinedMat, tan[i*4], tan[i*4+1], tan[i*4+2]);
      wTan[i*4] = tt[0]; wTan[i*4+1] = tt[1]; wTan[i*4+2] = tt[2]; wTan[i*4+3] = tan[i*4+3];
    }
  }

  // Union-find by spatially welded vertices
  const vKeyToId = new Map();
  const vMap = new Int32Array(vCount);
  let nextId = 0;
  for (let i = 0; i < vCount; i++) {
    const k = `${Math.round(wPos[i*3]*weldRes)},${Math.round(wPos[i*3+1]*weldRes)},${Math.round(wPos[i*3+2]*weldRes)}`;
    let id = vKeyToId.get(k);
    if (id === undefined) { id = nextId++; vKeyToId.set(k, id); }
    vMap[i] = id;
  }
  const parent = new Int32Array(nextId);
  for (let i = 0; i < nextId; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };

  for (let t = 0; t < triCount; t++) {
    const i0 = indices ? indices[t*3] : t*3;
    const i1 = indices ? indices[t*3+1] : t*3+1;
    const i2 = indices ? indices[t*3+2] : t*3+2;
    union(vMap[i0], vMap[i1]);
    union(vMap[i1], vMap[i2]);
  }

  const comps = new Map();
  for (let t = 0; t < triCount; t++) {
    const i0 = indices ? indices[t*3] : t*3;
    const i1 = indices ? indices[t*3+1] : t*3+1;
    const i2 = indices ? indices[t*3+2] : t*3+2;
    const r = find(vMap[i0]);
    let c = comps.get(r);
    if (!c) {
      c = { tris: [], min: [1e9,1e9,1e9], max: [-1e9,-1e9,-1e9] };
      comps.set(r, c);
    }
    c.tris.push(i0, i1, i2);
    for (const vi of [i0, i1, i2]) {
      for (let k = 0; k < 3; k++) {
        const val = wPos[vi*3 + k];
        if (val < c.min[k]) c.min[k] = val;
        if (val > c.max[k]) c.max[k] = val;
      }
    }
  }

  const result = [];
  for (const c of comps.values()) {
    const ctr = [
      (c.min[0] + c.max[0]) * 0.5,
      (c.min[1] + c.max[1]) * 0.5,
      (c.min[2] + c.max[2]) * 0.5,
    ];
    const sz = [
      c.max[0] - c.min[0],
      c.max[1] - c.min[1],
      c.max[2] - c.min[2],
    ];
    result.push({
      tris: c.tris,
      triCount: c.tris.length / 3,
      min: c.min,
      max: c.max,
      ctr,
      sz,
      material: prim.getMaterial(),
      wPos,
      wNorm,
      uv,
      wTan,
    });
  }
  return result;
}

/**
 * Creates a glTF Mesh inside `doc` from a list of island buckets, transforming vertices
 * from world space into the target node's local coordinate frame via `invNodeMat`.
 */
function buildMeshFromIslands(doc, buffer, name, islands, invNodeMat, overrideMaterial = null) {
  if (!islands.length) return null;
  const mesh = doc.createMesh(name);

  // Group islands by material
  const byMat = new Map();
  for (const isl of islands) {
    const mat = overrideMaterial || isl.material;
    let arr = byMat.get(mat);
    if (!arr) { arr = []; byMat.set(mat, arr); }
    arr.push(isl);
  }

  for (const [mat, list] of byMat.entries()) {
    let totalIndices = 0;
    for (const isl of list) totalIndices += isl.tris.length;
    if (totalIndices === 0) continue;

    // Compact vertices per material primitive
    const newPos = [];
    const newNorm = [];
    const newUv = [];
    const newIndices = [];
    const hasNorm = list.every(i => i.wNorm !== null);
    const hasUv = list.every(i => i.uv !== null);

    let vCursor = 0;
    for (const isl of list) {
      const localMap = new Map();
      const { tris, wPos, wNorm, uv } = isl;
      for (let k = 0; k < tris.length; k++) {
        const oldIdx = tris[k];
        let mapped = localMap.get(oldIdx);
        if (mapped === undefined) {
          mapped = vCursor++;
          localMap.set(oldIdx, mapped);
          const p = xformPt(invNodeMat, wPos[oldIdx*3], wPos[oldIdx*3+1], wPos[oldIdx*3+2]);
          newPos.push(p[0], p[1], p[2]);
          if (hasNorm) {
            const n = xformDir(invNodeMat, wNorm[oldIdx*3], wNorm[oldIdx*3+1], wNorm[oldIdx*3+2]);
            newNorm.push(n[0], n[1], n[2]);
          }
          if (hasUv) {
            newUv.push(uv[oldIdx*2], uv[oldIdx*2+1]);
          }
        }
        newIndices.push(mapped);
      }
    }

    const prim = doc.createPrimitive();
    const posAcc = doc.createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(newPos))
      .setBuffer(buffer);
    prim.setAttribute('POSITION', posAcc);

    if (hasNorm) {
      const normAcc = doc.createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(newNorm))
        .setBuffer(buffer);
      prim.setAttribute('NORMAL', normAcc);
    }
    if (hasUv) {
      const uvAcc = doc.createAccessor()
        .setType('VEC2')
        .setArray(new Float32Array(newUv))
        .setBuffer(buffer);
      prim.setAttribute('TEXCOORD_0', uvAcc);
    }

    const use32 = vCursor > 65535;
    const idxAcc = doc.createAccessor()
      .setType('SCALAR')
      .setArray(use32 ? new Uint32Array(newIndices) : new Uint16Array(newIndices))
      .setBuffer(buffer);
    prim.setIndices(idxAcc);
    if (mat) prim.setMaterial(mat);
    mesh.addPrimitive(prim);
  }
  return mesh;
}

/**
 * Helper to create standard hierarchical motorcycle rig in a glTF doc.
 * Returns { chassisRoot, steeringPivot, frontSlider, frontWheelPivot, rearSwingarmPivot, rearWheelPivot, invMats }
 */
function createMotorcycleRigHierarchy(doc, scene, spec) {
  const {
    steeringHeadPos,   // [0, y, z] in world space
    rakeDeg,           // positive rake tilts fork bottom forward (+Z) -> rotate X by -rakeRad!
    frontAxlePos,      // [0, Rf, Zf]
    rearSwingarmPos,   // [0, y, z]
    rearAxlePos,       // [0, Rr, Zr]
  } = spec;

  const rakeRad = (rakeDeg * Math.PI) / 180;

  const chassisRoot = doc.createNode('chassis_root');
  scene.addChild(chassisRoot);

  // Steering pivot sits at steeringHeadPos and is tilted by -rakeRad around X so its local -Y points down the fork tubes toward frontAxlePos!
  const steeringPivot = doc.createNode('steering_pivot')
    .setTranslation(steeringHeadPos)
    .setRotation(quatFromAxisAngle(1, 0, 0, -rakeRad));
  chassisRoot.addChild(steeringPivot);

  const steeringUpper = doc.createNode('steering_upper');
  steeringPivot.addChild(steeringUpper);

  const frontSlider = doc.createNode('front_suspension_slider');
  steeringPivot.addChild(frontSlider);

  // Compute frontAxlePos expressed in steeringPivot's local space!
  const invSteeringMat = mulMat4(mat4RotX(rakeRad), mat4Translation(-steeringHeadPos[0], -steeringHeadPos[1], -steeringHeadPos[2]));
  const frontAxleLocal = xformPt(invSteeringMat, frontAxlePos[0], frontAxlePos[1], frontAxlePos[2]);

  // Undo the rake rotation on front_wheel_pivot so its local X axis is pure horizontal axle and Y/Z match world when steering=0
  const frontWheelPivot = doc.createNode('front_wheel_pivot')
    .setTranslation(frontAxleLocal)
    .setRotation(quatFromAxisAngle(1, 0, 0, rakeRad));
  frontSlider.addChild(frontWheelPivot);

  const rearSwingarmPivot = doc.createNode('rear_swingarm_pivot')
    .setTranslation(rearSwingarmPos);
  chassisRoot.addChild(rearSwingarmPivot);

  const rearAxleLocal = [
    rearAxlePos[0] - rearSwingarmPos[0],
    rearAxlePos[1] - rearSwingarmPos[1],
    rearAxlePos[2] - rearSwingarmPos[2],
  ];
  const rearWheelPivot = doc.createNode('rear_wheel_pivot')
    .setTranslation(rearAxleLocal);
  rearSwingarmPivot.addChild(rearWheelPivot);

  // Inverse matrices to bake world-space vertices cleanly into each pivot's local space!
  const invChassis = mat4Identity();
  const invFrontWheel = mat4Translation(-frontAxlePos[0], -frontAxlePos[1], -frontAxlePos[2]);
  const invRearSwingarm = mat4Translation(-rearSwingarmPos[0], -rearSwingarmPos[1], -rearSwingarmPos[2]);
  const invRearWheel = mat4Translation(-rearAxlePos[0], -rearAxlePos[1], -rearAxlePos[2]);

  return {
    chassisRoot,
    steeringPivot,
    steeringUpper,
    frontSlider,
    frontWheelPivot,
    rearSwingarmPivot,
    rearWheelPivot,
    invMats: {
      chassis: invChassis,
      steering: invSteeringMat,
      frontWheel: invFrontWheel,
      rearSwingarm: invRearSwingarm,
      rearWheel: invRearWheel,
    },
  };
}

function createLampMaterials(doc) {
  const headlight = doc.createMaterial('mat_lamp_headlight')
    .setBaseColorFactor([1.0, 0.96, 0.86, 1])
    .setRoughnessFactor(0.12)
    .setMetallicFactor(0.1)
    .setEmissiveFactor([0.0, 0.0, 0.0]);
  const taillight = doc.createMaterial('mat_lamp_taillight')
    .setBaseColorFactor([0.75, 0.04, 0.04, 1])
    .setRoughnessFactor(0.18)
    .setMetallicFactor(0.05)
    .setEmissiveFactor([0.0, 0.0, 0.0]);
  const turnLeft = doc.createMaterial('mat_lamp_turn_left')
    .setBaseColorFactor([0.92, 0.45, 0.02, 1])
    .setRoughnessFactor(0.22)
    .setMetallicFactor(0.05)
    .setEmissiveFactor([0.0, 0.0, 0.0]);
  const turnRight = doc.createMaterial('mat_lamp_turn_right')
    .setBaseColorFactor([0.92, 0.45, 0.02, 1])
    .setRoughnessFactor(0.22)
    .setMetallicFactor(0.05)
    .setEmissiveFactor([0.0, 0.0, 0.0]);
  return { headlight, taillight, turnLeft, turnRight };
}

// ============================================================================
// 1. PROCESS HONDA SUPER CUB C90 (Google Drive — Merged Mesh -> Full Mechanical Rig!)
// ============================================================================
async function processSuperCub(io) {
  console.log('\n[1/5] Processing Honda Super Cub C90...');
  const doc = await io.read(SOURCE_ASSETS.superCub);
  const root = doc.getRoot();
  const srcScene = root.listScenes()[0];

  // Fix the Sketchfab material bug: original material_0 had alphaMode=BLEND & emissive=[1,1,1]!
  const origMat = root.listMaterials()[0];
  origMat.setName('cub_hardware');
  origMat.setAlphaMode('OPAQUE');
  origMat.setEmissiveFactor([0, 0, 0]);
  origMat.setEmissiveTexture(null);
  origMat.setMetallicFactor(0.45);
  origMat.setRoughnessFactor(0.52);

  // Clone clean semantic PBR channels preserving original UV/Normal/Roughness/Metallic/AO maps!
  const matCubPaint = origMat.clone().setName('paint_primary').setMetallicFactor(0.32).setRoughnessFactor(0.22);
  const matCubLegshield = origMat.clone().setName('cub_legshield').setMetallicFactor(0.05).setRoughnessFactor(0.28);
  const matCubSeat = origMat.clone().setName('seat_leather').setMetallicFactor(0.02).setRoughnessFactor(0.68);
  const matCubRims = origMat.clone().setName('rim_spokes').setMetallicFactor(0.92).setRoughnessFactor(0.16);
  const matCubTires = origMat.clone().setName('tire_rubber').setMetallicFactor(0.0).setRoughnessFactor(0.86);

  // Extract all connected islands across Object_2..5
  const islands = [];
  function walk(node, pm) {
    const wm = mulMat4(pm, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const list = extractIslandsFromPrimitive(prim, wm, mat4Identity(), null, 500);
        for (const isl of list) {
          isl.srcNode = node.getName();
          islands.push(isl);
        }
      }
    }
    for (const c of node.listChildren()) walk(c, wm);
  }
  for (const n of srcScene.listChildren()) walk(n, mat4Identity());
  console.log(`  Extracted ${islands.length} topological islands from monolithic Super Cub mesh!`);

  // Classify every island anatomically!
  const frontAxle = [0, 0.335, 0.808];
  const rearAxle = [0, 0.335, -0.590];
  const steeringHead = [0, 0.88, 0.48];
  const seatHingePos = [0, 0.81, 0.02];

  const buckets = {
    frontWheel: [],
    rearWheel: [],
    steeringUpper: [],
    frontSuspension: [],
    seat: [],
    chassis: [],
    headlight: [],
    taillight: [],
    turnLeft: [],
    turnRight: [],
  };

  for (const isl of islands) {
    const [cx, cy, cz] = isl.ctr;
    const [sx, sy, sz] = isl.sz;
    const dFrontYZ = Math.hypot(cy - frontAxle[1], cz - frontAxle[2]);
    const dRearYZ = Math.hypot(cy - rearAxle[1], cz - rearAxle[2]);

    // 1. Front Wheel (tire, rim, hub, valve, all 36 spokes!)
    if (dFrontYZ < 0.345 && Math.abs(cx) < 0.032 && isl.min[1] < 0.68 && isl.max[1] < 0.70 && cz > 0.45) {
      buckets.frontWheel.push(isl);
      continue;
    }
    // 2. Rear Wheel (tire, rim, hub, rear sprocket, all 36 spokes — strictly concentric around rearAxle!)
    if (dRearYZ < 0.25 && (Math.abs(cx) < 0.032 || (cx > 0.06 && cx < 0.10 && sy > 0.17 && sz > 0.17 && sy < 0.22)) && isl.min[1] < 0.68 && isl.max[1] < 0.70 && isl.max[2] < rearAxle[2] + 0.345 && isl.min[2] > rearAxle[2] - 0.345) {
      buckets.rearWheel.push(isl);
      continue;
    }
    // 3. Headlight lens (front center top of handlebar nacelle)
    if (Math.abs(cx) < 0.03 && cy > 0.98 && cy < 1.14 && cz > 0.46 && cz < 0.56 && sx < 0.19 && sy < 0.19) {
      buckets.headlight.push(isl);
      continue;
    }
    // 4. Taillight lens (rear tip)
    if (Math.abs(cx) < 0.04 && cy > 0.52 && cy < 0.68 && cz < -0.84 && sx < 0.24) {
      buckets.taillight.push(isl);
      continue;
    }
    // 5. Front & Rear Turn Signals
    if (cy > 0.79 && cy < 0.89 && cz > 0.36 && cz < 0.45 && Math.abs(cx) > 0.06 && Math.abs(cx) < 0.16 && sx < 0.12) {
      if (cx > 0) buckets.turnLeft.push(isl); else buckets.turnRight.push(isl);
      continue;
    }
    if (cy > 0.62 && cy < 0.72 && cz < -0.68 && cz > -0.80 && Math.abs(cx) > 0.08 && Math.abs(cx) < 0.22 && sx < 0.18) {
      if (cx > 0) buckets.turnLeft.push(isl); else buckets.turnRight.push(isl);
      continue;
    }
    // 6. Hinged Seat (classic solo Cub seat above under-seat fuel tank)
    if (Math.abs(cx) < 0.04 && cy > 0.81 && cy < 0.93 && cz > -0.32 && cz < -0.04 && sz > 0.32 && sz < 0.49 && sx > 0.24 && sx < 0.40) {
      buckets.seat.push(isl);
      continue;
    }
    // 7. Leading-link front suspension arms (move with wheel travel inside steering!)
    if (cz > 0.60 && cy > 0.28 && cy < 0.52 && Math.abs(cx) > 0.03 && Math.abs(cx) < 0.13 && sz < 0.20) {
      buckets.frontSuspension.push(isl);
      continue;
    }
    // 8. Steering Assembly (handlebar, nacelle, mirrors, levers, front fork, front fender — excluding fixed leg shield!)
    const isLegShield = (sx > 0.40 && cy > 0.35 && cy < 0.80 && cz < 0.35);
    const isMainFrame = (sz > 0.90 && cz < 0.20);
    if (!isLegShield && !isMainFrame) {
      if (
        (cy > 0.90 && cz > 0.22) || // handlebars, grips, mirrors, nacelle
        (cz > 0.44 && cy > 0.20 && isl.min[2] > 0.30) // front fork & front fender
      ) {
        buckets.steeringUpper.push(isl);
        continue;
      }
    }
    // 9. Everything else stays on chassis
    buckets.chassis.push(isl);
  }

  console.log('  Super Cub bucket counts (islands):', Object.fromEntries(Object.entries(buckets).map(([k,v]) => [k, v.length])));

  // Clear old scene children & rebuild clean mechanical rig!
  for (const child of srcScene.listChildren()) srcScene.removeChild(child);
  const buffer = root.listBuffers()[0] || doc.createBuffer();
  const lamps = createLampMaterials(doc);

  const rig = createMotorcycleRigHierarchy(doc, srcScene, {
    steeringHeadPos: steeringHead,
    rakeDeg: 26.0,
    frontAxlePos: frontAxle,
    rearSwingarmPos: [0, 0.35, -0.18],
    rearAxlePos: rearAxle,
  });

  // Assign semantic material channels to every Super Cub island so paint, legshield, seat, rims & tires customize cleanly!
  for (const isl of buckets.chassis) {
    const [cx, cy, cz] = isl.ctr;
    const [sx, sy, sz] = isl.sz;
    const isLegShield = (sx > 0.40 && cy > 0.35 && cy < 0.80 && cz < 0.35);
    const isPaintedBody =
      !isLegShield &&
      ((sz > 0.85 && cy > 0.45 && Math.abs(cx) < 0.08) || // Main monocoque pressed-steel frame & rear fender!
       (Math.abs(cx) < 0.14 && cy > 0.35 && cy < 0.78 && cz > -0.35 && cz < 0.05 && sy > 0.30)); // Side covers
    if (isLegShield) isl.material = matCubLegshield;
    else if (isPaintedBody) isl.material = matCubPaint;
    else isl.material = origMat;
  }
  for (const isl of buckets.steeringUpper) {
    const [cx, cy, cz] = isl.ctr;
    const [sx, sy, sz] = isl.sz;
    // Front fork cover + front fender + handlebar top nacelle are painted body color!
    const isPaintedFront =
      (Math.abs(cx) < 0.06 && cy > 0.40 && cy < 1.12 && (sz > 0.14 || sx > 0.30));
    isl.material = isPaintedFront ? matCubPaint : origMat;
  }
  for (const isl of buckets.frontWheel) {
    isl.material = isl.triCount > 15000 ? matCubTires : matCubRims;
  }
  for (const isl of buckets.rearWheel) {
    isl.material = isl.triCount > 15000 ? matCubTires : matCubRims;
  }
  for (const isl of buckets.seat) {
    isl.material = matCubSeat;
  }

  // Attach separated real meshes
  const chassisMesh = buildMeshFromIslands(doc, buffer, 'chassis_body', buckets.chassis, rig.invMats.chassis);
  if (chassisMesh) rig.chassisRoot.addChild(doc.createNode('chassis_body').setMesh(chassisMesh));

  const steerMesh = buildMeshFromIslands(doc, buffer, 'steering_upper_mesh', buckets.steeringUpper, rig.invMats.steering);
  if (steerMesh) rig.steeringUpper.addChild(doc.createNode('steering_upper_mesh').setMesh(steerMesh));

  const fSuspMesh = buildMeshFromIslands(doc, buffer, 'front_suspension_arms', buckets.frontSuspension, rig.invMats.steering);
  if (fSuspMesh) rig.frontSlider.addChild(doc.createNode('front_suspension_arms').setMesh(fSuspMesh));

  const fwMesh = buildMeshFromIslands(doc, buffer, 'front_wheel_mesh', buckets.frontWheel, rig.invMats.frontWheel);
  if (fwMesh) rig.frontWheelPivot.addChild(doc.createNode('front_wheel_mesh').setMesh(fwMesh));

  const rwMesh = buildMeshFromIslands(doc, buffer, 'rear_wheel_mesh', buckets.rearWheel, rig.invMats.rearWheel);
  if (rwMesh) rig.rearWheelPivot.addChild(doc.createNode('rear_wheel_mesh').setMesh(rwMesh));

  // Lamps (using real separated lens geometry + controllable emissive materials!)
  const hlMesh = buildMeshFromIslands(doc, buffer, 'lamp_headlight', buckets.headlight, rig.invMats.steering, lamps.headlight);
  if (hlMesh) rig.steeringUpper.addChild(doc.createNode('lamp_headlight').setMesh(hlMesh));

  const tlMesh = buildMeshFromIslands(doc, buffer, 'lamp_taillight', buckets.taillight, rig.invMats.chassis, lamps.taillight);
  if (tlMesh) rig.chassisRoot.addChild(doc.createNode('lamp_taillight').setMesh(tlMesh));

  // Separate front & rear turn signals into steering vs chassis
  const frontTurnL = buckets.turnLeft.filter(i => i.ctr[2] > 0);
  const rearTurnL = buckets.turnLeft.filter(i => i.ctr[2] <= 0);
  const frontTurnR = buckets.turnRight.filter(i => i.ctr[2] > 0);
  const rearTurnR = buckets.turnRight.filter(i => i.ctr[2] <= 0);
  if (frontTurnL.length) rig.steeringUpper.addChild(doc.createNode('lamp_turn_fl').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_turn_fl', frontTurnL, rig.invMats.steering, lamps.turnLeft)));
  if (frontTurnR.length) rig.steeringUpper.addChild(doc.createNode('lamp_turn_fr').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_turn_fr', frontTurnR, rig.invMats.steering, lamps.turnRight)));
  if (rearTurnL.length) rig.chassisRoot.addChild(doc.createNode('lamp_turn_rl').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_turn_rl', rearTurnL, rig.invMats.chassis, lamps.turnLeft)));
  if (rearTurnR.length) rig.chassisRoot.addChild(doc.createNode('lamp_turn_rr').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_turn_rr', rearTurnR, rig.invMats.chassis, lamps.turnRight)));

  // Keep the source seat mesh and attach it to its articulation pivot.
  const seatHinge = doc.createNode('seat_hinge').setTranslation(seatHingePos);
  rig.chassisRoot.addChild(seatHinge);
  const invSeat = mat4Translation(-seatHingePos[0], -seatHingePos[1], -seatHingePos[2]);
  const seatMesh = buildMeshFromIslands(doc, buffer, 'seat_cushion', buckets.seat, invSeat);
  if (seatMesh) seatHinge.addChild(doc.createNode('seat_cushion').setMesh(seatMesh));

  await optimizeTextures(doc, 1536, 86);
  await doc.transform(prune(), dedup());
  const outPath = path.join(OUT_DIR, 'super-cub-c90.glb');
  await io.write(outPath, doc);
  console.log(`  Wrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// 2. PROCESS HONDA CG 125 (Google Drive — Unskin + Straighten -15° + Metric Scale!)
// ============================================================================
async function processCG125(io) {
  console.log('\n[2/5] Processing Honda CG 125 Classic...');
  const doc = await io.read(SOURCE_ASSETS.cg125);
  const root = doc.getRoot();
  const srcScene = root.listScenes()[0];

  // Compute straightened world matrices with Front_00 rotated by -15 deg around its local Y
  const straightRad = (-15 * Math.PI) / 180;
  const worldMats = new Map();
  function walkMats(node, pm) {
    let lm = node.getMatrix();
    if (node.getName() === 'Front_00') {
      lm = mulMat4(lm, mat4RotY(straightRad));
    }
    const wm = mulMat4(pm, lm);
    worldMats.set(node, wm);
    for (const c of node.listChildren()) walkMats(c, wm);
  }
  for (const n of srcScene.listChildren()) walkMats(n, mat4Identity());

  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const ibmArr = skin.getInverseBindMatrices().getArray();
  const jointMats = joints.map((j, idx) => mulMat4(worldMats.get(j), ibmArr.slice(idx*16, idx*16+16)));

  // Global normalization:
  // Original CG125 faces +X, rear wheel dia = 1.83 -> real CG125 tire dia = 0.625 m -> scale = 0.3415
  // Pitch back by -2.0° around raw Z so front & rear tire bottoms both touch y = 0.000!
  // Rotate -90° around Y so +X becomes +Z (forward)!
  const S = 0.625 / 1.83;
  // Let's compute exact front & rear axle centers in raw straightened coords:
  // Raw FrontWheel center: [2.1986, -0.0741, 0], Raw RearWheel center: [-1.699, 0.062, 0]
  const rawPitch = Math.atan2(0.062 - (-0.0741), 2.1986 - (-1.699)); // +0.0349 rad (+2.00 deg)
  // Rotate raw around Z by +rawPitch so Front (lower y) lifts up and Rear (higher y) drops down to the EXACT SAME Y!
  let globalXform = mat4RotZ(rawPitch);
  // Rotate -90 deg around Y so +X -> +Z, -Z -> +X (left)! Wait: RotY(-90°): (x,y,z) -> (-z, y, x).
  // Check right-hand rule: if bike faces +Z, left is +X, right is -X. In raw CG125, GearShifter is at z=-0.38 (left!), BrakePedal is at z=+0.29 (right!).
  // With RotY(-90°): x' = -z => GearShifter x' = +0.38 (LEFT!), BrakePedal x' = -0.29 (RIGHT!), FrontWheel z' = +2.20 (+Z FORWARD!). PERFECT!!
  globalXform = mulMat4(mat4RotY(-Math.PI / 2), globalXform);
  globalXform = mulMat4(mat4Scale(S, S, S), globalXform);

  // Measure tire min Y after scaling+leveling to place both tires cleanly on y=0.000!
  const fAxleRaw = xformPt(globalXform, 2.1986, -0.0741, 0);
  const rAxleRaw = xformPt(globalXform, -1.699, 0.062, 0);
  const wheelR = (1.83 * 0.5) * S; // 0.3125 m
  const yLift = wheelR - ((fAxleRaw[1] + rAxleRaw[1]) * 0.5);
  const zShift = -((fAxleRaw[2] + rAxleRaw[2]) * 0.5) + 0.08;
  globalXform = mulMat4(mat4Translation(0, yLift, zShift), globalXform);

  const frontAxle = xformPt(globalXform, 2.1986, -0.0741, 0);
  const rearAxle = xformPt(globalXform, -1.699, 0.062, 0);
  const steerHead = xformPt(globalXform, 0.985, 1.897, 0);
  const steerEnd = xformPt(globalXform, 1.426, 0.945, 0);
  const rakeDeg = (Math.atan2(steerEnd[2] - steerHead[2], steerHead[1] - steerEnd[1]) * 180) / Math.PI;
  const kickstandPos = xformPt(globalXform, -0.733, -0.21, 0);
  const gearShifterPos = xformPt(globalXform, -0.373, -0.06, -0.35);
  const brakePedalPos = xformPt(globalXform, -0.70, -0.15, 0.25);
  const kickstarterPos = xformPt(globalXform, -0.48, -0.143, 0.171);

  console.log(`  CG125 Normalized -> Wheelbase=${(frontAxle[2]-rearAxle[2]).toFixed(3)}m, R=${wheelR.toFixed(3)}m, Rake=${rakeDeg.toFixed(1)}°`);

  // Collect meshes by their clean semantic node/mesh names!
  const buckets = {
    frontWheel: [],
    rearWheel: [],
    steeringUpper: [],
    chassis: [],
    kickstand: [],
    gearShifter: [],
    brakePedal: [],
    kickstarter: [],
    headlight: [],
    taillight: [],
    turnLeft: [],
    turnRight: [],
    speedoNeedle: [],
    tachoNeedle: [],
    gaugeBacklight: [],
  };

  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const mn = mesh.getName();
    const wm = worldMats.get(node);
    const useSkin = !!node.getSkin();

    for (const prim of mesh.listPrimitives()) {
      const islands = extractIslandsFromPrimitive(prim, wm, globalXform, useSkin ? jointMats : null, 400);
      for (const isl of islands) {
        if (mn.startsWith('FrontWheel_')) buckets.frontWheel.push(isl);
        else if (mn.startsWith('Rest.001_')) buckets.rearWheel.push(isl);
        else if (mn.startsWith('KickStand_')) buckets.kickstand.push(isl);
        else if (mn.startsWith('GearShifter_')) buckets.gearShifter.push(isl);
        else if (mn.startsWith('BrakePedal_')) buckets.brakePedal.push(isl);
        else if (mn.startsWith('StartHammer_')) buckets.kickstarter.push(isl);
        else if (mn.includes('HeadLight')) buckets.headlight.push(isl);
        else if (mn.includes('RearLight')) buckets.taillight.push(isl);
        else if (mn.includes('SideLight')) {
          if (isl.ctr[0] >= 0) buckets.turnLeft.push(isl); else buckets.turnRight.push(isl);
        } else if (mn.includes('Needle')) {
          // Split speedo vs tacho needle by X position (in normalized coords: speedo vs tacho sit side-by-side)
          if (isl.ctr[0] >= 0) buckets.speedoNeedle.push(isl); else buckets.tachoNeedle.push(isl);
        } else if (mn.includes('UnderlayLight')) {
          buckets.gaugeBacklight.push(isl);
        } else if (mn.startsWith('Frontend_')) {
          buckets.steeringUpper.push(isl);
        } else {
          buckets.chassis.push(isl);
        }
      }
    }
  }

  // Upgrade CG125 PBR materials for crisp automotive paint & realistic chrome/metal
  for (const mat of root.listMaterials()) {
    const nm = mat.getName();
    if (nm === 'MetalBody') {
      mat.setName('paint_primary');
      mat.setBaseColorFactor([0.78, 0.05, 0.05, 1]);
      mat.setMetallicFactor(0.45);
      mat.setRoughnessFactor(0.18);
    } else if (nm === 'MetalBase' || nm === 'MetalBase.001') {
      mat.setMetallicFactor(0.92);
      mat.setRoughnessFactor(0.16);
    } else if (nm === 'DarkerEngineMetal' || nm === 'DarkerEngineMetal.001') {
      mat.setMetallicFactor(0.82);
      mat.setRoughnessFactor(0.36);
    } else if (nm === 'LEATHER_SEAT') {
      mat.setName('seat_leather');
      mat.setMetallicFactor(0.0);
      mat.setRoughnessFactor(0.68);
    } else if (nm === 'HeadLight' || nm === 'RearLight' || nm === 'SideLight') {
      mat.setEmissiveFactor([0, 0, 0]);
    }
  }

  // Rebuild clean unskinned mechanical scene
  for (const child of srcScene.listChildren()) srcScene.removeChild(child);
  for (const sk of root.listSkins()) sk.dispose();
  const buffer = root.listBuffers()[0] || doc.createBuffer();
  const lamps = createLampMaterials(doc);

  const rig = createMotorcycleRigHierarchy(doc, srcScene, {
    steeringHeadPos: steerHead,
    rakeDeg,
    frontAxlePos: frontAxle,
    rearSwingarmPos: [0, rearAxle[1] + 0.04, rearAxle[2] + 0.42],
    rearAxlePos: rearAxle,
  });

  if (buckets.chassis.length) rig.chassisRoot.addChild(doc.createNode('chassis_body').setMesh(buildMeshFromIslands(doc, buffer, 'chassis_body', buckets.chassis, rig.invMats.chassis)));
  if (buckets.steeringUpper.length) rig.steeringUpper.addChild(doc.createNode('steering_upper_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'steering_upper_mesh', buckets.steeringUpper, rig.invMats.steering)));
  if (buckets.frontWheel.length) rig.frontWheelPivot.addChild(doc.createNode('front_wheel_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'front_wheel_mesh', buckets.frontWheel, rig.invMats.frontWheel)));
  if (buckets.rearWheel.length) rig.rearWheelPivot.addChild(doc.createNode('rear_wheel_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'rear_wheel_mesh', buckets.rearWheel, rig.invMats.rearWheel)));

  // Mechanical linkages — REAL original parts from Honda CG125!
  if (buckets.kickstand.length) {
    const ksPivot = doc.createNode('kickstand_pivot').setTranslation(kickstandPos);
    rig.chassisRoot.addChild(ksPivot);
    ksPivot.addChild(doc.createNode('kickstand_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'kickstand_mesh', buckets.kickstand, mat4Translation(-kickstandPos[0], -kickstandPos[1], -kickstandPos[2]))));
  }
  if (buckets.gearShifter.length) {
    const gsPivot = doc.createNode('gear_shifter_pivot').setTranslation(gearShifterPos);
    rig.chassisRoot.addChild(gsPivot);
    gsPivot.addChild(doc.createNode('gear_shifter_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'gear_shifter_mesh', buckets.gearShifter, mat4Translation(-gearShifterPos[0], -gearShifterPos[1], -gearShifterPos[2]))));
  }
  if (buckets.brakePedal.length) {
    const bpPivot = doc.createNode('brake_pedal_pivot').setTranslation(brakePedalPos);
    rig.chassisRoot.addChild(bpPivot);
    bpPivot.addChild(doc.createNode('brake_pedal_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'brake_pedal_mesh', buckets.brakePedal, mat4Translation(-brakePedalPos[0], -brakePedalPos[1], -brakePedalPos[2]))));
  }
  if (buckets.kickstarter.length) {
    const stPivot = doc.createNode('kickstarter_pivot').setTranslation(kickstarterPos);
    rig.chassisRoot.addChild(stPivot);
    stPivot.addChild(doc.createNode('kickstarter_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'kickstarter_mesh', buckets.kickstarter, mat4Translation(-kickstarterPos[0], -kickstarterPos[1], -kickstarterPos[2]))));
  }

  // Real analog gauge needles & lamps inside steeringUpper / chassis!
  if (buckets.headlight.length) rig.steeringUpper.addChild(doc.createNode('lamp_headlight').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_headlight', buckets.headlight, rig.invMats.steering, lamps.headlight)));
  if (buckets.taillight.length) rig.chassisRoot.addChild(doc.createNode('lamp_taillight').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_taillight', buckets.taillight, rig.invMats.chassis, lamps.taillight)));
  if (buckets.turnLeft.length) rig.steeringUpper.addChild(doc.createNode('lamp_turn_fl').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_turn_fl', buckets.turnLeft, rig.invMats.steering, lamps.turnLeft)));
  if (buckets.turnRight.length) rig.steeringUpper.addChild(doc.createNode('lamp_turn_fr').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_turn_fr', buckets.turnRight, rig.invMats.steering, lamps.turnRight)));
  if (buckets.gaugeBacklight.length) rig.steeringUpper.addChild(doc.createNode('gauge_backlight').setMesh(buildMeshFromIslands(doc, buffer, 'gauge_backlight', buckets.gaugeBacklight, rig.invMats.steering)));

  if (buckets.speedoNeedle.length) {
    const avg = buckets.speedoNeedle[0].ctr;
    const localP = xformPt(rig.invMats.steering, avg[0], avg[1], avg[2]);
    const snPivot = doc.createNode('speedo_needle_pivot').setTranslation(localP);
    rig.steeringUpper.addChild(snPivot);
    const invSn = mulMat4(mat4Translation(-localP[0], -localP[1], -localP[2]), rig.invMats.steering);
    snPivot.addChild(doc.createNode('speedo_needle_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'speedo_needle_mesh', buckets.speedoNeedle, invSn)));
  }
  if (buckets.tachoNeedle.length) {
    const avg = buckets.tachoNeedle[0].ctr;
    const localP = xformPt(rig.invMats.steering, avg[0], avg[1], avg[2]);
    const tnPivot = doc.createNode('tacho_needle_pivot').setTranslation(localP);
    rig.steeringUpper.addChild(tnPivot);
    const invTn = mulMat4(mat4Translation(-localP[0], -localP[1], -localP[2]), rig.invMats.steering);
    tnPivot.addChild(doc.createNode('tacho_needle_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'tacho_needle_mesh', buckets.tachoNeedle, invTn)));
  }

  await optimizeTextures(doc, 1024, 82);
  await doc.transform(prune(), dedup());
  const outPath = path.join(OUT_DIR, 'honda-cg-125.glb');
  await io.write(outPath, doc);
  console.log(`  Wrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// 3. PROCESS FAT BOY CRUISER 1868 (Google Drive — Source Meshes + Raked Fork)
// ============================================================================
async function processFatBoy(io) {
  console.log('\n[3/5] Processing Fat Boy Cruiser 1868...');
  const doc = await io.read(SOURCE_ASSETS.fatBoy);
  const root = doc.getRoot();
  const srcScene = root.listScenes()[0];

  // Scale slightly from 2.87m to realistic Fat Boy length 2.37m (scale = 0.84) and drop minY to 0.000
  const S = 0.84;
  const globalXform = mulMat4(mat4Translation(0, -0.005 * S, 0), mat4Scale(S, S, S));

  const islands = [];
  function walk(node, pm) {
    const wm = mulMat4(pm, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const list = extractIslandsFromPrimitive(prim, wm, globalXform, null, 500);
        for (const isl of list) {
          isl.matName = prim.getMaterial()?.getName() || '';
          islands.push(isl);
        }
      }
    }
    for (const c of node.listChildren()) walk(c, wm);
  }
  for (const n of srcScene.listChildren()) walk(n, mat4Identity());

  const frontAxle = [0, 0.372 * S, 1.022 * S];
  const rearAxle = [0, 0.372 * S, -0.992 * S];
  const steeringHead = [0, 1.05 * S, 0.50 * S];

  const buckets = {
    frontWheel: [],
    rearWheel: [],
    steeringUpper: [],
    chassis: [],
    headlight: [],
    bagLeftBody: [],
    bagRightBody: [],
    bagLeftLid: [],
    bagRightLid: [],
  };

  for (const isl of islands) {
    const [cx, cy, cz] = isl.ctr;
    const [sx, sy, sz] = isl.sz;
    const mn = isl.matName;

    // Saddlebags -> split into Left (+X) and Right (-X)
    if (mn === 'M_Bags') {
      if (cx >= 0) {
        if (cy > 0.76 * S) buckets.bagLeftLid.push(isl);
        else buckets.bagLeftBody.push(isl);
      } else {
        if (cy > 0.76 * S) buckets.bagRightLid.push(isl);
        else buckets.bagRightBody.push(isl);
      }
      continue;
    }

    // Tires & Solid Disc Wheels
    if (mn === 'M_Tires') {
      const isDriveBelt = (Math.abs(cx) > 0.06 * S && sy < 0.36 * S && sz > 0.50 * S);
      if (isDriveBelt) {
        buckets.chassis.push(isl); // Drive belt stays on chassis
      } else if (cz > 0.45 * S && cy < 0.50 * S) {
        buckets.frontWheel.push(isl);
      } else if (cz < -0.45 * S && cy < 0.50 * S) {
        buckets.rearWheel.push(isl);
      } else if (cz > 0.45 * S) {
        buckets.steeringUpper.push(isl); // Front caliper/bracket
      } else {
        buckets.chassis.push(isl);
      }
      continue;
    }

    // Headlight lens
    if (mn === 'M_Structure' && Math.abs(cx) < 0.04 && Math.abs(cy - 1.17 * S) < 0.08 && cz > 0.63 * S && sz < 0.10 * S) {
      buckets.headlight.push(isl);
      continue;
    }

    // Raked front fork, wide handlebars, nacelle, front fender, brake calipers
    if (mn === 'M_Structure') {
      const isHandlebarOrUpperFork = (cy > 1.08 * S && cz > 0.16 * S);
      const isForkOrFender = (cz > 0.36 * S && cy > 0.30 * S && isl.min[2] > 0.24 * S);
      if (isHandlebarOrUpperFork || isForkOrFender) {
        buckets.steeringUpper.push(isl);
        continue;
      }
    }

    buckets.chassis.push(isl);
  }

  // Source bag geometry is articulated only when independent lid islands are present.
  const leftBagHingePos = [0.22 * S, 0.84 * S, -0.97 * S];
  const rightBagHingePos = [-0.22 * S, 0.84 * S, -0.97 * S];
  const hasSeparateLids = buckets.bagLeftLid.length > 0 && buckets.bagLeftBody.length > 0;

  for (const child of srcScene.listChildren()) srcScene.removeChild(child);
  const buffer = root.listBuffers()[0] || doc.createBuffer();
  const lamps = createLampMaterials(doc);

  const rig = createMotorcycleRigHierarchy(doc, srcScene, {
    steeringHeadPos: steeringHead,
    rakeDeg: 30.0,
    frontAxlePos: frontAxle,
    rearSwingarmPos: [0, 0.39 * S, -0.42 * S],
    rearAxlePos: rearAxle,
  });

  if (buckets.chassis.length) rig.chassisRoot.addChild(doc.createNode('chassis_body').setMesh(buildMeshFromIslands(doc, buffer, 'chassis_body', buckets.chassis, rig.invMats.chassis)));
  if (buckets.steeringUpper.length) rig.steeringUpper.addChild(doc.createNode('steering_upper_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'steering_upper_mesh', buckets.steeringUpper, rig.invMats.steering)));
  if (buckets.frontWheel.length) rig.frontWheelPivot.addChild(doc.createNode('front_wheel_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'front_wheel_mesh', buckets.frontWheel, rig.invMats.frontWheel)));
  if (buckets.rearWheel.length) rig.rearWheelPivot.addChild(doc.createNode('rear_wheel_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'rear_wheel_mesh', buckets.rearWheel, rig.invMats.rearWheel)));
  if (buckets.headlight.length) rig.steeringUpper.addChild(doc.createNode('lamp_headlight').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_headlight', buckets.headlight, rig.invMats.steering, lamps.headlight)));

  // Keep the original saddlebag geometry. Only articulate lids that exist as separate source islands.
  if (hasSeparateLids) {
    rig.chassisRoot.addChild(doc.createNode('saddlebag_left_body').setMesh(buildMeshFromIslands(doc, buffer, 'saddlebag_left_body', buckets.bagLeftBody, rig.invMats.chassis)));
    rig.chassisRoot.addChild(doc.createNode('saddlebag_right_body').setMesh(buildMeshFromIslands(doc, buffer, 'saddlebag_right_body', buckets.bagRightBody, rig.invMats.chassis)));
    const lLid = doc.createNode('saddlebag_left_lid').setTranslation(leftBagHingePos);
    const rLid = doc.createNode('saddlebag_right_lid').setTranslation(rightBagHingePos);
    lLid.addChild(doc.createNode('bag_l_lid_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'bag_l_lid_mesh', buckets.bagLeftLid, mat4Translation(-leftBagHingePos[0], -leftBagHingePos[1], -leftBagHingePos[2]))));
    rLid.addChild(doc.createNode('bag_r_lid_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'bag_r_lid_mesh', buckets.bagRightLid, mat4Translation(-rightBagHingePos[0], -rightBagHingePos[1], -rightBagHingePos[2]))));
    rig.chassisRoot.addChild(lLid);
    rig.chassisRoot.addChild(rLid);
  } else {
    const allLeft = [...buckets.bagLeftBody, ...buckets.bagLeftLid];
    const allRight = [...buckets.bagRightBody, ...buckets.bagRightLid];
    if (allLeft.length) rig.chassisRoot.addChild(doc.createNode('saddlebag_left_body').setMesh(buildMeshFromIslands(doc, buffer, 'saddlebag_left_body', allLeft, rig.invMats.chassis)));
    if (allRight.length) rig.chassisRoot.addChild(doc.createNode('saddlebag_right_body').setMesh(buildMeshFromIslands(doc, buffer, 'saddlebag_right_body', allRight, rig.invMats.chassis)));
  }

  // Split Fat Boy materials semantically so paint, cruiser seat, solid disc rims, tires & chrome stay strictly isolated!
  const matStruct = root.listMaterials().find((m) => m.getName() === 'M_Structure');
  const matTires = root.listMaterials().find((m) => m.getName() === 'M_Tires');
  if (matStruct && matTires) {
    matStruct.setName('cruiser_hardware');
    const matFatPaint = matStruct.clone().setName('paint_primary').setMetallicFactor(0.45).setRoughnessFactor(0.22);
    const matFatSeat = matStruct.clone().setName('seat_leather').setMetallicFactor(0.02).setRoughnessFactor(0.68);
    matTires.setName('tire_rubber');
    const matFatRim = matTires.clone().setName('rim_alloy').setMetallicFactor(0.88).setRoughnessFactor(0.22);

    // Reassign materials cleanly per island on rebuilt meshes
    for (const isl of buckets.chassis) {
      if (isl.matName === 'M_Structure') {
        const [cx, cy, cz] = isl.ctr;
        const [sx, sy, sz] = isl.sz;
        const isSeat = (Math.abs(cx) < 0.06 && cy > 0.60 * S && cy < 0.88 * S && cz < -0.25 * S && cz > -0.68 * S && sx > 0.35 * S);
        const isPaintedBody = (Math.abs(cx) < 0.08 && ((cz > -0.20 * S && cz < 0.45 * S && cy > 0.55 * S) || (cz < -0.75 * S && cy > 0.42 * S)));
        if (isSeat) isl.material = matFatSeat;
        else if (isPaintedBody) isl.material = matFatPaint;
        else isl.material = matStruct;
      }
    }
    for (const isl of buckets.steeringUpper) {
      if (isl.matName === 'M_Structure') {
        const [cx, cy, cz] = isl.ctr;
        // Front fender & headlight nacelle are painted body color!
        const isFrontPainted = (Math.abs(cx) < 0.08 && ((cy < 0.72 * S && cz > 0.65 * S) || (cy > 1.05 * S && cz > 0.48 * S)));
        isl.material = isFrontPainted ? matFatPaint : matStruct;
      }
    }
    for (const isl of [...buckets.frontWheel, ...buckets.rearWheel]) {
      const isOuterTire = isl.sz[1] > 0.62 * S;
      isl.material = isOuterTire ? matTires : matFatRim;
    }

    // Re-attach updated meshes with separated materials
    const replaceMesh = (nodeName, parentNode, islList, invM) => {
      const old = parentNode.listChildren().find((c) => c.getName() === nodeName);
      if (old) parentNode.removeChild(old);
      if (islList.length) parentNode.addChild(doc.createNode(nodeName).setMesh(buildMeshFromIslands(doc, buffer, nodeName, islList, invM)));
    };
    replaceMesh('chassis_body', rig.chassisRoot, buckets.chassis, rig.invMats.chassis);
    replaceMesh('steering_upper_mesh', rig.steeringUpper, buckets.steeringUpper, rig.invMats.steering);
    replaceMesh('front_wheel_mesh', rig.frontWheelPivot, buckets.frontWheel, rig.invMats.frontWheel);
    replaceMesh('rear_wheel_mesh', rig.rearWheelPivot, buckets.rearWheel, rig.invMats.rearWheel);
  }

  await optimizeTextures(doc, 1024, 84);
  await doc.transform(prune(), dedup());
  const outPath = path.join(OUT_DIR, 'fat-boy-cruiser.glb');
  await io.write(outPath, doc);
  console.log(`  Wrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// 4. PROCESS XYN CUSTOM BOBBER (Google Drive harledson-xyn.zip -> Normalized Rig!)
// ============================================================================
async function processXYNBobber(io) {
  console.log('\n[4/5] Processing XYN Custom Bobber...');
  const doc = await io.read(SOURCE_ASSETS.xyn);
  const root = doc.getRoot();
  const srcScene = root.listScenes()[0];

  // Original XYN faces -Z (front_wheel at z=-0.842, rear_wheel at z=+0.940) -> Rotate 180° around Y!
  // Also lift by -0.014 so tires rest cleanly at y = 0.000
  const S = 0.88;
  const globalXform = mulMat4(mat4Translation(0, -0.014 * S, 0), mulMat4(mat4Scale(S, S, S), mat4RotY(Math.PI)));

  const frontAxle = [0, (0.385 - 0.014) * S, 0.842 * S];
  const rearAxle = [0, (0.395 - 0.014) * S, -0.940 * S];
  const steeringHead = [0, (0.897 - 0.014) * S, 0.414 * S];

  const buckets = { chassis: [], steeringUpper: [], frontWheel: [], rearWheel: [], headlight: [], taillight: [] };

  function walk(node, pm) {
    const wm = mulMat4(pm, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) {
      const nm = node.getName();
      for (const prim of mesh.listPrimitives()) {
        const mName = prim.getMaterial()?.getName() || '';
        const list = extractIslandsFromPrimitive(prim, wm, globalXform, null, 400);
        for (const isl of list) {
          if (mName === 'M_MOTO_fara_emiss_01') buckets.headlight.push(isl);
          else if (mName === 'M_MOTO_raer_emiss_01') buckets.taillight.push(isl);
          else if (nm === 'front_wheel') buckets.frontWheel.push(isl);
          else if (nm === 'rear_wheel') buckets.rearWheel.push(isl);
          else if (nm === 'front_part') buckets.steeringUpper.push(isl);
          else buckets.chassis.push(isl);
        }
      }
    }
    for (const c of node.listChildren()) walk(c, wm);
  }
  for (const n of srcScene.listChildren()) walk(n, mat4Identity());

  // Enhance PBR materials (glossy deep metallic paint, mirror chrome, rich leather)
  for (const mat of root.listMaterials()) {
    const nm = mat.getName();
    if (nm === 'M_MOTO_paint_01') {
      mat.setName('paint_primary');
      mat.setBaseColorFactor([0.62, 0.05, 0.08, 1]);
      mat.setMetallicFactor(0.55);
      mat.setRoughnessFactor(0.14);
    } else if (nm === 'M_Chrome_01') {
      mat.setMetallicFactor(0.96);
      mat.setRoughnessFactor(0.08);
    } else if (nm === 'M_Kozsha_sedla_01') {
      mat.setName('seat_leather');
      mat.setBaseColorFactor([0.14, 0.06, 0.03, 1]);
      mat.setRoughnessFactor(0.62);
    }
  }

  for (const child of srcScene.listChildren()) srcScene.removeChild(child);
  const buffer = root.listBuffers()[0] || doc.createBuffer();
  const lamps = createLampMaterials(doc);

  const rig = createMotorcycleRigHierarchy(doc, srcScene, {
    steeringHeadPos: steeringHead,
    rakeDeg: 33.0,
    frontAxlePos: frontAxle,
    rearSwingarmPos: [0, 0.36 * S, -0.30 * S],
    rearAxlePos: rearAxle,
  });

  if (buckets.chassis.length) rig.chassisRoot.addChild(doc.createNode('chassis_body').setMesh(buildMeshFromIslands(doc, buffer, 'chassis_body', buckets.chassis, rig.invMats.chassis)));
  if (buckets.steeringUpper.length) rig.steeringUpper.addChild(doc.createNode('steering_upper_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'steering_upper_mesh', buckets.steeringUpper, rig.invMats.steering)));
  if (buckets.frontWheel.length) rig.frontWheelPivot.addChild(doc.createNode('front_wheel_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'front_wheel_mesh', buckets.frontWheel, rig.invMats.frontWheel)));
  if (buckets.rearWheel.length) rig.rearWheelPivot.addChild(doc.createNode('rear_wheel_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'rear_wheel_mesh', buckets.rearWheel, rig.invMats.rearWheel)));
  if (buckets.headlight.length) rig.steeringUpper.addChild(doc.createNode('lamp_headlight').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_headlight', buckets.headlight, rig.invMats.steering, lamps.headlight)));
  if (buckets.taillight.length) rig.chassisRoot.addChild(doc.createNode('lamp_taillight').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_taillight', buckets.taillight, rig.invMats.chassis, lamps.taillight)));

  await doc.transform(prune(), dedup());
  const outPath = path.join(OUT_DIR, 'xyn-custom-bobber.glb');
  await io.write(outPath, doc);
  console.log(`  Wrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// 5. PROCESS STREET SPORT 650 (CC-BY 4.0 Eriklys — High-Revving Naked/Sport!)
// ============================================================================
async function processSportbike(io) {
  console.log('\n[5/5] Processing Street Sport 650 (CC-BY 4.0)...');
  const doc = await io.read(SOURCE_ASSETS.sportbike);
  const root = doc.getRoot();
  const srcScene = root.listScenes()[0];

  // Original faces -Z (front tire z=-1.12, rear tire z=+0.77, tire dia=0.81 -> real sportbike 17" tire dia=0.63m -> scale=0.778)
  const S = 0.63 / 0.81;
  const globalXform = mulMat4(mat4Scale(S, S, S), mat4RotY(Math.PI));

  const frontAxle = [0, 0.405 * S, 1.12 * S];
  const rearAxle = [0, 0.405 * S, -0.77 * S];
  const steeringHead = [0, 1.12 * S, 0.72 * S];

  const buckets = {
    frontWheel: [], rearWheel: [], steeringUpper: [], chassis: [],
    seat: [], headlight: [], taillight: [], turnLeft: [], turnRight: []
  };

  function walk(node, pm) {
    const wm = mulMat4(pm, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const mName = prim.getMaterial()?.getName() || '';
        const list = extractIslandsFromPrimitive(prim, wm, globalXform, null, 400);
        for (const isl of list) {
          const [cx, cy, cz] = isl.ctr;
          const dF = Math.hypot(cy - frontAxle[1], cz - frontAxle[2]);
          const dR = Math.hypot(cy - rearAxle[1], cz - rearAxle[2]);

          if (mName === 'farol_0') { buckets.headlight.push(isl); continue; }
          if (mName === 'luzes_de_tras_0') {
            if (Math.abs(cx) < 0.08) buckets.taillight.push(isl);
            else if (cx > 0) buckets.turnLeft.push(isl);
            else buckets.turnRight.push(isl);
            continue;
          }
          if (mName === 'banco_0') { buckets.seat.push(isl); continue; }
          if (mName === 'pneu_0') {
            if (cz > 0) buckets.frontWheel.push(isl); else buckets.rearWheel.push(isl);
            continue;
          }
          if (dF < 0.31 && Math.abs(cx) < 0.14 && cz > 0.50 && isl.max[1] < 0.60) {
            buckets.frontWheel.push(isl); continue;
          }
          if (dR < 0.31 && Math.abs(cx) < 0.14 && cz < -0.35 && isl.max[1] < 0.60) {
            buckets.rearWheel.push(isl); continue;
          }
          if (mName === 'painel_0' || mName === 'acelerador_0' || mName === 'retrovizor_0') {
            buckets.steeringUpper.push(isl); continue;
          }
          if ((cz > 0.48 && cy > 0.25 && isl.min[2] > 0.40) || (cy > 0.90 && cz > 0.44)) {
            buckets.steeringUpper.push(isl); continue;
          }
          buckets.chassis.push(isl);
        }
      }
    }
    for (const c of node.listChildren()) walk(c, wm);
  }
  for (const n of srcScene.listChildren()) walk(n, mat4Identity());

  for (const mat of root.listMaterials()) {
    const nm = mat.getName();
    if (nm === 'tanque_0') { mat.setName('paint_primary'); mat.setMetallicFactor(0.55); mat.setRoughnessFactor(0.16); }
    else if (nm === 'banco_0') { mat.setName('seat_leather'); mat.setRoughnessFactor(0.75); }
    else if (nm === 'metal_claro_0') { mat.setMetallicFactor(0.92); mat.setRoughnessFactor(0.18); }
  }

  for (const child of srcScene.listChildren()) srcScene.removeChild(child);
  const buffer = root.listBuffers()[0] || doc.createBuffer();
  const lamps = createLampMaterials(doc);

  const rig = createMotorcycleRigHierarchy(doc, srcScene, {
    steeringHeadPos: steeringHead,
    rakeDeg: 23.5,
    frontAxlePos: frontAxle,
    rearSwingarmPos: [0, 0.42 * S, -0.20 * S],
    rearAxlePos: rearAxle,
  });

  if (buckets.chassis.length) rig.chassisRoot.addChild(doc.createNode('chassis_body').setMesh(buildMeshFromIslands(doc, buffer, 'chassis_body', buckets.chassis, rig.invMats.chassis)));
  if (buckets.steeringUpper.length) rig.steeringUpper.addChild(doc.createNode('steering_upper_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'steering_upper_mesh', buckets.steeringUpper, rig.invMats.steering)));
  if (buckets.frontWheel.length) rig.frontWheelPivot.addChild(doc.createNode('front_wheel_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'front_wheel_mesh', buckets.frontWheel, rig.invMats.frontWheel)));
  if (buckets.rearWheel.length) rig.rearWheelPivot.addChild(doc.createNode('rear_wheel_mesh').setMesh(buildMeshFromIslands(doc, buffer, 'rear_wheel_mesh', buckets.rearWheel, rig.invMats.rearWheel)));
  if (buckets.headlight.length) rig.steeringUpper.addChild(doc.createNode('lamp_headlight').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_headlight', buckets.headlight, rig.invMats.steering, lamps.headlight)));
  if (buckets.taillight.length) rig.chassisRoot.addChild(doc.createNode('lamp_taillight').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_taillight', buckets.taillight, rig.invMats.chassis, lamps.taillight)));
  if (buckets.turnLeft.length) rig.chassisRoot.addChild(doc.createNode('lamp_turn_rl').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_turn_rl', buckets.turnLeft, rig.invMats.chassis, lamps.turnLeft)));
  if (buckets.turnRight.length) rig.chassisRoot.addChild(doc.createNode('lamp_turn_rr').setMesh(buildMeshFromIslands(doc, buffer, 'lamp_turn_rr', buckets.turnRight, rig.invMats.chassis, lamps.turnRight)));

  // Keep the source seat mesh and attach it to its articulation pivot.
  const seatHingePos = [0, 0.78 * S, 0.04 * S];
  const seatHinge = doc.createNode('seat_hinge').setTranslation(seatHingePos);
  rig.chassisRoot.addChild(seatHinge);
  if (buckets.seat.length) seatHinge.addChild(doc.createNode('seat_cushion').setMesh(buildMeshFromIslands(doc, buffer, 'seat_cushion', buckets.seat, mat4Translation(-seatHingePos[0], -seatHingePos[1], -seatHingePos[2]))));

  await optimizeTextures(doc, 1024, 84);
  await doc.transform(prune(), dedup());
  const outPath = path.join(OUT_DIR, 'street-sport-650.glb');
  await io.write(outPath, doc);
  console.log(`  Wrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const strict = process.argv.includes('--strict');
  const requested = process.argv.slice(2).filter((arg) => arg !== '--strict');
  const jobs = {
    'super-cub-c90': { source: SOURCE_ASSETS.superCub, run: processSuperCub },
    'honda-cg-125': { source: SOURCE_ASSETS.cg125, run: processCG125 },
    'fat-boy-cruiser': { source: SOURCE_ASSETS.fatBoy, run: processFatBoy },
    'xyn-custom-bobber': { source: SOURCE_ASSETS.xyn, run: processXYNBobber },
    'street-sport-650': { source: SOURCE_ASSETS.sportbike, run: processSportbike },
  };
  const ids = requested.length
    ? requested
    : Object.keys(jobs);
  const missingSources = [];

  for (const id of ids) {
    const job = jobs[id];
    if (!job) {
      throw new Error(`Unknown vehicle '${id}'. Valid IDs: ${Object.keys(jobs).join(', ')}`);
    }
    if (!fs.existsSync(job.source)) {
      missingSources.push(`${id}: ${job.source}`);
      console.warn(`\nSkipping ${id}: its original source file is missing. No substitute model will be created.`);
      continue;
    }
    await job.run(io);
  }

  if (missingSources.length) {
    console.warn(`\nMissing original model sources:\n${missingSources.map((source) => `  - ${source}`).join('\n')}`);
    if (strict) {
      throw new Error('Model generation stopped because one or more original sources are missing.');
    }
  }

  console.log(`\nRequested vehicle processing finished. Output directory: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
