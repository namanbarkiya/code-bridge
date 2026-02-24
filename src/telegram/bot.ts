import { Bot } from "grammy";
import { IncomingTelegramMessage } from "../types";
import { isAllowedChat } from "./auth";
import { logInfo, logWarn } from "../utils/logger";

type MessageHandler = (msg: IncomingTelegramMessage) => Promise<void>;

export class TelegramBotService {
  private readonly bot: Bot;
  private readonly allowedChatIds: number[];
  private readonly onMessage: MessageHandler;
  private started = false;

  public constructor(token: string, allowedChatIds: number[], onMessage: MessageHandler) {
    this.bot = new Bot(token);
    this.allowedChatIds = allowedChatIds;
    this.onMessage = onMessage;
  }

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.bot.on("message:text", async (ctx) => {
      const text = ctx.message.text.trim();
      const chatId = Number(ctx.chat.id);

      if (!isAllowedChat(chatId, this.allowedChatIds)) {
        logWarn(`Rejected Telegram message from unauthorized chat ID: ${chatId}`);
        await ctx.reply(
          `This chat is not authorized.\n\nYour chat ID is: ${chatId}\nAdd it to tgBridge.allowedChatIds in settings.`
        );
        return;
      }

      if (!text) {
        await ctx.reply("Empty message ignored.");
        return;
      }

      try {
        await this.onMessage({ chatId, text });
      } catch (err) {
        logWarn(`Failed handling inbound Telegram message: ${String(err)}`);
        await ctx.reply("Bridge failed to process your message. Check extension logs.");
      }
    });

    this.bot.start({
      onStart: () => {
        logInfo("Telegram bot started (long polling).");
      }
    });
    this.started = true;
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.bot.stop();
    this.started = false;
    logInfo("Telegram bot stopped.");
  }

  public async sendMessage(chatId: number, text: string): Promise<void> {
    await this.bot.api.sendMessage(chatId, text);
  }
}
