import { HistoryManager } from './history';

export class SelectionManager {
    public selectedIndices: Set<number> = new Set();
    public onSelectionChanged: (() => void) | null = null;
    private history: HistoryManager;

    constructor(historyManager: HistoryManager) {
        this.history = historyManager;
        this.bindEvents();
    }

    private bindEvents() {
        window.addEventListener('keydown', (e) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            
            // Keep U exclusively for Unselect All!
            if (e.key.toLowerCase() === 'u') {
                this.clearSelection();
            }
        });
    }

    private createHistoryState(oldState: Set<number>, newState: Set<number>) {
        // Send a neat package to the global history manager
        this.history.addAction({
            undo: () => {
                this.selectedIndices = new Set(oldState);
                this.notify();
            },
            redo: () => {
                this.selectedIndices = new Set(newState);
                this.notify();
            }
        });
    }

    setSelection(indices: Iterable<number>) {
        const oldState = new Set(this.selectedIndices);
        this.selectedIndices = new Set(indices);
        this.createHistoryState(oldState, this.selectedIndices);
        this.notify();
    }

    addSelection(indices: Iterable<number>) {
        const oldState = new Set(this.selectedIndices);
        for (const index of indices) {
            this.selectedIndices.add(index);
        }
        this.createHistoryState(oldState, this.selectedIndices);
        this.notify();
    }

    clearSelection() {
        if (this.selectedIndices.size > 0) {
            const oldState = new Set(this.selectedIndices);
            this.selectedIndices.clear();
            this.createHistoryState(oldState, this.selectedIndices);
            this.notify();
        }
    }

    isSelected(index: number): boolean {
        return this.selectedIndices.has(index);
    }

    private notify() {
        console.log(`🎯 Selection Updated: ${this.selectedIndices.size} points selected.`);
        if (this.onSelectionChanged) {
            this.onSelectionChanged();
        }
    }
}