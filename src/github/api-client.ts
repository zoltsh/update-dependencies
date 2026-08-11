import { actionError, UpdateDependenciesError } from '../errors.js';

const DEFAULT_API_URL = 'https://api.github.com';
const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const API_VERSION = '2026-03-10';

export type GitHubHttpMethod = 'GET' | 'PATCH' | 'POST';

export interface GitHubJsonRequest {
    readonly body?: unknown;
    readonly method: GitHubHttpMethod;
    readonly path: string;
}

export interface GitHubJsonResponse {
    readonly status: number;
    readonly value: unknown;
}

export type GitHubRequester = (
    request: GitHubJsonRequest,
) => Promise<GitHubJsonResponse>;

export interface GitHubRequesterDependencies {
    readonly apiUrl?: string;
    readonly fetcher?: typeof fetch;
    readonly timeoutMilliseconds?: number;
}

export function createGitHubRequester(
    token: string,
    dependencies: GitHubRequesterDependencies = {},
): GitHubRequester {
    requireToken(token);
    const apiUrl = canonicalApiUrl(dependencies.apiUrl ?? DEFAULT_API_URL);
    const fetcher = dependencies.fetcher ?? fetch;
    const timeoutMilliseconds = dependencies.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
        throw githubApiError('The GitHub API timeout must be a positive integer.');
    }

    return async (request) => {
        const path = canonicalRequestPath(request.path);
        const body = request.body === undefined ? undefined : encodeRequestBody(request.body);
        let response: Response;
        try {
            response = await fetcher(`${apiUrl}${path}`, {
                ...(body === undefined ? {} : { body }),
                headers: {
                    accept: 'application/vnd.github+json',
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/json',
                    'user-agent': 'zoltsh/update-dependencies',
                    'x-github-api-version': API_VERSION,
                },
                method: request.method,
                redirect: 'error',
                signal: AbortSignal.timeout(timeoutMilliseconds),
            });
        } catch (error) {
            throw githubApiError('The GitHub API request failed before a response was received.', error);
        }

        const source = await readBoundedBody(response);
        if (source === '') {
            return Object.freeze({ status: response.status, value: null });
        }
        try {
            return Object.freeze({ status: response.status, value: JSON.parse(source) as unknown });
        } catch (error) {
            throw githubApiError('The GitHub API returned malformed JSON.', error);
        }
    };
}

function requireToken(token: string): void {
    if (
        token.trim() === ''
        || token !== token.trim()
        || token.length > 4096
        || /\s/u.test(token)
        || /[\u0000-\u001f\u007f]/u.test(token)
    ) {
        throw githubApiError('A non-empty, bounded GitHub token without whitespace or control characters is required.');
    }
}

function encodeRequestBody(value: unknown): string {
    try {
        const encoded = JSON.stringify(value);
        if (encoded === undefined) throw new TypeError('JSON.stringify returned undefined.');
        return encoded;
    } catch (error) {
        throw githubApiError('The GitHub API request body is not JSON-serializable.', error);
    }
}

async function readBoundedBody(response: Response): Promise<string> {
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
        throw githubApiError('The GitHub API returned an invalid or excessive Content-Length header.');
    }
    if (response.body === null) return '';

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.length;
            if (bytes > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw githubApiError('The GitHub API response exceeded the configured size limit.');
            }
            chunks.push(next.value);
        }
    } catch (error) {
        if (error instanceof UpdateDependenciesError) throw error;
        throw githubApiError('The GitHub API response could not be read.', error);
    }

    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(combined);
    } catch (error) {
        throw githubApiError('The GitHub API response was not valid UTF-8.', error);
    }
}

function canonicalApiUrl(value: string): string {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch (error) {
        throw githubApiError('The GitHub API URL is invalid.', error);
    }
    if (
        parsed.protocol !== 'https:'
        || parsed.username !== ''
        || parsed.password !== ''
        || parsed.search !== ''
        || parsed.hash !== ''
        || parsed.pathname !== '/'
        || parsed.origin !== DEFAULT_API_URL
    ) {
        throw githubApiError('Only the GitHub.com API origin is supported.');
    }
    return parsed.origin;
}

function canonicalRequestPath(value: string): string {
    if (
        !value.startsWith('/')
        || value.startsWith('//')
        || value.length > 8192
        || /[\u0000-\u001f\u007f]/u.test(value)
        || value.includes('://')
        || value.includes('\\')
        || value.includes('#')
        || value.includes(' ')
    ) {
        throw githubApiError('The GitHub API request path is invalid.');
    }
    return value;
}

function githubApiError(message: string, cause?: unknown): ReturnType<typeof actionError> {
    return actionError('ZOLT-GITHUB-API-001', message, cause);
}
