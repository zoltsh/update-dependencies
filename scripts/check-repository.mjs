import { access, readFile, readdir, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const action = await readFile(resolve(root, 'action.yml'), 'utf8');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const releaseMetadata = await readFile(resolve(root, 'src/generated/zolt-release.ts'), 'utf8');
const sourceContract = await readFile(resolve(root, 'src/generated/zolt-source-contract.ts'), 'utf8');

requireText(action, 'using: node24', 'action.yml must use Node 24.');
requireText(action, 'main: dist/index.js', 'action.yml must execute the committed dist/index.js.');
requireText(action, 'default: "true"', 'Planning must remain the default Action mode.');
for (const output of [
    'planned-update-count',
    'deferred-update-count',
    'blocked-update-count',
    'created-pull-request-count',
    'updated-pull-request-count',
    'closed-pull-request-count',
    'plan',
    'zolt-version',
]) {
    requireText(action, `  ${output}:`, `action.yml is missing output ${output}.`);
}

if (packageJson.name !== 'update-dependencies') throw new Error('Package name does not match the repository.');
if (packageJson.version !== '0.0.0') throw new Error('The private Action package version must remain 0.0.0.');
if (packageJson.private !== true) throw new Error('The Action package must remain private.');
if (packageJson.type !== 'module') throw new Error('The committed runtime must remain ESM.');
if (packageJson.engines?.node !== '>=24') throw new Error('package.json must require Node 24 or newer.');
if (packageJson.dependencies !== undefined && Object.keys(packageJson.dependencies).length !== 0) {
    throw new Error('The Action runtime must not have npm dependencies.');
}
for (const script of ['preinstall', 'install', 'postinstall', 'prepare']) {
    if (packageJson.scripts?.[script] !== undefined) throw new Error(`Forbidden lifecycle script ${script}.`);
}
if (packageJson.scripts?.['pinned-zolt:check'] !== 'node scripts/check-pinned-zolt.mjs') {
    throw new Error('package.json must expose the pinned Zolt contract check.');
}
if (packageJson.scripts?.actionlint !== 'actionlint') {
    throw new Error('package.json must expose actionlint.');
}
if (!packageJson.scripts?.check?.includes('npm run actionlint')) {
    throw new Error('The canonical package check must run actionlint.');
}
if (packageLock.name !== packageJson.name || packageLock.version !== packageJson.version) {
    throw new Error('package-lock.json root identity does not match package.json.');
}
if (packageLock.lockfileVersion !== 3) throw new Error('package-lock.json must use lockfile version 3.');


const contractCommit = sourceContract.match(/[0-9a-f]{40}/u)?.[0];
if (contractCommit === undefined) throw new Error('Zolt source-contract commit is missing or malformed.');
const releaseCommit = releaseMetadata.match(/ZOLT_SOURCE_COMMIT = '([0-9a-f]{40})'/u)?.[1];
const releaseVersion = releaseMetadata.match(/ZOLT_VERSION = '([^']+)'/u)?.[1];
if (releaseCommit === undefined || releaseVersion === undefined) {
    throw new Error('Pinned Zolt release identity is missing or malformed.');
}
if (releaseCommit !== contractCommit || !releaseVersion.endsWith(releaseCommit.slice(0, 12))) {
    throw new Error('Pinned Zolt release identity does not match the reviewed source contract.');
}
requireText(
    releaseMetadata,
    'ZOLT_OUTDATED_SCHEMA_VERSION: 1 | 2 = 2',
    'The pinned exact-target release must select outdated schema v2.',
);
const releaseTargets = [...releaseMetadata.matchAll(/^\s+'(?:linux|macos)-(?:arm64|x64)': artifact\(/gmu)];
const releaseDigests = [...releaseMetadata.matchAll(/artifact\('[^']+', '([0-9a-f]{64})'\)/gu)];
if (releaseTargets.length !== 4 || releaseDigests.length !== 4) {
    throw new Error('Pinned Zolt release metadata must contain four platform digests.');
}
const ciWorkflow = await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8');
requireText(ciWorkflow, `ref: ${contractCommit}`, 'CI Zolt checkout does not match the source-contract commit.');
requireText(
    ciWorkflow,
    `ZOLT_LIVE_SOURCE_COMMIT: ${contractCommit}`,
    'CI live-contract environment does not match the source-contract commit.',
);
requireText(
    ciWorkflow,
    'run: npm run pinned-zolt:check',
    'CI does not verify the pinned Zolt schema-v2 contract.',
);

await access(resolve(root, 'dist/index.js'));
await access(resolve(root, 'dist/licenses.txt'));
await access(resolve(root, '.github/CODEOWNERS'));
await access(resolve(root, '.github/pull_request_template.md'));
await access(resolve(root, '.github/workflows/codeql.yml'));
const publicationCanary = await readFile(
    resolve(root, '.github/workflows/publication-canary.yml'),
    'utf8',
);
requireText(publicationCanary, 'dry-run: false', 'The live publication canary must exercise write mode.');
requireText(
    publicationCanary,
    'test/fixtures/publication-canary',
    'The live publication canary must use the committed fixture.',
);
await access(resolve(root, 'test/fixtures/publication-canary/zolt.toml'));
await access(resolve(root, 'test/fixtures/publication-canary/zolt.lock'));
const checkMode = (await stat(resolve(root, 'scripts/check'))).mode;
if ((checkMode & 0o111) === 0) throw new Error('scripts/check must be executable.');

for (const workflow of await workflowFiles(resolve(root, '.github', 'workflows'))) {
    const source = await readFile(workflow, 'utf8');
    for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)) {
        const reference = match[1];
        if (reference === undefined || reference.startsWith('./')) continue;
        if (!/@[0-9a-f]{40}$/u.test(reference)) {
            throw new Error(`${workflow} contains an Action that is not pinned to a full commit SHA: ${reference}.`);
        }
    }
}

function requireText(source, expected, message) {
    if (!source.includes(expected)) throw new Error(message);
}

async function workflowFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && ['.yml', '.yaml'].includes(extname(entry.name)))
        .map((entry) => resolve(directory, entry.name));
}
