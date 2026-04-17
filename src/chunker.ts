import * as pc from 'playcanvas';
import type { PLYData } from './ply-loader';

export interface ChunkData {
    positions: Float32Array;
    colors: Uint8Array;
    count: number;
    min: pc.Vec3;
    max: pc.Vec3;
}

export function chunkPointCloud(data: PLYData, gridSize: number = 8): ChunkData[] {
    console.time("Chunking & Shuffling");
    
    const numBuckets = gridSize * gridSize * gridSize;
    const bucketCounts = new Int32Array(numBuckets);
    const pointBucketIndices = new Int32Array(data.numPoints);
    
    // Pass 1: Bucket assignment
    for(let i = 0; i < data.numPoints; i++) {
        let bx = Math.floor(((data.positions[i*3] - data.min.x) / data.size.x) * (gridSize - 0.001));
        let by = Math.floor(((data.positions[i*3+1] - data.min.y) / data.size.y) * (gridSize - 0.001));
        let bz = Math.floor(((data.positions[i*3+2] - data.min.z) / data.size.z) * (gridSize - 0.001));

        bx = Math.max(0, Math.min(gridSize - 1, bx));
        by = Math.max(0, Math.min(gridSize - 1, by));
        bz = Math.max(0, Math.min(gridSize - 1, bz));

        const bucketIdx = bx + by * gridSize + bz * gridSize * gridSize;
        pointBucketIndices[i] = bucketIdx;
        bucketCounts[bucketIdx]++;
    }

    // Pass 2: Initialize arrays
    const buckets: ChunkData[] = [];
    for(let i = 0; i < numBuckets; i++) {
        if (bucketCounts[i] > 0) {
            buckets[i] = {
                positions: new Float32Array(bucketCounts[i] * 3),
                colors: new Uint8Array(bucketCounts[i] * 4),
                count: 0,
                min: new pc.Vec3(Infinity, Infinity, Infinity),
                max: new pc.Vec3(-Infinity, -Infinity, -Infinity)
            };
        }
    }

    // Pass 3: Distribute data
    for(let i = 0; i < data.numPoints; i++) {
        const bIdx = pointBucketIndices[i];
        const bucket = buckets[bIdx];
        const idx = bucket.count;

        const x = data.positions[i*3], y = data.positions[i*3+1], z = data.positions[i*3+2];
        bucket.positions[idx*3] = x; bucket.positions[idx*3+1] = y; bucket.positions[idx*3+2] = z;

        bucket.colors[idx*4] = data.colors[i*4];
        bucket.colors[idx*4+1] = data.colors[i*4+1];
        bucket.colors[idx*4+2] = data.colors[i*4+2];
        bucket.colors[idx*4+3] = data.colors[i*4+3];

        if (x < bucket.min.x) bucket.min.x = x; if (x > bucket.max.x) bucket.max.x = x;
        if (y < bucket.min.y) bucket.min.y = y; if (y > bucket.max.y) bucket.max.y = y;
        if (z < bucket.min.z) bucket.min.z = z; if (z > bucket.max.z) bucket.max.z = z;

        bucket.count++;
    }

    // Pass 4: Randomize for LOD sparse drawing
    for (let i = 0; i < numBuckets; i++) {
        const bucket = buckets[i];
        if (!bucket) continue;

        for (let j = bucket.count - 1; j > 0; j--) {
            const rand = Math.floor(Math.random() * (j + 1));
            // Swap Pos
            for(let k = 0; k < 3; k++) {
                let temp = bucket.positions[j*3 + k];
                bucket.positions[j*3 + k] = bucket.positions[rand*3 + k];
                bucket.positions[rand*3 + k] = temp;
            }
            // Swap Color
            for(let k = 0; k < 4; k++) {
                let temp = bucket.colors[j*4 + k];
                bucket.colors[j*4 + k] = bucket.colors[rand*4 + k];
                bucket.colors[rand*4 + k] = temp;
            }
        }
    }

    console.timeEnd("Chunking & Shuffling");
    return buckets.filter(b => b !== undefined);
}