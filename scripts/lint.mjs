import { readFile, readdir } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const checkedExtensions = new Set(['.json', '.md', '.mjs', '.sh', '.ts', '.yml', '.yaml']);
const ignoredRoots = new Set(['.git', 'dist', 'dist-test', 'node_modules']);
const forbidden = [
    ['shell: true', /shell\s*:\s*true/u],
    ['child_process.exec', /(?<![.\w])exec(?:Sync)?\s*\(/u],
    ['eval', /\beval\s*\(/u],
    ['new Function', /new\s+Function\s*\(/u],
];
const failures = [];
await visit(root);
if (failures.length !== 0) throw new Error(`Repository lint failed:\n${failures.map((value) => `- ${value}`).join('\n')}`);

async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredRoots.has(entry.name)) continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            await visit(path);
            continue;
        }
        if (!checkedExtensions.has(extname(entry.name)) && entry.name !== 'LICENSE') continue;
        const display = relative(root, path).split('\\').join('/');
        const source = await readFile(path, 'utf8');
        if (!source.endsWith('\n')) failures.push(`${display} has no final newline`);
        source.split('\n').forEach((line, index) => {
            if (/\s$/u.test(line)) failures.push(`${display}:${(index + 1).toString()} has trailing whitespace`);
            if (line.includes('\t')) failures.push(`${display}:${(index + 1).toString()} contains a tab`);
        });
        if ((extname(entry.name) === '.ts' || extname(entry.name) === '.mjs') && display !== 'scripts/lint.mjs') {
            for (const [label, pattern] of forbidden) {
                if (pattern.test(source)) failures.push(`${display} uses forbidden ${label}`);
            }
        }
    }
}
