export interface NoteFrontmatter {
  title: string;
  category: string;
  tags: string[];
  created: string; // ISO date string
  updated: string; // ISO date string
  mentions: string[]; // @person mentions
}

export interface Note {
  id: string; // Derived from file path
  filePath: string;
  date: string; // YYYY-MM-DD
  frontmatter: NoteFrontmatter;
  content: string;
  rawContent: string; // Full file content including frontmatter
}

export interface NoteEntry {
  time: string; // HH:MM
  category: string;
  title: string;
  content: string;
  tags: string[];
  mentions: string[];
}

export interface CreateNoteOptions {
  date?: string; // YYYY-MM-DD, defaults to today
  category?: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface AppendNoteOptions {
  date?: string; // YYYY-MM-DD, defaults to today
  category?: string;
  title?: string;
  content: string;
  tags?: string[];
}

export interface DailySummary {
  date: string;
  entries: NoteEntry[];
  categories: Record<string, number>;
  tags: string[];
  mentions: string[];
}
