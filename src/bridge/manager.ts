import { EditorAdapter } from "../adapters/types";
import { IncomingTelegramMessage } from "../types";
import { TelegramBotService } from "../telegram/bot";
import { logInfo } from "../utils/logger";

export class BridgeManager {
  private readonly adapter: EditorAdapter;
  private readonly telegram: TelegramBotService;

  public constructor(
    adapter: EditorAdapter,
    telegram: TelegramBotService
  ) {
    this.adapter = adapter;
    this.telegram = telegram;
  }

  public async onIncomingMessage(message: IncomingTelegramMessage): Promise<void> {
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
