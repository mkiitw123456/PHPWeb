import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('server loads and resolves RSA signing keys without require(esm)', () => {
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', '--input-type=module', '-e', `
    import { generateKeyPairSync } from 'node:crypto';
    import { createRequire } from 'node:module';
    await import('./api/workspace.mjs');
    const require = createRequire(import.meta.url);
    const { retrieveSigningKeys } = require('jwks-rsa/src/utils.js');
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keys = await retrieveSigningKeys([{ ...publicKey.export({format:'jwk'}), kid:'test', alg:'RS256' }]);
    if (keys.length !== 1 || keys[0].getPublicKey().trim() !== publicKey.export({format:'pem',type:'spki'}).trim()) throw new Error('Signing key mismatch');
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
