import type { ProtocolEnvelope } from '@dsh-vscode/webview-protocol'

export interface VsCodeApi<State = unknown> {
  postMessage(message: ProtocolEnvelope): void
  getState(): State | undefined
  setState(newState: State): void
}

declare function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>

export function hasVsCodeApi(): boolean {
  return typeof acquireVsCodeApi === 'function'
}

export function runtimeEnvironment(): 'ssh-remote' | 'wsl' | 'default' {
  const remoteName =
    typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-dsh-remote')
  return remoteName === 'ssh-remote' || remoteName === 'wsl' ? remoteName : 'default'
}

const holder: { singleton?: VsCodeApi } = {}

export function getVsCodeApi(): VsCodeApi {
  if (holder.singleton !== undefined) return holder.singleton
  holder.singleton = hasVsCodeApi()
    ? acquireVsCodeApi()
    : { postMessage: () => undefined, getState: () => undefined, setState: () => undefined }
  return holder.singleton
}
