# Code Bridge

Control your Cursor/VS Code editor remotely from Telegram. Run terminal commands, send prompts to the Cursor AI agent, and approve or deny agent actions — all from your phone.

No extra AI layer. Messages go straight through; terminal output comes straight back.

## Features

**Terminal control** — run shell commands in your workspace and fetch output on demand.

**Multi-session** — create named terminal sessions (`/new backend`, `/new frontend`) and switch between them.

**Cursor agent bridge** — send prompts to the Cursor AI agent and receive completion notifications when it finishes.

**Approval flow** — get notified on Telegram when the agent wants to run a command. Reply `yes` or `no` to approve or skip.

**Security hardened** — chat ID allowlist, optional shared-secret auth, command denylist, workspace-restricted paths, sanitized environment, command timeouts, and session caps.

## Prerequisites

- [Cursor](https://cursor.sh) or VS Code `>=1.85.0`
- Node.js `>=18`
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- macOS Accessibility permission for Cursor (required for agent injection and approval keypress simulation)

## Setup

### 1. Create a Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Choose a display name (e.g. `Cursor Bridge Bot`).
4. Choose a username ending in `bot` (e.g. `my_cursor_bridge_bot`).
5. BotFather replies with a token like `123456789:AAHk...`. Copy it.

### 2. Get your chat ID

1. Send any message to your new bot.
2. The bot replies: `This chat is not authorized. Your chat ID is: 987654321`.
3. Copy that number.

### 3. Install and configure the extension

```bash
cd code-bridge
npm install
npm run build
```

Open Cursor Settings (JSON) and add:

```json
{
  "codeBridge.botToken": "123456789:AAHk...",
  "codeBridge.allowedChatIds": [987654321]
}
```

### 4. Start the bridge

Open the command palette and run **Code Bridge: Start**.

The status bar shows `TG Bridge` when running.

### 5. (Optional) Enable auth secret

For an extra layer of security, set a shared secret:

```json
{
  "codeBridge.authSecret": "my-secret-passphrase"
}
```

When set, every Telegram chat must send `/auth my-secret-passphrase` before any command is accepted.

## Telegram Commands

### Terminal

| Command | Description |
|---------|-------------|
| `/run <command>` | Run a shell command in the active session |
| `/out` | Fetch latest output (tail) |
| `/status` | Show running/idle state, cwd, last exit code |
| `/pwd` | Print working directory |
| `/cd <path>` | Change directory (restricted to workspace) |
| `/kill` | Send SIGINT to running command |

### Sessions

| Command | Description |
|---------|-------------|
| `/new <name>` | Create a new terminal session and switch to it |
| `/use <name>` | Switch active session |
| `/sessions` | List all sessions with status |

### Cursor Agent

| Command | Description |
|---------|-------------|
| `/agent <message>` | Send a prompt to the Cursor AI agent |
| `yes` / `y` / `run` | Approve a pending agent shell command |
| `no` / `n` / `skip` | Deny a pending agent shell command |

### Other

| Command | Description |
|---------|-------------|
| `/auth <secret>` | Authenticate (when `authSecret` is configured) |
| `/help` | Show all available commands |

## How It Works

### Terminal mode

`/run` spawns a child process in your workspace directory. stdout and stderr are captured in a rolling buffer. `/out` returns the last 60 lines. Commands auto-timeout after `commandTimeoutSec` (default 600s).

### Agent mode

`/agent` pastes your message into Cursor's composer and presses Enter. Cursor hooks (`beforeShellExecution`, `afterAgentResponse`, `stop`) send notifications back to Telegram:

- **Approval needed** — when the agent wants to run a shell command, you get a Telegram message with the command. Reply `yes` or `no`.
- **Agent completed** — when the agent finishes, the last response is sent to Telegram.
- **Agent error/stopped** — error or abort status is relayed.

Hooks are auto-deployed to `.cursor/hooks.json` and `.cursor/hooks/notify-telegram.mjs` on startup.

## Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `codeBridge.botToken` | string | `""` | Telegram bot token from @BotFather |
| `codeBridge.allowedChatIds` | number[] | `[]` | Allowed Telegram chat IDs (required) |
| `codeBridge.autoStart` | boolean | `false` | Auto-start bridge on extension activation |
| `codeBridge.authSecret` | string | `""` | Shared secret for `/auth` handshake |
| `codeBridge.maxSessions` | number | `5` | Max concurrent terminal sessions |
| `codeBridge.commandTimeoutSec` | number | `600` | Auto-kill timeout per `/run` command |
| `codeBridge.responseTimeoutSec` | number | `300` | Agent response timeout |
| `codeBridge.responseDirName` | string | `".code-bridge"` | Workspace directory for bridge files |

## Extension Commands

| Command | Description |
|---------|-------------|
| `Code Bridge: Start` | Start the bridge |
| `Code Bridge: Stop` | Stop the bridge |
| `Code Bridge: Status` | Show bridge status and allowed chat IDs |

## Security

- **Chat ID allowlist** — only configured chat IDs can interact with the bridge.
- **Auth secret** — optional second factor; chats must authenticate before commands are accepted.
- **Command denylist** — `rm -rf`, `mkfs`, `dd`, fork bombs, `curl|sh`, `shutdown`, `reboot`, and other destructive patterns are blocked.
- **Workspace-restricted paths** — `/cd` cannot navigate outside the workspace root.
- **Sanitized environment** — child processes only inherit safe env vars (PATH, HOME, LANG, tool paths). Secrets like GITHUB_TOKEN or AWS keys are stripped.
- **Command timeout** — processes exceeding the timeout are auto-killed.
- **Session cap** — limited concurrent sessions prevent resource exhaustion.
- **Token file permissions** — `.code-bridge/hook-config.json` is written with `chmod 600`.
- **Gitignored** — `.code-bridge/` is in `.gitignore` so tokens never enter version control.

## Project Structure

```
code-bridge/
  src/
    extension.ts          Entry point, lifecycle management
    config.ts             Settings reader
    types.ts              Shared interfaces
    bridge/
      manager.ts          Command router, session + agent orchestration
    terminal/
      session.ts          Shell process management, denylist, timeout
    telegram/
      bot.ts              grammy bot wrapper, message routing
      auth.ts             Chat ID validation
    adapters/
      types.ts            EditorAdapter interface
      detect.ts           Auto-detect Cursor vs VS Code
      cursor.ts           Cursor composer injection
      vscode.ts           VS Code chat injection
    hooks/
      config-writer.ts    Deploys hooks.json + hook script to workspace
    utils/
      keyboard.ts         OS-level keypress simulation
      clipboard.ts        Safe clipboard read/write/restore
      logger.ts           Output channel logging
  .cursor/
    hooks.json            Cursor hook configuration
    hooks/
      notify-telegram.mjs Hook script for agent notifications
  .code-bridge/           (gitignored) runtime config + debug log
  out/                    (gitignored) compiled JS
```

## Development

```bash
npm install
npm run watch        # rebuild on file changes
# Press F5 in Cursor to launch Extension Development Host
```

## License

MIT
