import { useCallback, useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import ChatPane from './components/ChatPane'
import type { Block, SelectedSession } from './types'

function App(): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [selected, setSelected] = useState<SelectedSession | null>(null)
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Block[]>>({})

  useEffect(() => {
    void window.api.workspaces.load().then(setWorkspaces)
  }, [])

  const persist = useCallback(async (next: string[]) => {
    setWorkspaces(next)
    await window.api.workspaces.save(next)
  }, [])

  const addWorkspace = useCallback(async () => {
    const picked = await window.api.workspaces.pickDirectory()
    if (!picked) return
    if (workspaces.includes(picked)) return
    await persist([picked, ...workspaces])
  }, [workspaces, persist])

  const startClaudeIn = useCallback((cwd: string) => {
    const sessionId = crypto.randomUUID()
    setSelected({
      workspacePath: cwd,
      sessionId,
      title: 'New session',
      isNew: true
    })
  }, [])

  const appendBlocks = useCallback((sessionId: string, blocks: Block[]) => {
    if (blocks.length === 0) return
    setMessagesBySession((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), ...blocks]
    }))
  }, [])

  const messages = selected ? (messagesBySession[selected.sessionId] ?? []) : []

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        selected={selected}
        onAddWorkspace={addWorkspace}
        onSelect={setSelected}
        onStartClaude={startClaudeIn}
      />
      <ChatPane selected={selected} messages={messages} onAppendBlocks={appendBlocks} />
    </div>
  )
}

export default App
