#!/usr/bin/env node

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
    appendFileSync(debugPath, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
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

debug(`Event: ${event}, keys: ${Object.keys(input).join(", ")}`);

if (event === "afterAgentResponse") {
  const agentText = input.text || "";
  debug(`afterAgentResponse text length: ${agentText.length}`);
  if (agentText) {
    try {
      writeFileSync(lastResponsePath, agentText, "utf8");
      debug("Wrote last-response.txt");
    } catch (err) {
      debug(`Failed writing last-response.txt: ${err}`);
    }
  }
  process.stdout.write(JSON.stringify(hookOutput));
  process.exit(0);
}

if (event === "beforeShellExecution") {
  const cmd = input.command || "unknown command";

  const text = `Approval needed: Agent wants to run:\n\n$ ${cmd}\n\nReply 'yes' to allow or 'no' to deny.`;
  for (const chatId of config.chatIds) {
    await sendTelegram(config.botToken, chatId, text);
  }

  debug(`Sent approval notification for: ${cmd}`);

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
    debug(`Read last-response.txt (${lastResponse.length} chars)`);
  } catch {
    debug("No last-response.txt found, trying transcript");
  }

  if (!lastResponse && input.transcript_path) {
    debug(`Trying transcript: ${input.transcript_path}`);
    lastResponse = readLastAssistantFromTranscript(input.transcript_path);
    debug(`Transcript result: ${lastResponse.length} chars`);
  }

  let text;
  if (status === "completed") {
    text = lastResponse
      ? `Agent completed:\n\n${lastResponse}`
      : "Agent finished execution successfully.";
  } else if (status === "error") {
    text = lastResponse
      ? `Agent error:\n\n${lastResponse}`
      : "Agent encountered an error. Please check Cursor.";
  } else {
    text = lastResponse
      ? `Agent stopped:\n\n${lastResponse}`
      : "Agent stopped. Please check Cursor.";
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

    const lines = raw.split("\n");
    let lastAssistant = "";

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role === "assistant" && entry.content) {
          lastAssistant = typeof entry.content === "string"
            ? entry.content
            : JSON.stringify(entry.content);
        }
        if (entry.type === "assistant" && entry.text) {
          lastAssistant = entry.text;
        }
      } catch {}
    }

    return lastAssistant.trim();
  } catch (err) {
    debug(`Transcript read error: ${err}`);
    return "";
  }
}

async function sendTelegram(token, chatId, message) {
  if (message.length > 4000) {
    message = message.slice(0, 4000) + "\n\n... (truncated)";
  }
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
