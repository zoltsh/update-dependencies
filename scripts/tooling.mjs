import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const typescript = resolve(import.meta.dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc');

export async function run(command, arguments_, options = {}) {
    await new Promise((resolve, reject) => {
        const child = spawn(command, arguments_, {
            cwd: options.cwd ?? process.cwd(),
            env: options.env ?? process.env,
            stdio: options.stdio ?? 'inherit',
            windowsHide: true,
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown status'}.`));
        });
    });
}

export async function runTsc(arguments_, options = {}) {
    await run(process.execPath, [typescript, ...arguments_], options);
}
