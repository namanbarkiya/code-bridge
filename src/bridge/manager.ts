import { EditorAdapter } from "../adapters/types";
import { BridgeConfig, IncomingTelegramMessage } from "../types";
import { TelegramBotService } from "../telegram/bot";
import { logInfo } from "../utils/logger";
import { pressEnterInForeground, pressEscapeInForeground, sleep } from "../utils/keyboard";

export class BridgeManager {
  private readonly adapter: EditorAdapter;
  private readonly telegram: TelegramBotService;
  private readonly config: BridgeConfig;

  public constructor(
    adapter: EditorAdapter,
    telegram: TelegramBotService,
    config: BridgeConfig
  ) {
    this.adapter = adapter;
    this.telegram = telegram;
    this.config = config;
  }

  public async onIncomingMessage(message: IncomingTelegramMessage): Promise<void> {
    const text = message.text.trim().toLowerCase();

    if (text === "yes" || text === "y" || text === "run") {
      logInfo("Telegram approval: pressing Run (Enter) in Cursor");
      await sleep(300);
      await pressEnterInForeground();
      await this.telegram.sendMessage(message.chatId, "Approved. Pressed Run.");
      return;
    }

    if (text === "no" || text === "n" || text === "deny" || text === "skip") {
      logInfo("Telegram denial: pressing Skip (Escape) in Cursor");
      await sleep(300);
      await pressEscapeInForeground();
      await this.telegram.sendMessage(message.chatId, "Denied. Pressed Skip.");
      return;
    }

    void this.handleMessage(message);
  }

  private async handleMessage(message: IncomingTelegramMessage): Promise<void> {
    logInfo(
      `Forwarding message from chat ${message.chatId} to ${this.adapter.editorId}.`
    );

    await this.telegram.sendMessage(
      message.chatId,
      "Received. Sending to agent chat now..."
    );

    try {
      await this.adapter.inject(message.text);
    } catch (err) {
      await this.telegram.sendMessage(
        message.chatId,
        `Failed to inject message into chat: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
