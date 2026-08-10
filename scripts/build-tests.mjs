import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { run, tscCommand } from './tooling.mjs';

const root = resolve(import.meta.dirname, '..');
await rm(resolve(root, 'dist-test'), { force: true, recursive: true });
await run(tscCommand(), ['-p', 'tsconfig.test.json'], { cwd: root });
