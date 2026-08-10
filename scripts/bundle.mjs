import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { run, tscCommand } from './tooling.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');
await rm(output, { force: true, recursive: true });
await run(tscCommand(), ['-p', 'tsconfig.build.json'], { cwd: root });
await mkdir(output, { recursive: true });
await writeFile(
    resolve(output, 'licenses.txt'),
    'update-dependencies\nMIT License\nCopyright (c) 2026 zoltsh\n',
    'utf8',
);
