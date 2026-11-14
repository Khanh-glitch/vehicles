import * as THREE from 'three';

export interface AnalyzedVehicleRig {
  isPreRigged: boolean;
  isMonolithic: boolean;
  meshCount: number;
  totalTriangles: number;
  islandCount: number;
  boundingSize: [number, number, number];
  detectedForwardAxis: '+Z' | '-Z' | '+X' | '-X';
  scaleFactor: number;
  frontAxle: [number, number, number];
  rearAxle: [number, number, number];
  frontWheelRadius: number;
  rearWheelRadius: number;
  steeringHead: [number, number, number];
  rakeDeg: number;
  partSummary: {
    frontWheelMeshes: number;
    rearWheelMeshes: number;
    steeringMeshes: number;
    chassisMeshes: number;
    lampMeshes: number;
    articulatedParts: string[];
  };
  warnings: string[];
}

export interface RigOverrideParams {
  forwardAxis: '+Z' | '-Z' | '+X' | '-X';
  targetWheelbaseM: number;
  rakeDeg: number;
  frontAxleZ: number;
  rearAxleZ: number;
  wheelRadiusM: number;
}

/**
 * Inspects ANY loaded Three.js GLB scene (either pre-rigged by our offline pipeline
 * OR a raw external/merged GLB uploaded via Vehicle Pipeline).
 * If the model is NOT already rigged into standard chassis_root/steering_pivot/front_wheel_pivot/rear_wheel_pivot,
 * this analyzer geometrically decomposes merged meshes by connected triangle islands & spatial wheel heuristics
 * and synthesizes a real working mechanical rig hierarchy on the fly!
 */
export function inspectAndRigThreeScene(
  rawRoot: THREE.Object3D,
  overrides?: Partial<RigOverrideParams>
): { riggedRoot: THREE.Group; report: AnalyzedVehicleRig } {
  rawRoot.updateMatrixWorld(true);

  // Check if already follows our standardized Moto Atelier Rig!
  const hasChassis = !!rawRoot.getObjectByName('chassis_root');
  const hasFrontWheel = !!rawRoot.getObjectByName('front_wheel_pivot');
  const hasRearWheel = !!rawRoot.getObjectByName('rear_wheel_pivot');
  const hasSteering = !!rawRoot.getObjectByName('steering_pivot');

  let meshCount = 0;
  let totalTriangles = 0;
  const articulatedParts: string[] = [];
  const articulatedNames = [
    'seat_hinge',
    'fuel_cap_pivot',
    'kickstand_pivot',
    'saddlebag_left_lid',
    'saddlebag_right_lid',
    'glovebox_hinge',
    'gear_shifter_pivot',
    'brake_pedal_pivot',
    'kickstarter_pivot',
    'speedo_needle_pivot',
    'tacho_needle_pivot',
  ];

  rawRoot.traverse((obj) => {
    if (articulatedNames.includes(obj.name)) articulatedParts.push(obj.name);
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      meshCount++;
      const g = m.geometry;
      totalTriangles += g.index ? Math.floor(g.index.count / 3) : Math.floor((g.attributes.position?.count || 0) / 3);
    }
  });

  if (hasChassis && hasFrontWheel && hasRearWheel && hasSteering && !overrides) {
    const box = new THREE.Box3().setFromObject(rawRoot);
    const sz = new THREE.Vector3();
    box.getSize(sz);
    const fwObj = rawRoot.getObjectByName('front_wheel_pivot')!;
    const rwObj = rawRoot.getObjectByName('rear_wheel_pivot')!;
    const stObj = rawRoot.getObjectByName('steering_pivot')!;
    const fwPos = new THREE.Vector3();
    const rwPos = new THREE.Vector3();
    const stPos = new THREE.Vector3();
    fwObj.getWorldPosition(fwPos);
    rwObj.getWorldPosition(rwPos);
    stObj.getWorldPosition(stPos);

    const wrap = new THREE.Group();
    wrap.name = 'vehicle_rig_wrapper';
    wrap.add(rawRoot);

    return {
      riggedRoot: wrap,
      report: {
        isPreRigged: true,
        isMonolithic: false,
        meshCount,
        totalTriangles,
        islandCount: meshCount,
        boundingSize: [+sz.x.toFixed(3), +sz.y.toFixed(3), +sz.z.toFixed(3)],
        detectedForwardAxis: '+Z',
        scaleFactor: 1,
        frontAxle: [+fwPos.x.toFixed(3), +fwPos.y.toFixed(3), +fwPos.z.toFixed(3)],
        rearAxle: [+rwPos.x.toFixed(3), +rwPos.y.toFixed(3), +rwPos.z.toFixed(3)],
        frontWheelRadius: Math.max(0.2, +fwPos.y.toFixed(3)),
        rearWheelRadius: Math.max(0.2, +rwPos.y.toFixed(3)),
        steeringHead: [+stPos.x.toFixed(3), +stPos.y.toFixed(3), +stPos.z.toFixed(3)],
        rakeDeg: +((Math.abs(stObj.rotation.x) * 180) / Math.PI).toFixed(1),
        partSummary: {
          frontWheelMeshes: 1,
          rearWheelMeshes: 1,
          steeringMeshes: 1,
          chassisMeshes: Math.max(1, meshCount - 3),
          lampMeshes: ['lamp_headlight', 'lamp_taillight', 'lamp_turn_fl', 'lamp_turn_fr', 'lamp_turn_rl', 'lamp_turn_rr'].filter(
            (n) => !!rawRoot.getObjectByName(n)
          ).length,
          articulatedParts,
        },
        warnings: [],
      },
    };
  }

  // ==========================================================================
  // RAW / MONOLITHIC EXTERNAL GLB -> LIVE AUTOMATIC GEOMETRIC DECOMPOSITION!
  // ==========================================================================
  const warnings: string[] = [];
  const rawBox = new THREE.Box3().setFromObject(rawRoot);
  const rawSize = new THREE.Vector3();
  rawBox.getSize(rawSize);
  const rawCenter = new THREE.Vector3();
  rawBox.getCenter(rawCenter);

  // Detect longest horizontal axis as longitudinal axis
  const defaultForward: '+Z' | '-Z' | '+X' | '-X' = rawSize.x > rawSize.z ? '+X' : '+Z';
  const forwardAxis = overrides?.forwardAxis || defaultForward;
  const rawLen = forwardAxis === '+X' || forwardAxis === '-X' ? rawSize.x : rawSize.z;
  const targetLen = overrides?.targetWheelbaseM ? overrides.targetWheelbaseM * 1.48 : 2.08;
  const scaleFactor = rawLen > 0.01 ? targetLen / rawLen : 1;

  // Build normalization matrix -> Y-up, +Z forward, centered in X/Z, minY = 0
  const normMat = new THREE.Matrix4();
  const rotY =
    forwardAxis === '+Z' ? 0 :
    forwardAxis === '-Z' ? Math.PI :
    forwardAxis === '+X' ? -Math.PI / 2 :
    Math.PI / 2;

  const mT1 = new THREE.Matrix4().makeTranslation(-rawCenter.x, -rawBox.min.y, -rawCenter.z);
  const mR = new THREE.Matrix4().makeRotationY(rotY);
  const mS = new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);
  normMat.multiplyMatrices(mS, mR).multiply(mT1);

  // Decompose EVERY mesh into connected triangle islands in normalized world space!
  interface IslandGeo {
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
    box: THREE.Box3;
    center: THREE.Vector3;
    size: THREE.Vector3;
    triCount: number;
    srcName: string;
  }

  const allIslands: IslandGeo[] = [];
  const isMonolithic = meshCount <= 6;
  if (isMonolithic) {
    warnings.push('Phát hiện mô hình bị gộp mesh — đã tự động kích hoạt bộ phân tách đảo đa giác liên thông (Connected-Component Island Decomposer).');
  }

  rawRoot.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const srcGeom = mesh.geometry;
    const posAttr = srcGeom.attributes.position;
    if (!posAttr) return;

    const fullMat = new THREE.Matrix4().multiplyMatrices(normMat, mesh.matrixWorld);
    const normMat3 = new THREE.Matrix3().getNormalMatrix(fullMat);
    const vCount = posAttr.count;
    const idxAttr = srcGeom.index;
    const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(vCount / 3);

    const wPos = new Float32Array(vCount * 3);
    const normAttr = srcGeom.attributes.normal;
    const wNorm = normAttr ? new Float32Array(vCount * 3) : null;
    const uvAttr = srcGeom.attributes.uv;
    const tmpV = new THREE.Vector3();

    for (let i = 0; i < vCount; i++) {
      tmpV.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(fullMat);
      wPos[i * 3] = tmpV.x;
      wPos[i * 3 + 1] = tmpV.y;
      wPos[i * 3 + 2] = tmpV.z;
      if (wNorm && normAttr) {
        tmpV.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i)).applyMatrix3(normMat3).normalize();
        wNorm[i * 3] = tmpV.x;
        wNorm[i * 3 + 1] = tmpV.y;
        wNorm[i * 3 + 2] = tmpV.z;
      }
    }

    // Connected components by spatially welded vertices
    const vKeyToId = new Map<string, number>();
    const vMap = new Int32Array(vCount);
    let nextId = 0;
    for (let i = 0; i < vCount; i++) {
      const k = `${Math.round(wPos[i * 3] * 250)},${Math.round(wPos[i * 3 + 1] * 250)},${Math.round(wPos[i * 3 + 2] * 250)}`;
      let id = vKeyToId.get(k);
      if (id === undefined) {
        id = nextId++;
        vKeyToId.set(k, id);
      }
      vMap[i] = id;
    }
    const parent = new Int32Array(nextId);
    for (let i = 0; i < nextId; i++) parent[i] = i;
    const find = (x: number) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const union = (a: number, b: number) => {
      a = find(a);
      b = find(b);
      if (a !== b) parent[a] = b;
    };

    for (let t = 0; t < triCount; t++) {
      const i0 = idxAttr ? idxAttr.getX(t * 3) : t * 3;
      const i1 = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2;
      union(vMap[i0], vMap[i1]);
      union(vMap[i1], vMap[i2]);
    }

    const compTris = new Map<number, number[]>();
    for (let t = 0; t < triCount; t++) {
      const i0 = idxAttr ? idxAttr.getX(t * 3) : t * 3;
      const i1 = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2;
      const r = find(vMap[i0]);
      let arr = compTris.get(r);
      if (!arr) {
        arr = [];
        compTris.set(r, arr);
      }
      arr.push(i0, i1, i2);
    }

    for (const tris of compTris.values()) {
      const localMap = new Map<number, number>();
      const nPos: number[] = [];
      const nNorm: number[] = [];
      const nUv: number[] = [];
      const nIdx: number[] = [];
      const b = new THREE.Box3();
      let cursor = 0;

      for (let k = 0; k < tris.length; k++) {
        const oi = tris[k];
        let mi = localMap.get(oi);
        if (mi === undefined) {
          mi = cursor++;
          localMap.set(oi, mi);
          const x = wPos[oi * 3], y = wPos[oi * 3 + 1], z = wPos[oi * 3 + 2];
          nPos.push(x, y, z);
          b.expandByPoint(tmpV.set(x, y, z));
          if (wNorm) nNorm.push(wNorm[oi * 3], wNorm[oi * 3 + 1], wNorm[oi * 3 + 2]);
          if (uvAttr) nUv.push(uvAttr.getX(oi), uvAttr.getY(oi));
        }
        nIdx.push(mi);
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(nPos, 3));
      if (wNorm) geom.setAttribute('normal', new THREE.Float32BufferAttribute(nNorm, 3));
      else geom.computeVertexNormals();
      if (uvAttr) geom.setAttribute('uv', new THREE.Float32BufferAttribute(nUv, 2));
      geom.setIndex(nIdx);

      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      b.getCenter(center);
      b.getSize(size);

      allIslands.push({
        geometry: geom,
        material: mesh.material,
        box: b,
        center,
        size,
        triCount: tris.length / 3,
        srcName: mesh.name,
      });
    }
  });

  // Compute global normalized box
  const normBox = new THREE.Box3();
  for (const isl of allIslands) normBox.union(isl.box);
  const normSize = new THREE.Vector3();
  normBox.getSize(normSize);

  // Detect Front & Rear Wheel candidates using cylindrical ground-contact heuristics!
  const wheelCandidates = allIslands.filter((isl) => {
    const aspectYZ = Math.min(isl.size.y, isl.size.z) / Math.max(isl.size.y, isl.size.z, 0.001);
    return (
      isl.box.min.y < 0.12 &&
      isl.size.y > 0.35 &&
      isl.size.y < 0.85 &&
      aspectYZ > 0.78 &&
      Math.abs(isl.center.x) < 0.14
    );
  });

  let frontAxleZ = overrides?.frontAxleZ ?? normBox.max.z - 0.33;
  let rearAxleZ = overrides?.rearAxleZ ?? normBox.min.z + 0.33;
  let wheelR = overrides?.wheelRadiusM ?? 0.32;

  if (!overrides?.frontAxleZ && wheelCandidates.length >= 2) {
    wheelCandidates.sort((a, b) => b.center.z - a.center.z);
    frontAxleZ = wheelCandidates[0].center.z;
    rearAxleZ = wheelCandidates[wheelCandidates.length - 1].center.z;
    wheelR = (wheelCandidates[0].size.y + wheelCandidates[wheelCandidates.length - 1].size.y) * 0.25;
  }

  const rakeDeg = overrides?.rakeDeg ?? 26.0;
  const rakeRad = (rakeDeg * Math.PI) / 180;
  const steeringHeadPos = new THREE.Vector3(0, normSize.y * 0.72, frontAxleZ - Math.tan(rakeRad) * (normSize.y * 0.72 - wheelR));
  const frontAxlePos = new THREE.Vector3(0, wheelR, frontAxleZ);
  const rearAxlePos = new THREE.Vector3(0, wheelR, rearAxleZ);
  const rearSwingPos = new THREE.Vector3(0, wheelR + 0.04, rearAxleZ + 0.42);

  // Build standard mechanical rig hierarchy!
  const riggedRoot = new THREE.Group();
  riggedRoot.name = 'vehicle_rig_wrapper';
  const chassisRoot = new THREE.Group();
  chassisRoot.name = 'chassis_root';
  riggedRoot.add(chassisRoot);

  const steeringPivot = new THREE.Group();
  steeringPivot.name = 'steering_pivot';
  steeringPivot.position.copy(steeringHeadPos);
  steeringPivot.rotation.x = -rakeRad;
  chassisRoot.add(steeringPivot);

  const steeringUpper = new THREE.Group();
  steeringUpper.name = 'steering_upper';
  steeringPivot.add(steeringUpper);

  const frontSlider = new THREE.Group();
  frontSlider.name = 'front_suspension_slider';
  steeringPivot.add(frontSlider);

  const invSteer = new THREE.Matrix4()
    .makeRotationX(rakeRad)
    .multiply(new THREE.Matrix4().makeTranslation(-steeringHeadPos.x, -steeringHeadPos.y, -steeringHeadPos.z));

  const frontAxleLocal = frontAxlePos.clone().applyMatrix4(invSteer);
  const frontWheelPivot = new THREE.Group();
  frontWheelPivot.name = 'front_wheel_pivot';
  frontWheelPivot.position.copy(frontAxleLocal);
  frontWheelPivot.rotation.x = rakeRad;
  frontSlider.add(frontWheelPivot);

  const rearSwingarmPivot = new THREE.Group();
  rearSwingarmPivot.name = 'rear_swingarm_pivot';
  rearSwingarmPivot.position.copy(rearSwingPos);
  chassisRoot.add(rearSwingarmPivot);

  const rearWheelPivot = new THREE.Group();
  rearWheelPivot.name = 'rear_wheel_pivot';
  rearWheelPivot.position.set(0, rearAxlePos.y - rearSwingPos.y, rearAxlePos.z - rearSwingPos.z);
  rearSwingarmPivot.add(rearWheelPivot);

  const invFrontWheel = new THREE.Matrix4().makeTranslation(-frontAxlePos.x, -frontAxlePos.y, -frontAxlePos.z);
  const invRearWheel = new THREE.Matrix4().makeTranslation(-rearAxlePos.x, -rearAxlePos.y, -rearAxlePos.z);

  let frontWheelMeshes = 0;
  let rearWheelMeshes = 0;
  let steeringMeshes = 0;
  let chassisMeshes = 0;

  for (const isl of allIslands) {
    const dFront = Math.hypot(isl.center.y - frontAxlePos.y, isl.center.z - frontAxlePos.z);
    const dRear = Math.hypot(isl.center.y - rearAxlePos.y, isl.center.z - rearAxlePos.z);

    if (dFront < wheelR * 1.02 && Math.abs(isl.center.x) < 0.14 && isl.box.max.y < wheelR * 2.12) {
      isl.geometry.applyMatrix4(invFrontWheel);
      frontWheelPivot.add(new THREE.Mesh(isl.geometry, isl.material));
      frontWheelMeshes++;
    } else if (dRear < wheelR * 1.02 && Math.abs(isl.center.x) < 0.14 && isl.box.max.y < wheelR * 2.12) {
      isl.geometry.applyMatrix4(invRearWheel);
      rearWheelPivot.add(new THREE.Mesh(isl.geometry, isl.material));
      rearWheelMeshes++;
    } else if (
      (isl.center.z > steeringHeadPos.z - 0.12 && isl.center.y > normSize.y * 0.58) ||
      (isl.center.z > steeringHeadPos.z + 0.05 && isl.box.min.z > steeringHeadPos.z - 0.15)
    ) {
      isl.geometry.applyMatrix4(invSteer);
      steeringUpper.add(new THREE.Mesh(isl.geometry, isl.material));
      steeringMeshes++;
    } else {
      chassisRoot.add(new THREE.Mesh(isl.geometry, isl.material));
      chassisMeshes++;
    }
  }

  if (frontWheelMeshes === 0 || rearWheelMeshes === 0) {
    warnings.push('Không phát hiện đủ đảo bánh xe rời — vui lòng tinh chỉnh trục Front/Rear Axle thủ công trong bảng hiệu chỉnh.');
  }

  return {
    riggedRoot,
    report: {
      isPreRigged: false,
      isMonolithic,
      meshCount,
      totalTriangles,
      islandCount: allIslands.length,
      boundingSize: [+normSize.x.toFixed(3), +normSize.y.toFixed(3), +normSize.z.toFixed(3)],
      detectedForwardAxis: forwardAxis,
      scaleFactor: +scaleFactor.toFixed(3),
      frontAxle: [0, +frontAxlePos.y.toFixed(3), +frontAxlePos.z.toFixed(3)],
      rearAxle: [0, +rearAxlePos.y.toFixed(3), +rearAxlePos.z.toFixed(3)],
      frontWheelRadius: +wheelR.toFixed(3),
      rearWheelRadius: +wheelR.toFixed(3),
      steeringHead: [0, +steeringHeadPos.y.toFixed(3), +steeringHeadPos.z.toFixed(3)],
      rakeDeg,
      partSummary: {
        frontWheelMeshes,
        rearWheelMeshes,
        steeringMeshes,
        chassisMeshes,
        lampMeshes: 0,
        articulatedParts: [],
      },
      warnings,
    },
  };
}
