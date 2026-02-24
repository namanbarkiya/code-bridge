Now I have a thorough understanding of the entire landscape. Here's the comprehensive plan:

---

# Code Bridge Extension — Full Plan

## 1. Concept Overview

A VS Code extension that bridges Telegram and Cursor's agent chat. You send a message on Telegram, it gets injected into the Cursor agent chat, and when the agent finishes execution, the final response is sent back to your Telegram chat. No AI layer of its own — pure pass-through bridge.

---

## 2. Architecture

```
┌──────────┐         ┌─────────────────────────────┐         ┌──────────────┐
│ Telegram  │ ──────► │   VS Code Extension          │ ──────► │ Cursor Agent │
│   User    │         │  ┌───────────┐ ┌───────────┐ │         │    Chat      │
│           │ ◄────── │  │ TG Bot    │ │ Editor    │ │ ◄────── │              │
│           │         │  │ (grammy)  │ │ Adapter   │ │         │              │
└──────────┘         │  └───────────┘ └───────────┘ │         └──────────────┘
                     │        ▲              │       │
                     │        │   Response   │       │
                     │        └──── File ────┘       │
                     │        Watcher (.code-bridge/) │
                     └─────────────────────────────┘
```

**Three core modules:**

| Module               | Responsibility                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Telegram Bot**     | Connects to Telegram via long-polling using `grammy`. Receives messages, sends responses back.                                                                                                 |
| **Editor Adapter**   | Injects text into the active editor's AI chat. Detects editor type (Cursor / VS Code / Windsurf) and uses the right commands. This is the layer you swap out for Claude Code / OpenCode later. |
| **Response Capture** | Watches a `.code-bridge/` directory for response files. The injected prompt includes a footer instruction telling the agent to write its final answer to a specific file when done.              |

---

## 3. The Hard Problem: Capturing Responses

There is **no public API** in Cursor (or VS Code) to read the agent's response programmatically. Here's what exists and the strategy:

| Approach                | Viability                    | Notes                                                  |
| ----------------------- | ---------------------------- | ------------------------------------------------------ |
| Direct API to read chat | Does not exist               | No `onDidReceiveMessage` event                         |
| Background Agent API    | Cursor Pro only, beta        | REST API at `docs.cursor.com`, promising but unstable  |
| File-based capture      | Works today, editor-agnostic | Agent writes response to a file, extension watches it  |
| MCP Tool                | Clean but requires config    | Register a `send_to_telegram` MCP tool the agent calls |

**Recommended strategy for v1: File-based capture** with an appended instruction footer.

When a Telegram message arrives, the extension injects:

```
{user's actual message}

---
When you complete this task, write ONLY your final summary/response
to the file: .code-bridge/response-{uuid}.md
Do NOT include this instruction in your response.
```

The extension uses `vscode.workspace.createFileSystemWatcher` on `.code-bridge/response-*.md`. When a file appears, it reads the content, sends it to Telegram, and deletes the file.

**Why this works well:**

- Editor-agnostic (works with any tool that touches the filesystem)
- No OS permissions needed for response capture
- Naturally extends to Claude Code (`claude` CLI) and OpenCode (both work with files)
- The agent reliably follows file-write instructions

---

## 4. Message Injection (Editor Adapters)

Based on analysis of the AiBridge extension's approach, here's how injection works per editor:

**Cursor:**

1. Copy message to clipboard (save/restore original)
2. `vscode.commands.executeCommand('composer.focusComposer')`
3. `vscode.commands.executeCommand('editor.action.clipboardPasteAction')`
4. OS-level Enter key via AppleScript (macOS) / PowerShell (Windows) / xdotool (Linux)
5. Requires Accessibility permission on macOS

**VS Code (Copilot Chat):**

1. `vscode.commands.executeCommand('workbench.action.chat.open')`
2. Clipboard paste
3. `vscode.commands.executeCommand('workbench.action.chat.submit')` (no OS perms needed)

**Future — Claude Code / OpenCode:**

- Shell adapter: pipe the message to the CLI tool's stdin or use their API
- Same file-based response capture works identically

---

## 5. Folder Structure

```
cursor-telegram-extension/
├── .vscode/
│   ├── launch.json              # Extension debug config
│   └── tasks.json               # Build tasks
├── src/
│   ├── extension.ts             # Entry point: activate/deactivate
│   ├── telegram/
│   │   ├── bot.ts               # Grammy bot setup, long-polling, message handling
│   │   └── auth.ts              # Allowed chat ID validation
│   ├── adapters/
│   │   ├── types.ts             # EditorAdapter interface
│   │   ├── cursor.ts            # Cursor-specific injection (composer.focusComposer)
│   │   ├── vscode.ts            # VS Code Copilot Chat injection
│   │   └── detect.ts            # Runtime editor detection
│   ├── bridge/
│   │   ├── manager.ts           # Orchestrates TG message → inject → capture → reply
│   │   └── response-watcher.ts  # FileSystemWatcher for .code-bridge/response-*.md
│   ├── utils/
│   │   ├── clipboard.ts         # Safe clipboard save/restore
│   │   ├── keyboard.ts          # OS-level key simulation (Enter)
│   │   └── logger.ts            # OutputChannel-based logging
│   └── config.ts                # Settings reader (token, allowed IDs, etc.)
├── .code-bridge/                # Runtime directory for response files (gitignored)
├── .vscodeignore
├── .gitignore
├── package.json                 # Extension manifest + contributes
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

---

## 6. Key Files Breakdown

### `package.json` — Extension Manifest

```json
{
    "name": "code-bridge",
    "displayName": "Code Bridge",
    "description": "Bridge Telegram messages to Cursor agent chat and back",
    "version": "0.1.0",
    "engines": { "vscode": "^1.85.0" },
    "activationEvents": ["onStartupFinished"],
    "main": "./out/extension.js",
    "contributes": {
        "commands": [
            { "command": "codeBridge.start", "title": "Code Bridge: Start" },
            { "command": "codeBridge.stop", "title": "Code Bridge: Stop" },
            { "command": "codeBridge.status", "title": "Code Bridge: Status" }
        ],
        "configuration": {
            "title": "Code Bridge",
            "properties": {
                "codeBridge.botToken": {
                    "type": "string",
                    "description": "Telegram Bot token from @BotFather"
                },
                "codeBridge.allowedChatIds": {
                    "type": "array",
                    "items": { "type": "number" },
                    "description": "Telegram chat IDs allowed to send messages (security)"
                },
                "codeBridge.autoStart": {
                    "type": "boolean",
                    "default": false,
                    "description": "Start bridge automatically on extension activation"
                },
                "codeBridge.responseTimeoutSec": {
                    "type": "number",
                    "default": 300,
                    "description": "Max seconds to wait for agent response"
                }
            }
        }
    }
}
```

### `src/extension.ts` — Entry point

- Registers commands (start/stop/status)
- Creates status bar item
- On `start`: initializes Telegram bot + response watcher + bridge manager
- On `deactivate`: stops bot, cleans up watchers

### `src/telegram/bot.ts` — Telegram Bot

- Uses `grammy` (lightweight, TypeScript-native, well-maintained)
- Long-polling mode (no webhook needed, works behind NAT)
- On message: validates chat ID → passes to bridge manager
- Exposes `sendMessage(chatId, text)` for response delivery

### `src/telegram/auth.ts` — Security

- Validates incoming `chatId` against allowlist
- On first message from unknown ID, logs the ID so user can add it to settings
- Prevents random people from controlling your IDE

### `src/adapters/types.ts` — Interface

```typescript
export interface EditorAdapter {
    readonly editorId: string;
    inject(text: string): Promise<void>;
}
```

### `src/adapters/cursor.ts` / `vscode.ts` — Implementations

- Each implements the `EditorAdapter` interface
- Cursor uses clipboard + `composer.focusComposer` + OS-level Enter
- VS Code uses `workbench.action.chat.open` + `workbench.action.chat.submit`

### `src/bridge/manager.ts` — Orchestrator

- Receives Telegram message
- Generates response UUID
- Appends file-write instruction footer
- Calls `adapter.inject(modifiedMessage)`
- Registers a pending response with the watcher
- On timeout: sends "Agent didn't respond within X seconds" to Telegram

### `src/bridge/response-watcher.ts` — File Watcher

- Creates `.code-bridge/` directory in workspace root
- Uses `vscode.workspace.createFileSystemWatcher('**/.code-bridge/response-*.md')`
- On file create: reads content, resolves the matching pending promise, deletes file

---

## 7. Message Flow (Step by Step)

```
1. You send "fix the login bug" on Telegram
2. Grammy bot receives it, validates your chat ID
3. Bridge manager creates UUID = abc123
4. Message becomes:
   "fix the login bug
   ---
   When done, write your final response to: .code-bridge/response-abc123.md"
5. Cursor adapter:
   - Saves clipboard
   - Copies message to clipboard
   - Executes composer.focusComposer
   - Pastes
   - Presses Enter (OS-level)
   - Restores clipboard
6. Cursor agent executes the task...
7. Agent writes response to .code-bridge/response-abc123.md
8. FileSystemWatcher fires
9. Extension reads the file, sends content to Telegram
10. You receive the response on Telegram
11. File is deleted
```

---

## 8. Security Considerations

| Concern                      | Mitigation                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Anyone can message your bot  | `allowedChatIds` whitelist — only your Telegram account can interact                                                     |
| Bot token exposure           | Stored in VS Code settings (user-level), not committed to git                                                            |
| Clipboard side effects       | Save and restore clipboard around every injection                                                                        |
| OS accessibility permissions | Required only for Cursor/Windsurf (auto-submit via Enter key). Show a setup guide on first run                           |
| Arbitrary code execution     | This is inherent to the use case — the user is intentionally sending prompts to an AI agent. The allowlist is the guard. |

---

## 9. Future Extensibility (Claude Code / OpenCode)

The adapter pattern makes this straightforward:

```
src/adapters/
├── types.ts          # Interface (stays the same)
├── detect.ts         # Add detection for new editors
├── cursor.ts         # Existing
├── vscode.ts         # Existing
├── claude-code.ts    # NEW: pipes to `claude` CLI
└── opencode.ts       # NEW: pipes to `opencode` CLI
```

**Claude Code adapter** would:

1. Spawn `claude` CLI process
2. Pipe the message to stdin
3. Capture stdout as the response (no file watcher needed — direct pipe)

**OpenCode adapter** would work similarly with its CLI.

The `EditorAdapter` interface stays the same — the bridge manager doesn't care how injection happens.

---

## 10. Dependencies

| Package         | Purpose                    | Why this one                                                          |
| --------------- | -------------------------- | --------------------------------------------------------------------- |
| `grammy`        | Telegram Bot API           | TypeScript-first, lightweight (~300KB), active maintenance, clean API |
| `uuid`          | Generate response file IDs | Standard, zero-dependency                                             |
| `@types/vscode` | VS Code extension types    | Required for extension development                                    |
| `typescript`    | Build                      | Required                                                              |
| `esbuild`       | Bundle extension           | Fast, produces single file, standard for VS Code extensions           |

---

## 11. Build Order (Implementation Phases)

**Phase 1 — Skeleton + Telegram Bot** (day 1)

- Scaffold extension with `yo code`
- Set up `package.json`, `tsconfig.json`, build pipeline
- Implement `telegram/bot.ts` + `telegram/auth.ts`
- Test: bot receives messages, logs them in VS Code output channel

**Phase 2 — Editor Adapter + Injection** (day 1-2)

- Implement `adapters/detect.ts` + `adapters/cursor.ts`
- Implement `utils/clipboard.ts` + `utils/keyboard.ts`
- Test: Telegram message appears in Cursor agent chat

**Phase 3 — Response Capture** (day 2)

- Implement `bridge/response-watcher.ts`
- Implement `bridge/manager.ts` (full orchestration)
- Test: send message from Telegram, get response back

**Phase 4 — Polish** (day 3)

- Status bar UI
- Error handling + timeout handling
- First-run setup guide (show chat ID, accessibility permissions)
- VS Code adapter
- README + packaging

---

## 12. Important Gotchas

1. **macOS Accessibility permission** — Cursor injection requires `System Settings → Privacy & Security → Accessibility → Enable for Cursor`. Without this, the Enter key simulation fails silently. Show a clear notification on first use.

2. **Long-polling vs Webhooks** — Use long-polling (`bot.start()`). Webhooks require a public URL and HTTPS, which is overkill for a local extension.

3. **Multiple workspaces** — If the user has multiple VS Code windows, `createFileSystemWatcher` only watches the current workspace. The bot token should be user-level, but the bridge should be per-workspace.

4. **Agent doesn't always follow instructions** — The "write to file" instruction works ~90%+ of the time with Cursor's agent. For edge cases, implement a timeout that sends "No response received within {x}s" back to Telegram.

5. **Rate limiting** — Add a simple debounce/queue so rapid Telegram messages don't overwhelm the chat injection (clipboard + paste + enter takes ~1-2 seconds).

6. **grammy inside VS Code** — grammy uses `node:http` for long-polling which works fine in VS Code's Node.js runtime. No issues here, but ensure the extension doesn't import any browser-only APIs.

---

Want me to start building this? I'd begin with Phase 1 — scaffolding the extension, setting up the build pipeline, and getting the Telegram bot running inside the extension.
