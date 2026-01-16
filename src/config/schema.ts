import { z } from "zod";

export const GitSyncConfigSchema = z.object({
  enabled: z.boolean().default(true),
  debounceSeconds: z.number().min(5).max(300).default(30),
  autoCommit: z.boolean().default(true),
  autoPush: z.boolean().default(true),
  remote: z.string().optional(),
});

export const DaemonConfigSchema = z.object({
  enabled: z.boolean().default(true),
  watchFiles: z.boolean().default(true),
  pidFile: z.string().optional(),
  logFile: z.string().optional(),
});

export const SearchConfigSchema = z.object({
  enableEntityExtraction: z.boolean().default(true),
  maxResults: z.number().min(1).max(100).default(20),
});

export const SummaryScheduleSchema = z.object({
  daily: z.string().optional(), // e.g., "18:00"
  weekly: z.string().optional(), // e.g., "friday 17:00"
  monthly: z.string().optional(), // e.g., "last 17:00"
});

export const ConfigSchema = z.object({
  notesDirectory: z.string().default("~/notes"),
  categories: z
    .array(z.string())
    .default(["work", "meeting", "personal", "idea", "task"]),
  defaultCategory: z.string().default("personal"),
  gitSync: GitSyncConfigSchema.default({}),
  daemon: DaemonConfigSchema.default({}),
  search: SearchConfigSchema.default({}),
  summarySchedule: SummaryScheduleSchema.default({}),
  templates: z.record(z.string(), z.string()).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type GitSyncConfig = z.infer<typeof GitSyncConfigSchema>;
export type DaemonConfig = z.infer<typeof DaemonConfigSchema>;
export type SearchConfig = z.infer<typeof SearchConfigSchema>;
export type SummarySchedule = z.infer<typeof SummaryScheduleSchema>;

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});
