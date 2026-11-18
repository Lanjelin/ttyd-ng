import { test as base, expect } from '@playwright/test';
import { get as httpGet } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../helpers/server.mjs';

const assets = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const test = base.extend({
    start: async ({}, use, testInfo) => {
        const servers = [];
        try {
            await use(async options => {
                const server = await startServer(options);
                servers.push(server);
                return server;
            });
        } finally {
            for (const [index, server] of servers.entries()) {
                if (testInfo.status !== testInfo.expectedStatus) {
                    await testInfo.attach(`server-${index}.log`, { body: server.logs(), contentType: 'text/plain' });
                }
                await server.stop();
            }
        }
    },
});

function get(url, headers = {}) {
    // Fetch treats a direct HTTP 407 as a network error. Inspect the actual
    // response so proxy-auth rejection remains part of the asset contract.
    return new Promise((resolve, reject) => {
        const request = httpGet(url, { headers }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
                status: response.statusCode,
                headers: response.headers,
            })));
        });
        request.on('error', reject);
        request.setTimeout(3000, () => request.destroy(new Error('HTTP response timed out')));
    });
}

for (const basePath of ['', '/nested/terminal']) {
    const args = basePath ? ['-b', basePath] : [];
    const location = basePath || '/';

    test(`install metadata and decoded PNG icons resolve under ${location} without URL secrets`, async ({ page, start }) => {
        const server = await start({ args });
        const response = await page.goto(`${server.url}?arg=do-not-save-this#private-fragment`);
        expect(response.status()).toBe(200);
        const link = page.locator('link[rel="manifest"]');
        await expect(link).toHaveAttribute('crossorigin', 'use-credentials');
        const manifestUrl = await link.evaluate(element => element.href);
        expect(manifestUrl).toBe(new URL('manifest.webmanifest', server.url).href);
        const manifestResponse = await get(manifestUrl);
        expect(manifestResponse.status).toBe(200);
        expect(manifestResponse.headers.get('content-type')).toMatch(/^application\/manifest\+json(?:;|$)/);
        expect(manifestResponse.headers.get('cache-control')).toContain('no-store');
        const manifest = await manifestResponse.json();
        expect(manifest).toMatchObject({ name: 'ttyd-ng', short_name: 'ttyd-ng', display: 'standalone' });
        for (const key of ['id', 'start_url', 'scope']) {
            expect(manifest[key]).toBe('./');
            expect(new URL(manifest[key], manifestUrl).href).toBe(server.url);
        }
        // Relative URLs inherit public HTTPS and host without trusting proxy headers.
        const publicIndex = `https://terminal.example.test${basePath}/?arg=private`;
        const publicManifest = new URL(await link.getAttribute('href'), publicIndex);
        expect(new URL(manifest.start_url, publicManifest).href).toBe(`https://terminal.example.test${basePath}/`);
        expect(manifest.icons.map(icon => icon.sizes).sort()).toEqual(['192x192', '512x512']);
        const icons = manifest.icons.map(icon => ({
            url: new URL(icon.src, manifestUrl).href,
            size: Number(icon.sizes.split('x')[0]),
        }));
        const apple = page.locator('link[rel="apple-touch-icon"]');
        await expect(apple).toHaveAttribute('sizes', '180x180');
        icons.push({ url: await apple.evaluate(element => element.href), size: 180 });
        for (const { url, size } of icons) {
            expect(new URL(url).pathname.startsWith(`${basePath}/`)).toBe(true);
            expect(new URL(url).search).toBe('');
            const iconResponse = await get(url);
            expect(iconResponse.status).toBe(200);
            expect(iconResponse.headers.get('content-type')).toBe('image/png');
            expect(iconResponse.headers.get('cache-control')).toContain('no-store');
            const bytes = Buffer.from(await iconResponse.arrayBuffer());
            expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
            // Exercise a real PNG decoder, not merely a signature or source-text check.
            const dimensions = await page.evaluate(async source => {
                const image = new Image();
                image.src = source;
                await image.decode();
                return [image.naturalWidth, image.naturalHeight];
            }, url);
            expect(dimensions).toEqual([size, size]);
        }
        expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
        if (basePath) {
            for (const asset of assets) {
                expect((await get(new URL(`/${asset}`, server.url))).status).toBe(404);
            }
        }
    });

    for (const auth of [
        {
            name: 'Basic credentials', args: ['-c', 'pwa:secret'], status: 401,
            headers: { Authorization: `Basic ${Buffer.from('pwa:secret').toString('base64')}` },
            invalid: { Authorization: `Basic ${Buffer.from('pwa:wrong').toString('base64')}` },
        },
        {
            name: 'proxy authentication', args: ['-H', 'X-Authenticated-User'], status: 407,
            headers: { 'X-Authenticated-User': 'pwa-user' }, invalid: {},
        },
    ]) {
        test(`PWA assets preserve ${auth.name} at ${location} and never cache authorized responses`, async ({ start }) => {
            const server = await start({ args: [...args, ...auth.args] });
            for (const asset of assets) {
                const url = new URL(asset, server.url);
                for (const headers of [{}, auth.invalid]) {
                    const rejected = await get(url, headers);
                    expect(rejected.status).toBe(auth.status);
                    expect(rejected.headers.get('cache-control')).toContain('no-store');
                    expect((await rejected.arrayBuffer()).byteLength).toBe(0);
                }
                const accepted = await get(url, auth.headers);
                expect(accepted.status).toBe(200);
                expect(accepted.headers.get('cache-control')).toContain('no-store');
                expect((await accepted.arrayBuffer()).byteLength).toBeGreaterThan(0);
                // Reuse connections and revisit without credentials: no session leaks.
                const rejected = await get(url);
                expect(rejected.status).toBe(auth.status);
                await rejected.arrayBuffer();
            }
            const token = await get(new URL('token', server.url), auth.headers);
            expect(token.status).toBe(200);
            expect(token.headers.get('cache-control')).toContain('no-store');
            await token.arrayBuffer();
        });
    }
}

test('custom index remains untouched while optional install assets are available', async ({ start }) => {
    const directory = await mkdtemp(join(tmpdir(), 'ttyd-pwa-index-'));
    try {
        const index = join(directory, 'index.html');
        const contents = '<!doctype html><title>Custom terminal</title><p>Custom index</p>';
        await writeFile(index, contents);
        const server = await start({ args: ['-I', index, '-b', '/custom'] });
        const response = await get(server.url);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(contents);
        for (const asset of assets) {
            const metadata = await get(new URL(asset, server.url));
            expect(metadata.status).toBe(200);
            await metadata.arrayBuffer();
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
