import initSqlJs, { Database } from "sql.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  Config,
  getDatabasePath,
  getIndexDirectory,
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

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

export class Indexer {
  private db: Database;
  private config: Config;
  private dbPath: string;

  private constructor(db: Database, config: Config, dbPath: string) {
    this.db = db;
    this.config = config;
    this.dbPath = dbPath;
  }

  static async create(config: Config): Promise<Indexer> {
    const dbPath = getDatabasePath(config);
    const indexDir = dirname(dbPath);

    if (!existsSync(indexDir)) {
      mkdirSync(indexDir, { recursive: true });
    }

    const SQL = await getSqlJs();
    let db: Database;

    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    const indexer = new Indexer(db, config, dbPath);
    indexer.initializeSchema();
    return indexer;
  }

  private initializeSchema(): void {
    this.db.run(`
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
    this.save();
  }

  private save(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
  }

  indexNote(note: Note): void {
    // Delete existing entry if any
    this.db.run("DELETE FROM notes_fts WHERE id = ?", [note.id]);
    this.db.run("DELETE FROM notes WHERE id = ?", [note.id]);

    // Insert new entry
    this.db.run(
      `INSERT INTO notes
       (id, file_path, date, title, category, tags, mentions, content, created_at, updated_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        new Date().toISOString(),
      ]
    );

    // Update FTS index
    this.db.run(
      `INSERT INTO notes_fts (id, title, content, tags, mentions)
       VALUES (?, ?, ?, ?, ?)`,
      [
        note.id,
        note.frontmatter.title,
        note.content,
        note.frontmatter.tags.join(","),
        note.frontmatter.mentions.join(","),
      ]
    );

    // Index entities (mentions)
    if (this.config.search.enableEntityExtraction) {
      this.indexEntities(note);
    }

    this.save();
  }

  private indexEntities(note: Note): void {
    const mentions = note.frontmatter.mentions;
    const now = new Date().toISOString();

    for (const mention of mentions) {
      // Check if entity exists
      const existing = this.db.exec(
        "SELECT id FROM entities WHERE name = ? AND type = 'person'",
        [mention.toLowerCase()]
      );

      let entityId: number;

      if (existing.length > 0 && existing[0].values.length > 0) {
        entityId = existing[0].values[0][0] as number;
        this.db.run(
          "UPDATE entities SET last_seen = ?, mention_count = mention_count + 1 WHERE id = ?",
          [now, entityId]
        );
      } else {
        this.db.run(
          "INSERT INTO entities (name, type, first_seen, last_seen, mention_count) VALUES (?, 'person', ?, ?, 1)",
          [mention.toLowerCase(), now, now]
        );
        const result = this.db.exec("SELECT last_insert_rowid()");
        entityId = result[0].values[0][0] as number;
      }

      // Link note to entity
      this.db.run(
        "INSERT OR IGNORE INTO note_entities (note_id, entity_id) VALUES (?, ?)",
        [note.id, entityId]
      );
    }
  }

  removeNote(noteId: string): void {
    this.db.run("DELETE FROM note_entities WHERE note_id = ?", [noteId]);
    this.db.run("DELETE FROM notes_fts WHERE id = ?", [noteId]);
    this.db.run("DELETE FROM notes WHERE id = ?", [noteId]);
    this.save();
  }

  search(query: string, limit: number = 20): SearchResult[] {
    const results = this.db.exec(
      `SELECT
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
      LIMIT ?`,
      [query, limit]
    );

    if (results.length === 0) return [];

    return results[0].values.map((row) => ({
      id: row[0] as string,
      filePath: row[1] as string,
      date: row[2] as string,
      title: row[3] as string,
      category: row[4] as string,
      tags: (row[5] as string)?.split(",").filter(Boolean) || [],
      mentions: (row[6] as string)?.split(",").filter(Boolean) || [],
      snippet: row[7] as string,
      rank: row[8] as number,
    }));
  }

  searchByPerson(name: string, limit: number = 20): SearchResult[] {
    const results = this.db.exec(
      `SELECT
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
      LIMIT ?`,
      [`%${name.toLowerCase()}%`, limit]
    );

    if (results.length === 0) return [];

    return results[0].values.map((row) => ({
      id: row[0] as string,
      filePath: row[1] as string,
      date: row[2] as string,
      title: row[3] as string,
      category: row[4] as string,
      tags: (row[5] as string)?.split(",").filter(Boolean) || [],
      mentions: (row[6] as string)?.split(",").filter(Boolean) || [],
      snippet: row[7] as string,
      rank: row[8] as number,
    }));
  }

  searchByDateRange(
    startDate: string,
    endDate: string,
    limit: number = 100
  ): SearchResult[] {
    const results = this.db.exec(
      `SELECT
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
      LIMIT ?`,
      [startDate, endDate, limit]
    );

    if (results.length === 0) return [];

    return results[0].values.map((row) => ({
      id: row[0] as string,
      filePath: row[1] as string,
      date: row[2] as string,
      title: row[3] as string,
      category: row[4] as string,
      tags: (row[5] as string)?.split(",").filter(Boolean) || [],
      mentions: (row[6] as string)?.split(",").filter(Boolean) || [],
      snippet: row[7] as string,
      rank: row[8] as number,
    }));
  }

  searchByCategory(category: string, limit: number = 50): SearchResult[] {
    const results = this.db.exec(
      `SELECT
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
      LIMIT ?`,
      [category, limit]
    );

    if (results.length === 0) return [];

    return results[0].values.map((row) => ({
      id: row[0] as string,
      filePath: row[1] as string,
      date: row[2] as string,
      title: row[3] as string,
      category: row[4] as string,
      tags: (row[5] as string)?.split(",").filter(Boolean) || [],
      mentions: (row[6] as string)?.split(",").filter(Boolean) || [],
      snippet: row[7] as string,
      rank: row[8] as number,
    }));
  }

  searchByTag(tag: string, limit: number = 50): SearchResult[] {
    const results = this.db.exec(
      `SELECT
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
      LIMIT ?`,
      [`%${tag}%`, limit]
    );

    if (results.length === 0) return [];

    return results[0].values.map((row) => ({
      id: row[0] as string,
      filePath: row[1] as string,
      date: row[2] as string,
      title: row[3] as string,
      category: row[4] as string,
      tags: (row[5] as string)?.split(",").filter(Boolean) || [],
      mentions: (row[6] as string)?.split(",").filter(Boolean) || [],
      snippet: row[7] as string,
      rank: row[8] as number,
    }));
  }

  getEntities(type?: string): Array<{ name: string; type: string; count: number }> {
    let results;
    if (type) {
      results = this.db.exec(
        `SELECT name, type, mention_count as count
         FROM entities
         WHERE type = ?
         ORDER BY mention_count DESC`,
        [type]
      );
    } else {
      results = this.db.exec(
        `SELECT name, type, mention_count as count
         FROM entities
         ORDER BY mention_count DESC`
      );
    }

    if (results.length === 0) return [];

    return results[0].values.map((row) => ({
      name: row[0] as string,
      type: row[1] as string,
      count: row[2] as number,
    }));
  }

  async rebuildIndex(noteManager: NoteManager): Promise<number> {
    // Clear existing data
    this.db.run("DELETE FROM note_entities");
    this.db.run("DELETE FROM entities");
    this.db.run("DELETE FROM notes_fts");
    this.db.run("DELETE FROM notes");

    // Re-index all notes
    const notes = await noteManager.getAllNotes();
    for (const note of notes) {
      this.indexNote(note);
    }

    this.save();
    return notes.length;
  }

  getStats(): { noteCount: number; entityCount: number; lastIndexed: string | null } {
    const noteResult = this.db.exec("SELECT COUNT(*) as count FROM notes");
    const entityResult = this.db.exec("SELECT COUNT(*) as count FROM entities");
    const lastResult = this.db.exec("SELECT MAX(indexed_at) as last FROM notes");

    const noteCount = noteResult.length > 0 ? (noteResult[0].values[0][0] as number) : 0;
    const entityCount = entityResult.length > 0 ? (entityResult[0].values[0][0] as number) : 0;
    const lastIndexed = lastResult.length > 0 ? (lastResult[0].values[0][0] as string | null) : null;

    return { noteCount, entityCount, lastIndexed };
  }

  close(): void {
    this.save();
    this.db.close();
  }
}

export async function initializeDatabase(config: Config): Promise<Indexer> {
  return Indexer.create(config);
}
