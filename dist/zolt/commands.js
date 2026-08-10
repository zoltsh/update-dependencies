import { UpdateDependenciesError } from '../errors.js';
import { decodeOutdatedReport } from './contracts.js';
import { runZolt } from './process.js';
export async function captureOutdated(binary, inputs, selection, environment, dependencies = {}) {
    const arguments_ = ['--color', 'never', '--progress', 'never', 'outdated', '--format', 'json'];
    if (inputs.includePrereleases)
        arguments_.push('--include-prereleases');
    arguments_.push(...inputs.selectors);
    const result = await (dependencies.run ?? runZolt)(binary, arguments_, selection.root, environment, 120_000);
    if (result.stderr !== '') {
        throw new UpdateDependenciesError('ZOLT-PROCESS-002', 'Zolt wrote unexpected diagnostic output while producing its machine document.');
    }
    return (dependencies.decode ?? decodeOutdatedReport)(result.stdout);
}
