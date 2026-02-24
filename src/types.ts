export interface IncomingTelegramMessage {
  chatId: number;
  text: string;
}

export interface BridgeConfig {
  botToken: string;
  allowedChatIds: number[];
  autoStart: boolean;
  responseTimeoutSec: number;
  responseDirName: string;
}
