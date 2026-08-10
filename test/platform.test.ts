import * as assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTarget } from '../src/install/platform.js';

test('resolveTarget maps all supported runners and rejects Windows', () => {
    assert.equal(resolveTarget('linux', 'x64'), 'linux-x64');
    assert.equal(resolveTarget('linux', 'arm64'), 'linux-arm64');
    assert.equal(resolveTarget('darwin', 'x64'), 'macos-x64');
    assert.equal(resolveTarget('darwin', 'arm64'), 'macos-arm64');
    assert.throws(() => resolveTarget('win32', 'x64'), /does not support Windows/u);
});
