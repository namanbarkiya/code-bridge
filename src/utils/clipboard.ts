import * as vscode from "vscode";

export async function withClipboardText(
  text: string,
  fn: () => Promise<void>
): Promise<void> {
  const original = await vscode.env.clipboard.readText();
  await vscode.env.clipboard.writeText(text);
  try {
    await fn();
  } finally {
    await vscode.env.clipboard.writeText(original);
  }
}
