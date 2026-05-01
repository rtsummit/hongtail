// English dict. Keys mirror ko.ts.
export const en: Record<string, string> = {
  // === Settings modal ===
  'settings.title': 'Settings',
  'settings.close': 'Close',
  'settings.font': 'Font',
  'settings.fontSize': 'Font size',
  'settings.loadingFonts': 'Loading system fonts…',
  'settings.fontHint':
    'Fonts fall back left to right. Use ‹ › to reorder.',
  'settings.readonlyChunkSize': 'Read-only chunk size (lines per load)',
  'settings.toolCardsDefaultOpen': 'Tool cards expanded by default',
  'settings.language': 'Language',
  'settings.language.auto': 'Auto (browser locale)',
  'settings.language.ko': '한국어',
  'settings.language.en': 'English',
  'settings.web.title': 'Web mode',
  'settings.web.password': 'Password',
  'settings.web.passwordSet': '(set)',
  'settings.web.passwordUnset': '— not set',
  'settings.web.passwordPlaceholder': 'New password (8+ characters)',
  'settings.web.passwordConfirm': 'Confirm password',
  'settings.web.passwordSubmitSet': 'Set',
  'settings.web.passwordSubmitChange': 'Change',
  'settings.web.enabled': 'Enable web server (external browser / mobile access)',
  'settings.web.port': 'Port',
  'settings.reset': 'Reset',
  'settings.done': 'Done',

  // === Chat composer ===
  'chat.placeholder.desktop':
    'Type a message (Enter: send, Shift+Enter: newline, /: command, 📎: file)',
  'chat.placeholder.mobile': 'Type a message (use send button)',
  'chat.send': 'Send',
  'chat.interrupt': 'Interrupt current turn (keeps session)',
  'chat.attach.title': 'Attach file (image / any file)',
  'chat.attach.aria': 'Attach file',

  // === Readonly activation ===
  'chat.readonly.label': 'Previous conversation — read-only',
  'chat.activate.full': 'Activate (Full)',
  'chat.activate.full.short': 'Full',
  'chat.activate.summary': 'Activate (Summary)',
  'chat.activate.summary.short': 'Summary',
  'chat.activate.terminal': 'Open in Terminal',
  'chat.activate.terminal.short': 'Terminal',

  // === Sidebar ===
  'sidebar.addWorkspace': 'Add workspace',
  'sidebar.minimize': 'Collapse sidebar',
  'sidebar.expand': 'Expand sidebar',
  'sidebar.settings': 'Settings',
  'sidebar.filter.all': 'All',
  'sidebar.filter.active': 'Active',
  'sidebar.filter.days': '{n}d',
  'sidebar.toggle.aria': 'Open/close sidebar',

  // === System / event messages ===
  'system.interrupted': '— interrupted —',
  'system.result': 'Result: {subtype}',
  'system.stderr': '[stderr] {data}',
  'system.spawnFailed': 'Failed to start process: {error}',
  'system.processExit': '[process exited code={code}]',
  'system.code.unknown': '?',

  // === Tool cards ===
  'tool.error': 'Error',
  'tool.openInWindow': 'Open in window',
  'tool.modal.expand': 'Expand to modal',
  'tool.modal.close': 'Close',
  'tool.modal.codeView': 'Code view',
  'tool.modal.response': 'Response',
  'tool.bash.noOutput': 'No output',
  'tool.bash.linesOutput': '{n} line output',
  'tool.read.linesRead': 'Read {n} lines',
  'tool.write.linesWritten': 'Wrote {n} lines',
  'tool.search.results': '{n} results',
  'tool.search.noResults': 'No results',
  'tool.glob.files': '{n} files',
  'tool.todo.hasResult': 'Has result',
  'tool.argsHint.openFile': '\n(Ctrl/⌘-click: open file)',

  // === Bubble (assistant message) actions ===
  'bubble.copy': 'Copy',
  'bubble.copied': 'Copied',
  'bubble.collapse': 'Collapse',
  'bubble.expand': 'Expand',
  'bubble.collapsed': '··· (collapsed — click to expand)',

  // === Side chat ===
  'sideChat.toggle.aria': 'Open/close BTW side chat',
  'sideChat.subtitle': 'Side question without interrupting main work',
  'sideChat.clear': 'Clear',
  'sideChat.collapseTitle': 'Collapse panel',
  'sideChat.expandTitle': 'Expand BTW side chat',
  'sideChat.placeholder.enabled': 'Ask BTW (Enter to send)',
  'sideChat.placeholder.disabled': 'Select a main session first',
  'sideChat.send': 'Send',
  'sideChat.cancel': 'Cancel',
  'sideChat.thinking': 'Thinking…',
  'sideChat.empty.noSession':
    'Select a main session to ask BTW questions in its context.',
  'sideChat.empty.helper':
    'A side chat with no tools — answers using only the main conversation context.\nFeel free to ask without interrupting your main work.'
}
