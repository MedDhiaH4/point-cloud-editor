import * as pc from 'playcanvas';
import type { OctreeNode } from './octree';

export interface RaycastHit {
    point: pc.Vec3;
    distance: number; 
}

// Memory allocation to prevent garbage collection lag during deep searches
const tempVec = new pc.Vec3();

export function raycastOctree(
    node: OctreeNode,
    ray: pc.Ray,
    fov: number,
    screenHeight: number,
    pixelTolerance: number = 10,
    bestHit: RaycastHit | null = null
): RaycastHit | null {
    
    // 1. Quick test: Does the ray even hit this chunk's bounding box?
    const halfExtents = new pc.Vec3().sub2(node.max, node.min).mulScalar(0.5);
    const aabb = new pc.BoundingBox(node.center, halfExtents);
    if (!aabb.intersectsRay(ray)) return bestHit;

    // 2. If it's an internal node, recursively search its children
    if (node.children) {
        for (const child of node.children) {
            bestHit = raycastOctree(child, ray, fov, screenHeight, pixelTolerance, bestHit);
        }
        return bestHit;
    }

    // 3. If it's a Leaf Node, check the raw points in RAM
    if (!node.positions) return bestHit;

    const count = node.count;
    const rayDir = ray.direction;
    const rayOrigin = ray.origin;

    for (let i = 0; i < count; i++) {
        const px = node.positions[i * 3];
        const py = node.positions[i * 3 + 1];
        const pz = node.positions[i * 3 + 2];
        
        tempVec.set(px, py, pz);
        tempVec.sub(rayOrigin); 
        
        const depthDistance = tempVec.dot(rayDir); 
        
        if (depthDistance < 0 || (bestHit && depthDistance > bestHit.distance)) continue; 
        
        const distSq = tempVec.lengthSq() - (depthDistance * depthDistance);
        const perpDistance = Math.sqrt(Math.max(0, distSq));

        const allowedRadius = depthDistance * Math.tan((fov / 2) * pc.math.DEG_TO_RAD) * (pixelTolerance / screenHeight) * 2;

        if (perpDistance <= allowedRadius) {
            bestHit = {
                point: new pc.Vec3(px, py, pz),
                distance: depthDistance 
            };
        }
    }

    return bestHit;
}