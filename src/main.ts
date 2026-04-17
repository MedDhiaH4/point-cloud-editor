// src/main.ts
import * as pc from 'playcanvas';
import { CameraController } from './camera-control';
import { parsePLY } from './ply-loader';
import { LODManager } from './lod-manager';
import { buildOctree, type OctreeNode, findNearestNeighbors } from './octree';
import { SelectionManager } from './selection-manager';
import { AISegmentationTool } from './ai-segmentation';
import { FocalPointManager } from './focal-point-manager'; 
import { HistoryManager } from './history';
import { RegionGrower } from './region-grower';
import { initPointSizeSlider } from './point-size-slider';
import { initDensificationSlider } from './g-pc-densification';
import { SceneManager } from './scene-manager'; // ⚡ NEW

// --- ENGINE & DOM SETUP ---
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const container = document.getElementById('canvas-container')!;
const fpsLabel = document.getElementById('fps-counter')!;
const visibleLabel = document.getElementById('visible-count')!;

const app = new pc.Application(canvas, {
    graphicsDeviceOptions: { antialias: false }
});

app.autoRender = false;
app.setCanvasFillMode(pc.FILLMODE_NONE);
app.setCanvasResolution(pc.RESOLUTION_AUTO);

const resize = () => {
    app.resizeCanvas(container.clientWidth, container.clientHeight);
    app.renderNextFrame = true;
};
window.addEventListener('resize', resize);
resize();

// --- SCENE & MODULE SETUP ---
const sceneManager = new SceneManager(); // ⚡ CLEAN INITIALIZATION

const camera = new pc.Entity('Camera');
camera.addComponent('camera', { clearColor: new pc.Color(0.01, 0.01, 0.01) });
app.root.addChild(camera);

const cameraController = new CameraController(camera, container, () => app.renderNextFrame = true);
const lodManager = new LODManager(camera);
const focalManager = new FocalPointManager(camera, cameraController, container, () => app.renderNextFrame = true);

const historyManager = new HistoryManager();
const selectionManager = new SelectionManager(historyManager); 

// ⚡ CLEAN: Selection Highlight logic using our SceneManager
selectionManager.onSelectionChanged = () => {
    const leaves = sceneManager.octreeLeaves;
    if (!leaves || leaves.length === 0) return;

    if (leaves.length > 0 && leaves[0].indices) {
        for (const node of leaves) {
            if (!node.indices || !node.meshInstance) continue;
            
            node.colors!.set((node as any).originalColors);
            
            for (let i = 0; i < node.indices.length; i++) {
                const globalIdx = node.indices[i];
                if (selectionManager.selectedIndices.has(globalIdx)) {
                    node.colors![i * 4 + 0] = 255; 
                    node.colors![i * 4 + 1] = 255; 
                    node.colors![i * 4 + 2] = 0;   
                }
            }
            
            const currentCount = node.meshInstance.mesh.primitive[0].count;
            node.meshInstance.mesh.setColors32(node.colors!);
            node.meshInstance.mesh.update(pc.PRIMITIVE_POINTS);
            node.meshInstance.mesh.primitive[0].count = currentCount;
        }
        app.renderNextFrame = true;
        return;
    }

    const positions = sceneManager.positions;
    const originalColors = sceneManager.originalColors;
    if (!positions || !originalColors) return;

    const highlightColors = new Uint8Array(originalColors);
    for (const idx of selectionManager.selectedIndices) {
        highlightColors[idx * 4 + 0] = 255;
        highlightColors[idx * 4 + 1] = 255;
        highlightColors[idx * 4 + 2] = 0;
    }

    renderPointCloud(
        positions, 
        highlightColors, 
        sceneManager.normals!, 
        sceneManager.sceneMin, 
        sceneManager.sceneMax, 
        sceneManager.isGaussianSplat
    );
    app.renderNextFrame = true;
};

// ⚡ Inject SceneManager into Tools
const regionGrower = new RegionGrower(app, selectionManager, historyManager, sceneManager);
const aiTool = new AISegmentationTool(app, camera, selectionManager, historyManager, sceneManager);

container.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === 0 && aiTool.inputMode !== 'none') {
        const hitPoint = focalManager.raycast(e.offsetX, e.offsetY);
        if (hitPoint) {
            aiTool.handleSingleClick(hitPoint);
            app.renderNextFrame = true;
        } else {
            console.warn("⚠️ Clicked empty space. Raycast missed the point cloud.");
        }
    }
});

focalManager.onPointPicked = (hitPoint: pc.Vec3) => {
    aiTool.setFocalPoint(hitPoint);
};

let globalSceneSize = 10; 

// --- RENDER LOOP ---
let wasMoving = false;
let isAsleep = false; 
let forceGizmoUpdate = true; 

app.on('update', (dt) => {
    regionGrower.update();
    cameraController.update(dt);
    const moving = cameraController.isMoving;

    if (camera.camera && (moving || wasMoving || forceGizmoUpdate || lodManager.needsUpdate)) {
        const viewMat = camera.camera.viewMatrix;
        
        const projectAxis = (axis: pc.Vec3, lineId: string, labelId: string) => {
            const camVec = new pc.Vec3();
            viewMat.transformVector(axis, camVec); 

            const L = 30; 
            const x = camVec.x * L;
            const y = -camVec.y * L; 

            const line = document.getElementById(lineId)!;
            const label = document.getElementById(labelId)!;

            const angle = Math.atan2(y, x) * (180 / Math.PI);
            const dist = Math.sqrt(x*x + y*y);

            line.style.width = `${dist}px`;
            line.style.left = `40px`;
            line.style.top = `40px`;
            line.style.transform = `rotate(${angle}deg)`;

            label.style.left = `${40 + x}px`;
            label.style.top = `${40 + y}px`;

            const zIndex = Math.round(camVec.z * -100) + 1000;
            label.style.zIndex = zIndex.toString();
            line.style.zIndex = (zIndex - 1).toString();
        };

        projectAxis(new pc.Vec3(1,0,0), 'gizmo-line-x', 'gizmo-label-x');
        projectAxis(new pc.Vec3(0,1,0), 'gizmo-line-y', 'gizmo-label-y');
        projectAxis(new pc.Vec3(0,0,1), 'gizmo-line-z', 'gizmo-label-z');
        
        forceGizmoUpdate = false; 
    }

    if (moving || wasMoving || lodManager.needsUpdate) {
        if (isAsleep) {
            lodManager.resetTimer();
            isAsleep = false;
        }
        const activePoints = lodManager.update(); 
        if (activePoints > 0) visibleLabel.innerText = activePoints.toLocaleString();
        fpsLabel.innerText = Math.round(lodManager.currentFPS).toString();
        app.renderNextFrame = true;
    } else {
        if (!isAsleep) {
            fpsLabel.innerText = "0 (Asleep)";
            isAsleep = true;
        }
    }
    wasMoving = moving;
});

function collectLeaves(node: OctreeNode, out: OctreeNode[]) {
    if (!node.children || node.children.length === 0) {
        out.push(node);
        return;
    }
    for (const c of node.children) collectLeaves(c, out);
}

function renderPointCloud(positions: Float32Array, colors: Uint8Array, normals: Float32Array, min: pc.Vec3, max: pc.Vec3, isSplat: boolean) {
    console.log("Building Octree...");
    const root = buildOctree(positions, colors, normals, min, max); 

    const old = app.root.findByName('PointCloud');
    if (old) old.destroy();

    const leaves: OctreeNode[] = [];
    collectLeaves(root, leaves);

    const meshInstances: pc.MeshInstance[] = [];

    const material = new pc.StandardMaterial();
    material.useLighting = false;
    material.emissiveVertexColor = true;
    material.emissive = new pc.Color(1, 1, 1);
    
    const chunks = material.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
    chunks.set('litUserDeclarationVS', `uniform float uPointSize;`);
    chunks.set('litUserMainEndVS', `gl_PointSize = uPointSize;`);
    material.update();
    
    const initialPointSize = parseFloat((document.getElementById('point-size-slider') as HTMLInputElement).value) || 1.0;
    material.setParameter('uPointSize', initialPointSize);

    for (const node of leaves) {
        if (!node.positions || !node.colors) continue;

        const mesh = new pc.Mesh(app.graphicsDevice);
        mesh.setPositions(node.positions);
        mesh.setColors32(node.colors);
        mesh.update(pc.PRIMITIVE_POINTS);

        const instance = new pc.MeshInstance(mesh, material);
        (node as any).meshInstance = instance;
        (node as any).originalColors = new Uint8Array(node.colors);

        meshInstances.push(instance);
    }

    const entity = new pc.Entity('PointCloud');
    entity.addComponent('render', { meshInstances });
    app.root.addChild(entity);

    lodManager.setTarget(entity, isSplat);
    focalManager.setOctree(root);

    // ⚡ CLEAN: Store directly into SceneManager
    sceneManager.octreeRoot = root;
    sceneManager.octreeLeaves = leaves;

    const numPoints = positions.length / 3;
    const leafMap = new Int32Array(numPoints);
    const localIdxMap = new Int32Array(numPoints);

    leaves.forEach((node, leafIdx) => {
        if (!node.indices) return;
        for (let i = 0; i < node.indices.length; i++) {
            const globalIdx = node.indices[i];
            leafMap[globalIdx] = leafIdx;
            localIdxMap[globalIdx] = i;
        }
    });

    sceneManager.leafMap = leafMap;
    sceneManager.localIdxMap = localIdxMap;

    return root;
}

// --- CORE PIPELINE ---
async function loadFile(file: File) {
    const overlay = document.getElementById('loading-overlay')!;
    document.getElementById('file-name')!.innerText = file.name;
    overlay.classList.remove('hidden');

    const buffer = await file.arrayBuffer();
    const data = await parsePLY(buffer);
    if (!data) return;

    // ⚡ CLEAN: Update SceneManager
    sceneManager.reset();
    sceneManager.positions = data.positions;
    sceneManager.originalColors = new Uint8Array(data.colors);
    sceneManager.normals = data.normals; 
    sceneManager.sceneMin = data.min;
    sceneManager.sceneMax = data.max;
    sceneManager.isGaussianSplat = data.isGaussianSplat;

    const splatPanel = document.getElementById('splat-panel')!;
    const splatDivider = document.getElementById('splat-divider')!;
    const splatSlider = document.getElementById('splat-density-slider') as HTMLInputElement;
    const splatLabel = document.getElementById('splat-density-label')!;

    if (data.isGaussianSplat) {
        splatPanel.style.display = 'block';
        splatDivider.style.display = 'block';
        splatSlider.value = '0';
        splatLabel.innerText = '0%';
    } else {
        splatPanel.style.display = 'none';
        splatDivider.style.display = 'none';
    }

    const ptSizeSlider = document.getElementById('point-size-slider') as HTMLInputElement;
    const ptSizeLabel = document.getElementById('point-size-label');
    if (ptSizeSlider && ptSizeLabel) {
        ptSizeSlider.value = "1.0";
        ptSizeLabel.innerText = "1.00";
    }

    renderPointCloud(data.positions, data.colors, data.normals, data.min, data.max, data.isGaussianSplat);
    regionGrower.setData(data.positions, new Uint8Array(data.colors), data.normals, data.min, data.max);

    document.getElementById('point-count')!.innerText = (data.numPoints / (data.isGaussianSplat ? 5 : 1)).toLocaleString();
    
    const initialPoints = lodManager.update();
    visibleLabel.innerText = initialPoints.toLocaleString();
    fpsLabel.innerText = Math.round(lodManager.currentFPS).toString();

    globalSceneSize = data.size.length();
    cameraController.focus(new pc.Vec3(0, 0, 0), globalSceneSize);
    
    if (camera.camera) {
        camera.camera.nearClip = Math.max(0.001, globalSceneSize * 0.001);
        camera.camera.farClip = globalSceneSize * 10;
    }

    overlay.classList.add('hidden');
    document.getElementById('drop-hint')!.style.display = 'none';
    forceGizmoUpdate = true;
    app.renderNextFrame = true;
}

// --- DOM EVENTS ---
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { 
    e.preventDefault(); 
    const f = e.dataTransfer?.files[0]; 
    if (f) loadFile(f); 
});
document.getElementById('import-btn')!.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file'; 
    input.accept = '.ply';
    input.onchange = (e: any) => loadFile(e.target.files[0]);
    input.click();
};

const updateRotation = () => {
    const pcEntity = app.root.findByName('PointCloud');
    if (pcEntity) {
        const rx = parseFloat((document.getElementById('rot-x') as HTMLInputElement).value) || 0;
        const ry = parseFloat((document.getElementById('rot-y') as HTMLInputElement).value) || 0;
        const rz = parseFloat((document.getElementById('rot-z') as HTMLInputElement).value) || 0;
        
        pcEntity.setLocalEulerAngles(rx, ry, rz);
        app.renderNextFrame = true;
    }
};

document.getElementById('rot-x')!.addEventListener('change', updateRotation);
document.getElementById('rot-y')!.addEventListener('change', updateRotation);
document.getElementById('rot-z')!.addEventListener('change', updateRotation);

const snapCamera = (yaw: number, pitch: number) => {
    cameraController.targetYaw = yaw;
    cameraController.targetPitch = pitch;
    app.renderNextFrame = true; 
};

const attachGizmoClick = (id: string, yaw: number, pitch: number) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); 
        e.preventDefault();
        snapCamera(yaw, pitch);
    });
};

attachGizmoClick('gizmo-label-x', 90, 0);     
attachGizmoClick('gizmo-label-y', 0, 0);      
attachGizmoClick('gizmo-label-z', 0, -89.9);  

document.getElementById('toggle-panel-btn')!.addEventListener('click', () => {
    document.getElementById('right-panel')!.classList.toggle('collapsed');
    setTimeout(() => {
        resize();
        app.renderNextFrame = true;
        forceGizmoUpdate = true;
    }, 310); 
});

document.getElementById('reset-scene-btn')!.addEventListener('click', () => {
    (document.getElementById('pos-x') as HTMLInputElement).value = '0';
    (document.getElementById('pos-y') as HTMLInputElement).value = '0';
    (document.getElementById('pos-z') as HTMLInputElement).value = '0';
    (document.getElementById('rot-x') as HTMLInputElement).value = '0';
    (document.getElementById('rot-y') as HTMLInputElement).value = '0';
    (document.getElementById('rot-z') as HTMLInputElement).value = '0';
    (document.getElementById('scale-val') as HTMLInputElement).value = '1';

    updateRotation(); 
    cameraController.focus(new pc.Vec3(0, 0, 0), globalSceneSize);
    
    forceGizmoUpdate = true;
    app.renderNextFrame = true;
});

initDensificationSlider(lodManager);
initPointSizeSlider(app, lodManager);

window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.repeat) return;
    
    if (e.key.toLowerCase() === 'g') {
        if (regionGrower.isGrowing) {
            regionGrower.toggleGrowth([]);
            return;
        }

        let seeds: number[] = [];
        
        if (selectionManager.selectedIndices.size > 0) {
            seeds = Array.from(selectionManager.selectedIndices);
        } else if (focalManager.cameraController.targetPivot) {
            const root = sceneManager.octreeRoot; // ⚡ CLEAN: Access via Manager
            if (root) {
                const nearest = findNearestNeighbors(root, focalManager.cameraController.targetPivot, 1);
                if (nearest.length > 0) seeds = [nearest[0]];
            }
        }

        if (seeds.length > 0) {
            const colStrict = parseFloat((document.getElementById('color-strict-val') as HTMLInputElement).value) ?? 0.75;
            const geoStrict = parseFloat((document.getElementById('geom-strict-val') as HTMLInputElement).value) ?? 0.75;
            
            regionGrower.toggleGrowth(seeds, colStrict, geoStrict);
        } else {
            console.warn("⚠️ No selection or focal point to grow from!");
        }
    }
});

app.start();