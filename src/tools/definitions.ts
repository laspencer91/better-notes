import { z } from "zod";

export const CreateNoteSchema = z.object({
  title: z.string().describe("Title for the note entry"),
  content: z.string().describe("Content of the note"),
  category: z.string().optional().describe("Category (e.g., work, meeting, personal)"),
  tags: z.array(z.string()).optional().describe("Tags for the note"),
  date: z
    .string()
    .optional()
    .describe("Date in YYYY-MM-DD format (defaults to today)"),
});

export const AppendNoteSchema = z.object({
  content: z.string().describe("Content to append"),
  title: z.string().optional().describe("Title for this entry (defaults to 'Note')"),
  category: z.string().optional().describe("Category for this entry"),
  tags: z.array(z.string()).optional().describe("Tags for this entry"),
  date: z
    .string()
    .optional()
    .describe("Date in YYYY-MM-DD format (defaults to today)"),
});

export const SearchNotesSchema = z.object({
  query: z
    .string()
    .describe(
      "Search query. Can include @person mentions, #tags, date ranges like 'past week', or plain text"
    ),
  limit: z.number().optional().describe("Maximum results to return (default: 20)"),
});

export const SearchByPersonSchema = z.object({
  name: z.string().describe("Name of the person to search for (without @)"),
  startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
  endDate: z.string().optional().describe("End date YYYY-MM-DD"),
});

export const SearchByTopicSchema = z.object({
  topic: z.string().describe("Topic or keyword to search for"),
  limit: z.number().optional().describe("Maximum results (default: 20)"),
});

export const GetDailySummarySchema = z.object({
  date: z.string().optional().describe("Date in YYYY-MM-DD format (defaults to today)"),
});

export const GenerateSummarySchema = z.object({
  period: z.enum(["daily", "weekly", "monthly"]).describe("Summary period"),
  date: z.string().optional().describe("Reference date YYYY-MM-DD (defaults to today)"),
});

export const ListRecentNotesSchema = z.object({
  days: z.number().optional().describe("Number of days to look back (default: 7)"),
});

export const GetNoteSchema = z.object({
  date: z.string().describe("Date in YYYY-MM-DD format"),
});

export const SearchByCategorySchema = z.object({
  category: z.string().describe("Category to filter by"),
  limit: z.number().optional().describe("Maximum results (default: 50)"),
});

export const SearchByTagSchema = z.object({
  tag: z.string().describe("Tag to filter by (without #)"),
  limit: z.number().optional().describe("Maximum results (default: 50)"),
});

export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;
export type AppendNoteInput = z.infer<typeof AppendNoteSchema>;
export type SearchNotesInput = z.infer<typeof SearchNotesSchema>;
export type SearchByPersonInput = z.infer<typeof SearchByPersonSchema>;
export type SearchByTopicInput = z.infer<typeof SearchByTopicSchema>;
export type GetDailySummaryInput = z.infer<typeof GetDailySummarySchema>;
export type GenerateSummaryInput = z.infer<typeof GenerateSummarySchema>;
export type ListRecentNotesInput = z.infer<typeof ListRecentNotesSchema>;
export type GetNoteInput = z.infer<typeof GetNoteSchema>;
export const GetGitChangesSchema = z.object({
  date: z
    .string()
    .optional()
    .describe("Date in YYYY-MM-DD format (defaults to today)"),
});

export const SummarizeDaySchema = z.object({
  date: z
    .string()
    .optional()
    .describe("Date in YYYY-MM-DD format (defaults to today)"),
});

export type SearchByCategoryInput = z.infer<typeof SearchByCategorySchema>;
export type SearchByTagInput = z.infer<typeof SearchByTagSchema>;
export type GetGitChangesInput = z.infer<typeof GetGitChangesSchema>;
export type SummarizeDayInput = z.infer<typeof SummarizeDaySchema>;
