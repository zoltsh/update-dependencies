import { randomBytes } from 'node:crypto';
import { appendFile, lstat } from 'node:fs/promises';
import { MAX_ACTION_OUTPUT_BYTES } from '../constants.js';
import { actionError } from '../errors.js';
export class GitHubActionCore {
    environment;
    constructor(environment = process.env) {
        this.environment = environment;
    }
    getInput(name) {
        return this.environment[inputKey(name)]?.trim() ?? '';
    }
    info(message) {
        console.log(message);
    }
    setFailed(message) {
        const text = message instanceof Error ? message.message : message;
        console.error(`::error::${escapeCommand(text)}`);
        process.exitCode = 1;
    }
    async setOutput(name, value) {
        const path = this.environment.GITHUB_OUTPUT;
        const rendered = typeof value === 'string' ? value : JSON.stringify(value);
        if (Buffer.byteLength(rendered, 'utf8') > MAX_ACTION_OUTPUT_BYTES) {
            throw actionError('ZOLT-OUTPUT-002', `${name} exceeds the Action output byte limit.`);
        }
        if (path === undefined || path === '') {
            console.log(`${name}=${rendered}`);
            return;
        }
        await requireRunnerFile(path, 'GITHUB_OUTPUT');
        const delimiter = `zolt_${randomBytes(16).toString('hex')}`;
        await appendFile(path, `${name}<<${delimiter}\n${rendered}\n${delimiter}\n`, 'utf8');
    }
    setSecret(secret) {
        if (secret !== '')
            console.log(`::add-mask::${escapeCommand(secret)}`);
    }
    async writeSummary(markdown) {
        const path = this.environment.GITHUB_STEP_SUMMARY;
        if (path === undefined || path === '') {
            console.log(markdown);
            return;
        }
        await requireRunnerFile(path, 'GITHUB_STEP_SUMMARY');
        await appendFile(path, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
    }
}
function inputKey(name) {
    return `INPUT_${name.replaceAll(' ', '_').toUpperCase()}`;
}
function escapeCommand(value) {
    return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}
async function requireRunnerFile(path, name) {
    try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink())
            throw new Error('not a regular file');
    }
    catch (error) {
        throw actionError('ZOLT-OUTPUT-001', `${name} is not a regular runner file.`, error);
    }
}
