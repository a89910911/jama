const test = require('node:test');
const assert = require('node:assert/strict');

const sceneService = require('../src/services/sceneService');
const createSceneRoutes = require('../src/routes/scenes');

function createResponse() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function runGenerateImage(body) {
  const calls = [];
  const originalSingle = sceneService.generateSceneSingleImage;
  const originalQuad = sceneService.generateSceneFourViewImage;
  sceneService.generateSceneSingleImage = async (...args) => {
    calls.push({ mode: 'single', args });
    return { ok: true, image_generation: { id: 101 } };
  };
  sceneService.generateSceneFourViewImage = async (...args) => {
    calls.push({ mode: 'quad', args });
    return { ok: true, image_generation: { id: 202 } };
  };

  try {
    const routes = createSceneRoutes({}, { error() {} }, {});
    const res = createResponse();
    await routes.generateImage({ body }, res);
    return { calls, res };
  } finally {
    sceneService.generateSceneSingleImage = originalSingle;
    sceneService.generateSceneFourViewImage = originalQuad;
  }
}

test('scene image route defaults to a single image', async () => {
  const { calls, res } = await runGenerateImage({ scene_id: 7 });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'single');
  assert.equal(calls[0].args[3], 7);
});

test('scene image route honors an explicit false quad-grid flag', async () => {
  const { calls } = await runGenerateImage({ scene_id: 8, use_quad_grid: false });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'single');
});

test('scene image route uses four-view generation only when requested', async () => {
  const { calls, res } = await runGenerateImage({ scene_id: 9, use_quad_grid: true });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'quad');
  assert.equal(res.payload.data.image_generation.id, 202);
});
