// Must be imported before any `prismjs/components/*` so that the IIFEs
// can find `Prism` on globalThis and extend the same shared instance.
import { Prism } from 'prism-react-renderer'

;(globalThis as unknown as { Prism: typeof Prism }).Prism = Prism

export {}
