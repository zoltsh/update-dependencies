import { spawn } from 'node:child_process';

import { actionError } from './errors.js';

export interface ExecTextOptions {
    readonly cwd?: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly label: string;
    readonly maxBuffer: number;
    readonly timeout?: number;
}

export interface ExecTextResult {
    readonly stderr: string;
    readonly stdout: string;
}

export async function execText(
    command: string,
    arguments_: readonly string[],
    options: ExecTextOptions,
): Promise<ExecTextResult> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, [...arguments_], {
            cwd: options.cwd,
            env: options.environment,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        const timeout = options.timeout ?? 60_000;
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            finish(actionError('ZOLT-PROCESS-003', `${options.label} exceeded its timeout.`));
        }, timeout);

        child.stdout.on('data', (value: Buffer) => {
            stdoutBytes += value.length;
            if (stdoutBytes > options.maxBuffer) {
                child.kill('SIGKILL');
                finish(actionError('ZOLT-PROCESS-004', `${options.label} stdout exceeded its safety limit.`));
                return;
            }
            stdout.push(value);
        });
        child.stderr.on('data', (value: Buffer) => {
            stderrBytes += value.length;
            if (stderrBytes > options.maxBuffer) {
                child.kill('SIGKILL');
                finish(actionError('ZOLT-PROCESS-005', `${options.label} stderr exceeded its safety limit.`));
                return;
            }
            stderr.push(value);
        });
        child.once('error', (error) => finish(actionError('ZOLT-PROCESS-001', `Could not start ${options.label}.`, error)));
        child.once('close', (code, signal) => {
            let output: ExecTextResult;
            try {
                output = {
                    stderr: decode(Buffer.concat(stderr, stderrBytes), `${options.label} stderr`),
                    stdout: decode(Buffer.concat(stdout, stdoutBytes), `${options.label} stdout`),
                };
            } catch (error) {
                finish(error as Error);
                return;
            }
            if (code === 0) {
                finish(undefined, output);
                return;
            }
            const detail = output.stderr.trim() || output.stdout.trim();
            finish(actionError(
                'ZOLT-PROCESS-002',
                detail === ''
                    ? `${options.label} exited with ${code?.toString() ?? signal ?? 'an unknown status'}.`
                    : `${options.label} failed: ${detail}`,
            ));
        });

        function finish(error?: Error, result?: ExecTextResult): void {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error === undefined) resolvePromise(result as ExecTextResult);
            else rejectPromise(error);
        }
    });
}

function decode(value: Buffer, label: string): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(value);
    } catch (error) {
        throw actionError('ZOLT-PROCESS-006', `${label} was not valid UTF-8.`, error);
    }
}
