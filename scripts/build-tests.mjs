import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runTsc } from './tooling.mjs';

const root = resolve(import.meta.dirname, '..');
await rm(resolve(root, 'dist-test'), { force: true, recursive: true });
await runTsc(['-p', 'tsconfig.test.json'], { cwd: root });
