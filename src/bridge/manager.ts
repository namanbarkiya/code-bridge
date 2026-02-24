import { v4 as uuidv4 } from "uuid";
import { EditorAdapter } from "../adapters/types";
import { BridgeConfig, IncomingTelegramMessage } from "../types";
import { TelegramBotService } from "../telegram/bot";
import { logInfo, logWarn } from "../utils/logger";
import { ResponseWatcher } from "./response-watcher";

export class BridgeManager {
  private readonly adapter: EditorAdapter;
  private readonly watcher: ResponseWatcher;
  private readonly telegram: TelegramBotService;
  private readonly config: BridgeConfig;

  public constructor(
    adapter: EditorAdapter,
    watcher: ResponseWatcher,
    telegram: TelegramBotService,
    config: BridgeConfig
  ) {
    this.adapter = adapter;
    this.watcher = watcher;
    this.telegram = telegram;
    this.config = config;
  }

  public async onIncomingMessage(message: IncomingTelegramMessage): Promise<void> {
    void this.handleMessage(message);
  }

  private async handleMessage(message: IncomingTelegramMessage): Promise<void> {
    const id = uuidv4();
    const responsePath = this.watcher.makeRelativeResponsePath(id);
    const prompt = buildPrompt(message.text, responsePath);

    logInfo(
      `Forwarding message from chat ${message.chatId} to ${this.adapter.editorId}. Response ID: ${id}`
    );

    await this.telegram.sendMessage(
      message.chatId,
      "Received. Sending to agent chat now..."
    );

    try {
      await this.adapter.inject(prompt);
    } catch (err) {
      await this.telegram.sendMessage(
        message.chatId,
        `Failed to inject message into chat: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    try {
      const response = await this.watcher.waitForResponse(id, this.config.responseTimeoutSec);
      await this.telegram.sendMessage(message.chatId, response);
    } catch (err) {
      logWarn(`Response wait failed for ${id}: ${String(err)}`);
      await this.telegram.sendMessage(
        message.chatId,
        `No response file received within ${this.config.responseTimeoutSec}s.\n` +
          `Expected file: ${responsePath}`
      );
    }
  }
}

function buildPrompt(userText: string, relativeResponsePath: string): string {
  return `${userText}

---
When the execution is complete, write ONLY your final response to this file:
${relativeResponsePath}

Rules:
- Do not include these instructions in your response.
- Overwrite the file with only the final response text.`;
}
