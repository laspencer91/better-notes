#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadConfig, configExists, ensureDirectories, Config } from "./config/index.js";
import { NoteManager } from "./notes/manager.js";
import { Indexer } from "./index/indexer.js";
import { SearchEngine } from "./notes/search.js";
import {
  CreateNoteSchema,
  AppendNoteSchema,
  SearchNotesSchema,
  SearchByPersonSchema,
  SearchByTopicSchema,
  GetDailySummarySchema,
  GenerateSummarySchema,
  ListRecentNotesSchema,
  GetNoteSchema,
  SearchByCategorySchema,
  SearchByTagSchema,
} from "./tools/definitions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

class BetterNotesServer {
  private server: Server;
  private config: Config;
  private noteManager: NoteManager;
  private indexer: Indexer;
  private searchEngine: SearchEngine;

  private constructor(config: Config, noteManager: NoteManager, indexer: Indexer, searchEngine: SearchEngine) {
    this.config = config;
    this.noteManager = noteManager;
    this.indexer = indexer;
    this.searchEngine = searchEngine;

    this.server = new Server(
      {
        name: "better-notes",
        version: packageJson.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  static async create(): Promise<BetterNotesServer> {
    if (!configExists()) {
      console.error(
        "No configuration found. Run 'better-notes init' first."
      );
      process.exit(1);
    }

    const config = loadConfig();
    ensureDirectories(config);

    const noteManager = new NoteManager(config);
    const indexer = await Indexer.create(config);
    const searchEngine = new SearchEngine(indexer, config);

    return new BetterNotesServer(config, noteManager, indexer, searchEngine);
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "create_note",
          description:
            "Create a new note entry. Notes are organized by date. If a note already exists for the date, the new entry is appended.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Title for the note entry" },
              content: { type: "string", description: "Content of the note" },
              category: {
                type: "string",
                description: "Category (e.g., work, meeting, personal)",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Tags for the note",
              },
              date: {
                type: "string",
                description: "Date in YYYY-MM-DD format (defaults to today)",
              },
            },
            required: ["title", "content"],
          },
        },
        {
          name: "append_note",
          description:
            "Append content to today's note (or a specific date). Quick way to add to existing notes.",
          inputSchema: {
            type: "object",
            properties: {
              content: { type: "string", description: "Content to append" },
              title: {
                type: "string",
                description: "Title for this entry (defaults to 'Note')",
              },
              category: { type: "string", description: "Category for this entry" },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Tags for this entry",
              },
              date: {
                type: "string",
                description: "Date in YYYY-MM-DD format (defaults to today)",
              },
            },
            required: ["content"],
          },
        },
        {
          name: "search_notes",
          description:
            "Search notes using natural language. Supports @person mentions, #tags, date ranges like 'past week' or 'last month', and full-text search.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Search query with optional filters like @person, #tag, date ranges",
              },
              limit: {
                type: "number",
                description: "Maximum results to return (default: 20)",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "search_by_person",
          description:
            "Find all notes mentioning a specific person. Use this when looking for conversations or meetings with someone.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Name of the person (without @)",
              },
              startDate: { type: "string", description: "Start date YYYY-MM-DD" },
              endDate: { type: "string", description: "End date YYYY-MM-DD" },
            },
            required: ["name"],
          },
        },
        {
          name: "search_by_topic",
          description:
            "Full-text search for a topic or keyword across all notes with ranked results.",
          inputSchema: {
            type: "object",
            properties: {
              topic: { type: "string", description: "Topic or keyword to search for" },
              limit: {
                type: "number",
                description: "Maximum results (default: 20)",
              },
            },
            required: ["topic"],
          },
        },
        {
          name: "get_daily_summary",
          description:
            "Get a summary of notes for a specific day, including all entries, categories used, tags, and people mentioned.",
          inputSchema: {
            type: "object",
            properties: {
              date: {
                type: "string",
                description: "Date in YYYY-MM-DD format (defaults to today)",
              },
            },
          },
        },
        {
          name: "list_recent_notes",
          description: "List notes from the past N days with brief summaries.",
          inputSchema: {
            type: "object",
            properties: {
              days: {
                type: "number",
                description: "Number of days to look back (default: 7)",
              },
            },
          },
        },
        {
          name: "get_note",
          description: "Get the full content of a note for a specific date.",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date in YYYY-MM-DD format" },
            },
            required: ["date"],
          },
        },
        {
          name: "list_categories",
          description: "List all available note categories.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "list_tags",
          description: "List all tags used across notes.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "list_people",
          description: "List all people mentioned in notes with mention counts.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "search_by_category",
          description: "Find all notes in a specific category.",
          inputSchema: {
            type: "object",
            properties: {
              category: { type: "string", description: "Category to filter by" },
              limit: {
                type: "number",
                description: "Maximum results (default: 50)",
              },
            },
            required: ["category"],
          },
        },
        {
          name: "search_by_tag",
          description: "Find all notes with a specific tag.",
          inputSchema: {
            type: "object",
            properties: {
              tag: { type: "string", description: "Tag to filter by (without #)" },
              limit: {
                type: "number",
                description: "Maximum results (default: 50)",
              },
            },
            required: ["tag"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "create_note": {
            const input = CreateNoteSchema.parse(args);
            const note = await this.noteManager.createNote(input);
            this.indexer.indexNote(note);
            return {
              content: [
                {
                  type: "text",
                  text: `Created note: ${note.frontmatter.title}\nDate: ${note.date}\nFile: ${note.filePath}`,
                },
              ],
            };
          }

          case "append_note": {
            const input = AppendNoteSchema.parse(args);
            const note = await this.noteManager.appendNote(input);
            this.indexer.indexNote(note);
            return {
              content: [
                {
                  type: "text",
                  text: `Appended to note: ${note.date}\nFile: ${note.filePath}`,
                },
              ],
            };
          }

          case "search_notes": {
            const input = SearchNotesSchema.parse(args);
            const results = await this.searchEngine.search(input.query);
            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No notes found matching your query." }],
              };
            }
            const formatted = results
              .map(
                (r) =>
                  `**${r.date}** - ${r.title}\nFile: ${r.filePath}\n${r.snippet}\nTags: ${r.tags.join(", ") || "none"} | Mentions: ${r.mentions.join(", ") || "none"}`
              )
              .join("\n\n---\n\n");
            return {
              content: [{ type: "text", text: `Found ${results.length} notes:\n\n${formatted}` }],
            };
          }

          case "search_by_person": {
            const input = SearchByPersonSchema.parse(args);
            const dateRange =
              input.startDate && input.endDate
                ? { start: input.startDate, end: input.endDate }
                : undefined;
            const results = await this.searchEngine.searchByPerson(input.name, dateRange);
            if (results.length === 0) {
              return {
                content: [
                  { type: "text", text: `No notes found mentioning @${input.name}.` },
                ],
              };
            }
            const formatted = results
              .map((r) => `**${r.date}** - ${r.title}\nFile: ${r.filePath}\n${r.snippet}`)
              .join("\n\n---\n\n");
            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} notes mentioning @${input.name}:\n\n${formatted}`,
                },
              ],
            };
          }

          case "search_by_topic": {
            const input = SearchByTopicSchema.parse(args);
            const results = await this.searchEngine.searchFullText(input.topic);
            if (results.length === 0) {
              return {
                content: [
                  { type: "text", text: `No notes found about "${input.topic}".` },
                ],
              };
            }
            const formatted = results
              .map((r) => `**${r.date}** - ${r.title}\nFile: ${r.filePath}\n${r.snippet}`)
              .join("\n\n---\n\n");
            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} notes about "${input.topic}":\n\n${formatted}`,
                },
              ],
            };
          }

          case "get_daily_summary": {
            const input = GetDailySummarySchema.parse(args);
            const summary = await this.noteManager.getDailySummary(input.date);
            if (!summary) {
              return {
                content: [
                  { type: "text", text: `No notes found for ${input.date || "today"}.` },
                ],
              };
            }
            const entrySummaries = summary.entries
              .map((e) => `- **${e.time}** ${e.title}: ${e.content.slice(0, 100)}...`)
              .join("\n");
            return {
              content: [
                {
                  type: "text",
                  text: `## Summary for ${summary.date}\n\n**Entries:** ${summary.entries.length}\n${entrySummaries}\n\n**Tags:** ${summary.tags.join(", ") || "none"}\n**People:** ${summary.mentions.join(", ") || "none"}`,
                },
              ],
            };
          }

          case "list_recent_notes": {
            const input = ListRecentNotesSchema.parse(args);
            const notes = await this.noteManager.getRecentNotes(input.days || 7);
            if (notes.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `No notes found in the past ${input.days || 7} days.`,
                  },
                ],
              };
            }
            const formatted = notes
              .map(
                (n) =>
                  `**${n.date}** - ${n.frontmatter.title}\nFile: ${n.filePath}\nCategory: ${n.frontmatter.category} | Tags: ${n.frontmatter.tags.join(", ") || "none"}`
              )
              .join("\n\n");
            return {
              content: [
                {
                  type: "text",
                  text: `Recent notes (${notes.length}):\n\n${formatted}`,
                },
              ],
            };
          }

          case "get_note": {
            const input = GetNoteSchema.parse(args);
            const note = await this.noteManager.getNote(input.date);
            if (!note) {
              return {
                content: [{ type: "text", text: `No note found for ${input.date}.` }],
              };
            }
            return {
              content: [
                {
                  type: "text",
                  text: `# ${note.frontmatter.title}\n\n**Date:** ${note.date}\n**Category:** ${note.frontmatter.category}\n**Tags:** ${note.frontmatter.tags.join(", ") || "none"}\n**Mentions:** ${note.frontmatter.mentions.join(", ") || "none"}\n\n---\n\n${note.content}`,
                },
              ],
            };
          }

          case "list_categories": {
            const categories = this.noteManager.getCategories();
            return {
              content: [
                {
                  type: "text",
                  text: `Available categories:\n${categories.map((c) => `- ${c}`).join("\n")}`,
                },
              ],
            };
          }

          case "list_tags": {
            const tags = await this.noteManager.getAllTags();
            if (tags.length === 0) {
              return {
                content: [{ type: "text", text: "No tags found in any notes." }],
              };
            }
            return {
              content: [
                {
                  type: "text",
                  text: `Tags used (${tags.length}):\n${tags.map((t) => `#${t}`).join(", ")}`,
                },
              ],
            };
          }

          case "list_people": {
            const entities = this.searchEngine.getEntities("person");
            if (entities.length === 0) {
              return {
                content: [{ type: "text", text: "No people mentioned in any notes." }],
              };
            }
            const formatted = entities
              .map((e) => `- @${e.name} (${e.count} mentions)`)
              .join("\n");
            return {
              content: [
                {
                  type: "text",
                  text: `People mentioned (${entities.length}):\n${formatted}`,
                },
              ],
            };
          }

          case "search_by_category": {
            const input = SearchByCategorySchema.parse(args);
            const results = this.indexer.searchByCategory(input.category, input.limit);
            if (results.length === 0) {
              return {
                content: [
                  { type: "text", text: `No notes found in category "${input.category}".` },
                ],
              };
            }
            const formatted = results
              .map((r) => `**${r.date}** - ${r.title}`)
              .join("\n");
            return {
              content: [
                {
                  type: "text",
                  text: `Notes in "${input.category}" (${results.length}):\n\n${formatted}`,
                },
              ],
            };
          }

          case "search_by_tag": {
            const input = SearchByTagSchema.parse(args);
            const results = this.indexer.searchByTag(input.tag, input.limit);
            if (results.length === 0) {
              return {
                content: [
                  { type: "text", text: `No notes found with tag #${input.tag}.` },
                ],
              };
            }
            const formatted = results
              .map((r) => `**${r.date}** - ${r.title}`)
              .join("\n");
            return {
              content: [
                {
                  type: "text",
                  text: `Notes with #${input.tag} (${results.length}):\n\n${formatted}`,
                },
              ],
            };
          }

          default:
            return {
              content: [{ type: "text", text: `Unknown tool: ${name}` }],
              isError: true,
            };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Better Notes MCP server running on stdio");
  }
}

BetterNotesServer.create()
  .then((server) => server.run())
  .catch(console.error);
