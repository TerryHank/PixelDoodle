'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const submitModule = require('../cloudfunctions/submitStyleTransfer/index.js')

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])

function dependencies(overrides = {}) {
  return {
    cloud: {
      downloadFile: async () => ({ fileContent: PNG_BYTES })
    },
    http: {
      post: async () => ({
        data: {
          output: { task_id: 'task-123', task_status: 'PENDING' },
          request_id: 'request-123'
        }
      })
    },
    env: { DASHSCOPE_API_KEY: 'test-secret' },
    ...overrides
  }
}

test('submitStyleTransfer sends a Base64 image and returns only the public task contract', async () => {
  let captured
  const deps = dependencies({
    http: {
      post: async (...args) => {
        captured = args
        return {
          data: {
            output: { task_id: 'task-123', task_status: 'PENDING' },
            request_id: 'request-123'
          }
        }
      }
    },
    env: {
      DASHSCOPE_API_KEY: 'top-secret-key',
      DASHSCOPE_API_BASE_URL: 'https://example.test/api/v1/'
    }
  })

  const result = await submitModule.handleSubmitStyleTransfer(
    { fileID: 'cloud://input/example.png', styleIndex: 34 },
    {},
    deps
  )

  assert.deepEqual(result, {
    success: true,
    status: 'PENDING',
    taskId: 'task-123',
    requestId: 'request-123'
  })
  assert.equal(captured[0], 'https://example.test/api/v1/services/aigc/image-generation/generation')
  assert.equal(captured[1].model, 'wanx-style-repaint-v1')
  assert.equal(captured[1].input.style_index, 34)
  assert.match(captured[1].input.image_url, /^data:image\/png;base64,/)
  assert.equal(captured[2].headers['X-DashScope-Async'], 'enable')
  assert.equal(captured[2].headers.Authorization, 'Bearer top-secret-key')
  assert.equal(JSON.stringify(result).includes('top-secret-key'), false)
})

test('submitStyleTransfer rejects unsupported presets, invalid magic and files over 10MB', async (t) => {
  await t.test('non-CloudBase file ID', async () => {
    await assert.rejects(
      submitModule.handleSubmitStyleTransfer(
        { fileID: 'https://example.test/input.png', styleIndex: 34 },
        {},
        dependencies()
      ),
      { code: 'INVALID_FILE_ID' }
    )
  })

  await t.test('unsupported style index', async () => {
    await assert.rejects(
      submitModule.handleSubmitStyleTransfer(
        { fileID: 'cloud://input/example.png', styleIndex: 13 },
        {},
        dependencies()
      ),
      { code: 'UNSUPPORTED_STYLE_INDEX' }
    )
  })

  await t.test('invalid magic bytes', async () => {
    const deps = dependencies({
      cloud: { downloadFile: async () => ({ fileContent: Buffer.from('not an image') }) }
    })
    await assert.rejects(
      submitModule.handleSubmitStyleTransfer(
        { fileID: 'cloud://input/example.bin', styleIndex: 0 },
        {},
        deps
      ),
      { code: 'UNSUPPORTED_IMAGE_TYPE' }
    )
  })

  await t.test('input larger than 10MB', async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1)
    oversized.set([0xff, 0xd8, 0xff], 0)
    const deps = dependencies({
      cloud: { downloadFile: async () => ({ fileContent: oversized }) }
    })
    await assert.rejects(
      submitModule.handleSubmitStyleTransfer(
        { fileID: 'cloud://input/large.jpg', styleIndex: 40 },
        {},
        deps
      ),
      { code: 'IMAGE_TOO_LARGE' }
    )
  })
})

test('submitStyleTransfer never exposes the API key when the provider rejects the request', async () => {
  const secret = 'do-not-leak-this-key'
  const deps = dependencies({
    env: { DASHSCOPE_API_KEY: secret },
    http: {
      post: async () => {
        throw {
          message: `Bearer ${secret}`,
          response: { data: { request_id: 'request-failed', message: secret } },
          config: { headers: { Authorization: `Bearer ${secret}` } }
        }
      }
    }
  })

  let caught
  try {
    await submitModule.handleSubmitStyleTransfer(
      { fileID: 'cloud://input/example.png', styleIndex: 32 },
      {},
      deps
    )
  } catch (error) {
    caught = error
  }

  assert.equal(caught.code, 'DASHSCOPE_SUBMIT_FAILED')
  assert.equal(caught.requestId, 'request-failed')
  assert.equal(`${caught.message}\n${caught.stack}\n${JSON.stringify(caught)}`.includes(secret), false)
})

test('both cloud function packages pin the required production dependencies', () => {
  const functionsRoot = path.join(__dirname, '..', 'cloudfunctions')
  for (const functionName of ['submitStyleTransfer', 'queryStyleTransfer']) {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(functionsRoot, functionName, 'package.json'), 'utf8')
    )
    assert.deepEqual(packageJson.dependencies, {
      axios: '1.19.0',
      'wx-server-sdk': '4.0.2'
    })
  }
})
