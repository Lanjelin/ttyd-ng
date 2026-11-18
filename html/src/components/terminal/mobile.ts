// iPadOS may identify itself as macOS, including in standalone web apps.
export function isIOSClient(): boolean {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);
}

export function isMobileClient(): boolean {
    return navigator.maxTouchPoints > 0 && (isIOSClient() || /Android|Mobile/.test(navigator.userAgent));
}

export function isStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
