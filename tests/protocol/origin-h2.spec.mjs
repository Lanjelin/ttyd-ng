import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http2 from 'node:http2';
import { Receiver } from 'ws';
import { startServer } from '../helpers/server.mjs';

// RFC 8441 carries ordinary WebSocket frames in HTTP/2 DATA, not an HTTP/1 upgrade.
function frame(text) {
    const payload = Buffer.from(text);
    if (payload.length >= 126) throw new Error('Test frame requires a short payload');
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const result = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, payload]);
    for (let i = 0; i < payload.length; i++) result[6 + i] ^= mask[i % 4];
    return result;
}

test('HTTP/2 origin checks use authority and cannot be bypassed with a conflicting Host', async ({}, testInfo) => {
    const directory = await mkdtemp(join(tmpdir(), 'ttyd-origin-h2-'));
    const cert = join(directory, 'cert.pem');
    const key = join(directory, 'key.pem');
    let server;
    let client;
    const streams = [];
    const errors = [];
    try {
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=localhost', '-keyout', key, '-out', cert], { stdio: 'pipe' });
        server = await startServer({ args: ['-W', '-O', '-S', '-C', cert, '-K', key] });
        client = http2.connect(server.url.replace('http:', 'https:'), { rejectUnauthorized: false });
        client.on('error', error => errors.push(error.message));
        let settings;
        client.on('remoteSettings', value => { settings = value; });
        await new Promise((resolve, reject) => {
            client.once('connect', resolve);
            client.once('error', reject);
        });
        test.skip(client.alpnProtocol !== 'h2', 'This libwebsockets build does not negotiate HTTP/2');
        await expect.poll(() => settings !== undefined || errors.length > 0).toBe(true);
        expect(errors).toEqual([]);
        test.skip(!settings?.enableConnectProtocol, 'This libwebsockets build does not advertise RFC 8441');

        function connect(authority, origin, host) {
            const stream = client.request({
                ':method': 'CONNECT', ':protocol': 'websocket', ':scheme': 'https',
                ':path': '/ws', ':authority': authority, origin,
                'sec-websocket-version': '13', 'sec-websocket-protocol': 'tty',
                ...(host ? { host } : {}),
            }, { endStream: false });
            const result = { stream, status: null, output: '', closed: false };
            const receiver = new Receiver({ isServer: false });
            receiver.on('message', data => {
                if (data[0] === 0x30) result.output += data.subarray(1).toString();
            });
            receiver.on('error', error => errors.push(error.message));
            stream.on('data', data => receiver.write(data));
            stream.on('response', headers => { result.status = headers[':status']; });
            stream.on('error', () => {}); // Rejected CONNECT streams may be reset.
            stream.on('close', () => { result.closed = true; });
            streams.push(stream);
            return result;
        }

        for (const host of [undefined, 'other.example.com']) {
            // Test ordinary h2 (no Host), then a duplicate Host that must not veto :authority.
            const accepted = connect('terminal.example.com', 'https://terminal.example.com', host);
            await expect.poll(() => accepted.status).toBe(200);
            accepted.stream.write(frame(JSON.stringify({ columns: 80, rows: 24 })));
            await expect.poll(() => accepted.output).toContain('READY\r\n');
            accepted.stream.write(frame('0echo h2-origin\n'));
            await expect.poll(() => accepted.output).toContain('ECHO:h2-origin\r\n');
        }

        // A forged Host matching Origin must not override a different :authority.
        const rejected = connect('other.example.com', 'https://terminal.example.com', 'terminal.example.com');
        // Keep the transport active: some lws versions defer flushing the refused-stream reset.
        await new Promise((resolve, reject) => client.ping(error => error ? reject(error) : resolve()));
        await expect.poll(() => rejected.closed || rejected.status !== null).toBe(true);
        expect(rejected.status).not.toBe(200);
        expect(errors).toEqual([]);
    } finally {
        for (const stream of streams) stream.destroy();
        client?.destroy();
        if (server) {
            if (testInfo.status !== testInfo.expectedStatus) {
                await testInfo.attach('server.log', { body: server.logs(), contentType: 'text/plain' });
            }
            await server.stop();
        }
        await rm(directory, { recursive: true, force: true });
    }
});
