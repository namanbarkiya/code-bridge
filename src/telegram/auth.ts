export function isAllowedChat(chatId: number, allowedChatIds: number[]): boolean {
  if (allowedChatIds.length === 0) {
    return false;
  }
  return allowedChatIds.includes(chatId);
}
