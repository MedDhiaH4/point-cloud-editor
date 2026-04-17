import * as pc from 'playcanvas';
import { SelectionManager } from './selection-manager';
import { HistoryManager } from './history';

export class RegionGrower {
    private app: pc.Application;
    private selectionManager: SelectionManager;
    private historyManager: HistoryManager;
    
    private colors: Uint8Array | null = null;
    private normals: Float32Array | null = null; // ⚡ NEW
    
    private worker: Worker;

    public isGrowing: boolean = false;
    private currentGrowthSession: Set<number> = new Set();
    private preGrowthState: Set<number> = new Set();

    constructor(app: pc.Application, selectionManager: SelectionManager, historyManager: HistoryManager) {
        this.app = app;
        this.selectionManager = selectionManager;
        this.historyManager = historyManager;

        this.worker = new Worker(new URL('./growth-worker.ts', import.meta.url), { type: 'module' });
        this.bindWorkerEvents();
    }

    private bindWorkerEvents() {
        this.worker.onmessage = (e) => {
            const { type, payload } = e.data;

            if (type === 'INIT_DONE') {
                console.log("✅ Worker is primed and ready.");
            } 
            else if (type === 'GROWTH_BATCH') {
                for (const idx of payload) {
                    this.selectionManager.selectedIndices.add(idx);
                    this.currentGrowthSession.add(idx);
                }
                
                // ⚡ YOUR FAST UPLOADER IS PRESERVED
                if ((window as any).fastHighlight) {
                    (window as any).fastHighlight(payload);
                    this.app.renderNextFrame = true;         
                }
            }
            else if (type === 'GROWTH_FINISHED') {
                this.finalizeGrowth();
            }
        };
    }

    // ⚡ PASS NORMALS
    public setData(positions: Float32Array, colors: Uint8Array, normals: Float32Array, min: pc.Vec3, max: pc.Vec3) {
        this.colors = colors;
        this.normals = normals;
        
        this.worker.postMessage({
            type: 'INIT',
            payload: { positions, colors, normals, min, max }
        });
    }

    // ⚡ Accept the new UI parameters
    public toggleGrowth(seedIndices: number[], colorStrictness: number = 0.75, geomStrictness: number = 0.75) {
        if (this.isGrowing) {
            this.stopGrowth();
        } else {
            this.startGrowth(seedIndices, colorStrictness, geomStrictness);
        }
    }

    private startGrowth(seedIndices: number[], colorStrictness: number, geomStrictness: number) {
        if (!this.colors || !this.normals || seedIndices.length === 0) return;

        this.preGrowthState = new Set([...this.selectionManager.selectedIndices].filter(x => !seedIndices.includes(x)));
        this.currentGrowthSession = new Set(seedIndices);

        let sumR = 0, sumG = 0, sumB = 0;
        for (const idx of seedIndices) {
            sumR += this.colors[idx * 4 + 0];
            sumG += this.colors[idx * 4 + 1];
            sumB += this.colors[idx * 4 + 2];
        }
        
        const targetColor = {
            r: sumR / seedIndices.length,
            g: sumG / seedIndices.length,
            b: sumB / seedIndices.length
        };

        let sumNx = 0, sumNy = 0, sumNz = 0;
        let validNormals = 0;
        for (const idx of seedIndices) {
            const nx = this.normals[idx * 3 + 0];
            const ny = this.normals[idx * 3 + 1];
            const nz = this.normals[idx * 3 + 2];
            if (nx*nx + ny*ny + nz*nz > 0.1) { 
                sumNx += nx; sumNy += ny; sumNz += nz;
                validNormals++;
            }
        }
        let targetNormal = { x: 0, y: 0, z: 0 };
        if (validNormals > 0) {
            const len = Math.sqrt(sumNx*sumNx + sumNy*sumNy + sumNz*sumNz);
            if (len > 0) targetNormal = { x: sumNx/len, y: sumNy/len, z: sumNz/len };
        }

        // ⚡ THE COLOR STRICTNESS MATH
        // The maximum distance between White (255,255,255) and Black (0,0,0) in 3D RGB space is ~441.67
        const maxRgbDist = 441.673; 
        
        // If Strictness is 1.0, allowed distance is 0. If 0.75, allowed distance is 25%.
        const allowedDist = (1.0 - colorStrictness) * maxRgbDist;
        let toleranceSq = allowedDist * allowedDist;

        // Failsafe: Ensure tolerance is at least large enough to cover the seeds the user actually selected!
        let maxSeedDistSq = 0;
        for (const idx of seedIndices) {
            const dr = this.colors[idx * 4 + 0] - targetColor.r;
            const dg = this.colors[idx * 4 + 1] - targetColor.g;
            const db = this.colors[idx * 4 + 2] - targetColor.b;
            const distSq = dr*dr + dg*dg + db*db;
            if (distSq > maxSeedDistSq) maxSeedDistSq = distSq;
        }
        toleranceSq = Math.max(toleranceSq, maxSeedDistSq + 1);

        for (const idx of seedIndices) this.selectionManager.selectedIndices.add(idx);
        (this.selectionManager as any).notify();
        this.app.renderNextFrame = true;

        this.isGrowing = true;

        this.worker.postMessage({
            type: 'START_GROWTH',
            // ⚡ Pass geomStrictness straight to the worker!
            payload: { seeds: seedIndices, targetColor, targetNormal, toleranceSq, geomStrictness } 
        });
    }

    public stopGrowth() {
        if (!this.isGrowing) return;
        this.worker.postMessage({ type: 'STOP_GROWTH' });
        this.finalizeGrowth();
    }

    private finalizeGrowth() {
        this.isGrowing = false;
        console.log(`🛑 Growth Session Ended. Total points: ${this.currentGrowthSession.size}`);

        if (this.currentGrowthSession.size > 0) {
            const oldState = new Set(this.preGrowthState);
            const newState = new Set(this.selectionManager.selectedIndices);
            
            this.historyManager.addAction({
                undo: () => {
                    this.selectionManager.selectedIndices = new Set(oldState);
                    (this.selectionManager as any).notify();
                },
                redo: () => {
                    this.selectionManager.selectedIndices = new Set(newState);
                    (this.selectionManager as any).notify();
                }
            });
        }
        this.currentGrowthSession.clear();
    }

    public update() {} 
}