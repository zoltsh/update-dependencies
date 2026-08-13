import type { ReleaseArtifact, ReleaseTarget } from '../types.js';

// Keep this version, source commit, URLs, and all four digests aligned with the
// immutable Zolt release channel used by submit-dependencies.
export const ZOLT_VERSION = '0.1.0-zap.20260813.486974e1a11b';
export const ZOLT_SOURCE_COMMIT = '486974e1a11b39d2bea5cb0a3621befa4ebfd160';
export const ZOLT_OUTDATED_SCHEMA_VERSION: 1 | 2 = 2;

const tag = `zolt-zap-${ZOLT_VERSION}`;
const base = `https://github.com/zoltsh/releases/releases/download/${tag}`;

export const ZOLT_RELEASE: Readonly<Record<ReleaseTarget, ReleaseArtifact>> = {
    'linux-arm64': artifact('linux-arm64', '4e8b7f380f0191128fd284aebb9715604f611deab20061412227dbce5cc2339f'),
    'linux-x64': artifact('linux-x64', '905f1046e60b63f674e9ca7e9912f3c47136a313dff3b1df58fe4461fe30f9d3'),
    'macos-arm64': artifact('macos-arm64', '2d3921173cb6262f156e1a0a1e758ac1fe322425415b1e93796b15e1a36188ed'),
    'macos-x64': artifact('macos-x64', '38011ee0dd7eda2cbbb1d23821ec4352c9dd02555532dc14e5c70bba8dd74cdd'),
};

function artifact(target: ReleaseTarget, sha256: string): ReleaseArtifact {
    const archive = `zolt-${ZOLT_VERSION}-${target}.tar.gz`;
    return { archive, archiveUrl: `${base}/${archive}`, sha256 };
}
