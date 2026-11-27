// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { ModelProvider } from '@dsh-vscode/domain'
import { PROTOCOL_VERSION } from '@dsh-vscode/webview-protocol'
import { ProtocolClient } from '../../app/protocol-client.js'
import { I18nProvider } from '../../i18n.js'
import { CustomProviderCard } from './CustomProviderCard.js'

function renderCard(reasoningLevels?: readonly string[]): {
  readonly onCreate: ReturnType<typeof vi.fn>
  readonly onDiscover: ReturnType<typeof vi.fn>
} {
  const onCreate = vi.fn().mockResolvedValue({ profileCommitted: true, credentialConfigured: true })
  const onDiscover = vi.fn().mockResolvedValue([])
  render(
    <I18nProvider>
      <CustomProviderCard
        template={{
          settingsNamespace: 'llm-custom',
          collectionPath: ['providers'],
          protocols: ['openai-compatible'],
          revision: 4,
        }}
        providers={[]}
        reasoningLevels={reasoningLevels}
        writable
        saving={false}
        onClose={vi.fn()}
        onCreate={onCreate}
        onDiscover={onDiscover}
      />
    </I18nProvider>,
  )
  return { onCreate, onDiscover }
}

function addModel(id: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }))
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: id } })
}

describe('CustomProviderCard model validation', () => {
  afterEach(() => cleanup())

  it('names the capacity field that is actually invalid', () => {
    renderCard()
    addModel('model-a')
    fireEvent.click(screen.getByRole('button', { name: 'Advanced model settings' }))
    fireEvent.change(screen.getByLabelText('Max output tokens'), { target: { value: 'abc' } })

    expect(
      screen.getByText('Max output tokens must be a positive integer, optionally using K or M.'),
    ).toBeDefined()
    expect(
      screen.queryByText('Context window must be a positive integer, optionally using K or M.'),
    ).toBeNull()
  })

  it('still enables submission for a valid model capacity', () => {
    renderCard()
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'my-router' } })
    fireEvent.change(screen.getByLabelText('API URL'), {
      target: { value: 'https://api.example.com' },
    })
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save provider' })
    expect(save.disabled).toBe(true)
    addModel('model-a')
    fireEvent.click(screen.getByRole('button', { name: 'Advanced model settings' }))
    fireEvent.change(screen.getByLabelText('Max output tokens'), { target: { value: '32K' } })

    expect(save.disabled).toBe(false)
  })

  it('emphasizes that both actions use the key from the form', () => {
    renderCard()
    const instruction = screen.getByText('Fetching models and saving the provider use the key above', {
      selector: 'strong',
    })
    const save = screen.getByRole('button', { name: 'Save provider' })
    expect(save.getAttribute('aria-describedby')).toBe(instruction.parentElement?.id)
    expect(instruction.parentElement?.textContent).toContain('You can also click Add model')
  })

  it('masks the API key and uses one input for both discovery and saving', async () => {
    const { onCreate, onDiscover } = renderCard()
    onDiscover.mockResolvedValueOnce([{ id: 'model-a', label: 'Model A' }])
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'my-router' } })
    fireEvent.change(screen.getByLabelText('API URL'), { target: { value: 'https://api.example.com' } })

    const key = screen.getByLabelText<HTMLInputElement>('API key (optional)')
    fireEvent.change(key, { target: { value: 'fixture-key' } })
    expect(key.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show API key' }))
    expect(key.type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: 'Get available models' }))
    const picker = await screen.findByRole('dialog', { name: 'Available models' })
    expect(onDiscover).toHaveBeenCalledWith({
      settingsNamespace: 'llm-custom',
      providerId: 'my-router',
      baseUrl: 'https://api.example.com',
      api: 'openai-compatible',
      apiKey: 'fixture-key',
    })
    fireEvent.click(within(picker).getByRole('button', { name: 'Add selected' }))
    expect(key.type).toBe('password')
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save provider' })
    await vi.waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await vi.waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'my-router', models: [{ id: 'model-a', name: 'Model A' }] }),
        expect.stringMatching(/^[a-f\d-]{36}$/u),
        'fixture-key',
      ),
    )
    await vi.waitFor(() => expect(key.value).toBe(''))
  })

  it('keeps retry available when a timed-out save has already appeared in the provider catalog', async () => {
    const client = new ProtocolClient({
      postMessage: () => undefined,
      getState: () => undefined,
      setState: () => undefined,
    })
    const failed = client
      .request({ type: 'providers.list', requestId: 'unconfirmed-save' })
      .catch((reason: unknown) => reason)
    client.handle({
      protocolVersion: PROTOCOL_VERSION,
      message: {
        type: 'response',
        requestId: 'unconfirmed-save',
        ok: false,
        error: { code: 'BACKEND_UNREACHABLE', message: 'Timed out.', retryable: true },
      },
    })
    const error = await failed
    client.dispose()
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ profileCommitted: true, credentialConfigured: true })
    const onClose = vi.fn()
    const renderProvider = (providers: readonly ModelProvider[]): ReactElement => (
      <I18nProvider>
        <CustomProviderCard
          template={{
            settingsNamespace: 'llm-custom',
            collectionPath: ['providers'],
            protocols: ['openai-compatible'],
            revision: 4,
          }}
          providers={providers}
          writable
          saving={false}
          onClose={onClose}
          onCreate={onCreate}
          onDiscover={() => Promise.resolve([])}
        />
      </I18nProvider>
    )
    const view = render(renderProvider([]))
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'my-router' } })
    fireEvent.change(screen.getByLabelText('API URL'), { target: { value: 'https://api.example.com' } })
    fireEvent.change(screen.getByLabelText('API key (optional)'), { target: { value: 'fixture-key' } })
    addModel('model-a')
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }))
    await screen.findByRole('alert')
    view.rerender(
      renderProvider([
        { id: 'my-router', name: 'My router', configurable: true, kind: 'remote', fields: [] },
      ]),
    )
    const retry = screen.getByRole<HTMLButtonElement>('button', { name: 'Retry save' })
    expect(retry.disabled).toBe(false)
    fireEvent.click(retry)
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
    expect(onCreate.mock.calls[1]).toEqual(onCreate.mock.calls[0])
  })

  it('carries the declared reasoning levels into the provider profile', () => {
    const { onCreate } = renderCard(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'my-router' } })
    fireEvent.change(screen.getByLabelText('API URL'), {
      target: { value: 'https://api.example.com' },
    })
    addModel('model-a')
    expect(screen.queryByRole('switch', { name: 'Reasoning effort 1' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced model settings' }))
    const effort = screen.getByRole<HTMLInputElement>('switch', { name: 'Reasoning effort 1' })
    expect(effort.checked).toBe(false)
    fireEvent.click(effort)
    expect(effort.checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [
          expect.objectContaining({
            id: 'model-a',
            reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
          }),
        ],
      }),
      expect.stringMatching(/^[a-f\d-]{36}$/u),
      '',
    )
  })

  it('refuses a reasoning declaration that offers no thinking level', () => {
    renderCard(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'my-router' } })
    fireEvent.change(screen.getByLabelText('API URL'), {
      target: { value: 'https://api.example.com' },
    })
    addModel('model-a')
    fireEvent.click(screen.getByRole('button', { name: 'Advanced model settings' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Reasoning effort 1' }))
    for (const level of ['low', 'medium', 'high']) {
      fireEvent.click(screen.getByRole('button', { name: `Remove reasoning level ${level}` }))
    }

    expect(screen.queryAllByText('Declare at least one reasoning level besides off.').length).toBeGreaterThan(
      0,
    )
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save provider' }).disabled).toBe(true)
  })
})
