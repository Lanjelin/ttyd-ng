const { deflateSync } = require('node:zlib');

// Original terminal artwork, rasterized deterministically at build time without
// image libraries. Coordinates are normalized so every icon shares the design.
function roundedRect(x, y, left, top, width, height, radius) {
    const dx = Math.max(left + radius - x, 0, x - (left + width - radius));
    const dy = Math.max(top + radius - y, 0, y - (top + height - radius));
    return x >= left && x <= left + width && y >= top && y <= top + height && dx * dx + dy * dy <= radius * radius;
}

function stroke(x, y, ax, ay, bx, by, width) {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (width / 2) ** 2;
}

function color(x, y) {
    let rgb = [18 + 9 * (1 - y), 31 + 22 * (1 - y), 50 + 28 * (1 - x)];
    if (roundedRect(x, y, 0.125, 0.195, 0.75, 0.64, 0.075)) rgb = [9, 19, 32];
    if (roundedRect(x, y, 0.125, 0.165, 0.75, 0.64, 0.075)) rgb = [72, 112, 133];
    if (roundedRect(x, y, 0.14, 0.18, 0.72, 0.61, 0.06)) rgb = [12, 26, 40];
    if (y > 0.29 && y < 0.299 && x > 0.145 && x < 0.855) rgb = [38, 61, 78];
    const dots = [[0.215, [248, 116, 116]], [0.285, [247, 199, 107]], [0.355, [94, 214, 173]]];
    for (const [cx, fill] of dots) {
        if ((x - cx) ** 2 + (y - 0.24) ** 2 <= 0.017 ** 2) rgb = fill;
    }
    if (stroke(x, y, 0.285, 0.425, 0.39, 0.525, 0.045) || stroke(x, y, 0.39, 0.525, 0.285, 0.625, 0.045)) {
        rgb = [105, 239, 201];
    }
    if (stroke(x, y, 0.47, 0.625, 0.68, 0.625, 0.045)) rgb = [137, 205, 255];
    return rgb;
}

function chunk(type, contents) {
    const data = Buffer.concat([Buffer.from(type), contents]);
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(contents.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, data, checksum]);
}

module.exports = function terminalIcon(size) {
    const pixels = Buffer.alloc((size * 3 + 1) * size);
    const samples = 3;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const rgb = [0, 0, 0];
            for (let sy = 0; sy < samples; sy++) {
                for (let sx = 0; sx < samples; sx++) {
                    const fill = color((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size);
                    for (let channel = 0; channel < 3; channel++) rgb[channel] += fill[channel];
                }
            }
            const offset = y * (size * 3 + 1) + 1 + x * 3;
            for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(rgb[channel] / samples ** 2);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8; // 8-bit RGB, no interlacing.
    header[9] = 2;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(pixels, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
};
