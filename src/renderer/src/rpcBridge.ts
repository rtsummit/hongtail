import type { Backend, Block, SelectedSession, SessionStatus } from './types'

export type ActiveMode = 'new' | 'resume-full' | 'resume-summary'

export interface ActiveEntry {
  workspacePath: string
  mode: ActiveMode
  backend: Backend
}

export interface RpcSnapshot {
  workspaces: string[]
  selected: SelectedSession | null
  active: Record<string, ActiveEntry>
  status: Record<string, SessionStatus>
  messageCounts: Record<string, number>
}

export interface RpcWaiterEntry {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: number
}

export interface RpcActions {
  addWorkspace: (path: string) => Promise<void>
  startSession: (
    workspacePath: string,
    backend: Backend,
    mode: ActiveMode,
    sessionId?: string | null
  ) => Promise<{ sessionId: string }>
  selectSession: (workspacePath: string, sessionId: string, title: string) => void
  activate: (mode: 'resume-full' | 'resume-summary') => void
  sendInput: (sessionId: string, text: string) => Promise<void>
  controlRequest: (sessionId: string, request: Record<string, unknown>) => Promise<string>
  waitResult: (sessionId: string, timeoutMs?: number) => Promise<unknown>
}

export interface RpcInstall {
  getSnapshot: () => RpcSnapshot
  getMessages: (sessionId: string) => Block[]
  actions: RpcActions
}

declare global {
  interface Window {
    __rpc?: {
      getState: () => RpcSnapshot
      getMessages: (sessionId: string) => Block[]
      addWorkspace: RpcActions['addWorkspace']
      startSession: RpcActions['startSession']
      selectSession: RpcActions['selectSession']
      activate: RpcActions['activate']
      sendInput: RpcActions['sendInput']
      controlRequest: RpcActions['controlRequest']
      waitResult: RpcActions['waitResult']
    }
  }
}

export function installRpcBridge(install: RpcInstall): () => void {
  window.__rpc = {
    getState: () => install.getSnapshot(),
    getMessages: (id) => install.getMessages(id),
    addWorkspace: (...args) => install.actions.addWorkspace(...args),
    startSession: (...args) => install.actions.startSession(...args),
    selectSession: (...args) => install.actions.selectSession(...args),
    activate: (...args) => install.actions.activate(...args),
    sendInput: (...args) => install.actions.sendInput(...args),
    controlRequest: (...args) => install.actions.controlRequest(...args),
    waitResult: (...args) => install.actions.waitResult(...args)
  }
  return () => {
    delete window.__rpc
  }
}
