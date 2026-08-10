import { gzipSync } from 'node:zlib';

export interface TarFixtureEntry {
    readonly content?: Buffer;
    readonly mode?: number;
    readonly path: string;
    readonly type?: 'directory' | 'file' | 'symlink';
}

export function tarGz(entries: readonly TarFixtureEntry[]): Buffer {
    const blocks: Buffer[] = [];
    for (const entry of entries) {
        const type = entry.type ?? 'file';
        const content = entry.content ?? Buffer.alloc(0);
        const header = Buffer.alloc(512);
        writeText(header, 0, 100, entry.path);
        writeOctal(header, 100, 8, entry.mode ?? (type === 'directory' ? 0o755 : 0o644));
        writeOctal(header, 108, 8, 0);
        writeOctal(header, 116, 8, 0);
        writeOctal(header, 124, 12, type === 'file' ? content.length : 0);
        writeOctal(header, 136, 12, 0);
        header.fill(0x20, 148, 156);
        header[156] = type === 'file' ? 48 : type === 'directory' ? 53 : 50;
        writeText(header, 257, 6, 'ustar');
        writeText(header, 263, 2, '00');
        const checksum = header.reduce((sum, value) => sum + value, 0);
        const rendered = checksum.toString(8).padStart(6, '0');
        header.write(rendered, 148, 6, 'ascii');
        header[154] = 0;
        header[155] = 0x20;
        blocks.push(header);
        if (type === 'file') {
            blocks.push(content);
            const padding = (512 - content.length % 512) % 512;
            if (padding !== 0) blocks.push(Buffer.alloc(padding));
        }
    }
    blocks.push(Buffer.alloc(1024));
    return gzipSync(Buffer.concat(blocks));
}

function writeText(target: Buffer, offset: number, length: number, value: string): void {
    const encoded = Buffer.from(value, 'utf8');
    if (encoded.length > length) throw new Error(`Tar fixture field is too long: ${value}`);
    encoded.copy(target, offset);
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
    const rendered = value.toString(8).padStart(length - 1, '0');
    target.write(rendered, offset, length - 1, 'ascii');
    target[offset + length - 1] = 0;
}
