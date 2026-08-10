import { actionError } from '../errors.js';
import { minimalZoltEnvironment, runZolt } from '../zolt/process.js';

export async function verifyZoltVersion(
    binary: string,
    expectedVersion: string,
    environment: NodeJS.ProcessEnv,
): Promise<void> {
    const result = await runZolt(binary, ['--version'], process.cwd(), minimalZoltEnvironment(environment), 10_000);
    if (result.stderr !== '' || result.stdout !== expectedVersion && result.stdout !== `${expectedVersion}\n`) {
        throw actionError(
            'ZOLT-INSTALL-011',
            `Installed Zolt failed exact version verification; expected ${expectedVersion}. No project command was run.`,
        );
    }
}
