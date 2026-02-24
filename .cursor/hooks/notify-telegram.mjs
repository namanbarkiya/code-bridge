#!/usr/bin/env node

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
  text = `Approval needed: Agent wants to run:\n\n$ ${cmd}\n\nPlease open Cursor and click Run or Skip.`;
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
  text = `Agent event: ${event}. Please check Cursor.`;
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
    path: `/bot${token}/sendMessage`,
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
