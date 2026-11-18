import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { startServer } from '../helpers/server.mjs';

const mobile = {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
};

async function input(server) {
    return (await events(server)).filter(event => event.type === 'input').map(event => event.data).join('');
}

async function events(server) {
    return (await readFile(server.eventsPath, 'utf8')).split('\n').slice(0, -1)
        .filter(Boolean).map(line => JSON.parse(line));
}

async function withMobile(browser, testInfo, run, { standalone = true, writable = true, desktop = false, serverArgs = [] } = {}) {
    const server = await startServer({ args: [...(writable ? ['-W'] : []), ...serverArgs] });
    const context = await browser.newContext(desktop ? {} : mobile);
    if (standalone) {
        // Simulate iOS's installed-display signal, not a real OS installation.
        await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    }
    const page = await context.newPage();
    try {
        await page.goto(server.url);
        await expect.poll(() => page.evaluate(() => window.term?.buffer.active.getLine(0)?.translateToString(true))).toContain('READY');
        await run(page, server);
    } finally {
        await testInfo.attach('fixture-events.jsonl', { body: await readFile(server.eventsPath), contentType: 'application/x-ndjson' });
        await context.close();
        await server.stop();
        await testInfo.attach('ttyd.log', { body: server.logs(), contentType: 'text/plain' });
    }
}

const key = (page, name) => page.getByRole('button', { name, exact: true });

async function readyKeys(page) {
    // Emulate keyboard occlusion with a real viewport resize, not UI state.
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(page.getByRole('toolbar', { name: 'Terminal extra keys' })).toBeVisible();
    await expect(key(page, 'Escape')).toBeEnabled();
}

test('mobile installed extra keys retain focus and deliver one-shot chords to the PTY', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await readyKeys(page);
        await key(page, 'Control').tap();
        await expect(key(page, 'Control')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        await page.keyboard.type('c');
        await expect(key(page, 'Control')).toHaveAttribute('aria-pressed', 'false');
        await page.keyboard.type('x');
        await key(page, 'Alt').tap();
        await page.keyboard.type('b');
        await key(page, 'Escape').tap();
        await key(page, 'Tab').tap();
        for (const arrow of await page.getByRole('toolbar').getByRole('button', { name: /^Arrow / }).all()) {
            await arrow.tap();
            await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        }
        await expect.poll(() => input(server)).toBe('\x03x\x1bb\x1b\t\x1b[D\x1b[C\x1b[A\x1b[B');
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
    });
});

test('mobile installed keys follow keyboard visibility while connected', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        const toolbar = page.getByRole('toolbar', { name: 'Terminal extra keys' });
        await expect(toolbar).toBeHidden();
        const originalRows = await page.evaluate(() => window.term.rows);
        // A real viewport resize exercises layout; it does not emulate the OS keyboard.
        await readyKeys(page);
        await expect(toolbar).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.term.rows)).toBeLessThan(originalRows);
        const bounds = await toolbar.boundingBox();
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(501);
        await key(page, 'Control').tap();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(toolbar).toBeHidden();
        await expect(page.getByRole('button', { name: 'Control', exact: true, includeHidden: true }))
            .toHaveAttribute('aria-pressed', 'false');
        await page.keyboard.type('c');
        await expect.poll(() => input(server)).toBe('c');
        await expect.poll(() => page.evaluate(() => window.term.rows)).toBe(originalRows);
        await page.evaluate(() => window.term.blur());
        await expect(toolbar).toBeHidden();
        await page.locator('.xterm-helper-textarea').focus();
        await readyKeys(page);
        await key(page, 'Escape').tap();
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        await expect.poll(() => input(server)).toBe('c\x1b');
    });
});

test('extra keys preserve paste and committed Unicode text and respect application cursor mode', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await readyKeys(page);
        await key(page, 'Control').tap();
        await page.evaluate(() => {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', 'c');
            window.term.textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        });
        await expect.poll(() => input(server)).toBe('c');
        await key(page, 'Control').tap();
        await page.keyboard.insertText('日本語');
        await expect.poll(() => input(server)).toBe('c' + Buffer.from('日本語').toString('latin1'));
        await expect(key(page, 'Control')).toHaveAttribute('aria-pressed', 'false');
        // End the pending fixture command, then make the PTY itself emit DECCKM.
        await page.evaluate(() => window.term.input('\recho \x1b[?1h\r', true));
        await expect.poll(() => page.evaluate(() => window.term.modes.applicationCursorKeysMode)).toBe(true);
        const before = await input(server);
        await key(page, 'Arrow up').tap();
        await key(page, 'Control').tap();
        await key(page, 'Arrow left').tap();
        await expect.poll(() => input(server)).toBe(before + '\x1bOA\x1b[1;5D');
    });
});

test('extra keys cannot bypass read-only mode', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await readyKeys(page);
        const eventCount = (await events(server)).length;
        await key(page, 'Escape').tap();
        await key(page, 'Control').tap();
        await page.keyboard.type('c');
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: { readText: async () => 'readonly-paste' },
        }));
        await key(page, 'Paste').tap();
        // The ordered resize confirms the server processed preceding input frames.
        await page.setViewportSize({ width: 390, height: 460 });
        await expect.poll(async () => (await events(server)).slice(eventCount).some(event => event.type === 'resize')).toBe(true);
        expect(await input(server)).toBe('');
    }, { writable: false });
});

for (const [label, options] of [['mobile browser', { standalone: false }], ['desktop installed window', { desktop: true }]]) {
    test(`${label} has no extra keyboard controls`, async ({ browser }, testInfo) => {
        await withMobile(browser, testInfo, async page => {
            await page.setViewportSize({ width: 390, height: 500 });
            await expect(page.getByRole('toolbar', { name: 'Terminal extra keys' })).toHaveCount(0);
        }, options);
    });
}

test('the Paste key reads the clipboard without modifiers and preserves bracketed paste', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.evaluate(() => navigator.clipboard.writeText('c'));
        await readyKeys(page);
        await key(page, 'Control').tap();
        await key(page, 'Paste').tap();
        await expect.poll(() => input(server)).toBe('c');
        await expect(key(page, 'Control')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        // The real PTY emits the mode switch back through the WebSocket.
        await page.evaluate(() => window.term.input('\recho \x1b[?2004h\r', true));
        await expect.poll(() => page.evaluate(() => window.term.modes.bracketedPasteMode)).toBe(true);
        const before = await input(server);
        await page.evaluate(() => navigator.clipboard.writeText('paste\nnext'));
        await key(page, 'Paste').tap();
        await expect.poll(() => input(server)).toBe(before + '\x1b[200~paste\rnext\x1b[201~');
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
    });
});

test('denied clipboard access leaves typing usable without an application popup', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: {
                readText: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
            },
        }));
        await readyKeys(page);
        await key(page, 'Control').tap();
        await key(page, 'Paste').tap();
        await expect(page.getByRole('status')).toHaveCount(0);
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        await page.keyboard.type('echo after-denial');
        await page.keyboard.press('Enter');
        await expect.poll(() => input(server)).toBe('echo after-denial\r');
    });
});

test('clipboard permission results cannot paste into a reconnected session', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: {
                readText: () => new Promise(resolve => { window.finishClipboardRead = resolve; }),
            },
        }));
        await readyKeys(page);
        await key(page, 'Paste').tap();
        await page.keyboard.type('exit');
        await page.keyboard.press('Enter');
        const toolbar = page.getByRole('toolbar', { name: 'Terminal extra keys' });
        await expect(toolbar).toBeVisible();
        await expect(key(page, 'Escape')).toBeDisabled();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(toolbar).toBeHidden();
        await page.setViewportSize({ width: 390, height: 500 });
        await expect(toolbar).toBeVisible();
        await expect(key(page, 'Escape')).toBeDisabled();
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await events(server)).filter(event => event.type === 'ready').length).toBe(2);
        const secondReady = (await events(server)).findLastIndex(event => event.type === 'ready');
        await readyKeys(page);
        await page.evaluate(() => window.finishClipboardRead('echo stale-clipboard\n'));
        await expect(key(page, 'Paste')).toBeEnabled();
        await page.keyboard.type('size');
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await events(server)).slice(secondReady + 1)
            .filter(event => event.type === 'input').map(event => event.data).join('')).toBe('size\r');
    }, { serverArgs: ['-t', 'disableReconnect=true'] });
});

test('browser zoom persists without reflowing the mobile PTY and normal fitting resumes after zoom-out', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await readyKeys(page);
        const settle = () => page.evaluate(() => new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        await settle();
        const before = await page.evaluate(() => ({ cols: window.term.cols, rows: window.term.rows }));
        const cdp = await page.context().newCDPSession(page);
        try {
            // Exercise real browser page scaling, not mocked viewport metrics.
            // OS pinch recognition itself still requires physical-device testing.
            await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
            await expect.poll(() => page.evaluate(() => visualViewport.scale)).toBeGreaterThan(1.2);
            await settle();
            expect(await page.evaluate(() => ({ cols: window.term.cols, rows: window.term.rows }))).toEqual(before);
            await page.keyboard.type('echo zoomed');
            await page.keyboard.press('Enter');
            await expect.poll(() => input(server)).toBe('echo zoomed\r');
            await settle();
            expect(await page.evaluate(() => visualViewport.scale)).toBeGreaterThan(1.2);
            expect(await page.evaluate(() => ({ cols: window.term.cols, rows: window.term.rows }))).toEqual(before);
            await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
            await page.setViewportSize({ width: 430, height: 844 });
            await expect.poll(() => page.evaluate(() => window.term.cols)).toBeGreaterThan(before.cols);
            await expect.poll(async () => {
                const dimensions = await page.evaluate(() => ({ cols: window.term.cols, rows: window.term.rows }));
                return (await events(server)).some(event => event.type === 'resize' &&
                    event.cols === dimensions.cols && event.rows === dimensions.rows);
            }).toBe(true);
        } finally {
            await cdp.detach();
        }
    });
});

test('text size buttons resize the PTY without scaling the key row or sending input', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await readyKeys(page);
        const toolbar = page.getByRole('toolbar', { name: 'Terminal extra keys' });
        const panel = page.getByRole('group', { name: 'Terminal text size' });
        const before = await page.evaluate(() => ({
            size: window.term.options.fontSize, cols: window.term.cols, rows: window.term.rows,
            scale: visualViewport.scale,
        }));
        const height = (await toolbar.boundingBox()).height;
        await key(page, 'Text size').tap();
        await expect(panel).toBeVisible();
        await key(page, 'Increase text size').tap();
        await expect.poll(() => page.evaluate(() => window.term.options.fontSize)).toBe(before.size + 1);
        await expect.poll(() => page.evaluate(() => window.term.cols)).toBeLessThan(before.cols);
        await expect.poll(async () => {
            const dimensions = await page.evaluate(() => ({ cols: window.term.cols, rows: window.term.rows }));
            return (await events(server)).some(event => event.type === 'resize' &&
                event.cols === dimensions.cols && event.rows === dimensions.rows);
        }).toBe(true);
        expect((await toolbar.boundingBox()).height).toBe(height);
        expect(await page.evaluate(() => visualViewport.scale)).toBe(before.scale);
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        await key(page, 'Decrease text size').tap();
        await expect.poll(() => page.evaluate(() => ({ cols: window.term.cols, rows: window.term.rows })))
            .toEqual({ cols: before.cols, rows: before.rows });
        await key(page, 'Text size').tap();
        await expect(panel).toBeHidden();
        await key(page, 'Text size').tap();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(panel).toBeHidden();
        await readyKeys(page);
        await expect(panel).toBeHidden();
        await page.keyboard.type('echo after-sizing');
        await page.keyboard.press('Enter');
        await expect.poll(() => input(server)).toBe('echo after-sizing\r');
    });
});

test('chosen text size survives reload and overrides the server font preference in the mobile PWA', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async page => {
        await readyKeys(page);
        await expect.poll(() => page.evaluate(() => window.term.options.fontSize)).toBe(18);
        await key(page, 'Text size').tap();
        await key(page, 'Increase text size').tap();
        await expect.poll(() => page.evaluate(() => window.term.options.fontSize)).toBe(19);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload();
        await expect.poll(() => page.evaluate(() => window.term?.options.fontSize)).toBe(19);
        await readyKeys(page);
        await key(page, 'Text size').tap();
        await expect(page.getByLabel('Font size', { exact: true })).toHaveText('19px');
    }, { serverArgs: ['-t', 'fontSize=18'] });
});

for (const limit of [8, 32]) {
    test(`text size respects the ${limit}px limit and works with blocked storage`, async ({ browser }, testInfo) => {
        await withMobile(browser, testInfo, async (page, server) => {
            await page.evaluate(() => {
                Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
            });
            await readyKeys(page);
            await key(page, 'Text size').tap();
            const atMinimum = limit === 8;
            await expect(key(page, atMinimum ? 'Decrease text size' : 'Increase text size')).toBeDisabled();
            await key(page, atMinimum ? 'Increase text size' : 'Decrease text size').tap();
            await expect.poll(() => page.evaluate(() => window.term.options.fontSize))
                .toBe(limit + (atMinimum ? 1 : -1));
            await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
            await page.keyboard.type('echo size-bound');
            await page.keyboard.press('Enter');
            await expect.poll(() => input(server)).toBe('echo size-bound\r');
        }, { serverArgs: ['-t', `fontSize=${limit}`] });
    });
}
