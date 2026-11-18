import type { Terminal } from '@xterm/xterm';

// A separate hit surface prevents selection taps from reaching application mouse
// reporting. Use public buffer/selection APIs, not synthetic xterm mouse events.
export class MobileSelection {
    private surface = document.createElement('div');
    private panel = document.createElement('div');
    private status = document.createElement('span');
    private copy = document.createElement('button');
    private text = document.createElement('textarea');
    private anchor?: { column: number; row: number };
    private start?: { x: number; y: number; id: number };
    private selected = '';
    private generation = 0;
    private active = false;
    private listeners: (() => void)[] = [];

    constructor(
        private terminal: Terminal,
        host: HTMLElement,
        private changed: (active: boolean) => void,
        bindButton: (button: HTMLButtonElement, action: () => void) => void
    ) {
        this.surface.className = 'mobile-selection-surface';
        this.surface.hidden = true;
        this.surface.setAttribute('aria-hidden', 'true');
        this.panel.className = 'mobile-selection-panel';
        this.panel.hidden = true;
        this.panel.setAttribute('role', 'group');
        this.panel.setAttribute('aria-label', 'Terminal selection');
        this.status.setAttribute('role', 'status');
        this.text.readOnly = true;
        this.text.spellcheck = false;
        this.text.setAttribute('aria-label', 'Selected text');
        this.text.hidden = true;
        this.copy.type = 'button';
        this.copy.textContent = 'Copy';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        this.panel.append(this.status, this.copy, close, this.text);
        host.append(this.surface);
        host.parentElement?.append(this.panel);
        // Reuse the accessory keys' touch/pointer activation and focus handling.
        bindButton(this.copy, () => { void this.copyText(); });
        bindButton(close, () => this.close(true));
        this.listen(this.surface, 'pointerdown', event => {
            const pointer = event as PointerEvent;
            event.preventDefault();
            if (!pointer.isPrimary || pointer.button !== 0) return;
            this.surface.setPointerCapture(pointer.pointerId);
            this.start = { x: pointer.clientX, y: pointer.clientY, id: pointer.pointerId };
        });
        this.listen(this.surface, 'pointerup', event => {
            const pointer = event as PointerEvent;
            event.preventDefault();
            const start = this.start;
            this.start = undefined;
            if (!start || pointer.pointerId !== start.id ||
                Math.hypot(pointer.clientX - start.x, pointer.clientY - start.y) > 12) return;
            this.selectAt(pointer.clientX, pointer.clientY);
        });
        this.listen(this.surface, 'pointercancel', () => { this.start = undefined; });
        this.listen(this.surface, 'contextmenu', event => event.preventDefault());
        this.listen(this.surface, 'touchstart', event => event.preventDefault(), { passive: false });
        this.listen(this.surface, 'touchend', event => event.preventDefault(), { passive: false });
        this.listen(window, 'blur', () => this.close());
        this.listen(document, 'visibilitychange', () => { if (document.hidden) this.close(); });
        for (const disposable of [terminal.onResize(() => this.resetRange()), terminal.onScroll(() => this.resetRange())]) {
            this.listeners.push(() => disposable.dispose());
        }
    }

    private listen(target: EventTarget, type: string, listener: EventListener, options: AddEventListenerOptions = {}) {
        target.addEventListener(type, listener, options);
        this.listeners.push(() => target.removeEventListener(type, listener, options));
    }

    toggle() {
        if (this.active) this.close(true);
        else {
            this.active = true;
            this.surface.hidden = this.panel.hidden = false;
            this.resetRange();
            this.changed(true);
            // Keep the input focused: entering selection must not dismiss the
            // keyboard. The independent panel also works if it is hidden by hand.
        }
    }

    private resetRange() {
        if (!this.active) return;
        this.generation++;
        this.anchor = undefined;
        this.start = undefined;
        this.selected = '';
        this.text.value = '';
        this.text.hidden = true;
        this.copy.disabled = true;
        this.status.textContent = 'Tap selection start';
        this.terminal.clearSelection();
    }

    private selectAt(x: number, y: number) {
        const rect = this.terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return;
        const column = Math.min(this.terminal.cols - 1, Math.floor((x - rect.left) * this.terminal.cols / rect.width));
        const row = this.terminal.buffer.active.viewportY +
            Math.min(this.terminal.rows - 1, Math.floor((y - rect.top) * this.terminal.rows / rect.height));
        if (!this.anchor) {
            this.resetRange();
            this.anchor = { column, row };
            this.status.textContent = 'Tap selection end';
            this.terminal.select(column, row, 1);
            return;
        }
        const first = this.anchor.row * this.terminal.cols + this.anchor.column;
        const last = row * this.terminal.cols + column;
        const from = Math.min(first, last);
        this.terminal.select(from % this.terminal.cols, Math.floor(from / this.terminal.cols), Math.abs(last - first) + 1);
        this.anchor = undefined;
        this.selected = this.terminal.getSelection();
        this.copy.disabled = !this.selected;
        this.status.textContent = 'Tap Copy or select again';
    }

    private legacyCopy(text: string): boolean {
        const textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.value = text;
        textarea.className = 'mobile-copy-buffer';
        this.panel.append(textarea);
        const active = document.activeElement as HTMLElement | null;
        try {
            textarea.focus({ preventScroll: true });
            textarea.setSelectionRange(0, text.length);
            return document.execCommand('copy');
        } catch {
            return false;
        } finally {
            textarea.remove();
            active?.focus({ preventScroll: true });
        }
    }

    private async copyText() {
        if (!this.active || !this.selected || this.copy.disabled) return;
        const text = this.selected;
        const generation = this.generation;
        this.copy.disabled = true;
        let copied = false;
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                copied = true;
            } catch {
                // Plain HTTP or denied activation: retry via the legacy path.
            }
        }
        if (!this.active || generation !== this.generation) return;
        if (!copied) copied = this.legacyCopy(text);
        this.copy.disabled = false;
        if (copied) {
            this.close(true);
        } else {
            // A real native text field provides manual selection even when both
            // programmatic clipboard APIs are blocked. Copy retries on a new tap.
            this.status.textContent = 'Select text below to copy, or retry Copy';
            this.text.value = text;
            this.text.hidden = false;
            this.text.focus({ preventScroll: true });
            this.text.setSelectionRange(0, text.length);
        }
    }

    close(focus = false) {
        if (!this.active) return;
        this.resetRange();
        this.active = false;
        this.surface.hidden = this.panel.hidden = true;
        this.changed(false);
        if (focus) this.terminal.focus();
    }

    dispose() {
        this.close();
        for (const remove of this.listeners) remove();
        this.surface.remove();
        this.panel.remove();
    }
}
