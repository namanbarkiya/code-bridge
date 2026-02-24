import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";

const MAX_BUFFER_CHARS = 120_000;
const SNAPSHOT_CHARS = 3500;

export class TerminalSession {
  public cwd: string;
  private running: ChildProcessWithoutNullStreams | undefined;
  private runningCommand = "";
  private outputBuffer = "";
  private lastExit: number | null = null;
  private startedAtMs = 0;

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

  public startCommand(command: string): void {
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
      env: process.env
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
      this.appendOutput(`\n[process exited with code ${String(code)}]\n`);
    });

    this.running.on("error", (err: Error) => {
      this.appendOutput(`\n[failed to run command: ${err.message}]\n`);
      this.lastExit = 1;
      this.running = undefined;
    });
  }

  public killRunningCommand(): boolean {
    if (!this.running) {
      return false;
    }
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

    const tail = this.outputBuffer.length > SNAPSHOT_CHARS
      ? this.outputBuffer.slice(-SNAPSHOT_CHARS)
      : this.outputBuffer;

    const header = this.running
      ? `Output snapshot (running): ${this.runningCommand}`
      : `Output snapshot (finished): ${this.runningCommand}`;

    return `${header}\n\n${tail}`;
  }

  private appendOutput(text: string): void {
    this.outputBuffer += text;
    if (this.outputBuffer.length > MAX_BUFFER_CHARS) {
      this.outputBuffer = this.outputBuffer.slice(this.outputBuffer.length - MAX_BUFFER_CHARS);
    }
  }
}
