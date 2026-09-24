import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

// jwks-rsa 4.1 requires ESM-only jose synchronously. Vercel's loader rejects
// require(esm), even on Node 24. Keep the same verifier and load jose asynchronously.
// Remove this compatibility patch when upstream fixes auth0/node-jwks-rsa#507.
const require = createRequire(import.meta.url);
const path = require.resolve('jwks-rsa/src/utils.js');
const source = readFileSync(path, 'utf8');
const original = "const jose = require('jose');";
const marker = "  const jose = await import('jose');";
if (!source.includes(marker)) {
  if (!source.includes(original) || !source.includes('async function retrieveSigningKeys(jwks) {')) {
    throw new Error('jwks-rsa changed; review the Vercel ESM compatibility patch.');
  }
  writeFileSync(path, source.replace(original, '').replace(
    'async function retrieveSigningKeys(jwks) {',
    `async function retrieveSigningKeys(jwks) {\n${marker}`,
  ));
}
const passportPath = require.resolve('jwks-rsa/src/integrations/passport.js');
const passport = readFileSync(passportPath, 'utf8');
if (!passport.includes(marker)) {
  const provider = 'return function secretProvider(req, rawJwtToken, cb) {';
  if (!passport.includes(original) || !passport.includes(provider) || !passport.includes('    try {')) {
    throw new Error('jwks-rsa passport integration changed; review ESM compatibility.');
  }
  writeFileSync(passportPath, passport.replace(original, '')
    .replace(provider, 'return async function secretProvider(req, rawJwtToken, cb) {')
    .replace('    try {', `    try {\n    ${marker}`));
}
