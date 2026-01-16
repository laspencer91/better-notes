import Database from "better-sqlite3";
import { existsSync, mkdirSync, statSync } from "fs";
import { dirname } from "path";
import {
  Config,
  getDatabasePath,
  getIndexDirectory,
  getNotesDirectory,
} from "../config/index.js";
import { NoteManager } from "../notes/manager.js";
import { Note } from "../notes/types.js";

export interface IndexedNote {
  id: string;
  file_path: string;
  date: string;
  title: string;
  category: string;
  tags: string;
  mentions: string;
  content: string;
  created_at: string;
  updated_at: string;
  indexed_at: string;
}

export interface SearchResult {
  id: string;
  filePath: string;
  date: string;
  title: string;
  category: string;
  tags: string[];
  mentions: string[];
  snippet: string;
  rank: number;
}

export class Indexer {
  private db: Database.Database;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    const dbPath = getDatabasePath(config);

    // Ensure directory exists
    const indexDir = dirname(dbPath);
    if (!existsSync(indexDir)) {
      mkdirSync(indexDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      -- Main notes table
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        date TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT,
        tags TEXT,
        mentions TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );

      -- FTS5 virtual table for full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        id,
        title,
        content,
        tags,
        mentions,
        content='notes',
        content_rowid='rowid'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, id, title, content, tags, mentions)
        VALUES (NEW.rowid, NEW.id, NEW.title, NEW.content, NEW.tags, NEW.mentions);
      END;

      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, id, title, content, tags, mentions)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.content, OLD.tags, OLD.mentions);
      END;

      CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, id, title, content, tags, mentions)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.content, OLD.tags, OLD.mentions);
        INSERT INTO notes_fts(rowid, id, title, content, tags, mentions)
        VALUES (NEW.rowid, NEW.id, NEW.title, NEW.content, NEW.tags, NEW.mentions);
      END;

      -- Entities table for people, projects, etc.
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        mention_count INTEGER DEFAULT 1,
        UNIQUE(name, type)
      );

      -- Note-entity relationship
      CREATE TABLE IF NOT EXISTS note_entities (
        note_id TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        PRIMARY KEY (note_id, entity_id)
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date);
      CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    `);
  }

  indexNote(note: Note): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO notes
      (id, file_path, date, title, category, tags, mentions, content, created_at, updated_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      note.id,
      note.filePath,
      note.date,
      note.frontmatter.title,
      note.frontmatter.category,
      note.frontmatter.tags.join(","),
      note.frontmatter.mentions.join(","),
      note.content,
      note.frontmatter.created,
      note.frontmatter.updated,
      new Date().toISOString()
    );

    // Index entities (mentions)
    if (this.config.search.enableEntityExtraction) {
      this.indexEntities(note);
    }
  }

  private indexEntities(note: Note): void {
    const mentions = note.frontmatter.mentions;
    const now = new Date().toISOString();

    for (const mention of mentions) {
      // Upsert entity
      this.db
        .prepare(
          `
        INSERT INTO entities (name, type, first_seen, last_seen, mention_count)
        VALUES (?, 'person', ?, ?, 1)
        ON CONFLICT(name, type) DO UPDATE SET
          last_seen = ?,
          mention_count = mention_count + 1
      `
        )
        .run(mention, now, now, now);

      // Get entity ID
      const entity = this.db
        .prepare("SELECT id FROM entities WHERE name = ? AND type = 'person'")
        .get(mention) as { id: number } | undefined;

      if (entity) {
        this.db
          .prepare(
            `
          INSERT OR IGNORE INTO note_entities (note_id, entity_id)
          VALUES (?, ?)
        `
          )
          .run(note.id, entity.id);
      }
    }
  }

  removeNote(noteId: string): void {
    this.db.prepare("DELETE FROM note_entities WHERE note_id = ?").run(noteId);
    this.db.prepare("DELETE FROM notes WHERE id = ?").run(noteId);
  }

  search(query: string, limit: number = 20): SearchResult[] {
    const stmt = this.db.prepare(`
      SELECT
        n.id,
        n.file_path as filePath,
        n.date,
        n.title,
        n.category,
        n.tags,
        n.mentions,
        snippet(notes_fts, 2, '<mark>', '</mark>', '...', 32) as snippet,
        rank
      FROM notes_fts
      JOIN notes n ON notes_fts.id = n.id
      WHERE notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const results = stmt.all(query, limit) as Array<{
      id: string;
      filePath: string;
      date: string;
      title: string;
      category: string;
      tags: string;
      mentions: string;
      snippet: string;
      rank: number;
    }>;

    return results.map((r) => ({
      ...r,
      tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
      mentions: r.mentions ? r.mentions.split(",").filter(Boolean) : [],
    }));
  }

  searchByPerson(name: string, limit: number = 20): SearchResult[] {
    const stmt = this.db.prepare(`
      SELECT
        n.id,
        n.file_path as filePath,
        n.date,
        n.title,
        n.category,
        n.tags,
        n.mentions,
        substr(n.content, 1, 200) as snippet,
        0 as rank
      FROM notes n
      WHERE n.mentions LIKE ?
      ORDER BY n.date DESC
      LIMIT ?
    `);

    // Normalize to lowercase for case-insensitive matching
    const results = stmt.all(`%${name.toLowerCase()}%`, limit) as Array<{
      id: string;
      filePath: string;
      date: string;
      title: string;
      category: string;
      tags: string;
      mentions: string;
      snippet: string;
      rank: number;
    }>;

    return results.map((r) => ({
      ...r,
      tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
      mentions: r.mentions ? r.mentions.split(",").filter(Boolean) : [],
    }));
  }

  searchByDateRange(
    startDate: string,
    endDate: string,
    limit: number = 100
  ): SearchResult[] {
    const stmt = this.db.prepare(`
      SELECT
        n.id,
        n.file_path as filePath,
        n.date,
        n.title,
        n.category,
        n.tags,
        n.mentions,
        substr(n.content, 1, 200) as snippet,
        0 as rank
      FROM notes n
      WHERE n.date >= ? AND n.date <= ?
      ORDER BY n.date DESC
      LIMIT ?
    `);

    const results = stmt.all(startDate, endDate, limit) as Array<{
      id: string;
      filePath: string;
      date: string;
      title: string;
      category: string;
      tags: string;
      mentions: string;
      snippet: string;
      rank: number;
    }>;

    return results.map((r) => ({
      ...r,
      tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
      mentions: r.mentions ? r.mentions.split(",").filter(Boolean) : [],
    }));
  }

  searchByCategory(category: string, limit: number = 50): SearchResult[] {
    const stmt = this.db.prepare(`
      SELECT
        n.id,
        n.file_path as filePath,
        n.date,
        n.title,
        n.category,
        n.tags,
        n.mentions,
        substr(n.content, 1, 200) as snippet,
        0 as rank
      FROM notes n
      WHERE n.category = ?
      ORDER BY n.date DESC
      LIMIT ?
    `);

    const results = stmt.all(category, limit) as Array<{
      id: string;
      filePath: string;
      date: string;
      title: string;
      category: string;
      tags: string;
      mentions: string;
      snippet: string;
      rank: number;
    }>;

    return results.map((r) => ({
      ...r,
      tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
      mentions: r.mentions ? r.mentions.split(",").filter(Boolean) : [],
    }));
  }

  searchByTag(tag: string, limit: number = 50): SearchResult[] {
    const stmt = this.db.prepare(`
      SELECT
        n.id,
        n.file_path as filePath,
        n.date,
        n.title,
        n.category,
        n.tags,
        n.mentions,
        substr(n.content, 1, 200) as snippet,
        0 as rank
      FROM notes n
      WHERE n.tags LIKE ?
      ORDER BY n.date DESC
      LIMIT ?
    `);

    const results = stmt.all(`%${tag}%`, limit) as Array<{
      id: string;
      filePath: string;
      date: string;
      title: string;
      category: string;
      tags: string;
      mentions: string;
      snippet: string;
      rank: number;
    }>;

    return results.map((r) => ({
      ...r,
      tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
      mentions: r.mentions ? r.mentions.split(",").filter(Boolean) : [],
    }));
  }

  getEntities(type?: string): Array<{ name: string; type: string; count: number }> {
    let stmt;
    if (type) {
      stmt = this.db.prepare(`
        SELECT name, type, mention_count as count
        FROM entities
        WHERE type = ?
        ORDER BY mention_count DESC
      `);
      return stmt.all(type) as Array<{ name: string; type: string; count: number }>;
    } else {
      stmt = this.db.prepare(`
        SELECT name, type, mention_count as count
        FROM entities
        ORDER BY mention_count DESC
      `);
      return stmt.all() as Array<{ name: string; type: string; count: number }>;
    }
  }

  async rebuildIndex(noteManager: NoteManager): Promise<number> {
    // Clear existing data
    this.db.exec("DELETE FROM note_entities");
    this.db.exec("DELETE FROM entities");
    this.db.exec("DELETE FROM notes");

    // Re-index all notes
    const notes = await noteManager.getAllNotes();
    for (const note of notes) {
      this.indexNote(note);
    }

    return notes.length;
  }

  getStats(): { noteCount: number; entityCount: number; lastIndexed: string | null } {
    const noteCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM notes").get() as { count: number }
    ).count;
    const entityCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM entities").get() as { count: number }
    ).count;
    const lastIndexed = (
      this.db
        .prepare("SELECT MAX(indexed_at) as last FROM notes")
        .get() as { last: string | null }
    ).last;

    return { noteCount, entityCount, lastIndexed };
  }

  close(): void {
    this.db.close();
  }
}

export async function initializeDatabase(config: Config): Promise<Indexer> {
  const indexDir = getIndexDirectory(config);
  if (!existsSync(indexDir)) {
    mkdirSync(indexDir, { recursive: true });
  }

  return new Indexer(config);
}
