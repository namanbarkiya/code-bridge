import * as path from "node:path";
import { EditorAdapter } from "../adapters/types";
import { BridgeConfig, IncomingTelegramMessage } from "../types";
import { TelegramBotService } from "../telegram/bot";
import { TerminalSession, isCommandDenied } from "../terminal/session";
import { logInfo, logWarn } from "../utils/logger";
import { pressEnterInForeground, pressEscapeInForeground, sleep } from "../utils/keyboard";

export class BridgeManager {
  private readonly telegram: TelegramBotService;
  private readonly sessions = new Map<string, TerminalSession>();
  private activeSessionName = "default";
  private readonly agentAdapter: EditorAdapter | undefined;
  private readonly workspaceRoot: string;
  private readonly config: BridgeConfig;

  private readonly authenticatedChats = new Set<number>();
  private pendingApproval = false;

  public constructor(
    telegram: TelegramBotService,
    workspaceRoot: string,
    config: BridgeConfig,
    agentAdapter?: EditorAdapter
  ) {
    this.telegram = telegram;
    this.workspaceRoot = workspaceRoot;
    this.config = config;
    this.agentAdapter = agentAdapter;
    this.sessions.set(this.activeSessionName, new TerminalSession(workspaceRoot));
  }

  public setPendingApproval(pending: boolean): void {
    this.pendingApproval = pending;
  }

  public async onIncomingMessage(message: IncomingTelegramMessage): Promise<void> {
    const text = message.text.trim();
    const textLower = text.toLowerCase();
    if (!text) {
      await this.telegram.sendMessage(message.chatId, "Empty message ignored.");
      return;
    }

    if (textLower.startsWith("/auth ")) {
      await this.handleAuth(message.chatId, text.slice(6).trim());
      return;
    }

    if (this.config.authSecret && !this.authenticatedChats.has(message.chatId)) {
      await this.telegram.sendMessage(
        message.chatId,
        "Not authenticated. Send /auth <secret> first."
      );
      return;
    }

    if (textLower === "yes" || textLower === "y" || textLower === "run") {
      if (!this.pendingApproval) {
        await this.telegram.sendMessage(message.chatId, "No pending approval to confirm.");
        return;
      }
      logInfo("Telegram approval: pressing Run (Enter) in Cursor");
      this.pendingApproval = false;
      await sleep(300);
      await pressEnterInForeground();
      await this.telegram.sendMessage(message.chatId, "Approved. Pressed Run.");
      return;
    }

    if (textLower === "no" || textLower === "n" || textLower === "deny" || textLower === "skip") {
      if (!this.pendingApproval) {
        await this.telegram.sendMessage(message.chatId, "No pending approval to deny.");
        return;
      }
      logInfo("Telegram denial: pressing Skip (Escape) in Cursor");
      this.pendingApproval = false;
      await sleep(300);
      await pressEscapeInForeground();
      await this.telegram.sendMessage(message.chatId, "Denied. Pressed Skip.");
      return;
    }

    if (text === "/help") {
      const authLine = this.config.authSecret ? "/auth <secret> - authenticate session\n" : "";
      await this.telegram.sendMessage(
        message.chatId,
        [
          "Commands:",
          authLine,
          "Terminal:",
          "/run <command> - run command",
          "/out - latest output",
          "/status - session status",
          "/pwd - working directory",
          "/cd <path> - change directory (workspace only)",
          "/kill - stop running command",
          "/new <name> - new terminal session",
          "/use <name> - switch session",
          "/sessions - list sessions",
          "",
          "Agent:",
          "/agent <message> - send to Cursor agent",
          "yes/no - approve/skip pending confirmation"
        ].join("\n")
      );
      return;
    }

    if (text === "/agent") {
      await this.telegram.sendMessage(message.chatId, "Usage: /agent <message>");
      return;
    }

    if (text.startsWith("/agent ")) {
      const prompt = text.slice(7).trim();
      if (!prompt) {
        await this.telegram.sendMessage(message.chatId, "Usage: /agent <message>");
        return;
      }
      if (!this.agentAdapter) {
        await this.telegram.sendMessage(
          message.chatId,
          "Agent bridge is not available in this editor session."
        );
        return;
      }
      await this.telegram.sendMessage(message.chatId, "Received. Sending to agent chat now...");
      this.pendingApproval = true;
      try {
        await this.agentAdapter.inject(prompt);
      } catch (err) {
        this.pendingApproval = false;
        await this.telegram.sendMessage(
          message.chatId,
          `Failed to inject: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return;
    }

    if (text === "/out") {
      await this.telegram.sendMessage(
        message.chatId,
        this.formatWithSession(this.currentSession.getOutputSnapshot())
      );
      return;
    }

    if (text === "/status") {
      await this.telegram.sendMessage(
        message.chatId,
        this.formatWithSession(this.currentSession.getStatusText())
      );
      return;
    }

    if (text === "/pwd") {
      await this.telegram.sendMessage(
        message.chatId,
        this.formatWithSession(`cwd: ${this.currentSession.cwd}`)
      );
      return;
    }

    if (text === "/sessions") {
      const lines = Array.from(this.sessions.entries()).map(([name, session]) => {
        const marker = name === this.activeSessionName ? "*" : " ";
        const status = session.isRunning() ? "running" : "idle";
        return `${marker} ${name} (${status})`;
      });
      await this.telegram.sendMessage(
        message.chatId,
        `Sessions (${this.sessions.size}/${this.config.maxSessions}):\n${lines.join("\n")}`
      );
      return;
    }

    if (text === "/new") {
      await this.telegram.sendMessage(message.chatId, "Usage: /new <name>");
      return;
    }

    if (text.startsWith("/new ")) {
      const name = text.slice(5).trim();
      if (!this.isValidSessionName(name)) {
        await this.telegram.sendMessage(
          message.chatId,
          "Invalid name. Use letters, numbers, '-', '_' (max 32 chars)."
        );
        return;
      }
      if (this.sessions.has(name)) {
        await this.telegram.sendMessage(message.chatId, `Session already exists: ${name}`);
        return;
      }
      if (this.sessions.size >= this.config.maxSessions) {
        await this.telegram.sendMessage(
          message.chatId,
          `Session limit reached (${this.config.maxSessions}). Kill or reuse an existing session.`
        );
        return;
      }
      this.sessions.set(name, new TerminalSession(this.currentSession.cwd));
      this.activeSessionName = name;
      await this.telegram.sendMessage(
        message.chatId,
        `Created and switched to session: ${name}\ncwd: ${this.currentSession.cwd}`
      );
      return;
    }

    if (text === "/use") {
      await this.telegram.sendMessage(message.chatId, "Usage: /use <name>");
      return;
    }

    if (text.startsWith("/use ")) {
      const name = text.slice(5).trim();
      const session = this.sessions.get(name);
      if (!session) {
        await this.telegram.sendMessage(message.chatId, `Session not found: ${name}`);
        return;
      }
      this.activeSessionName = name;
      await this.telegram.sendMessage(
        message.chatId,
        `Switched to session: ${name}\n${session.getStatusText()}`
      );
      return;
    }

    if (text === "/cd") {
      await this.telegram.sendMessage(message.chatId, "Usage: /cd <path>");
      return;
    }

    if (text.startsWith("/cd ")) {
      const raw = text.slice(4).trim();
      if (!raw) {
        await this.telegram.sendMessage(message.chatId, "Usage: /cd <path>");
        return;
      }
      const nextDir = path.isAbsolute(raw)
        ? raw
        : path.resolve(this.currentSession.cwd, raw);

      const resolved = path.resolve(nextDir);
      if (!resolved.startsWith(this.workspaceRoot)) {
        await this.telegram.sendMessage(
          message.chatId,
          this.formatWithSession(`Denied: path is outside workspace root (${this.workspaceRoot})`)
        );
        return;
      }

      const changed = this.currentSession.setCwd(resolved);
      await this.telegram.sendMessage(
        message.chatId,
        changed
          ? this.formatWithSession(`cwd changed to ${this.currentSession.cwd}`)
          : this.formatWithSession(`Cannot access directory: ${resolved}`)
      );
      return;
    }

    if (text === "/kill") {
      const killed = this.currentSession.killRunningCommand();
      await this.telegram.sendMessage(
        message.chatId,
        killed
          ? this.formatWithSession("Sent SIGINT to running command.")
          : this.formatWithSession("No running command.")
      );
      return;
    }

    if (text === "/run") {
      await this.telegram.sendMessage(message.chatId, "Usage: /run <command>");
      return;
    }

    if (text.startsWith("/run ")) {
      const command = text.slice(5).trim();
      if (!command) {
        await this.telegram.sendMessage(message.chatId, "Usage: /run <command>");
        return;
      }

      const denied = isCommandDenied(command);
      if (denied) {
        logWarn(`Blocked command from chat ${message.chatId}: ${command}`);
        await this.telegram.sendMessage(message.chatId, denied);
        return;
      }

      if (this.currentSession.isRunning()) {
        await this.telegram.sendMessage(
          message.chatId,
          this.formatWithSession("A command is already running. Use /status, /out, or /kill first.")
        );
        return;
      }

      logInfo(`Running terminal command [${this.activeSessionName}]: ${command}`);
      const sessionName = this.activeSessionName;
      this.currentSession.startCommand(command, this.config.commandTimeoutSec);
      await this.telegram.sendMessage(
        message.chatId,
        this.formatWithSession(
          `Started in ${this.currentSession.cwd}:\n$ ${command}\n\nTimeout: ${this.config.commandTimeoutSec}s. Use /out to fetch output.`
        )
      );
      void this.sendDelayedRunOutput(message.chatId, sessionName);
      return;
    }

    await this.telegram.sendMessage(message.chatId, "Unknown command. Use /help.");
  }

  private async handleAuth(chatId: number, secret: string): Promise<void> {
    if (!this.config.authSecret) {
      await this.telegram.sendMessage(chatId, "Auth is not configured. All allowed chats have access.");
      return;
    }
    if (secret === this.config.authSecret) {
      this.authenticatedChats.add(chatId);
      logInfo(`Chat ${chatId} authenticated successfully.`);
      await this.telegram.sendMessage(chatId, "Authenticated successfully.");
    } else {
      logWarn(`Failed auth attempt from chat ${chatId}.`);
      await this.telegram.sendMessage(chatId, "Invalid secret.");
    }
  }

  private get currentSession(): TerminalSession {
    const session = this.sessions.get(this.activeSessionName);
    if (!session) {
      throw new Error(`Active session missing: ${this.activeSessionName}`);
    }
    return session;
  }

  private formatWithSession(text: string): string {
    return `[session: ${this.activeSessionName}]\n${text}`;
  }

  private isValidSessionName(name: string): boolean {
    return /^[a-zA-Z0-9_-]{1,32}$/.test(name);
  }

  private async sendDelayedRunOutput(chatId: number, sessionName: string): Promise<void> {
    await sleep(3000);
    const session = this.sessions.get(sessionName);
    if (!session) {
      return;
    }
    const snapshot = session.getOutputSnapshot();
    await this.telegram.sendMessage(chatId, `[session: ${sessionName}]\n${snapshot}`);
  }
}
