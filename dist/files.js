import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
export class BoundedFileError extends Error {
    failure;
    constructor(failure) {
        super(`Bounded file read failed: ${failure}.`);
        this.failure = failure;
    }
}
export async function readBoundedRegularFile(path, maximumBytes) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
        throw new RangeError('maximumBytes must be a non-negative safe integer.');
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await handle.stat();
        if (!before.isFile())
            throw new BoundedFileError('not-regular');
        if (before.size > maximumBytes)
            throw new BoundedFileError('too-large');
        const content = await readAtMost(handle, maximumBytes);
        const after = await handle.stat();
        if (!sameFileSnapshot(before, after))
            throw new BoundedFileError('changed');
        return Object.freeze({ content, mode: before.mode });
    }
    finally {
        await handle.close();
    }
}
async function readAtMost(handle, maximumBytes) {
    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0)
            break;
        offset += bytesRead;
    }
    if (offset > maximumBytes)
        throw new BoundedFileError('too-large');
    return Buffer.from(buffer.subarray(0, offset));
}
function sameFileSnapshot(before, after) {
    return before.dev === after.dev
        && before.ino === after.ino
        && before.mode === after.mode
        && before.size === after.size
        && before.ctimeMs === after.ctimeMs
        && before.mtimeMs === after.mtimeMs;
}
