import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Inline only the local asset tags emitted by src/template.html and webpack.
const dist = new URL('./dist/', import.meta.url);
const asset = name => readFileSync(new URL(name, dist));
const html = asset('index.html')
    .toString('utf8')
    .replace(/<link\b[^>]*\binline\b[^>]*>/gi, tag => {
        const href = /\bhref="([^"]+)"/.exec(tag)[1];
        if (/\brel="icon"/.test(tag)) {
            return tag.replace(/\sinline(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/, '').replace(href, `data:image/png;base64,${asset(href).toString('base64')}`);
        }
        return `<style>${asset(href).toString('utf8').replace(/<\/style/gi, '<\\/style')}</style>`;
    })
    .replace(/<script\b[^>]*\binline\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi, (_, src) => {
        return `<script>${asset(src).toString('utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
    });

writeFileSync(new URL('inline.html', dist), html);

function embed(name, contents) {
    const lines = [];
    for (let offset = 0; offset < contents.length; offset += 12) {
        lines.push(
            '  ' + Array.from(contents.subarray(offset, offset + 12), value => `0x${value.toString(16).padStart(2, '0')}`).join(', ')
        );
    }
    return `static const unsigned char ${name}[] = {\n${lines.join(',\n')}\n};`;
}

if (!process.argv.includes('--inline')) {
    const contents = Buffer.from(html);
    const compressed = gzipSync(contents);
    const header = [
        embed('index_html', compressed),
        `static const unsigned int index_html_len = ${compressed.length};`,
        `static const unsigned int index_html_size = ${contents.length};`,
        embed('pwa_manifest', asset('manifest.webmanifest')),
        embed('pwa_icon_192', asset('icon-192.png')),
        embed('pwa_icon_512', asset('icon-512.png')),
        embed('pwa_apple_icon', asset('apple-touch-icon.png')),
        '',
    ].join('\n');
    writeFileSync(new URL('../src/html.h', import.meta.url), header);
}
