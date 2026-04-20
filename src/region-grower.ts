// src/region-grower.ts
import * as pc from 'playcanvas';
import { SelectionManager } from './selection-manager';
import { HistoryManager } from './history';
import { SceneManager } from './scene-manager'; // ⚡ NEW

export class RegionGrower {
    private app: pc.Application;
    private selectionManager: SelectionManager;
    private historyManager: HistoryManager;
    private sceneManager: SceneManager; // ⚡ NEW
    
    private colors: Uint8Array | null = null;
    private normals: Float32Array | null = null; 
    
    private worker: Worker;

    public isGrowing: boolean = false;
    private currentGrowthSession: Set<number> = new Set();
    private preGrowthState: Set<number> = new Set();

    constructor(app: pc.Application, selectionManager: SelectionManager, historyManager: HistoryManager, sceneManager: SceneManager) {
        this.app = app;
        this.selectionManager = selectionManager;
        this.historyManager = historyManager;
        this.sceneManager = sceneManager; // ⚡ Bind it

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
                
                // ⚡ CLEAN: Safely call our SceneManager!
                this.sceneManager.fastHighlight(payload);
                this.app.renderNextFrame = true;         
            }
            else if (type === 'GROWTH_FINISHED') {
                this.finalizeGrowth();
            }
        };
    }

    public setData(positions: Float32Array, colors: Uint8Array, normals: Float32Array, min: pc.Vec3, max: pc.Vec3) {
        this.colors = colors;
        this.normals = normals;
        
        this.worker.postMessage({
            type: 'INIT',
            payload: { positions, colors, normals, min, max }
        });
    }

    public toggleGrowth(seedIndices: number[], colorStrictness: number = 0.75, geomStrictness: number = 0.75, kNeighbors: number = 50) {
        if (this.isGrowing) {
            this.stopGrowth();
        } else {
            this.startGrowth(seedIndices, colorStrictness, geomStrictness, kNeighbors);
        }
    }

    private startGrowth(seedIndices: number[], colorStrictness: number, geomStrictness: number, kNeighbors: number) {
        if (!this.colors || !this.normals || seedIndices.length === 0) return;

        this.preGrowthState = new Set([...this.selectionManager.selectedIndices].filter(x => !seedIndices.includes(x)));
        this.currentGrowthSession = new Set(seedIndices);

        const maxRgbDist = 441.673; 
        const allowedDist = (1.0 - colorStrictness) * maxRgbDist;
        const toleranceSq = allowedDist * allowedDist;

        for (const idx of seedIndices) {
            this.selectionManager.selectedIndices.add(idx);
        }
        
        (this.selectionManager as any).notify();
        this.app.renderNextFrame = true;

        this.isGrowing = true;

        this.worker.postMessage({
            type: 'START_GROWTH',
            // ⚡ Add kNeighbors to the payload!
            payload: { seeds: seedIndices, toleranceSq, geomStrictness, kNeighbors } 
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