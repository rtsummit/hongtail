import { useCallback, useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import ChatPane from './components/ChatPane'
import type { SelectedSession } from './types'

function App(): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [selected, setSelected] = useState<SelectedSession | null>(null)

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

  const startClaudeIn = useCallback(async (cwd: string) => {
    // Wired in Step 3
    console.log('[startClaudeIn]', cwd)
  }, [])

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        selected={selected}
        onAddWorkspace={addWorkspace}
        onSelect={setSelected}
        onStartClaude={startClaudeIn}
      />
      <ChatPane selected={selected} />
    </div>
  )
}

export default App
