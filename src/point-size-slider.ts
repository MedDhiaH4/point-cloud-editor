import * as pc from 'playcanvas';
import { LODManager } from './lod-manager';

export function initPointSizeSlider(app: pc.Application, lodManager: LODManager) {
    const ptSizeSlider = document.getElementById('point-size-slider') as HTMLInputElement;
    const ptSizeLabel = document.getElementById('point-size-label')!;

    if (!ptSizeSlider || !ptSizeLabel) return;

    ptSizeSlider.addEventListener('input', (e) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    
    ptSizeLabel.innerText = val.toFixed(2); 

    const pcEntity = app.root.findByName('PointCloud') as pc.Entity;
    if (pcEntity && pcEntity.render && pcEntity.render.meshInstances.length > 0) {
        const sharedMaterial = pcEntity.render.meshInstances[0].material;
        sharedMaterial.setParameter('uPointSize', val);
    }

    lodManager.needsUpdate = true;
    app.renderNextFrame = true;
});
}