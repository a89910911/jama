const test = require('node:test');
const assert = require('node:assert/strict');

const { VolcSigner, queryParamsToString } = require('../src/utils/volcSigner');

test('matches the official Volcengine signer output for a fixed request vector', () => {
  const request = {
    region: 'cn-beijing',
    method: 'POST',
    pathname: '/api/v3',
    params: {
      Version: '2024-01-01',
      Action: 'ListAssets',
      ProjectName: 'demo project',
    },
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: '{"PageNumber":1}',
  };

  const signer = new VolcSigner(request, 'ark');
  signer.addAuthorization({
    accessKeyId: 'AKIDEXAMPLE',
    secretKey: 'secret-example',
    sessionToken: 'token-example',
  }, new Date('2026-07-27T12:34:56.000Z'));

  assert.deepEqual(request.params, {
    Action: 'ListAssets',
    ProjectName: 'demo project',
    Version: '2024-01-01',
  });
  assert.equal(
    queryParamsToString(request.params),
    'Action=ListAssets&ProjectName=demo%20project&Version=2024-01-01'
  );
  assert.equal(request.headers['X-Date'], '20260727T123456Z');
  assert.equal(request.headers['X-Security-Token'], 'token-example');
  assert.equal(
    request.headers['X-Content-Sha256'],
    'd270382fc9e5db099e736eb4a0cfb5afd35cc19ea7a4d9495245344253b98eb3'
  );
  assert.equal(
    request.headers.Authorization,
    'HMAC-SHA256 Credential=AKIDEXAMPLE/20260727/cn-beijing/ark/request, '
    + 'SignedHeaders=x-content-sha256;x-date;x-security-token, '
    + 'Signature=df3b534b97af1989723f0aef1e65811140c6fe29eafbb800f16ac94e426d0f4f'
  );
});
