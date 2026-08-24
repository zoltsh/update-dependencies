import type { ReleaseArtifact, ReleaseTarget } from '../types.js';

// Keep this version, source commit, URLs, and all four digests aligned with the
// immutable Zolt release channel used by submit-dependencies.
export const ZOLT_VERSION = '0.1.0-zap.20260824.dd9b14a2df1d';
export const ZOLT_SOURCE_COMMIT = 'dd9b14a2df1d8aebe044a205c258aab2ceedf9f6';
export const ZOLT_OUTDATED_SCHEMA_VERSION: 1 | 2 = 2;

const tag = `zolt-zap-${ZOLT_VERSION}`;
const base = `https://github.com/zoltsh/releases/releases/download/${tag}`;

export const ZOLT_RELEASE: Readonly<Record<ReleaseTarget, ReleaseArtifact>> = {
    'linux-arm64': artifact('linux-arm64', 'f07219c88466197cfebcd971db1fcebe4686c5d33c2be3a2f2b5b3ea5865fce1'),
    'linux-x64': artifact('linux-x64', '24fc6c3dd5c432c26168fdcd2e5892e4f15efe55aecf75eea9e9d7a1ebedb8dd'),
    'macos-arm64': artifact('macos-arm64', 'cebb38e5b58ddeea3db54d855fc43455ea9c1ff91c4ac1976961ba053555b532'),
    'macos-x64': artifact('macos-x64', 'eed40b183c18edbe7210a1e523ae3f6ddef718918355cf48329e59cc0fddbe02'),
};

function artifact(target: ReleaseTarget, sha256: string): ReleaseArtifact {
    const archive = `zolt-${ZOLT_VERSION}-${target}.tar.gz`;
    return { archive, archiveUrl: `${base}/${archive}`, sha256 };
}
