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

async function withMobile(browser, testInfo, run, { standalone = true, writable = true, desktop = false, serverArgs = [], width = 390 } = {}) {
    const server = await startServer({ args: [...(writable ? ['-W'] : []), ...serverArgs] });
    const context = await browser.newContext(desktop ? {} : { ...mobile, viewport: { width, height: 844 } });
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
    await expect(key(page, 'Select text')).toBeEnabled();
}

const selectionPanel = page => page.getByRole('group', { name: 'Terminal selection', exact: true });

async function selectionScreen(page) {
    // Seed output through the public API, never through PTY input. Enable application
    // mouse reporting so leaked pointer events would become observable input bytes.
    await page.evaluate(() => new Promise(resolve => {
        window.term.write('\x1b[?1000h\x1b[?1006h\x1b[2J\x1b[Halpha bravo\r\ncharlie delta', resolve);
    }));
    await expect.poll(() => page.evaluate(() => window.term.modes.mouseTrackingMode)).toBe('vt200');
}

async function tapCell(page, column, row) {
    const point = await page.locator('.xterm-screen').evaluate((screen, { column, row }) => {
        const bounds = screen.getBoundingClientRect();
        return {
            x: bounds.left + (column + 0.5) * bounds.width / window.term.cols,
            y: bounds.top + (row + 0.5) * bounds.height / window.term.rows,
        };
    }, { column, row });
    await page.touchscreen.tap(point.x, point.y);
}

async function swipeScreen(page, from, to, fingers = 1) {
    const bounds = await page.locator('.xterm-screen').boundingBox();
    const session = await page.context().newCDPSession(page);
    const points = fraction => Array.from({ length: fingers }, (_, index) => ({
        id: index + 1,
        x: bounds.x + bounds.width / 2 + (index - (fingers - 1) / 2) * 40,
        y: bounds.y + bounds.height * fraction,
    }));
    try {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
        for (let step = 1; step <= 12; step++) {
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchMove', touchPoints: points(from + (to - from) * step / 12),
            });
            await page.evaluate(() => new Promise(requestAnimationFrame));
        }
    } finally {
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await session.detach();
    }
}

async function selectBravo(page) {
    await tapCell(page, 6, 0);
    await expect(selectionPanel(page).getByRole('status')).toHaveText('Tap selection end');
    await tapCell(page, 10, 0);
    await expect.poll(() => page.evaluate(() => window.term.getSelection())).toBe('bravo');
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
        await key(page, 'Escape').tap();
        await key(page, 'Control').tap();
        await page.keyboard.type('c');
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: { readText: async () => 'readonly-paste' },
        }));
        await key(page, 'Paste').tap();
        const eventCount = (await events(server)).length;
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
            await expect(key(page, 'Select text')).toHaveCount(0);
            await expect(selectionPanel(page)).toHaveCount(0);
            await expect(page.locator('.mobile-selection-surface')).toHaveCount(0);
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

test('eleven mobile controls fit a 320px row with Select directly after Paste', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async page => {
        // Start at phone width; resizing an already fixed-width mobile page can
        // trigger browser page scaling, which this feature deliberately avoids.
        await page.setViewportSize({ width: 320, height: 500 });
        const toolbar = page.getByRole('toolbar', { name: 'Terminal extra keys' });
        await expect(toolbar).toBeVisible();
        const buttons = toolbar.getByRole('button');
        await expect(buttons).toHaveCount(11);
        expect(await buttons.evaluateAll(items => items.map(item => item.getAttribute('aria-label')))).toEqual([
            'Escape', 'Tab', 'Control', 'Alt', 'Paste', 'Select text',
            'Arrow left', 'Arrow right', 'Arrow up', 'Arrow down', 'Text size',
        ]);
        const row = await toolbar.boundingBox();
        expect(row.x).toBeGreaterThanOrEqual(0);
        expect(row.x + row.width).toBeLessThanOrEqual(320);
        for (const button of await buttons.all()) {
            const bounds = await button.boundingBox();
            expect(bounds.x).toBeGreaterThanOrEqual(row.x);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(row.x + row.width);
            expect(bounds.y).toBe((await buttons.first().boundingBox()).y);
            expect(bounds.height).toBe(40);
            expect(await button.evaluate(element => getComputedStyle(element).fontSize)).toBe('14px');
        }
        for (const icon of await toolbar.locator('svg').all()) {
            const bounds = await icon.boundingBox();
            expect(bounds.width).toBe(16);
            expect(bounds.height).toBe(16);
        }
        await key(page, 'Select text').tap();
        const panel = selectionPanel(page);
        await expect(panel).toBeVisible();
        const bounds = await panel.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
        await expect(panel.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
        await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
    }, { width: 320 });
});

test('mobile selection uses inclusive public selection and explicit real clipboard copy without PTY mouse input', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.evaluate(() => navigator.clipboard.writeText('unchanged until Copy'));
        await readyKeys(page);
        await selectionScreen(page);
        await page.evaluate(() => {
            window.selectionBlurred = false;
            window.term.textarea.addEventListener('blur', () => { window.selectionBlurred = true; });
        });
        await key(page, 'Select text').tap();
        const panel = selectionPanel(page);
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('status')).toHaveText('Tap selection start');
        await expect(page.locator('.mobile-selection-surface')).toBeVisible();
        await selectBravo(page);
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('unchanged until Copy');
        await panel.getByRole('button', { name: 'Copy', exact: true }).tap();
        await expect(panel).toBeHidden();
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        expect(await page.evaluate(() => window.selectionBlurred)).toBe(false);
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('bravo');
        // An ordered PTY resize is a barrier, not a timed silence assertion.
        const eventCount = (await events(server)).length;
        await page.setViewportSize({ width: 390, height: 460 });
        await expect.poll(async () => (await events(server)).slice(eventCount).some(event => event.type === 'resize')).toBe(true);
        expect(await input(server)).toBe('');
        await expect(panel).toBeHidden();
        await expect(page.locator('.mobile-selection-surface')).toBeHidden();
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        expect(await page.evaluate(() => window.term.getSelection())).toBe('');
        await page.keyboard.type('echo after-selection');
        await page.keyboard.press('Enter');
        await expect.poll(() => input(server)).toBe('echo after-selection\r');
    });
});

test('reverse multiline selection exposes exact native text when both copy APIs fail and permits retry', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await readyKeys(page);
        await selectionScreen(page);
        await page.evaluate(() => {
            window.realClipboard = navigator.clipboard;
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true, value: {
                    writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
                },
            });
            document.execCommand = () => false;
        });
        await key(page, 'Select text').tap();
        const panel = selectionPanel(page);
        await tapCell(page, 6, 1);
        await expect(panel.getByRole('status')).toHaveText('Tap selection end');
        await tapCell(page, 6, 0);
        const selected = 'bravo\ncharlie';
        await expect.poll(() => page.evaluate(() => window.term.getSelection())).toBe(selected);
        await panel.getByRole('button', { name: 'Copy', exact: true }).tap();
        const nativeText = panel.getByRole('textbox', { name: 'Selected text', exact: true });
        await expect(nativeText).toBeVisible();
        await expect(nativeText).toHaveValue(selected);
        await expect(nativeText).toHaveAttribute('readonly', '');
        await expect(panel).toBeVisible();
        // This is a real native textarea, not terminal input or a styled text snapshot.
        await nativeText.evaluate(element => {
            element.focus();
            element.setSelectionRange(0, element.value.length);
        });
        expect(await nativeText.evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd))).toBe(selected);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: window.realClipboard });
        });
        await panel.getByRole('button', { name: 'Copy', exact: true }).tap();
        await expect(panel).toBeHidden();
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
        const eventCount = (await events(server)).length;
        await page.setViewportSize({ width: 390, height: 460 });
        await expect.poll(async () => (await events(server)).slice(eventCount).some(event => event.type === 'resize')).toBe(true);
        expect(await input(server)).toBe('');
    });
});

test('Copy uses the legacy clipboard path when the modern API is unavailable', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async page => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.evaluate(() => {
            window.realClipboard = navigator.clipboard;
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
        });
        await readyKeys(page);
        await selectionScreen(page);
        await key(page, 'Select text').tap();
        await selectBravo(page);
        await selectionPanel(page).getByRole('button', { name: 'Copy', exact: true }).tap();
        await expect(selectionPanel(page)).toBeHidden();
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        expect(await page.evaluate(() => window.realClipboard.readText())).toBe('bravo');
    });
});


test('selection panel survives keyboard dismissal and resets both its range and start anchor on resize', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async page => {
        await readyKeys(page);
        await selectionScreen(page);
        await key(page, 'Select text').tap();
        const panel = selectionPanel(page);
        await selectBravo(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByRole('toolbar', { name: 'Terminal extra keys' })).toBeHidden();
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('status')).toHaveText('Tap selection start');
        await expect(panel.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
        expect(await page.evaluate(() => window.term.getSelection())).toBe('');
        await tapCell(page, 6, 0);
        await expect(panel.getByRole('status')).toHaveText('Tap selection end');
        await page.setViewportSize({ width: 390, height: 800 });
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('status')).toHaveText('Tap selection start');
        await tapCell(page, 10, 0);
        await expect(panel.getByRole('status')).toHaveText('Tap selection end');
        await expect(panel.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
        await tapCell(page, 6, 0);
        await expect.poll(() => page.evaluate(() => window.term.getSelection())).toBe('bravo');
        await panel.getByRole('button', { name: 'Close', exact: true }).tap();
        await expect(panel).toBeHidden();
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        expect(await page.evaluate(() => window.term.getSelection())).toBe('');
    });
});

test('read-only terminals still allow explicit selection and clipboard copy', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await readyKeys(page);
        await selectionScreen(page);
        await expect(key(page, 'Select text')).toBeEnabled();
        await key(page, 'Select text').tap();
        await selectBravo(page);
        const copy = selectionPanel(page).getByRole('button', { name: 'Copy', exact: true });
        await expect(copy).toBeEnabled();
        await copy.tap();
        await expect(selectionPanel(page)).toBeHidden();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('bravo');
        await page.keyboard.type('blocked');
        const eventCount = (await events(server)).length;
        await page.setViewportSize({ width: 390, height: 460 });
        await expect.poll(async () => (await events(server)).slice(eventCount).some(event => event.type === 'resize')).toBe(true);
        expect(await input(server)).toBe('');
    }, { writable: false });
});

for (const reason of ['window blur', 'hidden document', 'disconnect']) {
    test(`selection closes and clears its range on ${reason}`, async ({ browser }, testInfo) => {
        await withMobile(browser, testInfo, async page => {
            await readyKeys(page);
            await selectionScreen(page);
            await key(page, 'Select text').tap();
            await selectBravo(page);
            if (reason === 'window blur') {
                await page.evaluate(() => window.dispatchEvent(new Event('blur')));
            } else if (reason === 'hidden document') {
                await page.evaluate(() => {
                    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
                    document.dispatchEvent(new Event('visibilitychange'));
                });
            } else {
                // Intentionally terminate the fixture; selection gestures themselves send no input.
                await page.evaluate(() => window.term.input('exit\r', true));
                await expect(key(page, 'Select text')).toBeDisabled();
            }
            await expect(selectionPanel(page)).toBeHidden();
            await expect(page.locator('.mobile-selection-surface')).toBeHidden();
            expect(await page.evaluate(() => window.term.getSelection())).toBe('');
        }, { serverArgs: ['-t', 'disableReconnect=true'] });
    });
}

test('keyboard-open scrollbar touch drags scroll terminal history without moving the page', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await readyKeys(page);
        await page.evaluate(() => new Promise(resolve => {
            window.term.write(Array.from({ length: 160 }, (_, index) => `\r\nscroll-line-${index}`).join(''), resolve);
        }));
        await expect.poll(() => page.evaluate(() => window.term.buffer.active.baseY)).toBeGreaterThan(100);
        await expect.poll(() => page.evaluate(() =>
            window.term.buffer.active.viewportY === window.term.buffer.active.baseY)).toBe(true);
        const screen = page.locator('.xterm-screen');
        const slider = page.locator('.xterm-scrollable-element > .scrollbar.vertical > .slider');
        const root = await page.locator('#terminal-container').boundingBox();
        const session = await page.context().newCDPSession(page);
        try {
            for (const edge of ['top', 'bottom']) {
                // Reveal xterm's auto-hiding scrollbar through its normal hover
                // path, then use genuine touch events, not mouse-drag simulation.
                await screen.hover();
                const thumb = await slider.boundingBox();
                const bounds = await screen.boundingBox();
                const from = { x: thumb.x + thumb.width / 2, y: thumb.y + thumb.height / 2 };
                const toY = edge === 'top' ? bounds.y + 4 : bounds.y + bounds.height - 4;
                await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
                try {
                    for (let step = 1; step <= 12; step++) {
                        await session.send('Input.dispatchTouchEvent', {
                            type: 'touchMove',
                            touchPoints: [{ x: from.x, y: from.y + (toY - from.y) * step / 12 }],
                        });
                        await page.evaluate(() => new Promise(requestAnimationFrame));
                    }
                } finally {
                    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                }
                await expect.poll(() => page.evaluate(() => window.term.buffer.active.viewportY))
                    .toBe(edge === 'top' ? 0 : await page.evaluate(() => window.term.buffer.active.baseY));
                expect(await page.locator('#terminal-container').boundingBox()).toEqual(root);
                expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
            }
        } finally {
            await session.detach();
        }
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        await page.keyboard.type('after-scroll');
        await expect.poll(() => input(server)).toBe('after-scroll');
        // Keyboard-hidden wheel scrolling remains owned by xterm as before.
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByRole('toolbar', { name: 'Terminal extra keys' })).toBeHidden();
        await screen.hover();
        await page.mouse.wheel(0, -300);
        await expect.poll(() => page.evaluate(() =>
            window.term.buffer.active.viewportY < window.term.buffer.active.baseY)).toBe(true);
    });
});

for (const keyboardOpen of [true, false]) {
    test(`keyboard-${keyboardOpen ? 'open' : 'closed'} screen swipes move terminal scrollback, not the page`, async ({ browser }, testInfo) => {
        await withMobile(browser, testInfo, async (page, server) => {
            if (keyboardOpen) await readyKeys(page);
            else await expect(page.getByRole('toolbar', { name: 'Terminal extra keys' })).toBeHidden();
            await page.evaluate(() => new Promise(resolve => {
                window.term.write(Array.from({ length: 160 }, (_, index) => `\r\nswipe-line-${index}`).join(''), resolve);
            }));
            await expect.poll(() => page.evaluate(() => window.term.buffer.active.baseY)).toBeGreaterThan(100);
            const start = await page.evaluate(() => window.term.buffer.active.viewportY);
            const root = await page.locator('#terminal-container').boundingBox();
            await swipeScreen(page, 0.25, 0.75);
            await expect.poll(() => page.evaluate(() => window.term.buffer.active.viewportY)).toBeLessThan(start);
            expect(await page.evaluate(() => window.term.buffer.active.viewportY)).toBeGreaterThan(0);
            await swipeScreen(page, 0.75, 0.25);
            await expect.poll(() => page.evaluate(original => Math.abs(window.term.buffer.active.viewportY - original), start))
                .toBeLessThanOrEqual(1);
            await page.evaluate(() => window.term.scrollToTop());
            await swipeScreen(page, 0.25, 0.75);
            expect(await page.evaluate(() => window.term.buffer.active.viewportY)).toBe(0);
            expect(await page.locator('#terminal-container').boundingBox()).toEqual(root);
            expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
            await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
            await page.keyboard.type('after-swipe');
            await expect.poll(() => input(server)).toBe('after-swipe');
        });
    });
}

test('screen swipe handling leaves two-finger gestures and application mouse input alone', async ({ browser }, testInfo) => {
    await withMobile(browser, testInfo, async (page, server) => {
        await readyKeys(page);
        await page.evaluate(() => new Promise(resolve => {
            window.term.write(Array.from({ length: 160 }, (_, index) => `\r\nmultitouch-line-${index}`).join(''), resolve);
        }));
        await expect.poll(() => page.evaluate(() => window.term.buffer.active.baseY)).toBeGreaterThan(100);
        const start = await page.evaluate(() => window.term.buffer.active.viewportY);
        await swipeScreen(page, 0.25, 0.75, 2);
        expect(await page.evaluate(() => window.term.buffer.active.viewportY)).toBe(start);
        // Full-screen TUIs have no scrollback. Swipes must not turn into mouse
        // reports or terminal keys while consuming the one-finger page pan.
        await page.evaluate(() => new Promise(resolve => {
            window.term.write('\x1b[?1049h\x1b[?1000h\x1b[?1006hvim-like-screen', resolve);
        }));
        await swipeScreen(page, 0.25, 0.75);
        expect(await page.evaluate(() => window.term.buffer.active.viewportY)).toBe(0);
        const eventCount = (await events(server)).length;
        await page.setViewportSize({ width: 390, height: 460 });
        await expect.poll(async () => (await events(server)).slice(eventCount).some(event => event.type === 'resize')).toBe(true);
        expect(await input(server)).toBe('');
    });
});
