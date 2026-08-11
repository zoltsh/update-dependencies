const DIGEST_PAYLOAD = /^[A-Za-z0-9_-]{43}$/u;

export type DigestIdentifierPrefix = 'zt1_' | 'zud1_';

export function isCanonicalDigestIdentifier(
    value: string,
    prefix: DigestIdentifierPrefix,
): boolean {
    if (!value.startsWith(prefix)) return false;
    const payload = value.slice(prefix.length);
    if (!DIGEST_PAYLOAD.test(payload)) return false;
    const bytes = Buffer.from(payload, 'base64url');
    return bytes.length === 32 && bytes.toString('base64url') === payload;
}
