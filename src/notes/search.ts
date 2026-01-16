import { Config } from "../config/index.js";
import { Indexer, SearchResult } from "../index/indexer.js";

export interface SearchQuery {
  text?: string;
  person?: string;
  tag?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface ParsedQuery extends SearchQuery {
  originalQuery: string;
}

export class SearchEngine {
  private indexer: Indexer;
  private config: Config;

  constructor(indexer: Indexer, config: Config) {
    this.indexer = indexer;
    this.config = config;
  }

  parseQuery(query: string): ParsedQuery {
    const parsed: ParsedQuery = {
      originalQuery: query,
    };

    // Extract @mentions (case-insensitive)
    const personMatch = query.match(/@(\w+)/);
    if (personMatch) {
      parsed.person = personMatch[1].toLowerCase();
      query = query.replace(/@\w+/, "").trim();
    }

    // Extract #tags
    const tagMatch = query.match(/#(\w+)/);
    if (tagMatch) {
      parsed.tag = tagMatch[1];
      query = query.replace(/#\w+/, "").trim();
    }

    // Extract category:value
    const categoryMatch = query.match(/category:(\w+)/i);
    if (categoryMatch) {
      parsed.category = categoryMatch[1];
      query = query.replace(/category:\w+/i, "").trim();
    }

    // Extract date ranges
    const dateRangePatterns = [
      // "from YYYY-MM-DD to YYYY-MM-DD"
      /from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i,
      // "between YYYY-MM-DD and YYYY-MM-DD"
      /between\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})/i,
    ];

    for (const pattern of dateRangePatterns) {
      const match = query.match(pattern);
      if (match) {
        parsed.startDate = match[1];
        parsed.endDate = match[2];
        query = query.replace(pattern, "").trim();
        break;
      }
    }

    // Handle relative date expressions
    const today = new Date();
    const relativePatterns: Array<{
      pattern: RegExp;
      getRange: () => { start: string; end: string };
    }> = [
      {
        pattern: /\b(today)\b/i,
        getRange: () => {
          const d = formatDate(today);
          return { start: d, end: d };
        },
      },
      {
        pattern: /\b(yesterday)\b/i,
        getRange: () => {
          const d = new Date(today);
          d.setDate(d.getDate() - 1);
          const ds = formatDate(d);
          return { start: ds, end: ds };
        },
      },
      {
        pattern: /\b(this week|past week|last 7 days)\b/i,
        getRange: () => {
          const end = formatDate(today);
          const start = new Date(today);
          start.setDate(start.getDate() - 7);
          return { start: formatDate(start), end };
        },
      },
      {
        pattern: /\b(last week)\b/i,
        getRange: () => {
          const end = new Date(today);
          end.setDate(end.getDate() - 7);
          const start = new Date(end);
          start.setDate(start.getDate() - 7);
          return { start: formatDate(start), end: formatDate(end) };
        },
      },
      {
        pattern: /\b(this month|past month|last 30 days)\b/i,
        getRange: () => {
          const end = formatDate(today);
          const start = new Date(today);
          start.setDate(start.getDate() - 30);
          return { start: formatDate(start), end };
        },
      },
      {
        pattern: /\bpast (\d+) days?\b/i,
        getRange: () => {
          const match = query.match(/past (\d+) days?/i);
          const days = match ? parseInt(match[1], 10) : 7;
          const end = formatDate(today);
          const start = new Date(today);
          start.setDate(start.getDate() - days);
          return { start: formatDate(start), end };
        },
      },
    ];

    for (const { pattern, getRange } of relativePatterns) {
      if (pattern.test(query)) {
        const range = getRange();
        parsed.startDate = range.start;
        parsed.endDate = range.end;
        query = query.replace(pattern, "").trim();
        break;
      }
    }

    // Remaining text is the search query
    if (query.trim()) {
      parsed.text = query.trim();
    }

    return parsed;
  }

  async search(query: string | SearchQuery): Promise<SearchResult[]> {
    const parsed: ParsedQuery =
      typeof query === "string" ? this.parseQuery(query) : { ...query, originalQuery: "" };

    const limit = parsed.limit || this.config.search.maxResults;
    let results: SearchResult[] = [];

    // If we have a date range, start with that
    if (parsed.startDate && parsed.endDate) {
      results = this.indexer.searchByDateRange(parsed.startDate, parsed.endDate, limit);
    }

    // If searching by person
    if (parsed.person) {
      const personResults = this.indexer.searchByPerson(parsed.person, limit);
      results = results.length > 0 ? intersectResults(results, personResults) : personResults;
    }

    // If searching by tag
    if (parsed.tag) {
      const tagResults = this.indexer.searchByTag(parsed.tag, limit);
      results = results.length > 0 ? intersectResults(results, tagResults) : tagResults;
    }

    // If searching by category
    if (parsed.category) {
      const categoryResults = this.indexer.searchByCategory(parsed.category, limit);
      results =
        results.length > 0 ? intersectResults(results, categoryResults) : categoryResults;
    }

    // If we have text, do full-text search
    if (parsed.text) {
      const textResults = this.indexer.search(parsed.text, limit);
      results = results.length > 0 ? intersectResults(results, textResults) : textResults;
    }

    // If no specific criteria, return recent notes
    if (results.length === 0 && !parsed.text && !parsed.person && !parsed.tag && !parsed.category) {
      const today = formatDate(new Date());
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      results = this.indexer.searchByDateRange(formatDate(weekAgo), today, limit);
    }

    // Regenerate snippets based on the primary search term (for intersection cases)
    const snippetTerm = parsed.text || parsed.person || parsed.tag;
    if (snippetTerm && results.length > 0) {
      results = this.indexer.regenerateSnippets(results, snippetTerm);
    }

    return results.slice(0, limit);
  }

  async searchByPerson(name: string, dateRange?: { start: string; end: string }): Promise<SearchResult[]> {
    let results = this.indexer.searchByPerson(name.toLowerCase(), this.config.search.maxResults);

    if (dateRange) {
      const dateResults = this.indexer.searchByDateRange(
        dateRange.start,
        dateRange.end,
        this.config.search.maxResults
      );
      results = intersectResults(results, dateResults);
    }

    return results;
  }

  async searchFullText(text: string): Promise<SearchResult[]> {
    return this.indexer.search(text, this.config.search.maxResults);
  }

  getEntities(type?: string) {
    return this.indexer.getEntities(type);
  }

  getStats() {
    return this.indexer.getStats();
  }
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function intersectResults(a: SearchResult[], b: SearchResult[]): SearchResult[] {
  const bIds = new Set(b.map((r) => r.id));
  return a.filter((r) => bIds.has(r.id));
}
