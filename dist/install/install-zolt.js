import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { actionError } from '../errors.js';
import { ZOLT_RELEASE, ZOLT_VERSION } from '../generated/zolt-release.js';
import { extractArchive, inspectArchive } from './archive.js';
import { downloadArchive } from './download.js';
import { verifyZoltVersion } from './verify.js';
export async function installZolt(target, dependencies = {}) {
    const release = ZOLT_RELEASE[target];
    const expectedArchive = `zolt-${ZOLT_VERSION}-${target}.tar.gz`;
    const expectedUrl = `https://github.com/zoltsh/releases/releases/download/zolt-zap-${ZOLT_VERSION}/${expectedArchive}`;
    if (release.archive !== expectedArchive || release.archiveUrl !== expectedUrl || !/^[0-9a-f]{64}$/u.test(release.sha256)) {
        throw actionError('ZOLT-INSTALL-013', `Embedded release metadata for ${target} is invalid.`);
    }
    const environment = dependencies.environment ?? process.env;
    const temporaryBase = dependencies.temporaryRoot ?? environment.RUNNER_TEMP ?? tmpdir();
    await mkdir(temporaryBase, { mode: 0o700, recursive: true });
    const work = await mkdtemp(join(temporaryBase, 'zolt-update-install-'));
    let retained = false;
    try {
        const archive = resolve(work, release.archive);
        const download = await downloadArchive(new URL(release.archiveUrl), archive, dependencies.fetcher);
        if (download.sha256 !== release.sha256) {
            throw actionError('ZOLT-INSTALL-006', `Downloaded Zolt archive failed SHA-256 verification. Expected ${release.sha256}; actual ${download.sha256}.`);
        }
        const expectedRoot = release.archive.slice(0, -'.tar.gz'.length);
        await inspectArchive(archive, expectedRoot);
        const binary = await extractArchive(archive, resolve(work, 'extract'), expectedRoot);
        await (dependencies.verifyVersion ?? verifyZoltVersion)(binary, ZOLT_VERSION, environment);
        retained = true;
        return {
            binary,
            cleanup: async () => rm(work, { force: true, recursive: true }),
            sha256: release.sha256,
            target,
            version: ZOLT_VERSION,
        };
    }
    finally {
        if (!retained)
            await rm(work, { force: true, recursive: true });
    }
}
