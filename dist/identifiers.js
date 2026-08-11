const DIGEST_PAYLOAD = /^[A-Za-z0-9_-]{43}$/u;
export function isCanonicalDigestIdentifier(value, prefix) {
    if (!value.startsWith(prefix))
        return false;
    const payload = value.slice(prefix.length);
    if (!DIGEST_PAYLOAD.test(payload))
        return false;
    const bytes = Buffer.from(payload, 'base64url');
    return bytes.length === 32 && bytes.toString('base64url') === payload;
}
