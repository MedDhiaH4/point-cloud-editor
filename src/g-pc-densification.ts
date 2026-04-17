import { LODManager } from './lod-manager';

export function initDensificationSlider(lodManager: LODManager) {
    const splatSlider = document.getElementById('splat-density-slider') as HTMLInputElement;
    const splatLabel = document.getElementById('splat-density-label')!;

    if (!splatSlider || !splatLabel) return;

    splatSlider.addEventListener('input', (e) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        splatLabel.innerText = `${val}%`;
        
        lodManager.setSplatDensity(val / 100);
    });
}