import * as path from "node:path";
import { EditorAdapter } from "../adapters/types";
import { IncomingTelegramMessage } from "../types";
import { TelegramBotService } from "../telegram/bot";
import { TerminalSession } from "../terminal/session";
import { logInfo } from "../utils/logger";
import { pressEnterInForeground, pressEscapeInForeground, sleep } from "../utils/keyboard";

export class BridgeManager {
  private readonly telegram: TelegramBotService;
  private readonly sessions = new Map<string, TerminalSession>();
  private activeSessionName = "default";
  private readonly agentAdapter: EditorAdapter | undefined;

  public constructor(
    telegram: TelegramBotService,
    workspaceRoot: string,
    agentAdapter?: EditorAdapter
  ) {
    this.telegram = telegram;
    this.agentAdapter = agentAdapter;
    this.sessions.set(this.activeSessionName, new TerminalSession(workspaceRoot));
  }

  public async onIncomingMessage(message: IncomingTelegramMessage): Promise<void> {
    const text = message.text.trim();
    const textLower = text.toLowerCase();
    if (!text) {
      await this.telegram.sendMessage(message.chatId, "Empty message ignored.");
      return;
    }

    if (textLower === "yes" || textLower === "y" || textLower === "run") {
      logInfo("Telegram approval: pressing Run (Enter) in Cursor");
      await sleep(300);
      await pressEnterInForeground();
      await this.telegram.sendMessage(message.chatId, "Approved. Pressed Run.");
      return;
    }

    if (textLower === "no" || textLower === "n" || textLower === "deny" || textLower === "skip") {
      logInfo("Telegram denial: pressing Skip (Escape) in Cursor");
      await sleep(300);
      await pressEscapeInForeground();
      await this.telegram.sendMessage(message.chatId, "Denied. Pressed Skip.");
      return;
    }

    if (text === "/help") {
      await this.telegram.sendMessage(
        message.chatId,
        [
          "Terminal commands:",
          "/new <name> - create a new terminal session",
          "/use <name> - switch active session",
          "/sessions - list sessions",
          "/run <command> - run command in current session directory",
          "/out - fetch latest output snapshot",
          "/status - show running/idle status",
          "/pwd - show current working directory",
          "/cd <path> - change session directory",
          "/kill - stop running command",
          "",
          "Agent command:",
          "/agent <message> - send message to Cursor agent",
          "yes/no - approve or skip pending Cursor shell confirmation"
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
      await this.telegram.sendMessage(
        message.chatId,
        "Received. Sending to agent chat now..."
      );
      try {
        await this.agentAdapter.inject(prompt);
      } catch (err) {
        await this.telegram.sendMessage(
          message.chatId,
          `Failed to inject message into chat: ${err instanceof Error ? err.message : String(err)}`
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
        `Sessions:\n${lines.join("\n")}`
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
          "Invalid session name. Use letters, numbers, '-', '_' (max 32 chars)."
        );
        return;
      }
      if (this.sessions.has(name)) {
        await this.telegram.sendMessage(message.chatId, `Session already exists: ${name}`);
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
      const changed = this.currentSession.setCwd(nextDir);
      await this.telegram.sendMessage(
        message.chatId,
        changed
          ? this.formatWithSession(`cwd changed to ${this.currentSession.cwd}`)
          : this.formatWithSession(`Cannot access directory: ${nextDir}`)
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

      if (this.currentSession.isRunning()) {
        await this.telegram.sendMessage(
          message.chatId,
          this.formatWithSession("A command is already running. Use /status, /out, or /kill first.")
        );
        return;
      }

      logInfo(`Running Telegram terminal command [${this.activeSessionName}]: ${command}`);
      this.currentSession.startCommand(command);
      await this.telegram.sendMessage(
        message.chatId,
        this.formatWithSession(
          `Started command in ${this.currentSession.cwd}:\n$ ${command}\n\nUse /out to fetch output.`
        )
      );
      return;
    }

    await this.telegram.sendMessage(
      message.chatId,
      "Unknown command. Use /help."
    );
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
}
