import * as pc from 'playcanvas';

export interface OctreeNode {
    min: pc.Vec3;
    max: pc.Vec3;
    center: pc.Vec3;
    radius: number;

    positions: Float32Array | null;
    colors: Uint8Array | null;
    normals: Float32Array | null; // ⚡ NEW: Added Normals
    
    indices: Uint32Array | null; 
    
    count: number;
    children: OctreeNode[] | null;
    meshInstance?: pc.MeshInstance;
}

const MAX_POINTS_PER_NODE = 50000; 
let MIN_CHUNK_SIZE = 0; 

export function buildOctree(
    positions: Float32Array,
    colors: Uint8Array,
    normals: Float32Array, // ⚡ NEW: Pass Normals
    min: pc.Vec3,
    max: pc.Vec3,
    depth: number = 0,
    indices?: Uint32Array 
): OctreeNode {

    const count = positions.length / 3;

    let currentIndices = indices;
    if (!currentIndices) {
        currentIndices = new Uint32Array(count);
        for (let i = 0; i < count; i++) {
            currentIndices[i] = i;
        }
    }

    const center = new pc.Vec3().add2(min, max).mulScalar(0.5);
    const size = new pc.Vec3().sub2(max, min);
    const radius = size.length() * 0.5;

    if (depth === 0) {
        MIN_CHUNK_SIZE = size.length() * 0.02; 
    }

    if (count <= MAX_POINTS_PER_NODE || size.length() <= MIN_CHUNK_SIZE) {
        
        for (let j = count - 1; j > 0; j--) {
            const rand = Math.floor(Math.random() * (j + 1));
            
            let tempIdx = currentIndices[j];
            currentIndices[j] = currentIndices[rand];
            currentIndices[rand] = tempIdx;

            for (let k = 0; k < 3; k++) {
                let temp = positions[j * 3 + k];
                positions[j * 3 + k] = positions[rand * 3 + k];
                positions[rand * 3 + k] = temp;
            }
            // ⚡ NEW: Shuffle normals perfectly in sync
            for (let k = 0; k < 3; k++) {
                let temp = normals[j * 3 + k];
                normals[j * 3 + k] = normals[rand * 3 + k];
                normals[rand * 3 + k] = temp;
            }
            for (let k = 0; k < 4; k++) {
                let temp = colors[j * 4 + k];
                colors[j * 4 + k] = colors[rand * 4 + k];
                colors[rand * 4 + k] = temp;
            }
        }

        return {
            min, max, center, radius,
            positions, colors, normals, count,
            indices: currentIndices, 
            children: null
        };
    }

    const buckets: number[][] = Array.from({ length: 8 }, () => []);

    for (let i = 0; i < count; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];

        let index = 0;
        if (x > center.x) index |= 1;
        if (y > center.y) index |= 2;
        if (z > center.z) index |= 4;

        buckets[index].push(i); 
    }

    const children: OctreeNode[] = [];

    for (let i = 0; i < 8; i++) {
        const bucket = buckets[i];
        if (bucket.length === 0) continue;

        const childCount = bucket.length;

        const childPositions = new Float32Array(childCount * 3);
        const childColors = new Uint8Array(childCount * 4);
        const childNormals = new Float32Array(childCount * 3); // ⚡ NEW: Child Normals Array
        const childIndices = new Uint32Array(childCount); 

        let cMin = new pc.Vec3(Infinity, Infinity, Infinity);
        let cMax = new pc.Vec3(-Infinity, -Infinity, -Infinity);

        for (let j = 0; j < childCount; j++) {
            const idx = bucket[j]; 

            const x = positions[idx * 3];
            const y = positions[idx * 3 + 1];
            const z = positions[idx * 3 + 2];

            const pIndex = j * 3;
            childPositions[pIndex] = x;
            childPositions[pIndex + 1] = y;
            childPositions[pIndex + 2] = z;

            // ⚡ Push normal into child
            childNormals[pIndex] = normals[idx * 3];
            childNormals[pIndex + 1] = normals[idx * 3 + 1];
            childNormals[pIndex + 2] = normals[idx * 3 + 2];

            const cIndex = j * 4;
            childColors[cIndex] = colors[idx * 4];
            childColors[cIndex + 1] = colors[idx * 4 + 1];
            childColors[cIndex + 2] = colors[idx * 4 + 2];
            childColors[cIndex + 3] = colors[idx * 4 + 3];

            childIndices[j] = currentIndices[idx];

            if (x < cMin.x) cMin.x = x;
            if (x > cMax.x) cMax.x = x;
            if (y < cMin.y) cMin.y = y;
            if (y > cMax.y) cMax.y = y;
            if (z < cMin.z) cMin.z = z;
            if (z > cMax.z) cMax.z = z;
        }

        const childNode = buildOctree(
            childPositions,
            childColors,
            childNormals, // ⚡ Pass normals deeper
            cMin,
            cMax,
            depth + 1,
            childIndices 
        );

        children.push(childNode);
    }

    return {
        min, max, center, radius, count, children,
        positions: null, colors: null, normals: null, indices: null 
    };
}

// ============================================================================
// KNN SEARCH 
// ============================================================================
function sqDistPointAABB(p: pc.Vec3, min: pc.Vec3, max: pc.Vec3): number {
    let sqDist = 0;
    if (p.x < min.x) sqDist += (min.x - p.x) * (min.x - p.x);
    if (p.x > max.x) sqDist += (p.x - max.x) * (p.x - max.x);
    if (p.y < min.y) sqDist += (min.y - p.y) * (min.y - p.y);
    if (p.y > max.y) sqDist += (p.y - max.y) * (p.y - max.y);
    if (p.z < min.z) sqDist += (min.z - p.z) * (min.z - p.z);
    if (p.z > max.z) sqDist += (p.z - max.z) * (p.z - max.z);
    return sqDist;
}

class KNNList {
    public elements: { index: number, distSq: number }[] = [];
    private k: number;

    constructor(k: number) { this.k = k; }

    public add(index: number, distSq: number) {
        if (this.elements.length < this.k || distSq < this.elements[this.elements.length - 1].distSq) {
            let i = 0;
            while (i < this.elements.length && this.elements[i].distSq < distSq) i++;
            this.elements.splice(i, 0, { index, distSq });
            if (this.elements.length > this.k) {
                this.elements.pop();
            }
        }
    }

    public getMaxDistSq(): number {
        if (this.elements.length < this.k) return Infinity;
        return this.elements[this.elements.length - 1].distSq;
    }
}

export function findNearestNeighbors(root: OctreeNode, target: pc.Vec3, k: number): number[] {
    const knn = new KNNList(k);

    function search(node: OctreeNode) {
        const boxDistSq = sqDistPointAABB(target, node.min, node.max);
        if (boxDistSq > knn.getMaxDistSq()) return;

        if (!node.children || node.children.length === 0) {
            if (!node.positions || !node.indices) return;
            for (let i = 0; i < node.indices.length; i++) {
                const px = node.positions[i * 3 + 0];
                const py = node.positions[i * 3 + 1];
                const pz = node.positions[i * 3 + 2];
                const dx = target.x - px;
                const dy = target.y - py;
                const dz = target.z - pz;
                const distSq = dx * dx + dy * dy + dz * dz;
                knn.add(node.indices[i], distSq);
            }
        } else {
            const sortedChildren = node.children.map(child => ({
                node: child,
                distSq: sqDistPointAABB(target, child.min, child.max)
            })).sort((a, b) => a.distSq - b.distSq);

            for (const child of sortedChildren) {
                if (child.distSq <= knn.getMaxDistSq()) {
                    search(child.node);
                }
            }
        }
    }

    search(root);
    return knn.elements.map(e => e.index);
}