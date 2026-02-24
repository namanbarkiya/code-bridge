import * as path from "node:path";
import * as vscode from "vscode";
import { logError, logInfo, logWarn } from "../utils/logger";

type PendingResolver = {
  resolve: (value: string) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
};

export class ResponseWatcher implements vscode.Disposable {
  private readonly pending = new Map<string, PendingResolver>();
  private readonly responseDirName: string;
  private watcher: vscode.FileSystemWatcher | undefined;

  public constructor(responseDirName: string) {
    this.responseDirName = responseDirName;
  }

  public async start(): Promise<void> {
    await this.ensureResponseDir();
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error("Open a workspace/folder before starting Telegram Bridge.");
    }

    const pattern = new vscode.RelativePattern(
      folder,
      `${this.responseDirName}/response-*.md`
    );

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern, false, true, false);
    this.watcher.onDidCreate((uri) => {
      void this.handleFile(uri);
    });
    this.watcher.onDidChange((uri) => {
      void this.handleFile(uri);
    });

    logInfo(`Watching response files in '${this.responseDirName}'.`);
  }

  public waitForResponse(id: string, timeoutSec: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for response file response-${id}.md`));
      }, timeoutSec * 1000);

      this.pending.set(id, { resolve, reject, timeout });
    });
  }

  public makeRelativeResponsePath(id: string): string {
    return `${this.responseDirName}/response-${id}.md`;
  }

  public async dispose(): Promise<void> {
    for (const [id, state] of this.pending) {
      clearTimeout(state.timeout);
      state.reject(new Error(`Watcher disposed before response received for ${id}`));
    }
    this.pending.clear();
    this.watcher?.dispose();
  }

  private async handleFile(uri: vscode.Uri): Promise<void> {
    const base = path.basename(uri.fsPath);
    const match = /^response-(.+)\.md$/.exec(base);
    if (!match) {
      return;
    }
    const id = match[1];
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }

    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(raw).toString("utf8").trim();
      if (!text) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.resolve(text);

      await vscode.workspace.fs.delete(uri, { useTrash: false });
      logInfo(`Resolved and deleted response file for id: ${id}`);
    } catch (err) {
      logWarn(`Failed reading response file '${uri.fsPath}': ${String(err)}`);
    }
  }

  private async ensureResponseDir(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error("Open a workspace/folder before starting Telegram Bridge.");
    }

    const dir = vscode.Uri.joinPath(folder.uri, this.responseDirName);
    try {
      await vscode.workspace.fs.createDirectory(dir);
    } catch (err) {
      logError(`Could not create response directory: ${String(err)}`);
      throw err;
    }
  }
}
