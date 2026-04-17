import * as pc from 'playcanvas';
import { CameraController } from './camera-control';
import type { OctreeNode } from './octree';
import { raycastOctree } from './octree-raycast';

export class FocalPointManager {
    cameraEntity: pc.Entity;
    cameraController: CameraController;
    container: HTMLElement;
    requestRender: () => void;

    rootOctree: OctreeNode | null = null;
    
    public onPointPicked: ((point: pc.Vec3) => void) | null = null;

    constructor(
        cameraEntity: pc.Entity,
        cameraController: CameraController,
        container: HTMLElement,
        requestRender: () => void
    ) {
        this.cameraEntity = cameraEntity;
        this.cameraController = cameraController;
        this.container = container;
        this.requestRender = requestRender;

        this.attachEvents();
    }

    setOctree(root: OctreeNode) {
        this.rootOctree = root;
    }

    // ⚡ EXTRACTED: A clean, public raycast function that any other tool can use!
    public raycast(screenX: number, screenY: number): pc.Vec3 | null {
        if (!this.rootOctree || !this.cameraEntity.camera) return null;

        const start = this.cameraEntity.camera.screenToWorld(screenX, screenY, this.cameraEntity.camera.nearClip);
        const end = this.cameraEntity.camera.screenToWorld(screenX, screenY, this.cameraEntity.camera.farClip);

        let searchRay = new pc.Ray(start, new pc.Vec3().sub2(end, start).normalize());
        const pcEntity = this.cameraEntity.parent?.findByName('PointCloud');
        let wtm: pc.Mat4 | null = null;

        if (pcEntity) {
            wtm = pcEntity.getWorldTransform();
            const invWtm = wtm.clone().invert();

            const localStart = new pc.Vec3();
            const localEnd = new pc.Vec3();
            invWtm.transformPoint(start, localStart);
            invWtm.transformPoint(end, localEnd);

            const localDir = new pc.Vec3().sub2(localEnd, localStart).normalize();
            searchRay = new pc.Ray(localStart, localDir);
        }

        const hit = raycastOctree(
            this.rootOctree, 
            searchRay, 
            this.cameraEntity.camera.fov, 
            this.container.clientHeight, 
            10 
        );

        if (hit) {
            if (wtm) {
                const worldPoint = new pc.Vec3();
                wtm.transformPoint(hit.point, worldPoint);
                hit.point.copy(worldPoint);
            }
            return hit.point;
        }
        return null;
    }

    private attachEvents() {
        this.container.addEventListener('dblclick', (e: MouseEvent) => {
            // ⚡ UPDATED: Just call our new clean function!
            const hitPoint = this.raycast(e.offsetX, e.offsetY);

            if (hitPoint) {
                document.getElementById('coord-x')!.innerText = hitPoint.x.toFixed(3);
                document.getElementById('coord-y')!.innerText = hitPoint.y.toFixed(3);
                document.getElementById('coord-z')!.innerText = hitPoint.z.toFixed(3);

                this.cameraController.targetPivot.copy(hitPoint);
                this.requestRender();

                if (this.onPointPicked) {
                    this.onPointPicked(hitPoint);
                }
            }
        });
    }
}