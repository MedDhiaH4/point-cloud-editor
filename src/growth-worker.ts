import { buildOctree, findNearestNeighbors, type OctreeNode } from './octree';

// Worker's private memory
let rootOctree: OctreeNode | null = null;
let positions: Float32Array | null = null;
let colors: Uint8Array | null = null;
let normals: Float32Array | null = null; // ⚡ NEW

let isGrowing = false;

self.onmessage = (e) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
        console.log("👷‍♂️ [Worker] Received data. Building background Octree...");
        positions = payload.positions;
        colors = payload.colors;
        normals = payload.normals; // ⚡
        
        rootOctree = buildOctree(positions!, colors!, normals!, payload.min, payload.max);
        
        console.log("👷‍♂️ [Worker] Background Octree ready!");
        self.postMessage({ type: 'INIT_DONE' });
    }
    else if (type === 'START_GROWTH') {
        if (!rootOctree || !positions || !colors || !normals) return;
        isGrowing = true;
        // ⚡ Pass targetNormal into the loop
        runGrowth(payload.seeds, payload.targetColor, payload.targetNormal, payload.toleranceSq, payload.geomStrictness);
    }
    else if (type === 'STOP_GROWTH') {
        isGrowing = false;
        console.log("👷‍♂️ [Worker] Growth stopped by Main Thread.");
    }
};

// ⚡ Update signature to accept geomStrictness
function runGrowth(seeds: number[], targetColor: {r: number, g: number, b: number}, targetNormal: {x: number, y: number, z: number}, toleranceSq: number, geomStrictness: number) {
    console.log(`👷‍♂️ [Worker] Dual-Gate Growth. ColorTolSq: ${toleranceSq.toFixed(1)}, GeoStrict: ${geomStrictness}`);
    
    const queue = [...seeds];
    const visited = new Set(seeds);
    const targetVec = { x: 0, y: 0, z: 0 }; 
 
    let newlyFound: number[] = [];
    let lastMessageTime = performance.now();

    function processBatch() {
        if (!isGrowing) return;

        const startTime = performance.now();

        while (queue.length > 0 && (performance.now() - startTime) < 16) {
            const currentIdx = queue.shift()!;

            targetVec.x = positions![currentIdx * 3 + 0];
            targetVec.y = positions![currentIdx * 3 + 1];
            targetVec.z = positions![currentIdx * 3 + 2];

            const neighbors = findNearestNeighbors(rootOctree!, targetVec as any, 20);

            for (const neighborIdx of neighbors) {
                if (visited.has(neighborIdx)) continue;
                visited.add(neighborIdx);

                // --- GATE 1: Color Match ---
                const r = colors![neighborIdx * 4 + 0];
                const g = colors![neighborIdx * 4 + 1];
                const b = colors![neighborIdx * 4 + 2];
                
                const dr = r - targetColor.r;
                const dg = g - targetColor.g;
                const db = b - targetColor.b;
                
                const colorMatch = (dr*dr + dg*dg + db*db) <= toleranceSq;
                
                // --- ⚡ GATE 2: Geometry Match ---
                let geometryMatch = true; 
                
                if (targetNormal.x !== 0 || targetNormal.y !== 0 || targetNormal.z !== 0) {
                    const nx = normals![neighborIdx * 3 + 0];
                    const ny = normals![neighborIdx * 3 + 1];
                    const nz = normals![neighborIdx * 3 + 2];
                    
                    if ((nx*nx + ny*ny + nz*nz) > 0.1) {
                        const dot = (nx * targetNormal.x) + (ny * targetNormal.y) + (nz * targetNormal.z);
                        // ⚡ Use the UI Slider value!
                        geometryMatch = Math.abs(dot) >= geomStrictness; 
                    }
                }

                if (colorMatch && geometryMatch) {
                    queue.push(neighborIdx);
                    newlyFound.push(neighborIdx);
                }
            }
        }

        if (newlyFound.length > 0 && (performance.now() - lastMessageTime) > 16) {
            self.postMessage({ type: 'GROWTH_BATCH', payload: newlyFound });
            newlyFound = []; 
            lastMessageTime = performance.now();
        }

        if (queue.length > 0) {
            setTimeout(processBatch, 0); 
        } else {
            if (newlyFound.length > 0) {
                self.postMessage({ type: 'GROWTH_BATCH', payload: newlyFound });
            }
            isGrowing = false;
            self.postMessage({ type: 'GROWTH_FINISHED' });
            console.log("👷‍♂️ [Worker] Exhausted all touching points.");
        }
    }

    processBatch();
}