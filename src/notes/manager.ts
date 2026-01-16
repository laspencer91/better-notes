import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import matter from "gray-matter";
import { Config, getNotesDirectory } from "../config/index.js";
import {
  Note,
  NoteFrontmatter,
  NoteEntry,
  CreateNoteOptions,
  AppendNoteOptions,
  DailySummary,
} from "./types.js";

export class NoteManager {
  private config: Config;
  private notesDir: string;

  constructor(config: Config) {
    this.config = config;
    this.notesDir = getNotesDirectory(config);
  }

  private getDatePath(date: string): string {
    const [year, month] = date.split("-");
    return join(this.notesDir, year, month, `${date}.md`);
  }

  private formatDate(date?: Date): string {
    const d = date || new Date();
    return d.toISOString().split("T")[0];
  }

  private formatTime(date?: Date): string {
    const d = date || new Date();
    return d.toTimeString().slice(0, 5);
  }

  private extractMentions(content: string): string[] {
    const mentions = content.match(/@[\w-]+/g) || [];
    return [...new Set(mentions.map((m) => m.slice(1).toLowerCase()))];
  }

  private extractTags(content: string): string[] {
    const tags = content.match(/#[\w-]+/g) || [];
    return [...new Set(tags.map((t) => t.slice(1)))];
  }

  private parseNote(filePath: string): Note | null {
    if (!existsSync(filePath)) {
      return null;
    }

    const rawContent = readFileSync(filePath, "utf-8");
    const { data, content } = matter(rawContent);

    const pathParts = filePath.split("/");
    const filename = pathParts[pathParts.length - 1];
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
  }

  private formatNoteEntry(entry: NoteEntry): string {
    const lines: string[] = [];
    lines.push(`## ${entry.time} - ${entry.title}`);
    if (entry.category !== this.config.defaultCategory) {
      lines.push(`**Category:** ${entry.category}`);
    }
    lines.push("");
    lines.push(entry.content);
    if (entry.tags.length > 0) {
      lines.push("");
      lines.push(`Tags: ${entry.tags.map((t) => `#${t}`).join(" ")}`);
    }
    return lines.join("\n");
  }

  private createEmptyDailyNote(date: string): string {
    const frontmatter = {
      title: `Notes for ${date}`,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags: [],
      mentions: [],
    };

    return matter.stringify("", frontmatter);
  }

  async createNote(options: CreateNoteOptions): Promise<Note> {
    const date = options.date || this.formatDate();
    const filePath = this.getDatePath(date);
    const time = this.formatTime();

    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const mentions = this.extractMentions(options.content);
    const contentTags = this.extractTags(options.content);
    const allTags = [...new Set([...(options.tags || []), ...contentTags])];

    const entry: NoteEntry = {
      time,
      category: options.category || this.config.defaultCategory,
      title: options.title,
      content: options.content,
      tags: allTags,
      mentions,
    };

    let existingNote = this.parseNote(filePath);
    let newContent: string;

    if (existingNote) {
      // Append to existing note
      const entryText = this.formatNoteEntry(entry);
      newContent = existingNote.content + "\n\n" + entryText;

      const updatedMentions = [
        ...new Set([...existingNote.frontmatter.mentions, ...mentions]),
      ];
      const updatedTags = [
        ...new Set([...existingNote.frontmatter.tags, ...allTags]),
      ];

      const frontmatter = {
        ...existingNote.frontmatter,
        updated: new Date().toISOString(),
        mentions: updatedMentions,
        tags: updatedTags,
      };

      writeFileSync(filePath, matter.stringify(newContent, frontmatter));
    } else {
      // Create new daily note
      const entryText = this.formatNoteEntry(entry);
      const frontmatter: NoteFrontmatter = {
        title: `Notes for ${date}`,
        category: this.config.defaultCategory,
        tags: allTags,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        mentions,
      };

      writeFileSync(filePath, matter.stringify(entryText, frontmatter));
    }

    return this.parseNote(filePath)!;
  }

  async appendNote(options: AppendNoteOptions): Promise<Note> {
    const date = options.date || this.formatDate();
    const title = options.title || "Note";

    return this.createNote({
      date,
      category: options.category,
      title,
      content: options.content,
      tags: options.tags,
    });
  }

  async getNote(date: string): Promise<Note | null> {
    const filePath = this.getDatePath(date);
    return this.parseNote(filePath);
  }

  async getNoteForToday(): Promise<Note | null> {
    return this.getNote(this.formatDate());
  }

  async getRecentNotes(days: number = 7): Promise<Note[]> {
    const notes: Note[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = this.formatDate(date);
      const note = await this.getNote(dateStr);
      if (note) {
        notes.push(note);
      }
    }

    return notes;
  }

  async getAllNotes(): Promise<Note[]> {
    const notes: Note[] = [];

    if (!existsSync(this.notesDir)) {
      return notes;
    }

    const years = readdirSync(this.notesDir).filter((f) => /^\d{4}$/.test(f));

    for (const year of years) {
      const yearPath = join(this.notesDir, year);
      const months = readdirSync(yearPath).filter((f) => /^\d{2}$/.test(f));

      for (const month of months) {
        const monthPath = join(yearPath, month);
        const files = readdirSync(monthPath).filter((f) => f.endsWith(".md"));

        for (const file of files) {
          const filePath = join(monthPath, file);
          const note = this.parseNote(filePath);
          if (note) {
            notes.push(note);
          }
        }
      }
    }

    return notes.sort((a, b) => b.date.localeCompare(a.date));
  }

  async getNotesByCategory(category: string): Promise<Note[]> {
    const allNotes = await this.getAllNotes();
    return allNotes.filter(
      (note) =>
        note.frontmatter.category === category ||
        note.content.includes(`**Category:** ${category}`)
    );
  }

  async getNotesByTag(tag: string): Promise<Note[]> {
    const allNotes = await this.getAllNotes();
    return allNotes.filter(
      (note) =>
        note.frontmatter.tags.includes(tag) ||
        note.content.includes(`#${tag}`)
    );
  }

  async getDailySummary(date?: string): Promise<DailySummary | null> {
    const targetDate = date || this.formatDate();
    const note = await this.getNote(targetDate);

    if (!note) {
      return null;
    }

    // Parse entries from content
    const entries: NoteEntry[] = [];
    const entryRegex = /## (\d{2}:\d{2}) - (.+?)(?=\n## |\n*$)/gs;
    let match;

    while ((match = entryRegex.exec(note.content)) !== null) {
      const time = match[1];
      const title = match[2].trim();
      const entryContent = match[0]
        .replace(`## ${time} - ${title}`, "")
        .trim();

      entries.push({
        time,
        title,
        category: this.config.defaultCategory,
        content: entryContent,
        tags: this.extractTags(entryContent),
        mentions: this.extractMentions(entryContent),
      });
    }

    const categories: Record<string, number> = {};
    entries.forEach((e) => {
      categories[e.category] = (categories[e.category] || 0) + 1;
    });

    return {
      date: targetDate,
      entries,
      categories,
      tags: note.frontmatter.tags,
      mentions: note.frontmatter.mentions,
    };
  }

  getCategories(): string[] {
    return this.config.categories;
  }

  async getAllTags(): Promise<string[]> {
    const allNotes = await this.getAllNotes();
    const tags = new Set<string>();

    allNotes.forEach((note) => {
      note.frontmatter.tags.forEach((tag) => tags.add(tag));
      this.extractTags(note.content).forEach((tag) => tags.add(tag));
    });

    return [...tags].sort();
  }

  async getAllMentions(): Promise<string[]> {
    const allNotes = await this.getAllNotes();
    const mentions = new Set<string>();

    allNotes.forEach((note) => {
      note.frontmatter.mentions.forEach((m) => mentions.add(m));
      this.extractMentions(note.content).forEach((m) => mentions.add(m));
    });

    return [...mentions].sort();
  }
}
