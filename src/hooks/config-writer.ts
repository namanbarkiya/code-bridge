import * as vscode from "vscode";
import { chmod } from "node:fs/promises";
import { BridgeConfig } from "../types";
import { logInfo, logError } from "../utils/logger";

const HOOKS_JSON = JSON.stringify(
  {
    version: 1,
    hooks: {
      beforeShellExecution: [
        { command: "node .cursor/hooks/notify-telegram.mjs", timeout: 10 }
      ],
      afterAgentResponse: [
        { command: "node .cursor/hooks/notify-telegram.mjs" }
      ],
      stop: [{ command: "node .cursor/hooks/notify-telegram.mjs" }]
    }
  },
  null,
  2
);

const HOOK_SCRIPT = `#!/usr/bin/env node

import { readFileSync, writeFileSync, unlinkSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import https from "node:https";

const input = await readStdin();
const event = input.hook_event_name || "unknown";

const projectDir =
  process.env.CURSOR_PROJECT_DIR ||
  (input.workspace_roots && input.workspace_roots[0]) ||
  process.cwd();

const configPath = join(projectDir, ".code-bridge", "hook-config.json");
const lastResponsePath = join(projectDir, ".code-bridge", "last-response.txt");
const debugPath = join(projectDir, ".code-bridge", "debug.log");

function debug(msg) {
  try {
    appendFileSync(debugPath, "[" + new Date().toISOString() + "] " + msg + "\\n", "utf8");
  } catch {}
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  process.exit(0);
}

if (!config.botToken || !config.chatIds?.length) {
  process.exit(0);
}

let hookOutput = {};

debug("Event: " + event);

if (event === "afterAgentResponse") {
  const agentText = input.text || "";
  if (agentText) {
    try { writeFileSync(lastResponsePath, agentText, "utf8"); } catch {}
  }
  process.stdout.write(JSON.stringify(hookOutput));
  process.exit(0);
}

if (event === "beforeShellExecution") {
  const cmd = input.command || "unknown command";

  const text = "Approval needed: Agent wants to run:\\n\\n$ " + cmd + "\\n\\nReply 'yes' to allow or 'no' to deny.";
  for (const chatId of config.chatIds) {
    await sendTelegram(config.botToken, chatId, text);
  }

  debug("Sent approval notification for: " + cmd);

  hookOutput = { permission: "ask" };
  process.stdout.write(JSON.stringify(hookOutput));
  process.exit(0);
}

if (event === "stop") {
  const status = input.status || "unknown";
  let lastResponse = "";
  try {
    lastResponse = readFileSync(lastResponsePath, "utf8").trim();
    unlinkSync(lastResponsePath);
  } catch {}

  if (!lastResponse && input.transcript_path) {
    lastResponse = readLastAssistantFromTranscript(input.transcript_path);
  }

  let text;
  if (status === "completed") {
    text = lastResponse ? "Agent completed:\\n\\n" + lastResponse : "Agent finished execution successfully.";
  } else if (status === "error") {
    text = lastResponse ? "Agent error:\\n\\n" + lastResponse : "Agent encountered an error. Please check Cursor.";
  } else {
    text = lastResponse ? "Agent stopped:\\n\\n" + lastResponse : "Agent stopped. Please check Cursor.";
  }

  for (const chatId of config.chatIds) {
    await sendTelegram(config.botToken, chatId, text);
  }
}

process.stdout.write(JSON.stringify(hookOutput));
process.exit(0);

function readLastAssistantFromTranscript(transcriptPath) {
  try {
    const raw = readFileSync(transcriptPath, "utf8").trim();
    if (!raw) return "";
    const lines = raw.split("\\n");
    let last = "";
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (e.role === "assistant" && e.content) last = typeof e.content === "string" ? e.content : JSON.stringify(e.content);
        if (e.type === "assistant" && e.text) last = e.text;
      } catch {}
    }
    return last.trim();
  } catch { return ""; }
}

async function sendTelegram(token, chatId, message) {
  if (message.length > 4000) {
    message = message.slice(0, 4000) + "\\n\\n... (truncated)";
  }
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
    const bridgeDir = vscode.Uri.joinPath(folder.uri, cfg.responseDirName);
    await vscode.workspace.fs.createDirectory(bridgeDir);

    const configUri = vscode.Uri.joinPath(bridgeDir, "hook-config.json");
    const payload = { botToken: cfg.botToken, chatIds: cfg.allowedChatIds };
    await vscode.workspace.fs.writeFile(
      configUri,
      Buffer.from(JSON.stringify(payload, null, 2), "utf8")
    );
    try {
      await chmod(configUri.fsPath, 0o600);
    } catch {}
    logInfo(`Hook config written to ${configUri.fsPath}`);

    const cursorDir = vscode.Uri.joinPath(folder.uri, ".cursor");
    const hooksDir = vscode.Uri.joinPath(cursorDir, "hooks");
    await vscode.workspace.fs.createDirectory(hooksDir);

    const hooksJsonUri = vscode.Uri.joinPath(cursorDir, "hooks.json");
    await vscode.workspace.fs.writeFile(hooksJsonUri, Buffer.from(HOOKS_JSON, "utf8"));
    logInfo(`Hooks config written to ${hooksJsonUri.fsPath}`);

    const scriptUri = vscode.Uri.joinPath(hooksDir, "notify-telegram.mjs");
    await vscode.workspace.fs.writeFile(scriptUri, Buffer.from(HOOK_SCRIPT, "utf8"));
    logInfo(`Hook script written to ${scriptUri.fsPath}`);
  } catch (err) {
    logError(`Failed writing hook files: ${String(err)}`);
  }
}
