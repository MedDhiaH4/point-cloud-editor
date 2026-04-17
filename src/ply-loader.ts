import * as pc from 'playcanvas';

export interface PLYData {
    positions: Float32Array;
    colors: Uint8Array;
    normals: Float32Array; // ⚡ NEW: Extracted or Calculated Normals
    numPoints: number;
    min: pc.Vec3;
    max: pc.Vec3;
    center: pc.Vec3;
    size: pc.Vec3;
    isGaussianSplat: boolean;
}

const TYPE_MAP: Record<string, { size: number, func: string }> = {
    'char': { size: 1, func: 'getInt8' }, 'uchar': { size: 1, func: 'getUint8' },
    'short': { size: 2, func: 'getInt16' }, 'ushort': { size: 2, func: 'getUint16' },
    'int': { size: 4, func: 'getInt32' }, 'uint': { size: 4, func: 'getUint32' },
    'float': { size: 4, func: 'getFloat32' }, 'double': { size: 8, func: 'getFloat64' },
    'int8': { size: 1, func: 'getInt8' }, 'uint8': { size: 1, func: 'getUint8' },
    'int16': { size: 2, func: 'getInt16' }, 'uint16': { size: 2, func: 'getUint16' },
    'int32': { size: 4, func: 'getInt32' }, 'uint32': { size: 4, func: 'getUint32' },
    'float32': { size: 4, func: 'getFloat32' }, 'float64': { size: 8, func: 'getFloat64' }
};

export async function parsePLY(buffer: ArrayBuffer): Promise<PLYData | null> {
    const uint8View = new Uint8Array(buffer);
    let headerStr = '';
    let headerEnd = 0;
    
    for (let i = 0; i < uint8View.length; i++) {
        headerStr += String.fromCharCode(uint8View[i]);
        if (headerStr.endsWith('end_header\n') || headerStr.endsWith('end_header\r\n')) {
            headerEnd = i + 1;
            break;
        }
    }

    const lines = headerStr.split(/\r?\n/);
    let originalPoints = 0;
    let isLittleEndian = true;
    const properties: any[] = [];
    let currentStride = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('format')) {
            isLittleEndian = trimmed.includes('binary_little_endian');
        } else if (trimmed.startsWith('element vertex')) {
            originalPoints = parseInt(trimmed.split(/\s+/)[2], 10);
        } else if (trimmed.startsWith('property')) {
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 3 && parts[1] !== 'list') {
                const info = TYPE_MAP[parts[1]];
                if (info) {
                    properties.push({ name: parts[2], ...info, offset: currentStride });
                    currentStride += info.size;
                }
            }
        }
    }

    const view = new DataView(buffer, headerEnd);

    const getProp = (pName: string) => properties.find(p => p.name === pName);
    const px = getProp('x'), py = getProp('y'), pz = getProp('z');
    const pr = getProp('red') || getProp('diffuse_red') || getProp('f_dc_0');
    const pg = getProp('green') || getProp('diffuse_green') || getProp('f_dc_1');
    const pb = getProp('blue') || getProp('diffuse_blue') || getProp('f_dc_2');
    
    // ⚡ NEW: Check for Native Normals
    const pnx = getProp('nx') || getProp('normal_x');
    const pny = getProp('ny') || getProp('normal_y');
    const pnz = getProp('nz') || getProp('normal_z');

    // Extract Splat Boundaries
    const s0 = getProp('scale_0'), s1 = getProp('scale_1'), s2 = getProp('scale_2');
    const rot0 = getProp('rot_0'), rot1 = getProp('rot_1'), rot2 = getProp('rot_2'), rot3 = getProp('rot_3');

    const isGaussianSplat = !!getProp('f_dc_0');
    const isDensifiable = isGaussianSplat && s0 && s1 && s2 && rot0 && rot1 && rot2 && rot3;

    // If densifiable, we allocate 5x the array space
    const MULTIPLIER = isDensifiable ? 10 : 1;
    const totalPoints = originalPoints * MULTIPLIER;

    const positions = new Float32Array(totalPoints * 3);
    const colors = new Uint8Array(totalPoints * 4);
    const normals = new Float32Array(totalPoints * 3); // ⚡ NEW: Allocate Normals array

    if (!px || !py || !pz) return null;

    let min = new pc.Vec3(Infinity, Infinity, Infinity);
    let max = new pc.Vec3(-Infinity, -Infinity, -Infinity);

    for (let i = 0; i < originalPoints; i++) {
        const o = i * currentStride;
        
        // 1. Extract Base Position
        const x = (view as any)[px.func](o + px.offset, isLittleEndian);
        const y = (view as any)[py.func](o + py.offset, isLittleEndian);
        const z = (view as any)[pz.func](o + pz.offset, isLittleEndian);

        if (x < min.x) min.x = x; if (x > max.x) max.x = x;
        if (y < min.y) min.y = y; if (y > max.y) max.y = y;
        if (z < min.z) min.z = z; if (z > max.z) max.z = z;

        // 2. Extract and Normalize Colors
        let r = pr ? (view as any)[pr.func](o + pr.offset, isLittleEndian) : 255;
        let g = pg ? (view as any)[pg.func](o + pg.offset, isLittleEndian) : 255;
        let b = pb ? (view as any)[pb.func](o + pb.offset, isLittleEndian) : 255;

        let rNorm = 0, gNorm = 0, bNorm = 0;

        if (isGaussianSplat) {
            const SH_C0 = 0.28209479177387814; 
            rNorm = Math.max(0, Math.min(1, r * SH_C0 + 0.5));
            gNorm = Math.max(0, Math.min(1, g * SH_C0 + 0.5));
            bNorm = Math.max(0, Math.min(1, b * SH_C0 + 0.5));
        } else {
            rNorm = (pr && (pr.func === 'getFloat32' || pr.func === 'getFloat64')) ? r : r / 255.0;
            gNorm = (pg && (pg.func === 'getFloat32' || pg.func === 'getFloat64')) ? g : g / 255.0;
            bNorm = (pb && (pb.func === 'getFloat32' || pb.func === 'getFloat64')) ? b : b / 255.0;
        }

        rNorm = Math.pow(rNorm, 2.2);
        gNorm = Math.pow(gNorm, 2.2);
        bNorm = Math.pow(bNorm, 2.2);

        const rFinal = Math.round(rNorm * 255);
        const gFinal = Math.round(gNorm * 255);
        const bFinal = Math.round(bNorm * 255);

        // ⚡ 3. Extract Native Normal OR Calculate Splat Normal
        let nx = pnx ? (view as any)[pnx.func](o + pnx.offset, isLittleEndian) : 0;
        let ny = pny ? (view as any)[pny.func](o + pny.offset, isLittleEndian) : 0;
        let nz = pnz ? (view as any)[pnz.func](o + pnz.offset, isLittleEndian) : 0;

        let flatScaleX = 0, flatScaleY = 0, flatScaleZ = 0;
        let qw = 1, qx = 0, qy = 0, qz = 0;

        if (isDensifiable && s0 && s1 && s2 && rot0 && rot1 && rot2 && rot3) {
            const scaleX = Math.exp((view as any)[s0.func](o + s0.offset, isLittleEndian));
            const scaleY = Math.exp((view as any)[s1.func](o + s1.offset, isLittleEndian));
            const scaleZ = Math.exp((view as any)[s2.func](o + s2.offset, isLittleEndian));

            const minScale = Math.min(scaleX, scaleY, scaleZ);
            const squashFactor = 0.0001; 
            
            flatScaleX = scaleX === minScale ? scaleX * squashFactor : scaleX;
            flatScaleY = scaleY === minScale ? scaleY * squashFactor : scaleY;
            flatScaleZ = scaleZ === minScale ? scaleZ * squashFactor : scaleZ;

            qw = (view as any)[rot0.func](o + rot0.offset, isLittleEndian);
            qx = (view as any)[rot1.func](o + rot1.offset, isLittleEndian);
            qy = (view as any)[rot2.func](o + rot2.offset, isLittleEndian);
            qz = (view as any)[rot3.func](o + rot3.offset, isLittleEndian);

            // ⚡ Calculate the Normal based on the shortest flat axis
            const lnx = minScale === scaleX ? 1 : 0;
            const lny = minScale === scaleY ? 1 : 0;
            const lnz = minScale === scaleZ ? 1 : 0;

            // Rotate the local normal by the Splat's Quaternion
            const uv_x = qy * lnz - qz * lny;
            const uv_y = qz * lnx - qx * lnz;
            const uv_z = qx * lny - qy * lnx;
            
            const uuv_x = qy * uv_z - qz * uv_y;
            const uuv_y = qz * uv_x - qx * uv_z;
            const uuv_z = qx * uv_y - qy * uv_x;
            
            nx = lnx + 2.0 * (qw * uv_x + uuv_x);
            ny = lny + 2.0 * (qw * uv_y + uuv_y);
            nz = lnz + 2.0 * (qw * uv_z + uuv_z);
        }

        // 4. Store Original Base Point
        let baseIdx = i * MULTIPLIER;
        positions[baseIdx * 3 + 0] = x; positions[baseIdx * 3 + 1] = y; positions[baseIdx * 3 + 2] = z;
        colors[baseIdx * 4 + 0] = rFinal; colors[baseIdx * 4 + 1] = gFinal; colors[baseIdx * 4 + 2] = bFinal; colors[baseIdx * 4 + 3] = 255; 
        
        // ⚡ Store the Normal for the Base Point
        normals[baseIdx * 3 + 0] = nx; normals[baseIdx * 3 + 1] = ny; normals[baseIdx * 3 + 2] = nz;

        // 5. Generate Extra Points inside the Splat Ellipsoid
        if (isDensifiable) {
            for (let e = 1; e < MULTIPLIER; e++) {
                const u = Math.random();
                const radius = Math.pow(u, 1/3); 
                const theta = Math.random() * 2 * Math.PI;
                const phi = Math.acos(2 * Math.random() - 1);
                
                const dx = radius * Math.sin(phi) * Math.cos(theta);
                const dy = radius * Math.sin(phi) * Math.sin(theta);
                const dz = radius * Math.cos(phi);

                const sx = dx * flatScaleX;
                const sy = dy * flatScaleY;
                const sz = dz * flatScaleZ;

                const uv_x = qy * sz - qz * sy;
                const uv_y = qz * sx - qx * sz;
                const uv_z = qx * sy - qy * sx;
                
                const uuv_x = qy * uv_z - qz * uv_y;
                const uuv_y = qz * uv_x - qx * uv_z;
                const uuv_z = qx * uv_y - qy * uv_x;
                
                const finalX = x + sx + 2.0 * (qw * uv_x + uuv_x);
                const finalY = y + sy + 2.0 * (qw * uv_y + uuv_y);
                const finalZ = z + sz + 2.0 * (qw * uv_z + uuv_z);

                const extIdx = baseIdx + e;
                positions[extIdx * 3 + 0] = finalX;
                positions[extIdx * 3 + 1] = finalY;
                positions[extIdx * 3 + 2] = finalZ;
                
                colors[extIdx * 4 + 0] = rFinal;
                colors[extIdx * 4 + 1] = gFinal;
                colors[extIdx * 4 + 2] = bFinal;
                colors[extIdx * 4 + 3] = 255;

                // ⚡ Store the EXACT same normal for the extra splat points because they sit on the same flat surface!
                normals[extIdx * 3 + 0] = nx; 
                normals[extIdx * 3 + 1] = ny; 
                normals[extIdx * 3 + 2] = nz;
            }
        }
    }

    // --- NORMALIZATION & Z-UP FIX ---
    const center = new pc.Vec3().add2(min, max).mulScalar(0.5);
    const size = new pc.Vec3().sub2(max, min);

    let upAxis: 'x' | 'y' | 'z' = 'z';
    if (size.y > size.x && size.y > size.z) upAxis = 'y';
    else if (size.x > size.y && size.x > size.z) upAxis = 'x';

    const rotation = new pc.Quat();
    if (upAxis === 'y') rotation.setFromEulerAngles(-90, 0, 0);
    else if (upAxis === 'x') rotation.setFromEulerAngles(0, 0, 90);
    else rotation.set(0, 0, 0, 1);

    const tempPos = new pc.Vec3();
    const tempNorm = new pc.Vec3();
    let rMin = new pc.Vec3(Infinity, Infinity, Infinity);
    let rMax = new pc.Vec3(-Infinity, -Infinity, -Infinity);

    for (let i = 0; i < totalPoints; i++) {
        // Rotate Position
        tempPos.set(
            positions[i * 3 + 0] - center.x,
            positions[i * 3 + 1] - center.y,
            positions[i * 3 + 2] - center.z
        );
        rotation.transformVector(tempPos, tempPos);
        
        positions[i * 3 + 0] = tempPos.x;
        positions[i * 3 + 1] = tempPos.y;
        positions[i * 3 + 2] = tempPos.z;

        if (tempPos.x < rMin.x) rMin.x = tempPos.x; if (tempPos.x > rMax.x) rMax.x = tempPos.x;
        if (tempPos.y < rMin.y) rMin.y = tempPos.y; if (tempPos.y > rMax.y) rMax.y = tempPos.y;
        if (tempPos.z < rMin.z) rMin.z = tempPos.z; if (tempPos.z > rMax.z) rMax.z = tempPos.z;

        // ⚡ Rotate Normal
        tempNorm.set(normals[i * 3 + 0], normals[i * 3 + 1], normals[i * 3 + 2]);
        rotation.transformVector(tempNorm, tempNorm);
        normals[i * 3 + 0] = tempNorm.x; 
        normals[i * 3 + 1] = tempNorm.y; 
        normals[i * 3 + 2] = tempNorm.z;
    }

    return {
        positions, 
        colors, 
        normals, // ⚡ Return the normals array!
        numPoints: totalPoints,
        min: rMin, 
        max: rMax,
        center: new pc.Vec3().add2(rMin, rMax).mulScalar(0.5),
        size: new pc.Vec3().sub2(rMax, rMin),
        isGaussianSplat
    };
}