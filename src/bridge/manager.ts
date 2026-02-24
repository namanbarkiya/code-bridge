import { v4 as uuidv4 } from "uuid";
import { EditorAdapter } from "../adapters/types";
import { BridgeConfig, IncomingTelegramMessage } from "../types";
import { TelegramBotService } from "../telegram/bot";
import { logInfo } from "../utils/logger";
import { ResponseWatcher } from "./response-watcher";

export class BridgeManager {
  private readonly adapter: EditorAdapter;
  private readonly watcher: ResponseWatcher;
  private readonly telegram: TelegramBotService;
  private readonly config: BridgeConfig;
  private queue: Promise<void> = Promise.resolve();

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

  public onIncomingMessage(message: IncomingTelegramMessage): Promise<void> {
    this.queue = this.queue
      .then(async () => this.handleMessage(message))
      .catch(async (err) => {
        await this.telegram.sendMessage(
          message.chatId,
          `Bridge error: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    return this.queue;
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

    const responsePromise = this.watcher.waitForResponse(id, this.config.responseTimeoutSec);
    await this.adapter.inject(prompt);

    try {
      const response = await responsePromise;
      await this.telegram.sendMessage(message.chatId, response);
    } catch (err) {
      await this.telegram.sendMessage(
        message.chatId,
        `No response file received within ${this.config.responseTimeoutSec}s.\n` +
          `Expected file: ${responsePath}`
      );
      throw err;
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
