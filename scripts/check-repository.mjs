import { access, readFile, readdir, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const action = await readFile(resolve(root, 'action.yml'), 'utf8');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));

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
    throw new Error('The first implementation batch must not have runtime npm dependencies.');
}
for (const script of ['preinstall', 'install', 'postinstall', 'prepare']) {
    if (packageJson.scripts?.[script] !== undefined) throw new Error(`Forbidden lifecycle script ${script}.`);
}
if (packageLock.name !== packageJson.name || packageLock.version !== packageJson.version) {
    throw new Error('package-lock.json root identity does not match package.json.');
}
if (packageLock.lockfileVersion !== 3) throw new Error('package-lock.json must use lockfile version 3.');

await access(resolve(root, 'dist/index.js'));
await access(resolve(root, 'dist/licenses.txt'));
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
