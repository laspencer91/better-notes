#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, unlinkSync, appendFileSync } from "fs";
import { spawn, ChildProcess } from "child_process";
import {
  loadConfig,
  configExists,
  getPidFilePath,
  getLogFilePath,
  ensureDirectories,
} from "./config/index.js";
import { Indexer } from "./index/indexer.js";
import { NoteManager } from "./notes/manager.js";
import { FileWatcher } from "./sync/watcher.js";
import { GitSync } from "./sync/git-sync.js";

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());

  try {
    const config = loadConfig();
    const logPath = getLogFilePath(config);
    appendFileSync(logPath, logMessage);
  } catch {
    // Ignore log file errors
  }
}

function writePidFile(pidPath: string): void {
  writeFileSync(pidPath, process.pid.toString());
}

function removePidFile(pidPath: string): void {
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
}

function readPidFile(pidPath: string): number | null {
  if (!existsSync(pidPath)) {
    return null;
  }
  try {
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startDaemon(): Promise<void> {
  if (!configExists()) {
    console.error("No configuration found. Run 'better-notes init' first.");
    process.exit(1);
  }

  const config = loadConfig();

  if (!config.daemon.enabled) {
    console.error("Daemon is disabled in configuration.");
    process.exit(1);
  }

  ensureDirectories(config);

  const pidPath = getPidFilePath(config);
  const existingPid = readPidFile(pidPath);

  if (existingPid && isProcessRunning(existingPid)) {
    console.error(`Daemon is already running (PID: ${existingPid})`);
    process.exit(1);
  }

  // Clean up stale PID file
  if (existingPid) {
    removePidFile(pidPath);
  }

  log("Starting better-notes daemon...");
  writePidFile(pidPath);

  // Initialize components
  const indexer = new Indexer(config);
  const noteManager = new NoteManager(config);
  const watcher = new FileWatcher(config, indexer);
  const gitSync = new GitSync(config);

  // Set up watcher events
  watcher.on("noteChanged", (note) => {
    log(`Note updated: ${note.id}`);
    if (config.gitSync.enabled) {
      gitSync.scheduleSync();
    }
  });

  watcher.on("noteDeleted", (noteId) => {
    log(`Note deleted: ${noteId}`);
    if (config.gitSync.enabled) {
      gitSync.scheduleSync();
    }
  });

  watcher.on("error", (error) => {
    log(`Watcher error: ${error.message}`);
  });

  watcher.on("ready", () => {
    log("File watcher ready");
  });

  // Set up git sync events
  gitSync.on("syncing", () => {
    log("Starting git sync...");
  });

  gitSync.on("synced", (result) => {
    if (result.filesChanged > 0) {
      log(
        `Git sync complete: ${result.filesChanged} files, committed=${result.committed}, pushed=${result.pushed}`
      );
    }
  });

  gitSync.on("error", (error) => {
    log(`Git sync error: ${error.message}`);
  });

  gitSync.on("conflict", (files) => {
    log(`Git conflicts detected in: ${files.join(", ")}`);
  });

  // Start watching
  if (config.daemon.watchFiles) {
    watcher.start();
    log("File watching started");
  }

  // Initial sync
  if (config.gitSync.enabled) {
    try {
      await gitSync.sync();
    } catch (error) {
      log(`Initial sync failed: ${(error as Error).message}`);
    }
  }

  // Rebuild index on startup
  try {
    const count = await indexer.rebuildIndex(noteManager);
    log(`Index rebuilt: ${count} notes indexed`);
  } catch (error) {
    log(`Index rebuild failed: ${(error as Error).message}`);
  }

  // Handle shutdown
  const shutdown = async () => {
    log("Shutting down daemon...");

    watcher.stop();
    gitSync.cancelPendingSync();

    // Final sync before shutdown
    if (config.gitSync.enabled) {
      try {
        await gitSync.sync();
        log("Final sync complete");
      } catch (error) {
        log(`Final sync failed: ${(error as Error).message}`);
      }
    }

    indexer.close();
    removePidFile(pidPath);
    log("Daemon stopped");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  if (process.platform !== "win32") {
    process.on("SIGHUP", shutdown);
  }

  log(`Daemon started (PID: ${process.pid})`);
}

export function stopDaemon(): void {
  if (!configExists()) {
    console.error("No configuration found.");
    process.exit(1);
  }

  const config = loadConfig();
  const pidPath = getPidFilePath(config);
  const pid = readPidFile(pidPath);

  if (!pid) {
    console.log("Daemon is not running (no PID file)");
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log("Daemon is not running (stale PID file)");
    removePidFile(pidPath);
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to daemon (PID: ${pid})`);

    // Wait for process to exit
    let attempts = 0;
    const checkInterval = setInterval(() => {
      if (!isProcessRunning(pid)) {
        clearInterval(checkInterval);
        console.log("Daemon stopped");
        removePidFile(pidPath);
      } else if (attempts++ > 10) {
        clearInterval(checkInterval);
        console.log("Daemon did not stop gracefully, sending SIGKILL");
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already dead
        }
        removePidFile(pidPath);
      }
    }, 500);
  } catch (error) {
    console.error(`Failed to stop daemon: ${(error as Error).message}`);
    process.exit(1);
  }
}

export function getDaemonStatus(): {
  running: boolean;
  pid: number | null;
  uptime?: string;
} {
  if (!configExists()) {
    return { running: false, pid: null };
  }

  const config = loadConfig();
  const pidPath = getPidFilePath(config);
  const pid = readPidFile(pidPath);

  if (!pid) {
    return { running: false, pid: null };
  }

  const running = isProcessRunning(pid);

  if (!running) {
    // Clean up stale PID file
    removePidFile(pidPath);
    return { running: false, pid: null };
  }

  return { running: true, pid };
}

export function startDaemonBackground(): ChildProcess {
  const child = spawn(process.execPath, [process.argv[1], "daemon", "run"], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
  return child;
}

// If run directly
if (process.argv[2] === "run") {
  startDaemon().catch((error) => {
    console.error("Failed to start daemon:", error);
    process.exit(1);
  });
}
