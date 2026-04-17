import * as pc from 'playcanvas';
import { SelectionManager } from './selection-manager';
import { HistoryManager } from './history';

interface PromptPoint {
    pos: pc.Vec3;
    isPositive: boolean;
    entity: pc.Entity;
}

export class AISegmentationTool {
    private app: pc.Application;
    private cameraEntity: pc.Entity;
    private selectionManager: SelectionManager;
    private history: HistoryManager;
    
    public targetFocalPoint: pc.Vec3 | null = null;

    // ⚡ PROMPT STATE MANAGEMENT
    public inputMode: 'none' | 'positive' | 'negative' = 'none';
    private promptPoints: PromptPoint[] = [];
    private redoStack: PromptPoint[] = [];

    // ⚡ Make sure historyManager is the 4th argument here!
    constructor(app: pc.Application, cameraEntity: pc.Entity, selectionManager: SelectionManager, historyManager: HistoryManager) {
        this.app = app;
        this.cameraEntity = cameraEntity;
        this.selectionManager = selectionManager;
        this.history = historyManager;

        this.bindEvents();
    }

    private bindEvents() {
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();

            // ⚡ THE FIX: Catch '=' and '_' in case the user doesn't press Shift!
            if (key === '+' || key === '=') {
                this.inputMode = this.inputMode === 'positive' ? 'none' : 'positive';
                console.log(`🖌️ Mode: ${this.inputMode.toUpperCase()}`);
            } else if (key === '-' || key === '_') {
                this.inputMode = this.inputMode === 'negative' ? 'none' : 'negative';
                console.log(`🖌️ Mode: ${this.inputMode.toUpperCase()}`);
            } 
            else if (key === 'u') {
                this.undoPrompt();
            } else if (key === 'r') {
                this.redoPrompt();
            } 
            else if (key === 'n') {
                this.inputMode = 'none'; 
                this.triggerSegmentation();
            } else if (key === 'escape') {
                this.inputMode = 'none';
                console.log("🛑 Input Mode Cancelled.");
            }
            // ⚡ THE FIX: Removed the catch-all "else" block that was silently 
            // canceling your mode when you pressed WASD to move the camera!
        });
    }

    // ⚡ CALLED BY MAIN.TS WHEN THE USER CLICKS THE MOUSE
    public handleSingleClick(hitPoint: pc.Vec3) {
        if (this.inputMode === 'none') return;
        this.addPromptPoint(hitPoint, this.inputMode === 'positive');
    }

    private addPromptPoint(pos: pc.Vec3, isPositive: boolean) {
        // 1. Create a blank entity (NO sphere model!)
        const pointEntity = new pc.Entity('PromptPoint');
        
        // 2. Create a literal 1-point mesh (a duplicate of how the point cloud works)
        const mesh = new pc.Mesh(this.app.graphicsDevice);
        mesh.setPositions(new Float32Array([0, 0, 0])); // Local center
        mesh.update(pc.PRIMITIVE_POINTS);
        
        // 3. Set the color to Green or Red
        const material = new pc.StandardMaterial();
        material.useLighting = false;
        material.emissive = isPositive ? new pc.Color(0, 1, 0) : new pc.Color(1, 0, 0);
        
        // 4. Force this single point to always be size 3.0 pixels!
        const chunks = material.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
        chunks.set('litUserMainEndVS', `
            gl_PointSize = 5.0; // Exactly as you requested!
        `);
        material.update();
        
        const instance = new pc.MeshInstance(mesh, material);
        pointEntity.addComponent('render', { meshInstances: [instance] });
        
        // 5. Place it exactly on the raycast hit position!
        pointEntity.setPosition(pos);
        
        this.app.root.addChild(pointEntity);
        
        // Save to state
        const promptData = { pos: pos.clone(), isPositive, entity: pointEntity };
        this.promptPoints.push(promptData);
        
        console.log(`📍 Added ${isPositive ? 'Positive' : 'Negative'} Prompt.`);

        this.history.addAction({
            undo: () => {
                promptData.entity.enabled = false;
                this.promptPoints = this.promptPoints.filter(p => p !== promptData);
                this.app.renderNextFrame = true;
            },
            redo: () => {
                promptData.entity.enabled = true;
                this.promptPoints.push(promptData);
                this.app.renderNextFrame = true;
            }
        });
    }

    private undoPrompt() {
        if (this.promptPoints.length <= 1) {
            console.log("⚠️ Cannot undo the primary Focal Point!");
            return;
        }
        const p = this.promptPoints.pop()!;
        p.entity.enabled = false; // Hide it
        this.redoStack.push(p);
        console.log("⏪ Undid Last Prompt.");
    }

    private redoPrompt() {
        if (this.redoStack.length === 0) return;
        const p = this.redoStack.pop()!;
        p.entity.enabled = true; // Show it
        this.promptPoints.push(p);
        console.log("⏩ Redid Last Prompt.");
    }

    private clearPromptPoints() {
        this.promptPoints.forEach(p => p.entity.destroy());
        this.redoStack.forEach(p => p.entity.destroy());
        this.promptPoints = [];
        this.redoStack = [];
    }

    public setFocalPoint(point: pc.Vec3) {
        this.targetFocalPoint = point.clone();
        
        // Clear old dots, and add this as the indestructible first positive point!
        this.clearPromptPoints();
        this.addPromptPoint(point, true);
        
        console.log(`🎯 Focal Point Set: [${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}]`);
    }

    private async triggerSegmentation() {
        if (!this.targetFocalPoint || this.promptPoints.length === 0) {
            alert("⚠️ Please double-click the object first!");
            return;
        }

        const pointCloudEntity = this.app.root.findByName('PointCloud') as pc.Entity;
        if (!pointCloudEntity) return;

        const positions = (window as any).globalPositionsArray as Float32Array; 
        const numPoints = positions.length / 3;

        // ⚡ THE FIX: Calculate the 2D pixels FIRST, before we move the camera!
        const prompt_coords: number[][] = [];
        const prompt_labels: number[] = [];

        this.promptPoints.forEach(p => {
            const screenPos = new pc.Vec3();
            this.cameraEntity.camera!.worldToScreen(p.pos, screenPos);
            
            prompt_coords.push([Math.round(screenPos.x), Math.round(screenPos.y)]);
            prompt_labels.push(p.isPositive ? 1 : 0);

            // ⚡ THE FIX: Instantly hide the physical 3D sphere so it does NOT
            // show up in the images SAM is about to process!
            p.entity.enabled = false; 
        });

        console.log("📸 Capturing virtual orbit frames (Dots are now hidden)...");
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        const width = canvas.width;
        const height = canvas.height;

        // Now the camera takes pictures of a perfectly clean scene!
        const videoFrames = await this.captureWindshieldWiper(this.targetFocalPoint);
        if (videoFrames.length === 0) {
            // If the capture fails for some reason, unhide the dots so the user isn't confused
            this.promptPoints.forEach(p => p.entity.enabled = true); 
            return;
        }

        try {
            document.getElementById('loading-overlay')?.classList.remove('hidden');
            
            console.log(`🧠 Sending to Backend: ${prompt_coords.length} Points`);
            const response = await fetch("http://localhost:8000/segment_video_orbit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    dataset_name: "RAM_SESSION", 
                    frames: videoFrames.map(f => ({ image: f.image, inv_matrix: [] })),
                    points: prompt_coords, 
                    labels: prompt_labels
                })
            });

            const data = await response.json();
            
            if (data.masks && data.masks.length > 0) {
                this.showMasksDebugUI(data.masks);
                await this.projectAndSelect(data, videoFrames, positions, numPoints, width, height, pointCloudEntity);
            }
        } catch (e) {
            console.error("❌ Orbit Failed:", e);
        } finally {
            document.getElementById('loading-overlay')?.classList.add('hidden');
            // Permanently clean up the dots from memory when the AI is finished
            this.clearPromptPoints(); 
        }
    }

    private async projectAndSelect(data: any, videoFrames: any[], positions: Float32Array, numPoints: number, width: number, height: number, pcEntity: pc.Entity) {
        const mask_votes = new Float32Array(numPoints);

        const offscreen = document.createElement('canvas');
        offscreen.width = width;
        offscreen.height = height;
        const ctx = offscreen.getContext('2d', { willReadFrequently: true })!;
        const maskPixels: Uint8ClampedArray[] = [];

        for (let i = 0; i < data.masks.length; i++) {
            const img = new Image();
            await new Promise<void>(resolve => {
                img.onload = () => {
                    ctx.clearRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                    maskPixels.push(ctx.getImageData(0, 0, width, height).data);
                    resolve();
                };
                img.src = "data:image/png;base64," + data.masks[i];
            });
        }

        const startTime = performance.now();
        
        const splatWorldMat = pcEntity.getWorldTransform();
        const vpMat0 = new pc.Mat4().set(videoFrames[0].vp_matrix);
        const finalProjMat0 = new pc.Mat4().mul2(vpMat0, splatWorldMat);
        const m0 = finalProjMat0.data; 

        const validIndices: number[] = [];

        for (let i = 0; i < numPoints; i++) {
            const px = positions[i * 3 + 0];
            const py = positions[i * 3 + 1];
            const pz = positions[i * 3 + 2];
            
            const p_w = m0[3]*px + m0[7]*py + m0[11]*pz + m0[15];
            if (p_w < 0.1) continue; 

            const x_h = m0[0]*px + m0[4]*py + m0[8]*pz + m0[12];
            if (Math.abs(x_h) > p_w) continue;

            const y_h = m0[1]*px + m0[5]*py + m0[9]*pz + m0[13];
            if (Math.abs(y_h) > p_w) continue;

            validIndices.push(i);
        }

        for (let f = 0; f < videoFrames.length; f++) {
            const vpMat = new pc.Mat4().set(videoFrames[f].vp_matrix);
            const finalProjMat = new pc.Mat4().mul2(vpMat, splatWorldMat);
            const m = finalProjMat.data; 
            const pixels = maskPixels[f];
            
            let minX = 0, minY = 0, maxX = width, maxY = height;
            if (data.bboxes && data.bboxes[f]) {
                [minX, minY, maxX, maxY] = data.bboxes[f];
            }

            for (let v = 0; v < validIndices.length; v++) {
                const i = validIndices[v];
                const px = positions[i * 3 + 0];
                const py = positions[i * 3 + 1];
                const pz = positions[i * 3 + 2];
                
                const p_w = m[3]*px + m[7]*py + m[11]*pz + m[15];
                if (p_w < 0.1) continue;

                const x_h = m[0]*px + m[4]*py + m[8]*pz + m[12];
                const y_h = m[1]*px + m[5]*py + m[9]*pz + m[13];
                
                const ndcX = x_h / p_w;
                const ndcY = y_h / p_w;
                
                const u = Math.round(((ndcX + 1.0) * 0.5) * width);
                const v_pixel = Math.round(((1.0 - ndcY) * 0.5) * height); 
                
                if (u < minX || u > maxX || v_pixel < minY || v_pixel > maxY) {
                    continue; 
                }

                const pixelIdx = (v_pixel * width + u) * 4;
                if (pixels[pixelIdx] > 128) {
                    mask_votes[i] += 1.0;
                }
            }
        }
        
        const totalTimeMs = performance.now() - startTime;
        console.log(`⏱️ PROJECTION PIPELINE FINISHED IN: ${totalTimeMs.toFixed(2)} ms`);

        const winningIndices = [];
        for (let i = 0; i < numPoints; i++) {
            if (mask_votes[i] > 15) {
                winningIndices.push(i);
            }
        }

        this.selectionManager.setSelection(winningIndices);
    }

    private async captureWindshieldWiper(targetVec: pc.Vec3) {
        const cameraComp = this.cameraEntity.camera!;
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        const frames: { image: string, vp_matrix: number[] }[] = [];
        const numFrames = 30; 
        
        const originalPos = this.cameraEntity.getPosition().clone();
        const originalRot = this.cameraEntity.getRotation().clone();
        const initialCrustVector = new pc.Vec3().sub2(originalPos, targetVec);

        try {
            for (let i = 0; i < numFrames; i++) {
                const currentAngle = (360 * (i / (numFrames - 1)));
                
                const orbitQuat = new pc.Quat().setFromAxisAngle(new pc.Vec3(0, 0, 1), currentAngle);
                
                const rotatedCrustVector = new pc.Vec3();
                orbitQuat.transformVector(initialCrustVector, rotatedCrustVector);
                const newPos = new pc.Vec3().add2(targetVec, rotatedCrustVector);
                const newRot = new pc.Quat().mul2(orbitQuat, originalRot);
                
                this.cameraEntity.setPosition(newPos);
                this.cameraEntity.setRotation(newRot); 
                
                this.cameraEntity.getWorldTransform(); 
                this.app.render(); 
                
                const base64 = canvas.toDataURL('image/jpeg', 0.8);
                
                const viewMat = cameraComp.viewMatrix;
                const projMat = cameraComp.projectionMatrix;
                const vpMat = new pc.Mat4().mul2(projMat, viewMat);
                
                frames.push({ image: base64, vp_matrix: Array.from(vpMat.data) });
            }
        } finally {
            await new Promise(resolve => setTimeout(resolve, 1000));

            this.cameraEntity.setPosition(originalPos);
            this.cameraEntity.setRotation(originalRot);
            this.app.render(); 
        }
        return frames;
    }

    private showMasksDebugUI(base64Masks: string[]) {
        const existing = document.getElementById('masks-generated-container');
        if (existing) document.body.removeChild(existing);

        const container = document.createElement('div');
        container.id = 'masks-generated-container';
        container.style.cssText = 'position: fixed; top: 10px; right: 10px; width: 600px; max-height: 90vh; overflow-y: auto; background: rgba(0,0,0,0.85); border: 2px solid white; z-index: 9999; padding: 10px; display: flex; flex-direction: column; gap: 10px;';

        const closeBtn = document.createElement('button');
        closeBtn.innerText = 'Close Masks';
        closeBtn.style.cssText = 'padding: 8px; cursor: pointer; background: #ff4444; color: white; border: none; font-weight: bold;';
        closeBtn.onclick = () => document.body.removeChild(container);
        container.appendChild(closeBtn);

        const grid = document.createElement('div');
        grid.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;';
        container.appendChild(grid);

        base64Masks.forEach((maskBase64, index) => {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'color: white; font-size: 12px; text-align: center;';
            wrapper.innerText = `Mask ${index + 1}`;

            const img = document.createElement('img');
            img.src = "data:image/png;base64," + maskBase64;
            img.style.cssText = 'width: 100%; border: 1px solid #555; margin-top: 4px;';

            wrapper.appendChild(img);
            grid.appendChild(wrapper);
        });

        document.body.appendChild(container);
    }
}