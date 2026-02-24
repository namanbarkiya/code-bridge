import * as vscode from "vscode";
import { withClipboardText } from "../utils/clipboard";
import { pressEnterInForeground, sleep } from "../utils/keyboard";
import { EditorAdapter } from "./types";

const CURSOR_BUNDLE_ID = "com.todesktop.230313mzl4w4u92";

export class CursorAdapter implements EditorAdapter {
  public readonly editorId = "cursor";

  public async inject(text: string): Promise<void> {
    await withClipboardText(text, async () => {
      await vscode.commands.executeCommand("composer.focusComposer");
      await sleep(300);
      await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
      await sleep(100);
      await pressEnterInForeground(CURSOR_BUNDLE_ID);
    });
  }
}
