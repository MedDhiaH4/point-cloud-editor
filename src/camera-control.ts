import * as pc from 'playcanvas';

export class CameraController {
    cameraEntity: pc.Entity;
    container: HTMLElement;
    requestRender: () => void; 

    pitch = 20; yaw = 45; targetPitch = 20; targetYaw = 45;
    distance = 10; targetDistance = 10;
    pivot = new pc.Vec3(0, 0, 0); targetPivot = new pc.Vec3(0, 0, 0);

    private pressedButton = -1;
    private lastX = 0; private lastY = 0;

    constructor(cameraEntity: pc.Entity, container: HTMLElement, requestRender: () => void) {
        this.cameraEntity = cameraEntity;
        this.container = container;
        this.requestRender = requestRender; 
        this.attachEvents();
    }

    public focus(center: pc.Vec3, size: number) {
        this.targetPivot.copy(center);
        this.targetDistance = size * 1.2;
        this.targetPitch = 20;
        this.targetYaw = 45;
        this.requestRender(); 
    }

    public get isMoving(): boolean {
        const threshold = 0.001;
        return Math.abs(this.yaw - this.targetYaw) > threshold ||
               Math.abs(this.pitch - this.targetPitch) > threshold ||
               Math.abs(this.distance - this.targetDistance) > threshold ||
               this.pivot.distance(this.targetPivot) > threshold;
    }

    private attachEvents() {
        this.container.addEventListener('contextmenu', e => e.preventDefault());

        this.container.addEventListener('pointerdown', (e: PointerEvent) => {
            if (this.pressedButton !== -1) return;
            this.container.setPointerCapture(e.pointerId);
            this.pressedButton = e.button;
            this.lastX = e.offsetX; this.lastY = e.offsetY;
            this.requestRender(); 
        });

        this.container.addEventListener('pointerup', (e: PointerEvent) => {
            if (e.button === this.pressedButton) {
                this.pressedButton = -1;
                this.container.releasePointerCapture(e.pointerId);
            }
        });

        this.container.addEventListener('pointermove', (e: PointerEvent) => {
            if (this.pressedButton === -1) return;

            const dx = e.offsetX - this.lastX; const dy = e.offsetY - this.lastY;
            this.lastX = e.offsetX; this.lastY = e.offsetY;

            if (this.pressedButton === 0) { 
                this.targetYaw += dx * 0.25;
                this.targetPitch += dy * 0.25;
                this.targetPitch = pc.math.clamp(this.targetPitch, -89.9, 89.9);
            } else if (this.pressedButton === 2 || this.pressedButton === 1) { 
                const panSpeed = this.targetDistance * 0.0015;
                const right = this.cameraEntity.right.clone();
                const up = this.cameraEntity.up.clone();
                this.targetPivot.add(right.mulScalar(-dx * panSpeed));
                this.targetPivot.add(up.mulScalar(dy * panSpeed));
            }
            this.requestRender(); 
        });

        this.container.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            this.targetDistance += e.deltaY * (this.targetDistance * 0.001);
            this.targetDistance = Math.max(0.001, this.targetDistance);
            this.requestRender(); 
        }, { passive: false });
    }

    public update(dt: number) {
        const t = Math.min(1.0, dt * 30); 
        this.yaw = pc.math.lerp(this.yaw, this.targetYaw, t);
        this.pitch = pc.math.lerp(this.pitch, this.targetPitch, t);
        this.distance = pc.math.lerp(this.distance, this.targetDistance, t);
        this.pivot.lerp(this.pivot, this.targetPivot, t);

        const pitchRad = this.pitch * pc.math.DEG_TO_RAD;
        const yawRad = this.yaw * pc.math.DEG_TO_RAD;
        const offset = new pc.Vec3();

        offset.x = this.distance * Math.cos(pitchRad) * Math.sin(yawRad);
        offset.y = this.distance * Math.cos(pitchRad) * Math.cos(yawRad);
        offset.z = this.distance * Math.sin(pitchRad);
        
        this.cameraEntity.setPosition(this.pivot.clone().add(offset));
        this.cameraEntity.lookAt(this.pivot, new pc.Vec3(0, 0, 1));
    }
}