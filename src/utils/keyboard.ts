import { execFile } from "node:child_process";
import { platform } from "node:os";

function execCommand(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export async function pressEnterInForeground(appBundleId?: string): Promise<void> {
  const os = platform();

  if (os === "darwin") {
    const activate = appBundleId
      ? `tell application id "${appBundleId}" to activate`
      : "";
    const script = `${activate}
delay 0.2
tell application "System Events" to key code 36`;
    await execCommand("osascript", ["-e", script]);
    return;
  }

  if (os === "win32") {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Start-Sleep -Milliseconds 200
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    `;
    await execCommand("powershell", ["-Command", script]);
    return;
  }

  await execCommand("xdotool", ["key", "Return"]);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
