const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Writable } = require('stream');

const {
  normalizeAssetId,
  listAssets,
  createAssetFromUrl,
  deleteAsset,
  uploadAsset,
  resolveAssetContentDescriptor,
  streamAssetContent,
} = require('../src/services/holyCrabAssetService');

const config = {
  provider: 'holycrab',
  api_protocol: 'holycrab',
  base_url: 'https://abgzfc.holycrab.ai',
  api_key: 'crab-secret',
};

function response(data, code = 200, message = null) {
  return {
    statusCode: 200,
    raw: JSON.stringify({ code, data, message }),
    headers: { 'content-type': 'application/json' },
  };
}

describe('HolyCrab asset management adapter', () => {
  it('lists a bounded page with filters and X-User-Token authentication', async () => {
    let captured;
    const result = await listAssets(
      config,
      { page: 2, page_size: 500, name: '角色 A', status: '1' },
      async (url, options) => {
        captured = { url: String(url), options };
        return response({ records: [{ uniqId: 'asset001' }], total: 1, current: 2 });
      }
    );
    assert.equal(
      captured.url,
      'https://abgzfc.holycrab.ai/api/user-assets?page=2&pageSize=100&name=%E8%A7%92%E8%89%B2+A&status=1'
    );
    assert.equal(captured.options.method, 'GET');
    assert.equal(captured.options.headers['X-User-Token'], 'crab-secret');
    assert.equal(result.records[0].uniqId, 'asset001');
  });

  it('validates asset ids and sends URL imports as form data', async () => {
    assert.throws(() => normalizeAssetId('bad-id'), /uniqId/);
    let captured;
    const created = await createAssetFromUrl(
      config,
      { url: 'https://cdn.example.com/a.png?x=1', name: '角色图' },
      async (url, options) => {
        captured = { url: String(url), options };
        return response({ uniqId: 'asset002', status: 'Processing' });
      }
    );
    assert.equal(captured.url, 'https://abgzfc.holycrab.ai/api/user-assets/create-asset-from-url');
    assert.match(captured.options.headers['Content-Type'], /^application\/x-www-form-urlencoded/);
    assert.equal(
      captured.options.body,
      'url=https%3A%2F%2Fcdn.example.com%2Fa.png%3Fx%3D1&name=%E8%A7%92%E8%89%B2%E5%9B%BE'
    );
    assert.equal(created.uniqId, 'asset002');
  });

  it('deletes an asset with the documented JSON payload', async () => {
    let captured;
    const result = await deleteAsset(config, 'asset003', async (url, options) => {
      captured = { url: String(url), options };
      return response(null);
    });
    assert.equal(captured.url, 'https://abgzfc.holycrab.ai/api/user-assets/delete');
    assert.deepEqual(captured.options.body, { uniq_id: 'asset003' });
    assert.deepEqual(result, { uniqId: 'asset003', deleted: true });
  });

  it('uploads local files through the pre-signed PUT and registration flow', async () => {
    const calls = [];
    const result = await uploadAsset(
      config,
      {
        buffer: Buffer.from('image-bytes'),
        originalname: 'character.png',
        mimetype: 'image/png',
      },
      { name: '角色素材', duration_seconds: 9 },
      async (url, options) => {
        calls.push({ url: String(url), options });
        if (String(url).includes('/pre-signed-download-url?')) {
          return response({
            preSignedUrl: 'https://objects.example.com/upload',
            objectKey: '1/character.png',
            uniqId: 'asset004',
          });
        }
        if (String(url) === 'https://objects.example.com/upload') {
          return { statusCode: 200, raw: '', headers: {} };
        }
        if (String(url).endsWith('/api/user-assets/upload')) return response(null);
        throw new Error(`Unexpected URL: ${url}`);
      }
    );

    assert.match(calls[0].url, /file_extension=png&content_type=image%2Fpng$/);
    assert.equal(calls[1].options.method, 'PUT');
    assert.equal(calls[1].options.headers['Content-Type'], 'image/png');
    assert.match(calls[2].options.headers['Content-Type'], /^multipart\/form-data; boundary=/);
    assert.match(calls[2].options.body.toString('utf8'), /name="object_key"\r\n\r\n1\/character\.png/);
    assert.doesNotMatch(calls[2].options.body.toString('utf8'), /duration_seconds/);
    assert.deepEqual(result, {
      uniqId: 'asset004',
      name: '角色素材',
      assetType: 'Image',
      status: 'Processing',
    });
  });

  it('resolves relative content URLs and preserves a useful download filename', () => {
    const descriptor = resolveAssetContentDescriptor(config, {
      uniqId: 'asset005',
      name: '角色视频',
      assetType: 'Video',
      url: '/api/user-assets/serve/asset005.mp4',
    });
    assert.equal(
      descriptor.url,
      'https://abgzfc.holycrab.ai/api/user-assets/serve/asset005.mp4'
    );
    assert.equal(descriptor.filename, '角色视频.mp4');
    assert.equal(descriptor.fallback_content_type, 'video/mp4');
  });

  it('streams media with Range support and does not leak the token across redirects', async () => {
    let apiRange = '';
    let apiToken = '';
    let cdnToken = '';
    const cdn = http.createServer((req, res) => {
      cdnToken = String(req.headers['x-user-token'] || '');
      res.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Content-Range': 'bytes 0-3/10',
        'Accept-Ranges': 'bytes',
        'Content-Length': '4',
      });
      res.end(Buffer.from('test'));
    });
    await new Promise((resolve) => cdn.listen(0, '127.0.0.1', resolve));
    const cdnPort = cdn.address().port;
    const api = http.createServer((req, res) => {
      apiRange = String(req.headers.range || '');
      apiToken = String(req.headers['x-user-token'] || '');
      res.writeHead(302, { Location: `http://127.0.0.1:${cdnPort}/video.mp4` });
      res.end();
    });
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    const apiPort = api.address().port;

    const chunks = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    output.headers = {};
    output.status = (status) => {
      output.statusCode = status;
      return output;
    };
    output.setHeader = (name, value) => {
      output.headers[String(name).toLowerCase()] = value;
    };

    try {
      await streamAssetContent(
        {
          provider: 'holycrab',
          base_url: `http://127.0.0.1:${apiPort}`,
          api_key: 'range-secret',
        },
        {
          uniqId: 'asset006',
          name: 'range-video.mp4',
          assetType: 'Video',
          url: '/media/video.mp4',
        },
        { headers: { range: 'bytes=0-3' } },
        output,
        { download: false, timeout_ms: 5000 }
      );
    } finally {
      await new Promise((resolve) => api.close(resolve));
      await new Promise((resolve) => cdn.close(resolve));
    }

    assert.equal(apiRange, 'bytes=0-3');
    assert.equal(apiToken, 'range-secret');
    assert.equal(cdnToken, '');
    assert.equal(output.statusCode, 206);
    assert.equal(output.headers['content-range'], 'bytes 0-3/10');
    assert.match(output.headers['content-disposition'], /^inline;/);
    assert.equal(Buffer.concat(chunks).toString('utf8'), 'test');
  });
});
