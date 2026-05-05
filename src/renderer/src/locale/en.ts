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
  'chat.readonly.label.withCtx': 'Previous conversation (Context {pct}%) — read-only',
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
    'A side chat with no tools — answers using only the main conversation context.\nFeel free to ask without interrupting your main work.',

  // === Confirm cards (AskUserQuestion / ExitPlanMode) ===
  'confirm.askUserQuestion.title': 'User input requested',
  'confirm.answered': 'Answered',
  'confirm.cancelled': 'Cancelled',
  'confirm.submit': 'Submit',
  'confirm.cancel': 'Cancel',
  'confirm.exitPlan.title': 'Plan approval requested',
  'confirm.approved': 'Approved',
  'confirm.denied': 'Denied',
  'confirm.savedTo': 'Saved to',
  'confirm.approveAndProceed': 'Approve and proceed',
  'confirm.denyWithFeedback': 'Deny with feedback',
  'confirm.feedbackPlaceholder': 'What part of the plan should be reworked?',
  'confirm.sendDenial': 'Send denial',

  // === Workspace card ===
  'workspace.dragHint': 'Drag to reorder',
  'workspace.aliasPlaceholder': 'Alias (clear to remove)',
  'workspace.removeTitle': 'Remove this workspace from the list',
  'workspace.newSessionPending': 'Pending new conversation (selected)',
  'workspace.newSessionStart': 'Start new conversation in this directory (app mode)',
  'workspace.newTerminalStart': 'Start new terminal session in this directory',
  'workspace.stopSession': 'Stop this live conversation',
  'workspace.newConversation': 'New conversation',
  'workspace.newTerminal': 'New terminal',

  // === Session row / title ===
  'session.deleteTitle': 'Delete conversation',
  'session.titleNew': 'New conversation',
  'session.aliasPlaceholder': 'Alias (clear to remove)',
  'session.aliasHintEdit': '\nOriginal title: {base}\n\nDouble-click: edit alias',
  'session.aliasHintAdd': '\n\nDouble-click: add alias',

  // === Sidebar ===
  'sidebar.dateFilterAria': 'Activity period filter',
  'splitter.title': 'Drag to resize sidebar',

  // === ChatPane empty / subtitle ===
  'chat.empty.startHint': 'Start with "+ New conversation" in a workspace',
  'chat.subtitle.readonly': 'read-only',

  // === FindBar ===
  'find.notFound': 'none',
  'find.placeholder.terminal': 'Search terminal…',
  'find.placeholder.app': 'Search messages…',
  'find.prev': 'Previous (Shift+Enter)',
  'find.next': 'Next (Enter)',
  'find.close': 'Close (Esc)',

  // === Quote (selection-to-comment) ===
  'quote.affordance': '💬 Quote',
  'quote.placeholder': 'Comment (Ctrl/⌘+Enter to add, Esc to cancel)',
  'quote.add': 'Add',
  'quote.remove': 'Remove quote',

  // === Settings modal — font chips, password ===
  'settings.fontChip.up': 'Move up',
  'settings.fontChip.down': 'Move down',
  'settings.fontChip.remove': 'Remove',
  'settings.fontChip.add': 'Add',
  'settings.fontChip.empty': 'Default (system font)',
  'settings.fontChip.pick': '— Pick a font —',
  'settings.password.tooShort': 'Password must be at least 8 characters',
  'settings.password.mismatch': 'Passwords do not match',
  'settings.password.changed': 'Changed. All existing sessions invalidated.',

  // === UsageBar ===
  'usage.weekly': 'Weekly',
  'usage.reset': '{time}',
  'usage.resetDone': 'Reset',
  'usage.warned': '⚠ Near limit',
  'usage.rejected': '🚫 Blocked',
  'usage.modelChange': 'Change model',
  'usage.modeChange': 'Change permission mode',
  'usage.sessionTotalTitle': 'Session total (incl. sub-agents)',
  'usage.sessionInputTitle':
    '↑ Input tokens — cumulative sent to the model (chat history + system prompt + this turn + cache read/creation)',
  'usage.sessionOutputTitle':
    '↓ Output tokens — cumulative generated by the model (reply text + tool call args + thinking)',
  'usage.model.default.hint': 'Default (model used at session start)',
  'usage.model.opus.hint': 'Highest capability — slower / pricier',
  'usage.model.sonnet.hint': 'Balanced — everyday work',
  'usage.model.haiku.hint': 'Fast & cheap — simple tasks',
  'usage.mode.default.hint': 'Default — confirm every tool call',
  'usage.mode.auto.hint': 'Auto-classify (allow safe ops)',
  'usage.mode.plan.hint': 'Block tools, draft plan only',
  'usage.mode.acceptEdits.hint': 'Auto-approve file edits',
  'usage.mode.bypassPermissions.hint': '⚠ Bypass all permissions',

  // === App ===
  'app.workspacePathPrompt': 'Workspace directory path (absolute, host PC)',
  'app.compactRequested': '▸ /compact requested',
  'app.confirmStopSession': 'Stop this live conversation? (history is kept)',

  // === Confirm modal (in-app replacement for native window.confirm) ===
  'dialog.ok': 'OK',
  'dialog.cancel': 'Cancel'
}
