import type { Terminal } from '@xterm/xterm';
import { MobileSelection } from './mobile-selection';
import './mobile-keyboard.scss';

type Modifier = 'ctrl' | 'alt';

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

// Input passes through xterm (including its disableStdin guard), never directly
// to the socket. Its onData callback applies armed modifiers to committed text.
export class MobileKeyboard {
    private root: HTMLElement;
    private bar = document.createElement('div');
    private buttons = new Map<string, HTMLButtonElement>();
    private listeners: (() => void)[] = [];
    private modifiers = new Set<Modifier>();
    private connected = false;
    private keyboardOpen = false;
    private baselineHeight = window.innerHeight;
    private viewportWidth = window.innerWidth;
    private frame = 0;
    private repeatDelay = 0;
    private repeatInterval = 0;
    private paste = false;
    private disposed = false;
    private readingClipboard = false;
    private connection = 0;
    private fontPanel = document.createElement('div');
    private fontValue = document.createElement('output');
    private fontDecrease = document.createElement('button');
    private fontIncrease = document.createElement('button');
    private preferredFontSize?: number;
    private fontStorageKey = `ttyd-ng:font-size:${window.location.pathname}`;
    private selection: MobileSelection;
    private touchScrollEnabled = false;
    private scrollTouch?: { id: number; y: number; pending: number; lineHeight: number };

    constructor(private terminal: Terminal, host: HTMLElement, private fit: () => void) {
        this.root = host.parentElement as HTMLElement;
        this.root.classList.add('mobile-pwa');
        this.bar.className = 'mobile-keyboard';
        this.bar.setAttribute('role', 'toolbar');
        this.bar.setAttribute('aria-label', 'Terminal extra keys');
        this.bar.hidden = true;
        for (const [key, label] of [
            ['escape', '⎋'], ['tab', '⇥'], ['ctrl', '⌃'], ['alt', '⌥'], ['paste', ''], ['select', ''],
            ['left', '◀'], ['right', '▶'], ['up', '▲'], ['down', '▼'], ['font', 'Aa'],
        ]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            if (key === 'paste' || key === 'select') {
                // Original clipboard outline, not a platform-restricted icon asset.
                const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                icon.setAttribute('viewBox', '0 0 24 24');
                icon.setAttribute('aria-hidden', 'true');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', key === 'paste' ?
                    'M9 5H6a2 2 0 0 0-2 2v13h16V7a2 2 0 0 0-2-2h-3M9 3h6v5H9z' :
                    'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z');
                icon.append(path);
                button.append(icon);
            }
            button.setAttribute('aria-label', ({ escape: 'Escape', tab: 'Tab', ctrl: 'Control', alt: 'Alt',
                paste: 'Paste', select: 'Select text', left: 'Arrow left', down: 'Arrow down', up: 'Arrow up', right: 'Arrow right',
                font: 'Text size' })[key] as string);
            if (key === 'ctrl' || key === 'alt' || key === 'select') button.setAttribute('aria-pressed', 'false');
            if (key === 'font') {
                button.setAttribute('aria-expanded', 'false');
                button.setAttribute('aria-controls', 'terminal-font-size');
            }
            this.bindButton(button, () => this.press(key), ['left', 'right', 'up', 'down'].includes(key),
                key === 'paste' || key === 'font' || key === 'select');
            this.buttons.set(key, button);
            this.bar.append(button);
        }
        this.fontPanel.id = 'terminal-font-size';
        this.fontPanel.className = 'mobile-font-size';
        this.fontPanel.setAttribute('role', 'group');
        this.fontPanel.setAttribute('aria-label', 'Terminal text size');
        this.fontPanel.hidden = true;
        this.fontValue.setAttribute('aria-label', 'Font size');
        for (const [button, label, delta] of [
            [this.fontDecrease, 'Decrease text size', -1],
            [this.fontIncrease, 'Increase text size', 1],
        ] as const) {
            button.type = 'button';
            button.textContent = delta < 0 ? '−' : '+';
            button.setAttribute('aria-label', label);
            this.bindButton(button, () => this.changeFontSize(delta), false, true);
        }
        this.fontPanel.append(this.fontDecrease, this.fontValue, this.fontIncrease);
        try {
            const stored = Number(localStorage.getItem(this.fontStorageKey));
            if (Number.isFinite(stored) && stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE) {
                this.preferredFontSize = stored;
            }
        } catch {
            // Size changes still work when browser storage is unavailable.
        }
        this.listen(this.root, 'pointerdown', event => {
            const target = event.target as Node;
            if (!this.fontPanel.contains(target) && !this.buttons.get('font')?.contains(target)) {
                this.setFontPanel(false);
            }
        }, true);
        this.root.append(this.fontPanel, this.bar);
        this.selection = new MobileSelection(terminal, host, active => {
            this.clearModifiers();
            this.stopRepeat();
            this.setFontPanel(false);
            this.buttons.get('select')?.setAttribute('aria-pressed', String(active));
        }, (button, action) => this.bindButton(button, action, false, true));
        this.listen(host, 'touchstart', event => {
            this.scrollTouch = undefined;
            const touch = event as TouchEvent;
            if (!this.touchScrollEnabled || touch.touches.length !== 1) return;
            const target = event.target;
            const screen = target instanceof Element ? target.closest('.xterm-screen') : null;
            if (!screen) return;
            const lineHeight = screen.getBoundingClientRect().height / terminal.rows;
            if (lineHeight <= 0) return;
            this.scrollTouch = { id: touch.touches[0].identifier, y: touch.touches[0].clientY, pending: 0, lineHeight };
        }, { passive: true });
        this.listen(host, 'touchmove', event => {
            const touch = event as TouchEvent;
            if (!this.touchScrollEnabled || touch.touches.length !== 1) {
                this.scrollTouch = undefined;
                return;
            }
            const target = event.target;
            if (target instanceof Element && target.closest('.xterm-scrollable-element > .scrollbar')) {
                if (event.cancelable) event.preventDefault();
                return;
            }
            const drag = this.scrollTouch;
            if (!drag || touch.touches[0].identifier !== drag.id) return;
            // xterm 6 uses a custom, pointer-driven scrollbar, not a native
            // scrolling text surface. Claim the screen swipe before Safari pans
            // its keyboard viewport and scroll through xterm's public API.
            if (event.cancelable) event.preventDefault();
            drag.pending += drag.y - touch.touches[0].clientY;
            drag.y = touch.touches[0].clientY;
            const lines = Math.trunc(drag.pending / drag.lineHeight);
            if (lines !== 0) {
                terminal.scrollLines(lines);
                drag.pending -= lines * drag.lineHeight;
            }
        }, { passive: false });
        for (const type of ['touchend', 'touchcancel']) {
            this.listen(host, type, () => { this.scrollTouch = undefined; }, { passive: true });
        }
        const textarea = terminal.textarea;
        if (textarea) {
            this.listen(textarea, 'focus', this.schedule);
            this.listen(textarea, 'blur', () => this.reset());
            // Clipboard input, including a single character, is never a chord.
            this.listen(textarea, 'paste', () => {
                this.paste = true;
                this.clearModifiers();
                queueMicrotask(() => { this.paste = false; });
            }, true);
            this.listen(textarea, 'beforeinput', event => {
                if ((event as InputEvent).inputType === 'insertFromPaste') this.clearModifiers();
            }, true);
        }
        this.listen(window, 'resize', this.schedule);
        this.listen(window, 'blur', () => this.reset());
        this.listen(document, 'visibilitychange', () => {
            if (document.hidden) this.reset();
            else this.schedule();
        });
        if (window.visualViewport) {
            this.listen(window.visualViewport, 'resize', this.schedule);
            this.listen(window.visualViewport, 'scroll', this.schedule);
        }
        this.schedule();
    }

    private listen(target: EventTarget, type: string, listener: EventListener, options: boolean | AddEventListenerOptions = false) {
        target.addEventListener(type, listener, options);
        this.listeners.push(() => target.removeEventListener(type, listener, options));
    }

    private keepFocus = (event: Event) => {
        if (event.cancelable) event.preventDefault();
        const textarea = this.terminal.textarea;
        if (textarea && document.activeElement !== textarea) textarea.focus({ preventScroll: true });
    };

    private bindButton(button: HTMLButtonElement, action: () => void, repeat = false, onRelease = false) {
        // iOS can still run touch compatibility focus actions after a canceled
        // pointerdown. Cancel the touch defaults too, without passive listeners,
        // and restore textarea focus synchronously inside the trusted gesture.
        this.listen(button, 'touchstart', this.keepFocus, { passive: false });
        this.listen(button, 'touchend', this.keepFocus, { passive: false });
        this.listen(button, 'mousedown', this.keepFocus);
        this.listen(button, 'pointerdown', event => {
            const pointer = event as PointerEvent;
            if (!pointer.isPrimary || pointer.button !== 0 || button.disabled) return;
            this.keepFocus(event);
            button.setPointerCapture(pointer.pointerId);
            this.stopRepeat();
            if (!onRelease) action();
            if (repeat) {
                this.repeatDelay = window.setTimeout(() => {
                    this.repeatInterval = window.setInterval(action, 80);
                }, 400);
            }
        });
        this.listen(button, 'pointerup', event => {
            this.stopRepeat();
            const pointer = event as PointerEvent;
            if (!pointer.isPrimary || pointer.button !== 0 || button.disabled) return;
            this.keepFocus(event);
            const rect = button.getBoundingClientRect();
            if (onRelease && pointer.clientX >= rect.left && pointer.clientX <= rect.right &&
                pointer.clientY >= rect.top && pointer.clientY <= rect.bottom) action();
        });
        for (const type of ['pointercancel', 'lostpointercapture']) {
            this.listen(button, type, () => this.stopRepeat());
        }
        this.listen(button, 'click', event => {
            // Keyboard/accessibility activation only; pointer actions ran above.
            if ((event as MouseEvent).detail !== 0 || button.disabled) return;
            this.keepFocus(event);
            action();
        });
    }

    setConnected(connected: boolean) {
        if (this.connected !== connected) this.connection++;
        this.connected = connected;
        if (!connected) {
            this.selection.close();
            this.reset();
        }
        this.schedule();
    }

    restoreFontSize() {
        if (this.preferredFontSize !== undefined) this.terminal.options.fontSize = this.preferredFontSize;
        this.updateFontControls();
    }

    private updateFontControls() {
        const size = this.terminal.options.fontSize ?? 15;
        this.fontValue.value = `${size}px`;
        this.fontDecrease.disabled = size <= MIN_FONT_SIZE;
        this.fontIncrease.disabled = size >= MAX_FONT_SIZE;
    }

    private setFontPanel(open: boolean) {
        if (this.fontPanel.hidden === !open) return;
        this.fontPanel.hidden = !open;
        this.buttons.get('font')?.setAttribute('aria-expanded', String(open));
        if (open) this.updateFontControls();
    }

    private changeFontSize(delta: number) {
        const current = this.terminal.options.fontSize ?? 15;
        const size = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, current + delta));
        if (size === current) return;
        this.terminal.options.fontSize = this.preferredFontSize = size;
        this.fit();
        this.updateFontControls();
        try {
            localStorage.setItem(this.fontStorageKey, String(size));
        } catch {
            // Retain the preference in this page even if persistence is blocked.
        }
    }

    // xterm has already resolved keyboard input/IME composition here. Only an
    // ASCII character can form a legacy terminal chord; never rewrite escape
    // sequences (including terminal replies), pasted blocks or composed words.
    filterInput(data: string): string {
        if (!this.modifiers.size || this.paste) return data;
        if (data.length !== 1 || data.charCodeAt(0) < 32 || data.charCodeAt(0) > 126) {
            if (!data.startsWith('\x1b')) this.clearModifiers();
            return data;
        }
        let result = data;
        if (this.modifiers.has('ctrl')) {
            const code = data.toUpperCase().charCodeAt(0);
            if (code >= 64 && code <= 95) result = String.fromCharCode(code & 31);
            else if (data === ' ') result = '\x00';
            else if (data === '?') result = '\x7f';
            else {
                this.clearModifiers();
                return data;
            }
        }
        if (this.modifiers.has('alt')) result = '\x1b' + result;
        this.clearModifiers();
        return result;
    }

    private press(key: string) {
        if (!this.connected) return;
        if (key === 'select') {
            this.selection.toggle();
            return;
        }
        if (this.terminal.options.disableStdin) return;
        this.selection.close();
        if (key === 'font') {
            this.clearModifiers();
            this.setFontPanel(this.fontPanel.hidden !== false);
            return;
        }
        this.setFontPanel(false);
        if (key === 'paste') {
            void this.readClipboard();
            return;
        }
        if (key === 'ctrl' || key === 'alt') {
            if (this.modifiers.has(key)) this.modifiers.delete(key);
            else this.modifiers.add(key);
            this.updateModifiers();
            return;
        }
        let data: string;
        if (key === 'escape') data = '\x1b';
        else if (key === 'tab') data = '\t';
        else {
            const final = ({ up: 'A', down: 'B', right: 'C', left: 'D' })[key];
            if (!final) return;
            const modifier = 1 + (this.modifiers.has('alt') ? 2 : 0) + (this.modifiers.has('ctrl') ? 4 : 0);
            data = modifier > 1 ? `\x1b[1;${modifier}${final}` :
                `\x1b${this.terminal.modes.applicationCursorKeysMode ? 'O' : '['}${final}`;
        }
        this.clearModifiers();
        this.terminal.input(data, true);
    }

    private async readClipboard() {
        if (this.readingClipboard) return;
        const connection = this.connection;
        const button = this.buttons.get('paste') as HTMLButtonElement;
        this.readingClipboard = button.disabled = true;
        this.clearModifiers();
        try {
            // Called on pointerup/click: touch pointerdown alone does not grant
            // clipboard user activation. The browser may show its own paste UI.
            if (!navigator.clipboard?.readText) return;
            const text = await navigator.clipboard.readText();
            if (this.disposed || !this.connected || connection !== this.connection || this.terminal.options.disableStdin) return;
            this.clearModifiers();
            this.paste = true;
            try {
                // Preserve xterm's bracketed-paste handling and disableStdin gate.
                this.terminal.paste(text);
            } finally {
                this.paste = false;
            }
        } catch {
            // Clipboard permission can be declined or dismissed. Keep the
            // terminal usable without an application popup or paste advice.
        } finally {
            this.readingClipboard = false;
            button.disabled = !this.connected || this.terminal.options.disableStdin === true;
        }
    }

    private updateModifiers() {
        for (const key of ['ctrl', 'alt'] as const) {
            this.buttons.get(key)?.setAttribute('aria-pressed', String(this.modifiers.has(key)));
        }
    }

    private clearModifiers() {
        this.modifiers.clear();
        this.updateModifiers();
    }

    private stopRepeat() {
        window.clearTimeout(this.repeatDelay);
        window.clearInterval(this.repeatInterval);
        this.repeatDelay = this.repeatInterval = 0;
    }

    reset() {
        this.scrollTouch = undefined;
        this.clearModifiers();
        this.stopRepeat();
        this.setFontPanel(false);
        this.schedule();
    }

    private schedule = () => {
        if (!this.disposed && !this.frame) this.frame = requestAnimationFrame(this.layout);
    };

    private layout = () => {
        this.frame = 0;
        const viewport = window.visualViewport;
        const height = viewport?.height ?? window.innerHeight;
        const width = viewport?.width ?? window.innerWidth;
        const scale = viewport?.scale ?? 1;
        const zoomed = Math.abs(scale - 1) > 0.01;
        if (!zoomed && Math.abs(width - this.viewportWidth) > 1) {
            this.baselineHeight = Math.max(window.innerHeight, height);
            this.viewportWidth = width;
        } else if (!zoomed) {
            this.baselineHeight = Math.max(this.baselineHeight, window.innerHeight, height);
        }
        // Native pinch zoom also shrinks the visual viewport. Normalize its
        // height before inferring keyboard occlusion, rather than hiding the
        // row simply because the page was magnified.
        const keyboard = this.baselineHeight - height * scale > Math.max(100, this.baselineHeight * 0.18);
        if (this.keyboardOpen !== keyboard) this.scrollTouch = undefined;
        if (this.keyboardOpen && !keyboard) {
            this.clearModifiers();
            this.stopRepeat();
        }
        this.keyboardOpen = keyboard;
        this.touchScrollEnabled = !zoomed;
        if (!this.touchScrollEnabled) this.scrollTouch = undefined;
        this.root.classList.toggle('mobile-scroll-contained', this.touchScrollEnabled);
        this.root.classList.toggle('mobile-keyboard-open', keyboard);
        this.bar.hidden = !keyboard;
        if (!keyboard) this.setFontPanel(false);
        for (const [key, button] of this.buttons) {
            button.disabled = !this.connected || (key !== 'select' && this.terminal.options.disableStdin) ||
                (key === 'paste' && this.readingClipboard);
        }
        // Let the browser magnify/pan the existing page. Refitting it to the
        // smaller zoomed viewport reflows the terminal and moves its input.
        if (zoomed) return;
        this.root.style.top = `${viewport?.offsetTop ?? 0}px`;
        this.root.style.left = `${viewport?.offsetLeft ?? 0}px`;
        this.root.style.width = `${width}px`;
        this.root.style.height = `${height}px`;
    };

    dispose() {
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        this.stopRepeat();
        this.selection.dispose();
        for (const remove of this.listeners) remove();
        this.bar.remove();
        this.fontPanel.remove();
        this.root.classList.remove('mobile-pwa', 'mobile-keyboard-open', 'mobile-scroll-contained');
        for (const property of ['top', 'left', 'width', 'height']) this.root.style.removeProperty(property);
    }
}
