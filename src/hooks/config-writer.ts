import * as vscode from "vscode";
import { BridgeConfig } from "../types";
import { logInfo, logError } from "../utils/logger";

const HOOKS_JSON = JSON.stringify(
  {
    version: 1,
    hooks: {
      beforeShellExecution: [
        { command: "node .cursor/hooks/notify-telegram.mjs", timeout: 10 }
      ],
      stop: [{ command: "node .cursor/hooks/notify-telegram.mjs" }]
    }
  },
  null,
  2
);

const HOOK_SCRIPT = `#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import https from "node:https";

const input = await readStdin();
const event = input.hook_event_name || "unknown";

const projectDir =
  process.env.CURSOR_PROJECT_DIR ||
  (input.workspace_roots && input.workspace_roots[0]) ||
  process.cwd();

const configPath = join(projectDir, ".tg-bridge", "hook-config.json");

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  process.exit(0);
}

if (!config.botToken || !config.chatIds?.length) {
  process.exit(0);
}

let text;
let hookOutput = {};

if (event === "beforeShellExecution") {
  const cmd = input.command || "unknown command";
  text = "Approval needed: Agent wants to run:\\n\\n$ " + cmd + "\\n\\nPlease open Cursor and click Run or Skip.";
  hookOutput = { permission: "ask" };
} else if (event === "stop") {
  const status = input.status || "unknown";
  if (status === "completed") {
    text = "Agent finished execution successfully.";
  } else if (status === "error") {
    text = "Agent encountered an error. Please check Cursor.";
  } else {
    text = "Agent stopped. Please check Cursor.";
  }
} else {
  text = "Agent event: " + event + ". Please check Cursor.";
}

for (const chatId of config.chatIds) {
  await sendTelegram(config.botToken, chatId, text);
}

process.stdout.write(JSON.stringify(hookOutput));
process.exit(0);

async function sendTelegram(token, chatId, message) {
  const payload = JSON.stringify({ chat_id: chatId, text: message });
  const options = {
    hostname: "api.telegram.org",
    path: "/bot" + token + "/sendMessage",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload)
    }
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      res.on("data", () => {});
      res.on("end", resolve);
    });
    req.on("error", resolve);
    req.write(payload);
    req.end();
  });
}

async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
  }
  try {
    return JSON.parse(raw.trim());
  } catch {
    return {};
  }
}
`;

export async function writeHookConfig(cfg: BridgeConfig): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return;
  }

  try {
    const tgBridgeDir = vscode.Uri.joinPath(folder.uri, cfg.responseDirName);
    await vscode.workspace.fs.createDirectory(tgBridgeDir);

    const configUri = vscode.Uri.joinPath(tgBridgeDir, "hook-config.json");
    const payload = { botToken: cfg.botToken, chatIds: cfg.allowedChatIds };
    await vscode.workspace.fs.writeFile(
      configUri,
      Buffer.from(JSON.stringify(payload, null, 2), "utf8")
    );
    logInfo(`Hook config written to ${configUri.fsPath}`);

    const cursorDir = vscode.Uri.joinPath(folder.uri, ".cursor");
    const hooksDir = vscode.Uri.joinPath(cursorDir, "hooks");
    await vscode.workspace.fs.createDirectory(hooksDir);

    const hooksJsonUri = vscode.Uri.joinPath(cursorDir, "hooks.json");
    await writeIfMissing(hooksJsonUri, HOOKS_JSON);

    const scriptUri = vscode.Uri.joinPath(hooksDir, "notify-telegram.mjs");
    await vscode.workspace.fs.writeFile(scriptUri, Buffer.from(HOOK_SCRIPT, "utf8"));
    logInfo(`Hook script written to ${scriptUri.fsPath}`);
  } catch (err) {
    logError(`Failed writing hook files: ${String(err)}`);
  }
}

async function writeIfMissing(uri: vscode.Uri, content: string): Promise<void> {
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
    logInfo(`Created ${uri.fsPath}`);
  }
}
