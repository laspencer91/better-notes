import { simpleGit, SimpleGit, StatusResult } from "simple-git";
import { EventEmitter } from "events";
import { Config, getNotesDirectory } from "../config/index.js";

export interface GitSyncEvents {
  syncing: () => void;
  synced: (result: SyncResult) => void;
  error: (error: Error) => void;
  conflict: (files: string[]) => void;
}

export interface SyncResult {
  committed: boolean;
  pushed: boolean;
  pulled: boolean;
  filesChanged: number;
  commitMessage?: string;
}

export class GitSync extends EventEmitter {
  private config: Config;
  private git: SimpleGit;
  private notesDir: string;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingSync: boolean = false;

  constructor(config: Config) {
    super();
    this.config = config;
    this.notesDir = getNotesDirectory(config);
    this.git = simpleGit(this.notesDir);
  }

  async isGitRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<StatusResult> {
    return this.git.status();
  }

  async hasRemote(): Promise<boolean> {
    try {
      const remotes = await this.git.getRemotes();
      return remotes.length > 0;
    } catch {
      return false;
    }
  }

  private generateCommitMessage(status: StatusResult): string {
    const parts: string[] = [];

    if (status.created.length > 0) {
      parts.push(`add ${status.created.length} note(s)`);
    }
    if (status.modified.length > 0) {
      parts.push(`update ${status.modified.length} note(s)`);
    }
    if (status.deleted.length > 0) {
      parts.push(`remove ${status.deleted.length} note(s)`);
    }

    if (parts.length === 0) {
      return "sync notes";
    }

    const date = new Date().toISOString().split("T")[0];
    return `[${date}] ${parts.join(", ")}`;
  }

  async sync(): Promise<SyncResult> {
    if (!this.config.gitSync.enabled) {
      return { committed: false, pushed: false, pulled: false, filesChanged: 0 };
    }

    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return { committed: false, pushed: false, pulled: false, filesChanged: 0 };
    }

    this.emit("syncing");

    const result: SyncResult = {
      committed: false,
      pushed: false,
      pulled: false,
      filesChanged: 0,
    };

    try {
      // Pull first if we have a remote
      const hasRemote = await this.hasRemote();
      if (hasRemote) {
        try {
          await this.git.pull({ "--rebase": "true" });
          result.pulled = true;
        } catch (error) {
          // Check for conflicts
          const status = await this.git.status();
          if (status.conflicted.length > 0) {
            this.emit("conflict", status.conflicted);
            throw new Error(`Merge conflicts in: ${status.conflicted.join(", ")}`);
          }
        }
      }

      // Check for changes
      const status = await this.git.status();
      const hasChanges =
        status.modified.length > 0 ||
        status.created.length > 0 ||
        status.deleted.length > 0 ||
        status.not_added.length > 0;

      if (!hasChanges) {
        this.emit("synced", result);
        return result;
      }

      result.filesChanged =
        status.modified.length +
        status.created.length +
        status.deleted.length +
        status.not_added.length;

      // Stage all changes
      if (this.config.gitSync.autoCommit) {
        await this.git.add(".");

        // Commit
        const commitMessage = this.generateCommitMessage(status);
        await this.git.commit(commitMessage);
        result.committed = true;
        result.commitMessage = commitMessage;

        // Push if enabled and remote exists
        if (this.config.gitSync.autoPush && hasRemote) {
          try {
            await this.git.push();
            result.pushed = true;
          } catch (error) {
            // Push failed, but commit succeeded - not a critical error
            console.error("Push failed:", error);
          }
        }
      }

      this.emit("synced", result);
      return result;
    } catch (error) {
      this.emit("error", error as Error);
      throw error;
    }
  }

  scheduleSync(): void {
    if (!this.config.gitSync.enabled) {
      return;
    }

    this.pendingSync = true;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      if (this.pendingSync) {
        this.pendingSync = false;
        try {
          await this.sync();
        } catch (error) {
          console.error("Scheduled sync failed:", error);
        }
      }
    }, this.config.gitSync.debounceSeconds * 1000);
  }

  cancelPendingSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingSync = false;
  }

  async forcePush(): Promise<void> {
    const hasRemote = await this.hasRemote();
    if (hasRemote) {
      await this.git.push(["--force-with-lease"]);
    }
  }

  async resolveConflicts(strategy: "ours" | "theirs"): Promise<void> {
    const status = await this.git.status();

    for (const file of status.conflicted) {
      if (strategy === "ours") {
        await this.git.checkout(["--ours", file]);
      } else {
        await this.git.checkout(["--theirs", file]);
      }
      await this.git.add(file);
    }

    if (status.conflicted.length > 0) {
      await this.git.commit(`Resolved conflicts using ${strategy}`);
    }
  }

  async getLog(limit: number = 10): Promise<Array<{ hash: string; date: string; message: string }>> {
    const log = await this.git.log({ maxCount: limit });
    return log.all.map((entry) => ({
      hash: entry.hash,
      date: entry.date,
      message: entry.message,
    }));
  }
}
