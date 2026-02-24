import * as vscode from "vscode";
import { BridgeConfig } from "./types";

const KEY = "codeBridge";

export function readConfig(): BridgeConfig {
  const cfg = vscode.workspace.getConfiguration(KEY);
  return {
    botToken: cfg.get<string>("botToken", "").trim(),
    allowedChatIds: cfg.get<number[]>("allowedChatIds", []),
    autoStart: cfg.get<boolean>("autoStart", false),
    responseTimeoutSec: cfg.get<number>("responseTimeoutSec", 300),
    responseDirName: cfg.get<string>("responseDirName", ".code-bridge"),
    authSecret: cfg.get<string>("authSecret", "").trim(),
    maxSessions: cfg.get<number>("maxSessions", 5),
    commandTimeoutSec: cfg.get<number>("commandTimeoutSec", 600),
  };
}
