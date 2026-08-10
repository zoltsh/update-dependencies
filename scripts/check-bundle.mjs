import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { run, tscCommand } from './tooling.mjs';

const root = resolve(import.meta.dirname, '..');
const expected = resolve(root, 'dist');
const temporary = await mkdtemp(join(tmpdir(), 'zolt-update-bundle-'));
try {
    await run(tscCommand(), ['-p', 'tsconfig.build.json', '--outDir', temporary], { cwd: root });
    const differences = await compareTrees(expected, temporary);
    if (differences.length !== 0) {
        throw new Error(`Committed dist/ is stale:\n${differences.map((value) => `- ${value}`).join('\n')}`);
    }
} finally {
    await rm(temporary, { force: true, recursive: true });
}

async function compareTrees(leftRoot, rightRoot) {
    const leftFiles = await files(leftRoot);
    const rightFiles = await files(rightRoot);
    const paths = new Set([...leftFiles, ...rightFiles].filter((path) => path !== 'licenses.txt'));
    const differences = [];
    for (const path of [...paths].sort()) {
        if (!leftFiles.has(path)) {
            differences.push(`dist/${path} is missing`);
            continue;
        }
        if (!rightFiles.has(path)) {
            differences.push(`dist/${path} is unexpected`);
            continue;
        }
        const [left, right] = await Promise.all([
            readFile(resolve(leftRoot, path)),
            readFile(resolve(rightRoot, path)),
        ]);
        if (!left.equals(right)) differences.push(`dist/${path} differs from source`);
    }
    return differences;
}

async function files(rootDirectory) {
    const result = new Set();
    await visit(rootDirectory);
    return result;

    async function visit(directory) {
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(path);
                continue;
            }
            if ((await stat(path)).isFile()) result.add(relative(rootDirectory, path).split('\\').join('/'));
        }
    }
}
