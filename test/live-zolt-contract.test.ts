import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';

import { createRepositoryView } from '../src/environment/repository-state.js';
import { ZOLT_EXACT_TARGET_CONTRACT_COMMIT } from '../src/generated/zolt-source-contract.js';
import { planUpdates } from '../src/planner/plan.js';
import { prepareExactUpdateArtifact } from '../src/update/executor.js';
import { captureOutdated } from '../src/zolt/commands.js';
import { createZoltEnvironment } from '../src/zolt/process.js';
import { decodeOutdatedReportV2 } from '../src/zolt/contracts-v2.js';
import { decodeExactUpdateResult } from '../src/zolt/exact-contract.js';
import { decodeMachineFailure } from '../src/zolt/failure-contract.js';
import { createZoltTargetId } from '../src/zolt/target-id.js';
import { selectZoltProject } from '../src/zolt/workspace.js';
import type { ExactUpdateArtifact } from '../src/types.js';
import { actionInputs, projectSelection } from './support/fixtures.js';

const execute = promisify(execFile);
const binary = process.env.ZOLT_LIVE_BINARY;
const live = binary === undefined ? test.skip : test;

live('live contract canary uses the reviewed Zolt source identity', () => {
    assert.equal(process.env.ZOLT_LIVE_SOURCE_COMMIT, ZOLT_EXACT_TARGET_CONTRACT_COMMIT);
});

live('production capture selects authoritative schema-v2 targets from reviewed Zolt', async (context) => {
    assert.ok(binary);
    const root = await temporaryRoot(context, 'production-capture');
    await writeProject(join(root, 'zolt.toml'), 'com.google.guava:guava', '31.0-jre');
    const environment = await isolatedEnvironment(context);
    const report = await captureOutdated(
        binary,
        actionInputs(),
        projectSelection({ root }),
        environment,
    );
    assert.equal(report.schemaVersion, 2);
    const entry = report.scopes.flatMap(({ entries }) => entries)
        .find(({ identifier }) => identifier === 'com.google.guava:guava');
    assert.ok(entry, `Expected Guava in the production outdated report: ${JSON.stringify(report)}`);
    assert.equal(entry.targetId, createZoltTargetId({
        identifier: 'com.google.guava:guava',
        manifestPath: 'zolt.toml',
        section: '[dependencies]',
        surface: 'dependency',
    }));
});

live('reviewed Zolt satisfies standalone exact-target schema v2', async (context) => {
    const root = await project(context, 'standalone');
    const report = await outdated(context, root);
    const scope = report.scopes[0];
    const entry = scope?.entries[0];
    assert.ok(scope);
    assert.ok(entry);
    assert.equal(scope.manifestPath, 'zolt.toml');
    assert.equal(entry.targetId, createZoltTargetId({
        identifier: 'com.example:lib',
        manifestPath: 'zolt.toml',
        section: '[dependencies]',
        surface: 'dependency',
    }));

    const result = await exact(context, root, entry.targetId, '1.1.0');
    assert.equal(result.applied, true);
    assert.equal(result.resolved, false);
    assert.deepEqual(result.changedFiles, ['zolt.toml']);
    assert.match(await readFile(join(root, 'zolt.toml'), 'utf8'), /"1\.1\.0"/u);
});

live('reviewed Zolt routes workspace targets and preserves root-relative paths', async (context) => {
    const root = await temporaryRoot(context, 'workspace');
    const member = join(root, 'apps', 'api');
    await mkdir(member, { recursive: true });
    await writeFile(join(root, 'zolt.toml'), `
[workspace]
name = "platform"
members = ["apps/api"]
`, 'utf8');
    await writeProject(join(member, 'zolt.toml'), 'com.example:lib', '1.0.0');

    const report = await outdated(context, root);
    const scope = report.scopes[0];
    const entry = scope?.entries[0];
    assert.equal(scope?.label, 'apps/api');
    assert.equal(scope?.manifestPath, 'apps/api/zolt.toml');
    assert.equal(scope?.lockfilePath, 'zolt.lock');
    assert.ok(entry);

    const result = await exact(context, root, entry.targetId, '1.1.0');
    assert.deepEqual(result.changedFiles, ['apps/api/zolt.toml']);
    assert.match(await readFile(join(member, 'zolt.toml'), 'utf8'), /"1\.1\.0"/u);
});

live('reviewed Zolt treats a retained empty workspace domain as standalone', async (context) => {
    const root = await project(context, 'retained-empty');
    await writeFile(join(root, 'zolt.toml'), `${await readFile(join(root, 'zolt.toml'), 'utf8')}
[workspace]
name = "retained"
members = []
`, 'utf8');

    const report = await outdated(context, root);
    assert.equal(report.scopes.length, 1);
    assert.equal(report.scopes[0]?.label, basename(root));
    assert.equal(report.scopes[0]?.manifestPath, 'zolt.toml');
});

live('reviewed Zolt emits selected-schema failures on stdout', async (context) => {
    const root = await project(context, 'failure');
    const result = await invoke(context, [
        'update',
        '--target-id',
        `zt1_${'A'.repeat(43)}`,
        '--to',
        '1.1.0',
        '--format',
        'json',
        '--schema-version',
        '2',
        '--no-resolve',
        '--cwd',
        root,
    ], true);
    assert.equal(result.stderr, '');
    const failure = decodeMachineFailure(result.stdout, 'update', 2);
    assert.equal(failure.diagnostics[0]?.severity, 'error');
});

live('production executor prepares verified artifacts across supported project layouts', async (context) => {
    assert.ok(binary);
    const environment = await isolatedEnvironment(context);
    const layouts = [
        await executorProject(context, 'executor-standalone', 'standalone'),
        await executorProject(context, 'executor-modern', 'modern'),
        await executorProject(context, 'executor-legacy', 'legacy'),
        await executorProject(context, 'executor-root-member', 'root-member'),
        await executorProject(context, 'executor-root-platform', 'workspace-root-platform'),
        await executorProject(context, 'executor-alias', 'alias'),
    ] as const;

    for (const layout of layouts) {
        const resolveArguments = ['resolve'];
        if (layout.workspace) resolveArguments.push('--workspace');
        resolveArguments.push('--cwd', layout.root);
        await invokeWithEnvironment(resolveArguments, environment);
        const sha = await commitFixture(layout.root);
        const repository = await createRepositoryView({
            directory: layout.directory,
            expectedSha: sha,
            workspace: layout.root,
        });
        context.after(repository.cleanup);
        const selection = await selectZoltProject(repository, 'auto');
        const inputs = actionInputs({ updateCeiling: 'major' });
        const report = await captureOutdated(binary, inputs, selection, environment);
        const target = planUpdates(report, selection, inputs).eligible
            .find(({ identifier }) => identifier === layout.identifier);
        assert.ok(target, `Expected ${layout.identifier} in ${layout.name}: ${JSON.stringify(report)}`);
        const artifact: ExactUpdateArtifact = await prepareExactUpdateArtifact({
            binary,
            environment,
            includePrereleases: false,
            repository,
            selection,
            target,
        }).catch((error: unknown) => {
            throw new Error(`${layout.name}: ${error instanceof Error ? error.message : String(error)}`, {
                cause: error,
            });
        });

        assert.deepEqual(artifact.changedFiles, layout.changedFiles, layout.name);
        assert.deepEqual(artifact.files.map(({ path }) => path), layout.changedFiles, layout.name);
        assert.equal(artifact.result.resolved, true, layout.name);
        assert.equal(artifact.target.authoritativeTarget, true, layout.name);
        if (layout.name === 'alias') assert.equal(artifact.target.fanOut.length, 2);
        if (layout.name === 'workspace-root-platform') {
            assert.equal(artifact.target.scope, 'workspace-root');
            assert.equal(artifact.target.surface, 'platform');
            assert.equal(artifact.target.zoltManifestPath, 'zolt.toml');
        }
        await repository.verify();
    }
});

live('production executor isolates and uses private repository credentials', async (context) => {
    assert.ok(binary);
    for (const mode of ['basic', 'bearer'] as const) {
        const username = 'canary-user';
        const password = 'canary-password';
        const token = 'canary-token';
        const expectedAuthorization = mode === 'basic'
            ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
            : `Bearer ${token}`;
        const repositoryServer = await privateMavenRepository(context, expectedAuthorization);
        const root = await temporaryRoot(context, `private-${mode}`);
        const credentialNames = mode === 'basic'
            ? ['ZOLT_CANARY_USERNAME', 'ZOLT_CANARY_PASSWORD']
            : ['ZOLT_CANARY_TOKEN'];
        await writePrivateProject(join(root, 'zolt.toml'), repositoryServer.url, mode);
        const source = {
            ...process.env,
            GITHUB_TOKEN: 'github-token-secret',
            ZOLT_CANARY_PASSWORD: password,
            ZOLT_CANARY_TOKEN: token,
            ZOLT_CANARY_USERNAME: username,
        };
        const zoltEnvironment = await createZoltEnvironment(
            source,
            credentialNames,
            'github-token-secret',
            () => undefined,
        );
        context.after(zoltEnvironment.cleanup);
        assert.equal(zoltEnvironment.environment.GITHUB_TOKEN, undefined);
        await invokeWithEnvironment(['resolve', '--cwd', root], zoltEnvironment.environment);
        const sha = await commitFixture(root);
        const repository = await createRepositoryView({
            directory: '.',
            expectedSha: sha,
            workspace: root,
        });
        context.after(repository.cleanup);
        const selection = await selectZoltProject(repository, 'auto');
        const inputs = actionInputs({ updateCeiling: 'major' });
        const report = await captureOutdated(binary, inputs, selection, zoltEnvironment.environment);
        const target = planUpdates(report, selection, inputs).eligible[0];
        assert.ok(target);
        const artifact = await prepareExactUpdateArtifact({
            binary,
            environment: zoltEnvironment.environment,
            includePrereleases: false,
            repository,
            selection,
            target,
        });

        assert.deepEqual(artifact.changedFiles, ['zolt.toml', 'zolt.lock']);
        assert.ok(repositoryServer.authorizations.length > 0);
        assert.ok(repositoryServer.authorizations.every((value) => value === expectedAuthorization));
        assert.ok(repositoryServer.authorizations.every((value) => !value.includes('github-token-secret')));
    }
});

async function outdated(context: TestContext, root: string) {
    const result = await invoke(context, [
        'outdated',
        '--format',
        'json',
        '--schema-version',
        '2',
        '--all',
        '--offline',
        '--cwd',
        root,
    ]);
    assert.equal(result.stderr, '');
    return decodeOutdatedReportV2(result.stdout);
}

async function exact(context: TestContext, root: string, targetId: string, to: string) {
    const result = await invoke(context, [
        'update',
        '--target-id',
        targetId,
        '--to',
        to,
        '--format',
        'json',
        '--schema-version',
        '2',
        '--no-resolve',
        '--cwd',
        root,
    ]);
    assert.equal(result.stderr, '');
    return decodeExactUpdateResult(result.stdout);
}

async function invoke(
    context: TestContext,
    arguments_: readonly string[],
    expectFailure = false,
) {
    assert.ok(binary);
    const environment = await isolatedEnvironment(context);
    try {
        const result = await execute(binary, ['--color', 'never', '--progress', 'never', ...arguments_], {
            encoding: 'utf8',
            env: environment,
            maxBuffer: 64 * 1024 * 1024,
            timeout: 120_000,
        });
        if (expectFailure) assert.fail('Expected the live Zolt command to fail.');
        return result;
    } catch (error) {
        if (!expectFailure) throw error;
        const failure = error as { readonly stderr?: string; readonly stdout?: string };
        return { stderr: failure.stderr ?? '', stdout: failure.stdout ?? '' };
    }
}

async function invokeWithEnvironment(
    arguments_: readonly string[],
    environment: NodeJS.ProcessEnv,
): Promise<void> {
    assert.ok(binary);
    const result = await execute(binary, ['--color', 'never', '--progress', 'never', ...arguments_], {
        encoding: 'utf8',
        env: environment,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120_000,
    });
    assert.equal(result.stderr, '');
}

async function project(context: TestContext, name: string): Promise<string> {
    const root = await temporaryRoot(context, name);
    await writeProject(join(root, 'zolt.toml'), 'com.example:lib', '1.0.0');
    return root;
}

async function isolatedEnvironment(context: TestContext): Promise<NodeJS.ProcessEnv> {
    const environment = await createZoltEnvironment(process.env, [], '', () => undefined);
    context.after(environment.cleanup);
    return environment.environment;
}

async function temporaryRoot(context: TestContext, name: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), `zolt-live-${name}-`));
    context.after(async () => rm(root, { force: true, recursive: true }));
    return root;
}

async function writeProject(path: string, identifier: string, version: string): Promise<void> {
    await writeFile(path, `
[project]
name = "demo"
version = "0.1.0"
group = "com.example"
java = "21"

[repositories]
central = "https://repo.maven.apache.org/maven2"

[dependencies]
"${identifier}" = "${version}"
`, 'utf8');
}

interface ExecutorProject {
    readonly changedFiles: readonly string[];
    readonly directory: string;
    readonly identifier: string;
    readonly name: string;
    readonly root: string;
    readonly workspace: boolean;
}

async function executorProject(
    context: TestContext,
    name: string,
    kind: 'alias' | 'legacy' | 'modern' | 'root-member' | 'standalone' | 'workspace-root-platform',
): Promise<ExecutorProject> {
    const root = await temporaryRoot(context, name);
    if (kind === 'standalone') {
        await writeProject(join(root, 'zolt.toml'), 'com.google.guava:guava', '31.0-jre');
        return {
            changedFiles: ['zolt.toml', 'zolt.lock'],
            directory: '.',
            identifier: 'com.google.guava:guava',
            name: kind,
            root,
            workspace: false,
        };
    }
    if (kind === 'alias') {
        await writeFile(join(root, 'zolt.toml'), `
[project]
name = "alias-demo"
version = "0.1.0"
group = "com.example"
java = "21"

[repositories]
central = "https://repo.maven.apache.org/maven2"

[versions]
junit = "5.8.0"

[dependencies]
"org.junit.jupiter:junit-jupiter-api" = { versionRef = "junit" }
"org.junit.jupiter:junit-jupiter-engine" = { versionRef = "junit" }
`, 'utf8');
        return {
            changedFiles: ['zolt.toml', 'zolt.lock'],
            directory: '.',
            identifier: 'junit',
            name: kind,
            root,
            workspace: false,
        };
    }
    if (kind === 'root-member') {
        await writeFile(join(root, 'zolt.toml'), `
[project]
name = "root-member"
version = "0.1.0"
group = "com.example"
java = "21"

[workspace]
name = "root-member"
members = ["."]

[repositories]
central = "https://repo.maven.apache.org/maven2"

[dependencies]
"com.google.guava:guava" = "31.0-jre"
`, 'utf8');
        return {
            changedFiles: ['zolt.toml', 'zolt.lock'],
            directory: '.',
            identifier: 'com.google.guava:guava',
            name: kind,
            root,
            workspace: true,
        };
    }
    if (kind === 'workspace-root-platform') {
        const member = join(root, 'apps', 'api');
        await mkdir(member, { recursive: true });
        await writeFile(join(root, 'zolt.toml'), `
[workspace]
name = "root-platform"
members = ["apps/api"]

[repositories]
central = "https://repo.maven.apache.org/maven2"

[platforms]
"org.junit:junit-bom" = "5.10.2"
`, 'utf8');
        await writeFile(join(member, 'zolt.toml'), `
[project]
name = "api"
version = "0.1.0"
group = "com.example"
java = "21"

[dependencies]
"org.junit.jupiter:junit-jupiter-api" = {}
`, 'utf8');
        return {
            changedFiles: ['zolt.toml', 'zolt.lock'],
            directory: 'apps/api',
            identifier: 'org.junit:junit-bom',
            name: kind,
            root,
            workspace: true,
        };
    }
    const member = join(root, 'apps', 'api');
    await mkdir(member, { recursive: true });
    const workspaceFile = kind === 'legacy' ? 'zolt-workspace.toml' : 'zolt.toml';
    await writeFile(join(root, workspaceFile), `
[workspace]
name = "${kind}-workspace"
members = ["apps/api"]
`, 'utf8');
    await writeProject(join(member, 'zolt.toml'), 'com.google.guava:guava', '31.0-jre');
    return {
        changedFiles: ['apps/api/zolt.toml', 'zolt.lock'],
        directory: 'apps/api',
        identifier: 'com.google.guava:guava',
        name: kind,
        root,
        workspace: true,
    };
}

async function commitFixture(root: string): Promise<string> {
    await execute('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
    await execute('git', ['config', 'user.name', 'Zolt canary'], { cwd: root, encoding: 'utf8' });
    await execute('git', ['config', 'user.email', 'canary@zolt.sh'], { cwd: root, encoding: 'utf8' });
    await execute('git', ['add', '--', 'zolt.lock', ':(glob)**/*.toml'], { cwd: root, encoding: 'utf8' });
    await execute('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], {
        cwd: root,
        encoding: 'utf8',
    });
    return (await execute('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })).stdout.trim();
}

async function writePrivateProject(
    path: string,
    repositoryUrl: string,
    mode: 'basic' | 'bearer',
): Promise<void> {
    const credentials = mode === 'basic'
        ? 'usernameEnv = "ZOLT_CANARY_USERNAME"\npasswordEnv = "ZOLT_CANARY_PASSWORD"'
        : 'tokenEnv = "ZOLT_CANARY_TOKEN"';
    await writeFile(path, `
[project]
name = "private-demo"
version = "0.1.0"
group = "com.example"
java = "21"

[repositories]
private = { url = "${repositoryUrl}", credentials = "private" }

[repositoryCredentials.private]
${credentials}

[dependencies]
"com.example:private" = "1.0.0"
`, 'utf8');
}

interface PrivateMavenRepository {
    readonly authorizations: string[];
    readonly url: string;
}

async function privateMavenRepository(
    context: TestContext,
    expectedAuthorization: string,
): Promise<PrivateMavenRepository> {
    const authorizations: string[] = [];
    const emptyJar = Buffer.from([
        0x50, 0x4b, 0x05, 0x06,
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0,
    ]);
    const metadata = Buffer.from(`
<metadata>
  <groupId>com.example</groupId>
  <artifactId>private</artifactId>
  <versioning>
    <latest>1.1.0</latest>
    <release>1.1.0</release>
    <versions><version>1.0.0</version><version>1.1.0</version></versions>
    <lastUpdated>20260811000000</lastUpdated>
  </versioning>
</metadata>
`);
    const responses = new Map<string, Buffer>([
        ['/maven2/com/example/private/maven-metadata.xml', metadata],
        ...['1.0.0', '1.1.0'].flatMap((version): [string, Buffer][] => {
            const base = `/maven2/com/example/private/${version}/private-${version}`;
            const pom = Buffer.from(`
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>private</artifactId>
  <version>${version}</version>
</project>
`);
            return [[`${base}.pom`, pom], [`${base}.jar`, emptyJar]];
        }),
    ]);
    const server = createServer((request, response) => {
        const authorization = request.headers.authorization ?? '';
        authorizations.push(authorization);
        if (authorization !== expectedAuthorization) {
            response.writeHead(401).end('authentication required');
            return;
        }
        const body = responses.get(request.url ?? '');
        if (body === undefined) {
            response.writeHead(404).end('missing');
            return;
        }
        response.writeHead(200, { 'content-length': body.length }).end(body);
    });
    await new Promise<void>((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolvePromise);
    });
    context.after(() => new Promise<void>((resolvePromise, reject) => {
        server.close((error) => error === undefined ? resolvePromise() : reject(error));
    }));
    const address = server.address() as AddressInfo;
    return { authorizations, url: `http://127.0.0.1:${address.port.toString()}/maven2` };
}
