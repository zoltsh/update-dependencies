import { actionError } from '../errors.js';
import { isCanonicalDigestIdentifier } from '../identifiers.js';
import { canonicalRelativeFile, canonicalRelativeRoot, canonicalZoltManifestPath, joinRelativeRoot, } from '../paths.js';
import { managedTargetIdentity } from '../planner/identity.js';
const PREFIX = '<!-- zolt-update-dependencies:v1:';
const MARKER_PATTERN = /<!-- zolt-update-dependencies:v1:([A-Za-z0-9_-]+) -->/gu;
const FULL_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MAX_PAYLOAD_BYTES = 4096;
const EXPECTED_KEYS = [
    'baseSha',
    'lockfilePath',
    'managedHeadSha',
    'managedId',
    'manifestPath',
    'schemaVersion',
    'targetId',
    'targetVersion',
    'zoltRoot',
];
export function renderManagedMarker(marker) {
    const validated = validateMarker(marker);
    const payload = Buffer.from(JSON.stringify(validated), 'utf8').toString('base64url');
    return `${PREFIX}${payload} -->`;
}
export function parseManagedMarker(body) {
    const matches = [...body.matchAll(MARKER_PATTERN)];
    if (matches.length === 0) {
        return body.includes(PREFIX)
            ? invalid('The managed marker is malformed.')
            : Object.freeze({ kind: 'none' });
    }
    if (matches.length !== 1 || occurrences(body, PREFIX) !== 1) {
        return invalid('The pull request contains multiple or ambiguous managed markers.');
    }
    const payload = matches[0]?.[1];
    if (payload === undefined || payload.length > Math.ceil(MAX_PAYLOAD_BYTES * 4 / 3)) {
        return invalid('The managed marker payload is missing or oversized.');
    }
    try {
        const bytes = Buffer.from(payload, 'base64url');
        if (bytes.length === 0
            || bytes.length > MAX_PAYLOAD_BYTES
            || bytes.toString('base64url') !== payload) {
            return invalid('The managed marker payload is not canonical base64url.');
        }
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return Object.freeze({ kind: 'valid', marker: decodeMarkerObject(JSON.parse(source)) });
    }
    catch (error) {
        return invalid(error instanceof Error ? error.message : 'The managed marker could not be decoded.');
    }
}
function decodeMarkerObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw markerError('The managed marker payload must be an object.');
    }
    const object = value;
    const actualKeys = Object.keys(object).sort();
    const expectedKeys = [...EXPECTED_KEYS].sort();
    if (actualKeys.length !== expectedKeys.length
        || actualKeys.some((key, index) => key !== expectedKeys[index])) {
        throw markerError('The managed marker has unknown or missing fields.');
    }
    return validateMarker({
        baseSha: stringValue(object.baseSha, 'baseSha'),
        lockfilePath: stringValue(object.lockfilePath, 'lockfilePath'),
        managedHeadSha: stringValue(object.managedHeadSha, 'managedHeadSha'),
        managedId: stringValue(object.managedId, 'managedId'),
        manifestPath: stringValue(object.manifestPath, 'manifestPath'),
        schemaVersion: schemaVersion(object.schemaVersion),
        targetId: stringValue(object.targetId, 'targetId'),
        targetVersion: stringValue(object.targetVersion, 'targetVersion'),
        zoltRoot: stringValue(object.zoltRoot, 'zoltRoot'),
    });
}
function validateMarker(marker) {
    if (!isCanonicalDigestIdentifier(marker.managedId, 'zud1_')) {
        throw markerError('The managed marker has an invalid managedId.');
    }
    if (!isCanonicalDigestIdentifier(marker.targetId, 'zt1_')) {
        throw markerError('The managed marker has an invalid targetId.');
    }
    if (!FULL_SHA_PATTERN.test(marker.baseSha))
        throw markerError('The managed marker has an invalid baseSha.');
    if (!FULL_SHA_PATTERN.test(marker.managedHeadSha))
        throw markerError('The managed marker has an invalid managedHeadSha.');
    const zoltRoot = canonicalRelativeRoot(marker.zoltRoot, 'managed marker Zolt root');
    const manifestPath = canonicalZoltManifestPath(marker.manifestPath, 'managed marker manifest path');
    const lockfilePath = canonicalRelativeFile(marker.lockfilePath, 'managed marker lockfile path');
    if (!insideRoot(zoltRoot, manifestPath)
        || lockfilePath !== joinRelativeRoot(zoltRoot, 'zolt.lock', 'managed marker lockfile path')) {
        throw markerError('The managed marker manifest and lockfile must stay inside its Zolt root.');
    }
    if (managedTargetIdentity(zoltRoot, marker.targetId).managedId !== marker.managedId) {
        throw markerError('The managed marker identity does not match its Zolt root and targetId.');
    }
    if (marker.targetVersion.trim() === '' || marker.targetVersion !== marker.targetVersion.trim()) {
        throw markerError('The managed marker has an invalid targetVersion.');
    }
    return Object.freeze({
        baseSha: marker.baseSha,
        lockfilePath,
        managedHeadSha: marker.managedHeadSha,
        managedId: marker.managedId,
        manifestPath,
        schemaVersion: 1,
        targetId: marker.targetId,
        targetVersion: marker.targetVersion,
        zoltRoot,
    });
}
function insideRoot(root, path) {
    return root === '.' || path.startsWith(`${root}/`);
}
function stringValue(value, field) {
    if (typeof value !== 'string' || value === '' || value.length > 4096 || /[\u0000-\u001F\u007F]/u.test(value)) {
        throw markerError(`The managed marker has an invalid ${field}.`);
    }
    return value;
}
function schemaVersion(value) {
    if (value !== 1)
        throw markerError('The managed marker schema is unsupported.');
    return 1;
}
function occurrences(source, token) {
    let count = 0;
    let offset = 0;
    while (true) {
        const next = source.indexOf(token, offset);
        if (next < 0)
            return count;
        count += 1;
        offset = next + token.length;
    }
}
function invalid(reason) {
    return Object.freeze({ kind: 'invalid', reason });
}
function markerError(message) {
    return actionError('ZOLT-MARKER-001', message);
}
