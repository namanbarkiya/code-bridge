import * as vscode from "vscode";
import { CursorAdapter } from "./cursor";
import { EditorAdapter } from "./types";
import { VscodeChatAdapter } from "./vscode";

export async function createAdapter(): Promise<EditorAdapter> {
  const commands = await vscode.commands.getCommands(true);
  if (commands.includes("composer.focusComposer")) {
    return new CursorAdapter();
  }
  return new VscodeChatAdapter();
}
