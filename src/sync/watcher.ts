import chokidar, { FSWatcher } from "chokidar";
import { EventEmitter } from "events";
import { basename, relative } from "path";
import { readFileSync, existsSync } from "fs";
import matter from "gray-matter";
import { Config, getNotesDirectory } from "../config/index.js";
import { Indexer } from "../index/indexer.js";
import { Note, NoteFrontmatter } from "../notes/types.js";

export interface WatcherEvents {
  noteChanged: (note: Note) => void;
  noteDeleted: (noteId: string) => void;
  error: (error: Error) => void;
  ready: () => void;
}

export class FileWatcher extends EventEmitter {
  private config: Config;
  private indexer: Indexer;
  private watcher: FSWatcher | null = null;
  private notesDir: string;

  constructor(config: Config, indexer: Indexer) {
    super();
    this.config = config;
    this.indexer = indexer;
    this.notesDir = getNotesDirectory(config);
  }

  private parseNote(filePath: string): Note | null {
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const rawContent = readFileSync(filePath, "utf-8");
      const { data, content } = matter(rawContent);

      const filename = basename(filePath);
      const date = filename.replace(".md", "");

      const frontmatter: NoteFrontmatter = {
        title: data.title || `Notes for ${date}`,
        category: data.category || this.config.defaultCategory,
        tags: data.tags || [],
        created: data.created || new Date().toISOString(),
        updated: data.updated || new Date().toISOString(),
        mentions: data.mentions || [],
      };

      return {
        id: date,
        filePath,
        date,
        frontmatter,
        content: content.trim(),
        rawContent,
      };
    } catch (error) {
      this.emit("error", error as Error);
      return null;
    }
  }

  private isNoteFile(filePath: string): boolean {
    // Must be a markdown file
    if (!filePath.endsWith(".md")) {
      return false;
    }

    // Must match YYYY-MM-DD.md pattern
    const filename = basename(filePath);
    return /^\d{4}-\d{2}-\d{2}\.md$/.test(filename);
  }

  private handleFileChange(filePath: string): void {
    if (!this.isNoteFile(filePath)) {
      return;
    }

    const note = this.parseNote(filePath);
    if (note) {
      this.indexer.indexNote(note);
      this.emit("noteChanged", note);
    }
  }

  private handleFileDelete(filePath: string): void {
    if (!this.isNoteFile(filePath)) {
      return;
    }

    const filename = basename(filePath);
    const noteId = filename.replace(".md", "");
    this.indexer.removeNote(noteId);
    this.emit("noteDeleted", noteId);
  }

  start(): void {
    if (this.watcher) {
      return;
    }

    this.watcher = chokidar.watch(this.notesDir, {
      ignored: [
        /(^|[\/\\])\../, // dotfiles
        "**/node_modules/**",
        "**/.index/**",
      ],
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher
      .on("add", (path) => this.handleFileChange(path))
      .on("change", (path) => this.handleFileChange(path))
      .on("unlink", (path) => this.handleFileDelete(path))
      .on("error", (error) => this.emit("error", error))
      .on("ready", () => this.emit("ready"));
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  isRunning(): boolean {
    return this.watcher !== null;
  }
}
