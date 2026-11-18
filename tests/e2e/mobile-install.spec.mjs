import { test, expect } from '@playwright/test';
import { startServer } from '../helpers/server.mjs';

const iosUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const androidUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

async function withServer(testInfo, run) {
    const server = await startServer({ args: ['-W', '-b', '/terminal'] });
    try {
        await run(server);
    } finally {
        try {
            await server.stop();
        } finally {
            await testInfo.attach('ttyd.log', { body: server.logs(), contentType: 'text/plain' });
        }
    }
}

async function openTerminal(page, url) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    await expect.poll(() => page.evaluate(() => {
        const buffer = window.term?.buffer.active;
        if (!buffer) return '';
        const lines = [];
        for (let row = 0; row < buffer.length; row++) {
            lines.push(buffer.getLine(row)?.translateToString(true) ?? '');
        }
        return lines.join('\n');
    })).toContain('READY');
}

test('desktop browsers never show installation guidance', async ({ page }, testInfo) => {
    await withServer(testInfo, async server => {
        await openTerminal(page, server.url);
        await expect(page.getByRole('complementary', { name: 'Install terminal' })).toHaveCount(0);
    });
});

test.describe('mobile installation guidance', () => {
    test.use({
        userAgent: iosUserAgent,
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
    });

    test('dismissals for a different terminal path do not suppress this terminal', async ({ page }, testInfo) => {
        await page.addInitScript(() => {
            sessionStorage.setItem('ttyd-ng:mobile-install:/another-terminal/', 'dismissed');
            localStorage.setItem('ttyd-ng:mobile-install:/another-terminal/', 'dismissed');
        });
        await withServer(testInfo, async server => {
            await openTerminal(page, server.url);
            await expect(page.getByRole('complementary', { name: 'Install terminal' })).toBeVisible();
        });
    });

    test('embedded mobile webviews do not advertise unsupported manual installation', async ({ page }, testInfo) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Version/4.0 Chrome/131.0 Mobile Safari/537.36',
            });
        });
        await withServer(testInfo, async server => {
            await openTerminal(page, server.url);
            await expect(page.getByRole('complementary', { name: 'Install terminal' })).toHaveCount(0);
        });
    });

    test('manual instructions require an explicit choice and preserve terminal focus', async ({ page }, testInfo) => {
        await withServer(testInfo, async server => {
            await openTerminal(page, server.url);
            const hint = page.getByRole('complementary', { name: 'Install terminal' });
            await expect(hint).toBeVisible();
            await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
            await expect(hint.getByText('Open as Web App', { exact: true })).toHaveCount(0);
            await hint.getByRole('button', { name: 'How to install', exact: true }).click();
            await expect(hint.getByRole('button', { name: 'How to install', exact: true })).toHaveAttribute('aria-expanded', 'true');
            await expect(hint).toContainText('Share menu');
            await expect(hint.getByText('Add to Home Screen', { exact: true })).toBeVisible();
            await expect(hint.getByText('Open as Web App', { exact: true })).toBeVisible();
            await expect(hint).toContainText('still needs a network connection');
        });
    });

    test('Not now survives reload and query changes but not a new tab', async ({ page, context }, testInfo) => {
        await withServer(testInfo, async server => {
            await openTerminal(page, `${server.url}?view=first`);
            const hint = page.getByRole('complementary', { name: 'Install terminal' });
            await hint.getByRole('button', { name: 'Not now', exact: true }).click();
            await expect(hint).toHaveCount(0);
            await page.reload();
            await expect(hint).toHaveCount(0);
            await openTerminal(page, `${server.url}?view=second`);
            await expect(hint).toHaveCount(0);
            const nextPage = await context.newPage();
            try {
                await openTerminal(nextPage, server.url);
                await expect(nextPage.getByRole('complementary', { name: 'Install terminal' })).toBeVisible();
            } finally {
                await nextPage.close();
            }
        });
    });

    test('Don’t show again persists in a new page', async ({ page, context }, testInfo) => {
        await withServer(testInfo, async server => {
            await openTerminal(page, server.url);
            const hint = page.getByRole('complementary', { name: 'Install terminal' });
            await hint.getByRole('button', { name: 'Don’t show again', exact: true }).click();
            await expect(hint).toHaveCount(0);
            const nextPage = await context.newPage();
            try {
                await openTerminal(nextPage, `${server.url}?another=visit`);
                await expect(nextPage.getByRole('complementary', { name: 'Install terminal' })).toHaveCount(0);
            } finally {
                await nextPage.close();
            }
        });
    });

    for (const mode of ['ios', 'standalone']) {
        test(`installed ${mode} display never shows the hint`, async ({ page }, testInfo) => {
            await page.addInitScript(mode => {
                if (mode === 'ios') {
                    Object.defineProperty(navigator, 'standalone', { get: () => true });
                } else {
                    const matchMedia = window.matchMedia.bind(window);
                    window.matchMedia = query => {
                        const media = matchMedia(query);
                        if (query === `(display-mode: ${mode})`) Object.defineProperty(media, 'matches', { value: true });
                        return media;
                    };
                }
            }, mode);
            await withServer(testInfo, async server => {
                await openTerminal(page, server.url);
                await expect(page.getByRole('complementary', { name: 'Install terminal' })).toHaveCount(0);
            });
        });
    }

    test('insecure contexts do not advertise installation', async ({ page }, testInfo) => {
        await page.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { get: () => false }));
        await withServer(testInfo, async server => {
            await openTerminal(page, server.url);
            await expect(page.getByRole('complementary', { name: 'Install terminal' })).toHaveCount(0);
        });
    });

    test('blocked storage still allows explicit dismissal without browser errors', async ({ page }, testInfo) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            for (const storage of ['sessionStorage', 'localStorage']) {
                Object.defineProperty(window, storage, {
                    get() { throw new DOMException('Storage blocked', 'SecurityError'); },
                });
            }
        });
        await withServer(testInfo, async server => {
            await openTerminal(page, server.url);
            const hint = page.getByRole('complementary', { name: 'Install terminal' });
            await hint.getByRole('button', { name: 'Don’t show again', exact: true }).click();
            await expect(hint).toHaveCount(0);
            expect(errors).toEqual([]);
        });
    });

    test('the software keyboard hides the panel, not automatic terminal focus', async ({ page }, testInfo) => {
        await withServer(testInfo, async server => {
            await openTerminal(page, server.url);
            const hint = page.getByRole('complementary', { name: 'Install terminal' });
            await expect(hint).toBeVisible();
            await page.evaluate(() => {
                window.term.focus();
                const viewport = window.visualViewport;
                Object.defineProperty(viewport, 'height', { configurable: true, value: viewport.height - 250 });
                viewport.dispatchEvent(new Event('resize'));
            });
            await expect(hint).toHaveCount(0);
            await page.evaluate(() => {
                delete window.visualViewport.height;
                window.visualViewport.dispatchEvent(new Event('resize'));
            });
            await expect(hint).toBeVisible();
        });
    });

    test('changing to standalone display hides the hint', async ({ page }, testInfo) => {
        await page.addInitScript(() => {
            const matchMedia = window.matchMedia.bind(window);
            const standalone = matchMedia('(display-mode: standalone)');
            window.mobileInstallStandalone = standalone;
            window.matchMedia = query => query === '(display-mode: standalone)' ? standalone : matchMedia(query);
        });
        await withServer(testInfo, async server => {
            await openTerminal(page, server.url);
            const hint = page.getByRole('complementary', { name: 'Install terminal' });
            await expect(hint).toBeVisible();
            await page.evaluate(() => {
                Object.defineProperty(window.mobileInstallStandalone, 'matches', { value: true });
                window.mobileInstallStandalone.dispatchEvent(new Event('change'));
            });
            await expect(hint).toHaveCount(0);
        });
    });

    test.describe('native install handoff', () => {
        test.use({ userAgent: androidUserAgent });

        for (const outcome of ['accepted', 'dismissed', 'failed']) {
            test(`native ${outcome} waits for a user gesture and never claims successful installation`, async ({ page }, testInfo) => {
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await withServer(testInfo, async server => {
                    await openTerminal(page, server.url);
                    const hint = page.getByRole('complementary', { name: 'Install terminal' });
                    await expect(hint).toBeVisible();
                    await page.evaluate(outcome => {
                        window.mobileInstallPromptCalls = 0;
                        const event = new Event('beforeinstallprompt', { cancelable: true });
                        event.prompt = async () => {
                            window.mobileInstallPromptCalls++;
                            if (outcome === 'failed') throw new Error('Install unavailable');
                        };
                        event.userChoice = Promise.resolve({ outcome });
                        window.dispatchEvent(event);
                        if (!event.defaultPrevented) throw new Error('Install event was not deferred');
                    }, outcome);
                    await expect(hint.getByRole('button', { name: 'Install', exact: true })).toBeVisible();
                    expect(await page.evaluate(() => window.mobileInstallPromptCalls)).toBe(0);
                    await hint.getByRole('button', { name: 'Install', exact: true }).click();
                    const expectedMessage = outcome === 'accepted' ? 'Installation requested.'
                        : outcome === 'dismissed' ? 'Installation was not completed.' : 'Installation could not be started.';
                    await expect(hint.getByRole('status')).toContainText(expectedMessage);
                    await expect(hint).toBeVisible();
                    expect(await page.evaluate(() => window.mobileInstallPromptCalls)).toBe(1);
                    await expect(hint.getByRole('button', { name: 'How to install', exact: true })).toBeVisible();
                    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
                    await expect(hint).toHaveCount(0);
                    expect(errors).toEqual([]);
                });
            });
        }
    });
});
