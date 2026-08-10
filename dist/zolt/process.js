import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_MACHINE_OUTPUT_BYTES, ZOLT_COMMAND_TIMEOUT_MS } from '../constants.js';
import { actionError } from '../errors.js';
const BASELINE_ENVIRONMENT = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'LANG',
    'LC_ALL',
    'NO_PROXY',
    'PATH',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'TEMP',
    'TMP',
    'TMPDIR',
    'http_proxy',
    'https_proxy',
    'no_proxy',
];
const DENIED_CREDENTIAL_NAMES = new Set([
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    'ACTIONS_ID_TOKEN_REQUEST_URL',
    'ACTIONS_RUNTIME_TOKEN',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'INPUT_GITHUB-TOKEN',
    'INPUT_GITHUB_TOKEN',
]);
export async function createZoltEnvironment(source, selectedNames, githubToken, registerSecret) {
    const temporaryBase = source.RUNNER_TEMP ?? tmpdir();
    await mkdir(temporaryBase, { mode: 0o700, recursive: true });
    const root = await mkdtemp(join(temporaryBase, 'zolt-update-home-'));
    const environment = Object.fromEntries(Object.entries(minimalZoltEnvironment(source))
        .filter(([, value]) => githubToken === '' || value?.includes(githubToken) !== true));
    environment.ZOLT_USER_HOME = root;
    environment.NO_COLOR = '1';
    try {
        for (const name of selectedNames) {
            if (DENIED_CREDENTIAL_NAMES.has(name) || /^ACTIONS_.*(?:TOKEN|URL)$/u.test(name) || /^(?:GH|GITHUB)_.*(?:PAT|TOKEN)$/u.test(name)) {
                throw actionError('ZOLT-CREDENTIAL-003', `registry-env cannot pass GitHub credential channel ${name}.`);
            }
            const value = source[name];
            if (value === undefined || value === '') {
                throw actionError('ZOLT-CREDENTIAL-001', `registry-env selected ${name}, but it is not set.`);
            }
            if (githubToken !== '' && value.includes(githubToken)) {
                throw actionError('ZOLT-CREDENTIAL-002', `${name} contains the GitHub pull request token and cannot be passed to Zolt.`);
            }
            registerSecret(value);
            environment[name] = value;
        }
    }
    catch (error) {
        await rm(root, { force: true, recursive: true });
        throw error;
    }
    return {
        cleanup: async () => rm(root, { force: true, recursive: true }),
        environment,
    };
}
export function selectedCredentialValues(source, selectedNames) {
    return selectedNames.flatMap((name) => {
        const value = source[name];
        return value === undefined || value === '' ? [] : [value];
    });
}
export function minimalZoltEnvironment(source) {
    const result = {};
    for (const name of BASELINE_ENVIRONMENT) {
        const value = source[name];
        if (value !== undefined)
            result[name] = value;
    }
    if (source.SystemRoot !== undefined)
        result.SystemRoot = source.SystemRoot;
    return result;
}
export async function runZolt(binary, arguments_, cwd, environment, timeout = ZOLT_COMMAND_TIMEOUT_MS) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(binary, [...arguments_], {
            cwd,
            env: environment,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const stdout = [];
        const stderr = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            finish(actionError('ZOLT-COMMAND-003', 'Zolt exceeded the command timeout.'));
        }, timeout);
        child.stdout.on('data', (chunk) => {
            stdoutBytes += chunk.length;
            if (stdoutBytes > MAX_MACHINE_OUTPUT_BYTES) {
                child.kill('SIGKILL');
                finish(actionError('ZOLT-COMMAND-004', 'Zolt stdout exceeded the machine-output limit.'));
                return;
            }
            stdout.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderrBytes += chunk.length;
            if (stderrBytes > MAX_MACHINE_OUTPUT_BYTES) {
                child.kill('SIGKILL');
                finish(actionError('ZOLT-COMMAND-005', 'Zolt stderr exceeded the machine-output limit.'));
                return;
            }
            stderr.push(chunk);
        });
        child.once('error', (error) => finish(actionError('ZOLT-COMMAND-001', 'Could not execute the verified Zolt binary.', error)));
        child.once('exit', (code, signal) => {
            if (settled)
                return;
            let output;
            try {
                output = {
                    stderr: decode(Buffer.concat(stderr, stderrBytes), 'Zolt stderr'),
                    stdout: decode(Buffer.concat(stdout, stdoutBytes), 'Zolt stdout'),
                };
            }
            catch (error) {
                finish(error);
                return;
            }
            if (code === 0) {
                finish(undefined, output);
                return;
            }
            const detail = output.stderr.trim() || output.stdout.trim();
            finish(actionError('ZOLT-COMMAND-002', detail === '' ? `Zolt exited with ${code?.toString() ?? signal ?? 'an unknown status'}.` : detail));
        });
        function finish(error, result) {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (error !== undefined)
                reject(error);
            else
                resolvePromise(result);
        }
    });
}
function decode(value, label) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(value);
    }
    catch (error) {
        throw actionError('ZOLT-COMMAND-006', `${label} was not valid UTF-8.`, error);
    }
}
