const expected = process.env.EXPECTED_ZOLT_TARGET;
if (expected === undefined || expected === '') {
    throw new Error('EXPECTED_ZOLT_TARGET is not set.');
}
const platform = process.platform === 'darwin' ? 'macos' : process.platform;
if (platform !== 'linux' && platform !== 'macos') {
    throw new Error(`Unsupported integration platform ${process.platform}.`);
}
if (process.arch !== 'x64' && process.arch !== 'arm64') {
    throw new Error(`Unsupported integration architecture ${process.arch}.`);
}
const actual = `${platform}-${process.arch}`;
if (actual !== expected) {
    throw new Error(`Runner target mismatch: expected ${expected}; actual ${actual}.`);
}
console.log(`Verified runner target ${actual}.`);
