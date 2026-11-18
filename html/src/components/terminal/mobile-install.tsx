import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isIOSClient, isMobileClient, isStandalone } from './mobile';
import './mobile-install.scss';

interface InstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isDismissed(key: string): boolean {
    try {
        if (sessionStorage.getItem(key) === 'dismissed') return true;
    } catch {
        // Storage may be unavailable in privacy-restricted browser sessions.
    }
    try {
        return localStorage.getItem(key) === 'dismissed';
    } catch {
        return false;
    }
}

function canInstallManually(): boolean {
    const userAgent = navigator.userAgent;
    // Embedded webviews cannot install apps from their host's menu.
    if (/; wv\)|FBAN|FBAV|Instagram/.test(userAgent)) return false;
    if (isIOSClient()) return /Safari|CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
    return /Android/.test(userAgent) && /Chrome|Firefox|SamsungBrowser|EdgA|OPR/.test(userAgent);
}

export function MobileInstallHint() {
    const key = `ttyd-ng:mobile-install:${window.location.pathname}`;
    const eligible = window.isSecureContext && isMobileClient();
    const [dismissed, setDismissed] = useState(() => isDismissed(key));
    const [standalone, setStandalone] = useState(isStandalone);
    const [installed, setInstalled] = useState(false);
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [hasPrompt, setHasPrompt] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const prompt = useRef<InstallPromptEvent | null>(null);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        if (!eligible) return () => { mounted.current = false; };

        const onPrompt = (event: Event) => {
            if (isStandalone() || isDismissed(key)) return;
            event.preventDefault();
            prompt.current = event as InstallPromptEvent;
            setHasPrompt(true);
        };
        const onInstalled = () => {
            prompt.current = null;
            setHasPrompt(false);
            setInstalled(true);
        };
        const onDisplayMode = () => setStandalone(isStandalone());
        const viewport = window.visualViewport;
        let baselineHeight = viewport?.height ?? window.innerHeight;
        const onViewport = () => {
            if (!viewport) return;
            baselineHeight = Math.max(baselineHeight, window.innerHeight, viewport.height);
            setKeyboardVisible(
                document.activeElement?.matches('.xterm-helper-textarea') === true &&
                baselineHeight - viewport.height > 150
            );
        };
        const onOrientation = () => {
            baselineHeight = window.innerHeight;
            onViewport();
        };
        const onFocus = () => {
            // focusout runs before activeElement points at the next focused node.
            queueMicrotask(() => {
                if (mounted.current) onViewport();
            });
        };
        const displayModes = [window.matchMedia('(display-mode: standalone)')];
        window.addEventListener('beforeinstallprompt', onPrompt);
        window.addEventListener('appinstalled', onInstalled);
        document.addEventListener('focusin', onFocus);
        document.addEventListener('focusout', onFocus);
        viewport?.addEventListener('resize', onViewport);
        window.addEventListener('orientationchange', onOrientation);
        displayModes.forEach(media => media.addEventListener('change', onDisplayMode));
        return () => {
            mounted.current = false;
            prompt.current = null;
            window.removeEventListener('beforeinstallprompt', onPrompt);
            window.removeEventListener('appinstalled', onInstalled);
            document.removeEventListener('focusin', onFocus);
            document.removeEventListener('focusout', onFocus);
            viewport?.removeEventListener('resize', onViewport);
            window.removeEventListener('orientationchange', onOrientation);
            displayModes.forEach(media => media.removeEventListener('change', onDisplayMode));
        };
    }, [eligible, key]);

    const dismiss = (persistent: boolean) => {
        setDismissed(true);
        prompt.current = null;
        try {
            (persistent ? localStorage : sessionStorage).setItem(key, 'dismissed');
        } catch {
            // The current page still respects dismissal when storage is blocked.
        }
    };

    const install = async () => {
        setExpanded(true);
        const event = prompt.current;
        if (!event || busy) return;
        prompt.current = null;
        setHasPrompt(false);
        setBusy(true);
        setMessage('');
        try {
            // This call stays directly in the click handler's user gesture.
            await event.prompt();
            const choice = await event.userChoice;
            if (mounted.current) {
                setMessage(choice.outcome === 'accepted'
                    ? 'Installation requested. Follow your browser’s confirmation to finish.'
                    : 'Installation was not completed. You can use your browser menu to try again.');
            }
        } catch {
            if (mounted.current) setMessage('Installation could not be started. Use your browser menu instead.');
        } finally {
            if (mounted.current) setBusy(false);
        }
    };

    if (!eligible || dismissed || standalone || installed || keyboardVisible || (!hasPrompt && !canInstallManually())) return null;

    return (
        <aside class="mobile-install" aria-label="Install terminal">
            <strong>Add this terminal to your home screen</strong>
            <p>Open without browser bars, with extra terminal keys above your mobile keyboard.</p>
            {expanded && (
                <div id="mobile-install-instructions" class="mobile-install-instructions">
                    {isIOSClient() ? (
                        <p>
                            Open the Share menu, choose <strong>Add to Home Screen</strong>, enable{' '}
                            <strong>Open as Web App</strong> if shown, then tap <strong>Add</strong>.
                            If the option is missing, open this address in Safari first.
                        </p>
                    ) : (
                        <p>
                            Open your browser menu and choose <strong>Install app</strong> or{' '}
                            <strong>Add to Home screen</strong>, then confirm installation.
                            If neither option is available, open this address in a browser that supports installing web apps.
                        </p>
                    )}
                    <p>Installation is optional. This terminal still needs a network connection and your usual sign-in.</p>
                </div>
            )}
            {message && <p role="status">{message}</p>}
            <div class="mobile-install-actions">
                <button
                    type="button"
                    onClick={install}
                    disabled={busy}
                    aria-expanded={expanded}
                    aria-controls={expanded ? 'mobile-install-instructions' : undefined}
                >
                    {busy ? 'Waiting for browser…' : hasPrompt ? 'Install' : 'How to install'}
                </button>
                <button type="button" onClick={() => dismiss(false)}>Not now</button>
                <button type="button" onClick={() => dismiss(true)}>Don’t show again</button>
            </div>
        </aside>
    );
}
