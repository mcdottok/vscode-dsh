import { AppError, type DshBackend } from '@dsh-vscode/domain'
import { describe, expect, it, vi } from 'vitest'
import { CustomProviderRequests } from './custom-provider-requests.js'

const discovery = {
  settingsNamespace: 'llm-pi-ai',
  providerId: 'sample',
  baseUrl: 'https://api.example.test/v1',
  api: 'openai-completions',
}
const draft = {
  ...discovery,
  draftId: '6f93c394-415a-45bc-a7ad-e2239db60cb0',
  collectionPath: ['providers'],
  models: [{ id: 'sample-model' }],
  expectedRevision: 7,
}
const saved = { profileCommitted: true, credentialConfigured: true }

function fixture(): {
  readonly requests: CustomProviderRequests
  readonly signal: AbortSignal
  readonly discover: ReturnType<typeof vi.fn>
  readonly create: ReturnType<typeof vi.fn>
} {
  const backend = {} as DshBackend
  const discover = vi.fn().mockResolvedValue([{ id: 'sample-model', label: 'Sample model' }])
  const create = vi.fn().mockResolvedValue(saved)
  const requests = new CustomProviderRequests({
    requireBackend: () => backend,
    discover,
    create,
  })
  return { requests, signal: new AbortController().signal, discover, create }
}

describe('custom-provider request lifetime', () => {
  it('uses the supplied key for discovery and idempotent saves', async () => {
    const { requests, signal, discover, create } = fixture()
    const models = await requests.discover({ ...discovery, apiKey: ' fixture-key ' }, signal)
    expect(models).toEqual([{ id: 'sample-model', label: 'Sample model' }])
    expect(discover).toHaveBeenCalledExactlyOnceWith({ ...discovery, apiKey: 'fixture-key' }, signal)
    const submitted = { ...draft, apiKey: ' fixture-key ' }
    await expect(
      Promise.all([requests.save(submitted, 'sidebar', signal), requests.save(submitted, 'sidebar', signal)]),
    ).resolves.toEqual([saved, saved])
    await expect(requests.save(submitted, 'sidebar', signal)).resolves.toEqual(saved)
    expect(create).toHaveBeenCalledExactlyOnceWith(draft, 'fixture-key', signal, false)
  })

  it.each([
    ['other surface', 'editor', draft],
    ['other draft', 'sidebar', { ...draft, draftId: '9e122311-a33d-4a97-bea8-41d305edb524' }],
    ['changed API address', 'sidebar', { ...draft, baseUrl: 'https://other.example.test/v1' }],
  ] as const)('does not reuse save results for %s', async (_name, surface, next) => {
    const { requests, signal, create } = fixture()
    await requests.save({ ...draft, apiKey: 'fixture-key' }, 'sidebar', signal)
    await requests.save({ ...next, apiKey: 'fixture-key' }, surface, signal)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenNthCalledWith(2, next, 'fixture-key', signal, false)
  })

  it('retains the key for a retry of an unconfirmed settings write', async () => {
    const { requests, signal, create } = fixture()
    const failure = new AppError({
      code: 'BACKEND_UNREACHABLE',
      message: 'Timed out.',
      retryable: true,
      context: { customProviderWriteUnconfirmed: true },
    })
    create.mockRejectedValueOnce(failure)
    const submitted = { ...draft, apiKey: 'fixture-key' }
    await expect(requests.save(submitted, 'sidebar', signal)).rejects.toBe(failure)
    await expect(requests.save(submitted, 'sidebar', signal)).resolves.toEqual(saved)
    expect(create).toHaveBeenNthCalledWith(2, draft, 'fixture-key', signal, true)
  })

  it('leaves authentication to DSH when the field is blank', async () => {
    const { requests, signal, discover, create } = fixture()
    await requests.discover({ ...discovery, apiKey: '' }, signal)
    await requests.save({ ...draft, apiKey: '' }, 'sidebar', signal)
    expect(discover).toHaveBeenCalledExactlyOnceWith(discovery, signal)
    expect(create).toHaveBeenCalledExactlyOnceWith(draft, undefined, signal, false)
  })

  it('retries credential storage with the original draft and key', async () => {
    const { requests, signal, create } = fixture()
    create.mockResolvedValueOnce({
      profileCommitted: true,
      credentialConfigured: false,
      credentialError: 'Store failed.',
    })
    const submitted = { ...draft, apiKey: 'fixture-key' }
    await expect(requests.save(submitted, 'sidebar', signal)).resolves.toHaveProperty('credentialError')
    await expect(requests.save(submitted, 'sidebar', signal)).resolves.toEqual(saved)
    expect(create).toHaveBeenNthCalledWith(2, draft, 'fixture-key', signal, true)
  })

  it('does not publish a supplied key echoed in a discovery response', async () => {
    const { requests, signal, discover } = fixture()
    discover.mockResolvedValueOnce([{ id: 'model', label: 'Bearer fixture-key' }])
    await expect(requests.discover({ ...discovery, apiKey: 'fixture-key' }, signal)).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
    })
  })
})
