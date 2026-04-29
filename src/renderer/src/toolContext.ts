import { createContext } from 'react'

// Tool 이름 (Bash, Read, ...) 의 set. 비어 있으면 모든 카드 접힘.
export const ToolDefaultOpenContext = createContext<ReadonlySet<string>>(new Set())
