import type { ReleaseArtifact, ReleaseTarget } from '../types.js';

// Keep this version, source commit, URLs, and all four digests aligned with the
// immutable Zolt release channel used by submit-dependencies.
export const ZOLT_VERSION = '0.1.0-zap.20260810.ae6532ef804c';
export const ZOLT_SOURCE_COMMIT = 'ae6532ef804c6347c6b1e72742216b9443c6c288';
export const ZOLT_OUTDATED_SCHEMA_VERSION: 1 | 2 = 2;

const tag = `zolt-zap-${ZOLT_VERSION}`;
const base = `https://github.com/zoltsh/releases/releases/download/${tag}`;

export const ZOLT_RELEASE: Readonly<Record<ReleaseTarget, ReleaseArtifact>> = {
    'linux-arm64': artifact('linux-arm64', 'c41d3428ca72b5ec84d0262e978b63e084589d6a36d6ab2c77d72434e504eb53'),
    'linux-x64': artifact('linux-x64', '12d81979fc8e24647fbe96c5318a86a766aa66aa21a0b4df945227951737043b'),
    'macos-arm64': artifact('macos-arm64', 'afd72127e70425986f5bc746b4f0b22207f76cde1f48d86d18e6a62c933d2dfe'),
    'macos-x64': artifact('macos-x64', '9767dcfa999b9a1da379c846c85d6a6ac2c4a387b41456d51d6888798d201d66'),
};

function artifact(target: ReleaseTarget, sha256: string): ReleaseArtifact {
    const archive = `zolt-${ZOLT_VERSION}-${target}.tar.gz`;
    return { archive, archiveUrl: `${base}/${archive}`, sha256 };
}
