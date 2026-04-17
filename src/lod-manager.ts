import * as pc from 'playcanvas';

export class LODManager {
    cameraEntity: pc.Entity;
    pointCloudEntity: pc.Entity | null = null;
    
    // --- LOD CONFIGURATION ---
    minDensity = 0.25; 
    maxDensity = 1.00; 
    minPixels = 2;
    maxPixels = 150; 

    public currentFPS = 0; 
    
    // ⚡ NEW: Densification Trackers
    public isGaussianSplat = false;
    public splatDensityLevel = 0; // 0.0 to 1.0
    public needsUpdate = false; // ⚡ Flag to signal UI changed

    private frustum = new pc.Frustum();
    private viewProj = new pc.Mat4();
    private tempSphere = new pc.BoundingSphere();

    private _lastEvalTime = 0;
    private _frameCount = 0;

    constructor(cameraEntity: pc.Entity) {
        this.cameraEntity = cameraEntity;
    }

    setTarget(entity: pc.Entity, isSplat: boolean) {
        this.pointCloudEntity = entity;
        this.isGaussianSplat = isSplat;
        this.splatDensityLevel = 0; // Default to 0% extra points on load
        this.needsUpdate = true;
    }

    setSplatDensity(value0to1: number) {
        const newLevel = pc.math.clamp(value0to1, 0, 1);
        if (this.splatDensityLevel !== newLevel) {
            this.splatDensityLevel = newLevel;
            this.needsUpdate = true; // ⚡ Mark as dirty to wake up the engine
        }
    }

    resetTimer() {
        this._lastEvalTime = 0;
        this._frameCount = 0;
    }

    update(): number {
        if (!this.pointCloudEntity || !this.pointCloudEntity.render || !this.cameraEntity.camera) {
            return 0;
        }

        // Reset the dirty flag since we are processing the update now
        this.needsUpdate = false;

        const cameraComp = this.cameraEntity.camera;
        this.viewProj.mul2(cameraComp.projectionMatrix, cameraComp.viewMatrix);
        this.frustum.setFromMat4(this.viewProj);

        const instances = this.pointCloudEntity.render.meshInstances;
        const cameraPos = this.cameraEntity.getPosition();

        const now = performance.now();
        if (this._lastEvalTime === 0) this._lastEvalTime = now;
        
        this._frameCount++;
        if (now - this._lastEvalTime >= 500) {
            this.currentFPS = (this._frameCount * 1000) / (now - this._lastEvalTime);
            this._lastEvalTime = now;
            this._frameCount = 0;
        }

        let totalRenderedPoints = 0;
        const fov = cameraComp.fov * pc.math.DEG_TO_RAD;
        const screenHeight = window.innerHeight;

        // ⚡ DYNAMIC LOD MATH:
        let currentMin = this.minDensity;
        let currentMax = this.maxDensity;

        if (this.isGaussianSplat) {
            // Because our array is 5x larger, 20% (0.2) represents 100% of the Original Points.
            // When slider is 0, max allowed is 0.2. When slider is 100, max allowed is 1.0.
            const baseFraction = 0.2; 
            currentMax = baseFraction + (this.splatDensityLevel * (1.0 - baseFraction));
            currentMin = currentMax * 0.25; 
        }

        for (let i = 0; i < instances.length; i++) {
            const instance = instances[i];
            const center = instance.aabb.center;
            const chunkRadius = instance.aabb.halfExtents.length();
            
            this.tempSphere.center.copy(center);
            this.tempSphere.radius = chunkRadius;

            if (this.frustum.containsSphere(this.tempSphere) === 0) {
                instance.mesh.primitive[0].count = 0; 
                continue; 
            }

            const distance = cameraPos.distance(center);
            const safeDistance = Math.max(distance, 0.001);

            const projectedSize = (chunkRadius / safeDistance) * (screenHeight / Math.tan(fov / 2));

            let t = (projectedSize - this.minPixels) / (this.maxPixels - this.minPixels);
            t = pc.math.clamp(t, 0, 1);

            // Interpolate based on the dynamically calculated slider limits!
            const density = pc.math.lerp(currentMin, currentMax, t);

            const maxPoints = instance.mesh.vertexBuffer.getNumVertices();
            const activePoints = Math.floor(maxPoints * density);

            instance.mesh.primitive[0].count = activePoints;
            totalRenderedPoints += activePoints;
        }

        return totalRenderedPoints;
    }
}