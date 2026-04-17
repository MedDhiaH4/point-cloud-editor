// history.ts
export interface HistoryAction {
    undo: () => void;
    redo: () => void;
}

export class HistoryManager {
    private undoStack: HistoryAction[] = [];
    private redoStack: HistoryAction[] = [];

    constructor() {
        this.bindEvents();
    }

    public addAction(action: HistoryAction) {
        this.undoStack.push(action);
        this.redoStack = []; // Clear redo stack when a brand new action is taken
        
        // Limit history to 50 steps to prevent RAM bloat
        if (this.undoStack.length > 50) {
            this.undoStack.shift(); 
        }
        console.log(`📜 History saved. Stack size: ${this.undoStack.length}`);
    }

    public undo() {
        if (this.undoStack.length === 0) {
            console.log("⚠️ Nothing to undo!");
            return;
        }
        const action = this.undoStack.pop()!;
        action.undo();
        this.redoStack.push(action);
        console.log("⏪ Global Undo.");
    }

    public redo() {
        if (this.redoStack.length === 0) {
            console.log("⚠️ Nothing to redo!");
            return;
        }
        const action = this.redoStack.pop()!;
        action.redo();
        this.undoStack.push(action);
        console.log("⏩ Global Redo.");
    }

    private bindEvents() {
        window.addEventListener('keydown', (e) => {
            // Ignore keystrokes if the user is typing in a UI box
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const modifier = isMac ? e.metaKey : e.ctrlKey;

            // Global Undo (Ctrl+Z)
            if (modifier && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
            }

            // Global Redo (Ctrl+Y or Ctrl+Shift+Z)
            if (modifier && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
                e.preventDefault();
                this.redo();
            }
        });
    }
}