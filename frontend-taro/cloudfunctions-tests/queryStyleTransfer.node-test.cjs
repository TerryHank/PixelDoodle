'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const queryModule = require('../cloudfunctions/queryStyleTransfer/index.js')

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01])

function dependencies(overrides = {}) {
  return {
    cloud: {
      uploadFile: async () => ({ fileID: 'cloud://output/result.jpg' })
    },
    http: {
      get: async () => ({
        data: {
          output: { task_status: 'RUNNING' },
          request_id: 'request-running'
        }
      })
    },
    env: { DASHSCOPE_API_KEY: 'test-secret' },
    ...overrides
  }
}

test('queryStyleTransfer returns RUNNING without downloading or uploading an image', async () => {
  let uploadCalled = false
  const deps = dependencies({
    cloud: {
      uploadFile: async () => {
        uploadCalled = true
      }
    }
  })

  const result = await queryModule.handleQueryStyleTransfer({ taskId: 'task-running' }, {}, deps)

  assert.deepEqual(result, {
    success: true,
    status: 'RUNNING',
    requestId: 'request-running'
  })
  assert.equal(uploadCalled, false)
})

test('queryStyleTransfer returns a structured FAILED response and redacts secrets', async () => {
  const secret = 'failed-task-secret'
  const deps = dependencies({
    env: { DASHSCOPE_API_KEY: secret },
    http: {
      get: async () => ({
        data: {
          output: {
            task_status: 'FAILED',
            code: `BAD_${secret}`,
            message: `Provider rejected Bearer ${secret}`
          },
          request_id: 'request-failed'
        }
      })
    }
  })

  const result = await queryModule.handleQueryStyleTransfer({ taskId: 'task-failed' }, {}, deps)

  assert.equal(result.success, false)
  assert.equal(result.status, 'FAILED')
  assert.equal(result.requestId, 'request-failed')
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.match(result.message, /\[REDACTED\]/)
  assert.match(result.code, /\[REDACTED\]/)
})

test('queryStyleTransfer downloads a successful result and stores it under the task path', async () => {
  const getCalls = []
  let uploaded
  const deps = dependencies({
    env: {
      DASHSCOPE_API_KEY: 'success-secret',
      DASHSCOPE_API_BASE_URL: 'https://example.test/api/v1/'
    },
    http: {
      get: async (url, options) => {
        getCalls.push([url, options])
        if (getCalls.length === 1) {
          return {
            data: {
              output: {
                task_status: 'SUCCEEDED',
                results: [{ result_url: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result' }]
              },
              request_id: 'request-success'
            }
          }
        }
        return { data: JPEG_BYTES }
      }
    },
    cloud: {
      uploadFile: async (input) => {
        uploaded = input
        return { fileID: 'cloud://output/task-success.jpg' }
      }
    }
  })

  const result = await queryModule.handleQueryStyleTransfer({ taskId: 'task-success' }, {}, deps)

  assert.deepEqual(result, {
    success: true,
    status: 'SUCCEEDED',
    fileID: 'cloud://output/task-success.jpg',
    mediaType: 'image/jpeg',
    requestId: 'request-success'
  })
  assert.equal(getCalls[0][0], 'https://example.test/api/v1/tasks/task-success')
  assert.equal(getCalls[0][1].headers.Authorization, 'Bearer success-secret')
  assert.equal(
    getCalls[1][0],
    'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result'
  )
  assert.equal(getCalls[1][1].maxRedirects, 0)
  assert.equal(getCalls[1][1].maxContentLength, 20 * 1024 * 1024)
  assert.equal(getCalls[1][1].maxBodyLength, 20 * 1024 * 1024)
  assert.deepEqual(uploaded, {
    cloudPath: 'wanxiang/output/task-success.jpg',
    fileContent: JPEG_BYTES
  })
  assert.equal(JSON.stringify(result).includes('success-secret'), false)
})

test('queryStyleTransfer rejects unsafe task IDs and hides provider request secrets', async (t) => {
  await t.test('unsafe task ID', async () => {
    await assert.rejects(
      queryModule.handleQueryStyleTransfer({ taskId: '../escape' }, {}, dependencies()),
      { code: 'INVALID_TASK_ID' }
    )
  })

  await t.test('provider query failure', async () => {
    const secret = 'query-secret-key'
    const deps = dependencies({
      env: { DASHSCOPE_API_KEY: secret },
      http: {
        get: async () => {
          throw {
            message: secret,
            response: { data: { request_id: 'request-query-error', message: secret } },
            config: { headers: { Authorization: `Bearer ${secret}` } }
          }
        }
      }
    })

    let caught
    try {
      await queryModule.handleQueryStyleTransfer({ taskId: 'task-error' }, {}, deps)
    } catch (error) {
      caught = error
    }

    assert.equal(caught.code, 'DASHSCOPE_QUERY_FAILED')
    assert.equal(caught.requestId, 'request-query-error')
    assert.equal(`${caught.message}\n${caught.stack}\n${JSON.stringify(caught)}`.includes(secret), false)
  })
})

test('queryStyleTransfer rejects untrusted result URLs and oversized downloads', async (t) => {
  await t.test('untrusted result URL', async () => {
    let requestCount = 0
    const deps = dependencies({
      http: {
        get: async () => {
          requestCount += 1
          return {
            data: {
              output: {
                task_status: 'SUCCEEDED',
                results: [{ url: 'http://127.0.0.1/internal' }]
              }
            }
          }
        }
      }
    })

    await assert.rejects(
      queryModule.handleQueryStyleTransfer({ taskId: 'task-ssrf' }, {}, deps),
      { code: 'DASHSCOPE_RESULT_URL_UNTRUSTED' }
    )
    assert.equal(requestCount, 1)
  })

  await t.test('oversized result body', async () => {
    let requestCount = 0
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1)
    oversized.set([0xff, 0xd8, 0xff], 0)
    const deps = dependencies({
      http: {
        get: async () => {
          requestCount += 1
          if (requestCount === 1) {
            return {
              data: {
                output: {
                  task_status: 'SUCCEEDED',
                  results: [{ url: 'https://dashscope-result-wlcb.oss-cn-wulanchabu.aliyuncs.com/result' }]
                }
              }
            }
          }
          return { data: oversized }
        }
      }
    })

    await assert.rejects(
      queryModule.handleQueryStyleTransfer({ taskId: 'task-large' }, {}, deps),
      { code: 'RESULT_IMAGE_TOO_LARGE' }
    )
  })
})
