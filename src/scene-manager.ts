import * as pc from 'playcanvas';
import type { OctreeNode } from './octree';

export class SceneManager {
    public positions: Float32Array | null = null;
    public originalColors: Uint8Array | null = null;
    public normals: Float32Array | null = null;
    
    public octreeRoot: OctreeNode | null = null;
    public octreeLeaves: OctreeNode[] = [];
    
    // Fast lookup tables
    public leafMap: Int32Array | null = null;
    public localIdxMap: Int32Array | null = null;

    public sceneMin: pc.Vec3 = new pc.Vec3();
    public sceneMax: pc.Vec3 = new pc.Vec3();
    public isGaussianSplat: boolean = false;

    // Clears the current scene data
    public reset() {
        this.positions = null;
        this.originalColors = null;
        this.normals = null;
        this.octreeRoot = null;
        this.octreeLeaves = [];
        this.leafMap = null;
        this.localIdxMap = null;
    }

    // Our new, cleanly scoped fast highlight
    public fastHighlight(globalIndices: number[]) {
        if (!this.leafMap || !this.localIdxMap || this.octreeLeaves.length === 0) return;

        const dirtyLeaves = new Set<number>();

        for (const globalIdx of globalIndices) {
            const leafIdx = this.leafMap[globalIdx];
            const localIdx = this.localIdxMap[globalIdx];
            const node = this.octreeLeaves[leafIdx];

            if (!node || !node.colors) continue;

            // Paint it yellow
            node.colors[localIdx * 4 + 0] = 255; 
            node.colors[localIdx * 4 + 1] = 255; 
            node.colors[localIdx * 4 + 2] = 0;   

            dirtyLeaves.add(leafIdx); 
        }

        // Batch update the dirty chunks
        for (const leafIdx of dirtyLeaves) {
            const node = this.octreeLeaves[leafIdx];
            if (!node || !node.meshInstance || !node.colors) continue;

            const currentLodCount = node.meshInstance.mesh.primitive[0].count;
            node.meshInstance.mesh.setColors32(node.colors);
            node.meshInstance.mesh.update(pc.PRIMITIVE_POINTS);
            node.meshInstance.mesh.primitive[0].count = currentLodCount;
        }
    }
}