import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig } from '../server/runtime-config.js';

test('Render uses its injected HTTPS URL without a hardcoded or guessed hostname', () => {
  const config = runtimeConfig({NODE_ENV:'production', RENDER_EXTERNAL_URL:'https://example-unique.onrender.com', PORT:'3001', DB_PATH:'/app/data/ali-insight.sqlite', TRUST_PROXY:'1'});
  assert.equal(config.origin, 'https://example-unique.onrender.com');
  assert.equal(config.port, 3001);
  assert.equal(config.dbPath, '/app/data/ali-insight.sqlite');
  assert.equal(config.production, true);
  assert.equal(config.trustProxy, true);
});

test('an explicitly configured custom domain takes priority over the Render URL', () => {
  assert.equal(runtimeConfig({NODE_ENV:'production', RENDER:'true', RENDER_EXTERNAL_URL:'https://example.onrender.com', APP_ORIGIN:'https://analytics.example.com'}).origin, 'https://analytics.example.com');
});

test('production fails closed without a canonical HTTPS origin', () => {
  for (const env of [
    {NODE_ENV:'production'},
    {NODE_ENV:'production', RENDER:'true', RENDER_EXTERNAL_URL:'http://example.onrender.com'},
    {NODE_ENV:'production', APP_ORIGIN:'https://example.com/'},
    {NODE_ENV:'production', APP_ORIGIN:'https://example.com/other'},
    {NODE_ENV:'production', APP_ORIGIN:'*'}
  ]) assert.throws(() => runtimeConfig(env));
});

test('local development defaults remain compatible and invalid network settings fail', () => {
  const config = runtimeConfig({});
  assert.equal(config.origin,'http://localhost:5173');
  assert.equal(config.production,false);
  for (const PORT of ['0','65536','invalid']) assert.throws(() => runtimeConfig({PORT}));
  assert.throws(() => runtimeConfig({TRUST_PROXY:'true'}));
});
