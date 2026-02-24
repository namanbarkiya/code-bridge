import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function getLogger(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Telegram Bridge");
  }
  return channel;
}

export function logInfo(message: string): void {
  getLogger().appendLine(`[INFO] ${message}`);
}

export function logWarn(message: string): void {
  getLogger().appendLine(`[WARN] ${message}`);
}

export function logError(message: string): void {
  getLogger().appendLine(`[ERROR] ${message}`);
}
