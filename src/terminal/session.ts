import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";

const MAX_BUFFER_CHARS = 120_000;
const SNAPSHOT_MAX_CHARS = 3500;
const SNAPSHOT_LINES = 60;

const DENIED_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*)?r[a-zA-Z]*f/,   // rm -rf / rm -fr
  /\brm\s+(-[a-zA-Z]*\s+)*\//,           // rm /
  /\bmkfs\b/,
  /\bdd\s+.*of=\/dev\//,
  /\b:(){ :|:& };:/,                      // fork bomb
  /\bchmod\s+(-R\s+)?777\s+\//,
  /\bsudo\s+rm\b/,
  /\bcurl\b.*\|\s*(ba)?sh/,              // curl | sh
  /\bwget\b.*\|\s*(ba)?sh/,
  />\s*\/dev\/[sh]da/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\binit\s+[06]\b/,
];

const ENV_PASSTHROUGH_PREFIXES = [
  "PATH", "HOME", "USER", "SHELL", "LANG", "LC_", "TERM",
  "TMPDIR", "TMP", "TEMP", "XDG_", "DISPLAY", "COLORTERM",
  "EDITOR", "VISUAL", "PAGER",
  "NVM_", "VOLTA_", "FNM_", "MISE_",
  "GOPATH", "GOROOT", "CARGO_HOME", "RUSTUP_HOME",
  "JAVA_HOME", "PYTHON", "VIRTUAL_ENV", "CONDA_",
];

function buildSanitizedEnv(): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (ENV_PASSTHROUGH_PREFIXES.some(p => key === p || key.startsWith(p))) {
      clean[key] = value;
    }
  }
  return clean;
}

export function isCommandDenied(command: string): string | null {
  for (const pattern of DENIED_PATTERNS) {
    if (pattern.test(command)) {
      return `Blocked: command matches deny pattern ${pattern.source}`;
    }
  }
  return null;
}

export class TerminalSession {
  public cwd: string;
  private running: ChildProcessWithoutNullStreams | undefined;
  private runningCommand = "";
  private outputBuffer = "";
  private lastExit: number | null = null;
  private startedAtMs = 0;
  private timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  public constructor(initialCwd: string) {
    this.cwd = initialCwd;
  }

  public isRunning(): boolean {
    return Boolean(this.running);
  }

  public setCwd(nextDir: string): boolean {
    try {
      const stat = fs.statSync(nextDir);
      if (!stat.isDirectory()) {
        return false;
      }
      this.cwd = nextDir;
      return true;
    } catch {
      return false;
    }
  }

  public startCommand(command: string, timeoutSec: number): void {
    if (this.running) {
      throw new Error("A command is already running.");
    }

    this.outputBuffer = "";
    this.lastExit = null;
    this.runningCommand = command;
    this.startedAtMs = Date.now();

    this.running = spawn(command, {
      cwd: this.cwd,
      shell: true,
      env: buildSanitizedEnv()
    });

    this.running.stdout.on("data", (chunk: Buffer) => {
      this.appendOutput(chunk.toString("utf8"));
    });

    this.running.stderr.on("data", (chunk: Buffer) => {
      this.appendOutput(chunk.toString("utf8"));
    });

    this.running.on("close", (code: number | null) => {
      this.lastExit = code;
      this.running = undefined;
      this.clearTimeout();
      this.appendOutput(`\n[process exited with code ${String(code)}]\n`);
    });

    this.running.on("error", (err: Error) => {
      this.appendOutput(`\n[failed to run command: ${err.message}]\n`);
      this.lastExit = 1;
      this.running = undefined;
      this.clearTimeout();
    });

    if (timeoutSec > 0) {
      this.timeoutHandle = setTimeout(() => {
        if (this.running) {
          this.appendOutput(`\n[auto-killed: exceeded ${timeoutSec}s timeout]\n`);
          this.running.kill("SIGKILL");
        }
      }, timeoutSec * 1000);
    }
  }

  public killRunningCommand(): boolean {
    if (!this.running) {
      return false;
    }
    this.clearTimeout();
    this.running.kill("SIGINT");
    return true;
  }

  public getStatusText(): string {
    if (this.running) {
      const secs = Math.max(1, Math.floor((Date.now() - this.startedAtMs) / 1000));
      return `Status: running (${secs}s)\ncwd: ${this.cwd}\ncommand: ${this.runningCommand}`;
    }
    const exitInfo = this.lastExit === null ? "none" : String(this.lastExit);
    return `Status: idle\ncwd: ${this.cwd}\nlast command: ${this.runningCommand || "(none)"}\nlast exit: ${exitInfo}`;
  }

  public getOutputSnapshot(): string {
    if (!this.outputBuffer) {
      return this.running
        ? `No output yet.\n\n${this.getStatusText()}`
        : "No output captured yet. Run a command with /run first.";
    }

    const tail = this.getTailLines(SNAPSHOT_LINES, SNAPSHOT_MAX_CHARS);

    const header = this.running
      ? `Output snapshot (running): ${this.runningCommand}`
      : `Output snapshot (finished): ${this.runningCommand}`;

    return `${header}\n\n${tail}`;
  }

  private getTailLines(maxLines: number, maxChars: number): string {
    const lines = this.outputBuffer.split(/\r?\n/);
    const sliced = lines.slice(-maxLines).join("\n");
    if (sliced.length <= maxChars) {
      return sliced;
    }
    return sliced.slice(sliced.length - maxChars);
  }

  private appendOutput(text: string): void {
    this.outputBuffer += text;
    if (this.outputBuffer.length > MAX_BUFFER_CHARS) {
      this.outputBuffer = this.outputBuffer.slice(this.outputBuffer.length - MAX_BUFFER_CHARS);
    }
  }

  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
  }
}
