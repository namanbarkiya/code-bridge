import * as vscode from "vscode";
import { createAdapter } from "./adapters/detect";
import { EditorAdapter } from "./adapters/types";
import { BridgeManager } from "./bridge/manager";
import { readConfig } from "./config";
import { writeHookConfig } from "./hooks/config-writer";
import { TelegramBotService } from "./telegram/bot";
import { logError, logInfo, logWarn } from "./utils/logger";

class BridgeRuntime implements vscode.Disposable {
    private statusBar: vscode.StatusBarItem | undefined;
    private telegram: TelegramBotService | undefined;
    private manager: BridgeManager | undefined;
    private running = false;

    public constructor(private readonly context: vscode.ExtensionContext) {}

    public async init(): Promise<void> {
        this.statusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.statusBar.command = "tgBridge.status";
        this.context.subscriptions.push(this.statusBar);
        this.renderStatus();

        this.context.subscriptions.push(
            vscode.commands.registerCommand("tgBridge.start", async () =>
                this.start(),
            ),
        );
        this.context.subscriptions.push(
            vscode.commands.registerCommand("tgBridge.stop", async () =>
                this.stop(),
            ),
        );
        this.context.subscriptions.push(
            vscode.commands.registerCommand("tgBridge.status", async () =>
                this.showStatus(),
            ),
        );

        const cfg = readConfig();
        if (cfg.autoStart) {
            await this.start();
        }
    }

    public async start(): Promise<void> {
        if (this.running) {
            vscode.window.showInformationMessage(
                "Telegram Bridge is already running.",
            );
            return;
        }

        const cfg = readConfig();
        if (!cfg.botToken) {
            vscode.window.showErrorMessage(
                "Set tgBridge.botToken in settings before starting Telegram Bridge.",
            );
            return;
        }

        if (!vscode.workspace.workspaceFolders?.length) {
            vscode.window.showErrorMessage(
                "Open a workspace/folder before starting Telegram Bridge.",
            );
            return;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage(
                "Open a workspace/folder before starting Telegram Bridge.",
            );
            return;
        }

        this.telegram = new TelegramBotService(
            cfg.botToken,
            cfg.allowedChatIds,
            async (message) => {
                if (this.manager) {
                    await this.manager.onIncomingMessage(message);
                }
            },
        );

        let modeLabel = "terminal mode";
        let adapter: EditorAdapter | undefined;
        try {
            adapter = await createAdapter();
            await writeHookConfig(cfg);
            modeLabel = `terminal + agent (${adapter.editorId})`;
            logInfo(`Agent bridge enabled using adapter: ${adapter.editorId}`);
        } catch (err) {
            logWarn(`Agent bridge unavailable; continuing in terminal-only mode: ${String(err)}`);
        }

        this.manager = new BridgeManager(this.telegram, workspaceRoot, adapter);

        try {
            await this.telegram.start();
            this.running = true;
            this.renderStatus();
            logInfo(`Bridge started in ${modeLabel}.`);
            void vscode.window.showInformationMessage(
                `Telegram Bridge started (${modeLabel}).`,
            );
        } catch (err) {
            logError(`Failed starting Telegram bot: ${String(err)}`);
            await this.stop();
            throw err;
        }
    }

    public async stop(): Promise<void> {
        if (!this.running) {
            this.renderStatus();
            return;
        }

        await this.telegram?.stop();
        this.telegram = undefined;
        this.manager = undefined;
        this.running = false;
        this.renderStatus();
        logInfo("Bridge stopped.");
    }

    public async showStatus(): Promise<void> {
        const cfg = readConfig();
        const status = this.running ? "running" : "stopped";
        const msg = `Telegram Bridge is ${status}. Allowed chat IDs: ${
            cfg.allowedChatIds.length ? cfg.allowedChatIds.join(", ") : "(none)"
        }`;
        void vscode.window.showInformationMessage(msg);
    }

    private renderStatus(): void {
        if (!this.statusBar) {
            return;
        }
        if (this.running) {
            this.statusBar.text = "$(broadcast) TG Bridge";
            this.statusBar.tooltip = "Telegram Bridge running";
        } else {
            this.statusBar.text = "$(circle-slash) TG Bridge";
            this.statusBar.tooltip = "Telegram Bridge stopped";
        }
        this.statusBar.show();
    }

    public dispose(): void {
        void this.stop();
        this.statusBar?.dispose();
    }
}

let runtime: BridgeRuntime | undefined;

export async function activate(
    context: vscode.ExtensionContext,
): Promise<void> {
    runtime = new BridgeRuntime(context);
    context.subscriptions.push(runtime);
    await runtime.init();
}

export async function deactivate(): Promise<void> {
    await runtime?.stop();
    runtime = undefined;
}
