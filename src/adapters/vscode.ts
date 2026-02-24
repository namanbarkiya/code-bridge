import * as vscode from "vscode";
import { withClipboardText } from "../utils/clipboard";
import { sleep } from "../utils/keyboard";
import { EditorAdapter } from "./types";

export class VscodeChatAdapter implements EditorAdapter {
  public readonly editorId = "vscode";

  public async inject(text: string): Promise<void> {
    await withClipboardText(text, async () => {
      await vscode.commands.executeCommand("workbench.action.chat.open");
      await sleep(250);
      await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
      await sleep(100);
      await vscode.commands.executeCommand("workbench.action.chat.submit");
    });
  }
}
