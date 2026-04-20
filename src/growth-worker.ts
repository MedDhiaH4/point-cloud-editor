import { buildOctree, findNearestNeighbors, type OctreeNode } from './octree';

let rootOctree: OctreeNode | null = null;
let positions: Float32Array | null = null;
let colors: Uint8Array | null = null;
let normals: Float32Array | null = null;

let isGrowing = false;
let sleepyCore = new Set<number>();
let lastSeedCount = 0;

self.onmessage = (e) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
        console.log("👷‍♂️ [Worker] Received data. Building background Octree...");
        positions = payload.positions;
        colors = payload.colors;
        normals = payload.normals;
        
        rootOctree = buildOctree(positions!, colors!, normals!, payload.min, payload.max);
        sleepyCore.clear(); 
        
        console.log("👷‍♂️ [Worker] Background Octree ready!");
        self.postMessage({ type: 'INIT_DONE' });
    }
    else if (type === 'START_GROWTH') {
        if (!rootOctree || !positions || !colors || !normals) return;
        isGrowing = true;

        if (payload.seeds.length < lastSeedCount || payload.seeds.length <= 1) {
            sleepyCore.clear();
            console.log("👷‍♂️ [Worker] Selection shrank or reset. Cache cleared.");
        }
        lastSeedCount = payload.seeds.length;

        // ⚡ THE FIX: Passing exactly 3 arguments to match the signature!
        runGrowth(payload.seeds, payload.toleranceSq, payload.geomStrictness);
    }
    else if (type === 'STOP_GROWTH') {
        isGrowing = false;
    }
};

function runGrowth(seeds: number[], toleranceSq: number, geomStrictness: number) {
    const initialQueue = seeds.filter(idx => !sleepyCore.has(idx));
    console.log(`👷‍♂️ [Worker] Total Seeds: ${seeds.length} | Skipping Core: ${sleepyCore.size} | Active Frontier: ${initialQueue.length}`);
    
    const queue = [...initialQueue];
    const visited = new Set(seeds); 
    const acceptedSet = new Set(seeds); 
    
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

            const neighbors = findNearestNeighbors(rootOctree!, targetVec as any, 50);

            let sumR = colors![currentIdx * 4 + 0];
            let sumG = colors![currentIdx * 4 + 1];
            let sumB = colors![currentIdx * 4 + 2];
            let localCount = 1;

            let sumNx = normals![currentIdx * 3 + 0];
            let sumNy = normals![currentIdx * 3 + 1];
            let sumNz = normals![currentIdx * 3 + 2];
            let localNormCount = (sumNx*sumNx + sumNy*sumNy + sumNz*sumNz) > 0.1 ? 1 : 0;

            const unvisitedNeighbors: number[] = [];
            let completelySurrounded = true; 

            for (const neighborIdx of neighbors) {
                if (acceptedSet.has(neighborIdx)) {
                    sumR += colors![neighborIdx * 4 + 0];
                    sumG += colors![neighborIdx * 4 + 1];
                    sumB += colors![neighborIdx * 4 + 2];
                    localCount++;

                    const nx = normals![neighborIdx * 3 + 0];
                    const ny = normals![neighborIdx * 3 + 1];
                    const nz = normals![neighborIdx * 3 + 2];
                    if ((nx*nx + ny*ny + nz*nz) > 0.1) {
                        sumNx += nx; sumNy += ny; sumNz += nz;
                        localNormCount++;
                    }
                } else if (visited.has(neighborIdx)) {
                    completelySurrounded = false;
                } else {
                    unvisitedNeighbors.push(neighborIdx);
                }
            }

            const avgR = sumR / localCount;
            const avgG = sumG / localCount;
            const avgB = sumB / localCount;

            let avgNx = 0, avgNy = 0, avgNz = 0;
            let avgNormalValid = false;
            if (localNormCount > 0) {
                const len = Math.sqrt(sumNx*sumNx + sumNy*sumNy + sumNz*sumNz);
                if (len > 0) {
                    avgNx = sumNx / len; avgNy = sumNy / len; avgNz = sumNz / len;
                    avgNormalValid = true;
                }
            }

            for (const neighborIdx of unvisitedNeighbors) {
                const r = colors![neighborIdx * 4 + 0];
                const g = colors![neighborIdx * 4 + 1];
                const b = colors![neighborIdx * 4 + 2];
                
                const dr = r - avgR; 
                const dg = g - avgG;
                const db = b - avgB;
                const colorMatch = (dr*dr + dg*dg + db*db) <= toleranceSq;
                
                let geometryMatch = true; 
                if (avgNormalValid) {
                    const nx = normals![neighborIdx * 3 + 0];
                    const ny = normals![neighborIdx * 3 + 1];
                    const nz = normals![neighborIdx * 3 + 2];
                    
                    if ((nx*nx + ny*ny + nz*nz) > 0.1) {
                        const dot = (nx * avgNx) + (ny * avgNy) + (nz * avgNz);
                        geometryMatch = Math.abs(dot) >= geomStrictness; 
                    }
                }

                if (colorMatch && geometryMatch) {
                    // ⚡ THE SNAG FIX: Only mark it as visited if it actually passes!
                    visited.add(neighborIdx);
                    queue.push(neighborIdx);
                    newlyFound.push(neighborIdx);
                    acceptedSet.add(neighborIdx);
                } else {
                    completelySurrounded = false; 
                }
            }

            if (completelySurrounded) {
                sleepyCore.add(currentIdx);
            }
        }

        if (newlyFound.length > 0 && (performance.now() - lastMessageTime) > 16) {
            lastSeedCount += newlyFound.length; 
            self.postMessage({ type: 'GROWTH_BATCH', payload: newlyFound });
            newlyFound = []; 
            lastMessageTime = performance.now();
        }

        if (queue.length > 0) {
            setTimeout(processBatch, 0); 
        } else {
            if (newlyFound.length > 0) {
                lastSeedCount += newlyFound.length;
                self.postMessage({ type: 'GROWTH_BATCH', payload: newlyFound });
            }
            isGrowing = false;
            self.postMessage({ type: 'GROWTH_FINISHED' });
            console.log(`👷‍♂️ [Worker] Finished. Sleepy Core Size is now: ${sleepyCore.size}`);
        }
    }

    processBatch();
}