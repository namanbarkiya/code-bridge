# Cursor Telegram Bridge

Simple pass-through bridge between Telegram and local AI chat in Cursor/VS Code.

## What it does

- Receives your Telegram message via bot token from @BotFather.
- Injects the message into Cursor agent chat (or VS Code chat fallback).
- Waits for agent completion by watching a response file.
- Sends the final response text back to your Telegram chat.

No extra AI is added by this extension.

## Setup

1. Install dependencies and build:
   - `npm install`
   - `npm run build`
2. Start extension development host from Run and Debug (`Run Extension`).
3. Complete Telegram bot setup (section below).
4. Open Settings and configure:
   - `tgBridge.botToken`
   - `tgBridge.allowedChatIds` (your Telegram chat ID)
5. Run command: `Telegram Bridge: Start`.

## Telegram Bot Setup (BotFather)

1. Open Telegram and search for `@BotFather`.
2. Send `/start`.
3. Send `/newbot`.
4. Enter a display name (example: `Cursor Bridge Bot`).
5. Enter a unique username that ends with `bot` (example: `cursor_bridge_demo_bot`).
6. BotFather returns a token like:
   - `123456789:AA...`
7. Copy this token and set it in `tgBridge.botToken`.

## Get Your Telegram Chat ID

1. Send any message to your new bot (example: `hello`).
2. If your chat ID is not allowlisted yet, the extension replies with:
   - `Your chat ID is: <number>`
3. Copy that number and set it in:
   - `tgBridge.allowedChatIds`
4. Use an array format in settings, for example:
   - `[123456789]`

## How response return works

The extension appends an instruction to your prompt asking the agent to write final output to:

`.tg-bridge/response-<id>.md`

A watcher picks this up and sends the content back to Telegram.

## Commands

- `Telegram Bridge: Start`
- `Telegram Bridge: Stop`
- `Telegram Bridge: Status`

## Telegram Notifications When Agent Stops

Uses Cursor Hooks (`stop` event) to send you a Telegram message **instantly** when the agent stops execution — whether it completed, errored, or is waiting for your approval.

How it works:

1. Extension writes `.tg-bridge/hook-config.json` (bot token + chat IDs) on start.
2. `.cursor/hooks.json` registers a `stop` hook.
3. `.cursor/hooks/notify-telegram.mjs` reads the config and calls the Telegram Bot API directly.
4. You get a message like: `Stopped: Agent execution aborted. Please check Cursor and approve if needed.`

No HTTP server, no polling. Cursor fires the hook, you get the notification.

After first setup, **restart Cursor once** so `.cursor/hooks.json` is loaded.

## Notes

- Cursor auto-submit uses OS-level Enter key simulation and may require Accessibility permission on macOS.
- Open a workspace folder before starting the bridge.
- The hook config file (`.tg-bridge/hook-config.json`) contains your bot token locally. It is gitignored.
