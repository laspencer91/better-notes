import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { Config, ConfigSchema, DEFAULT_CONFIG } from "./schema.js";

const CONFIG_FILENAME = ".better-notes.json";

export function getConfigPath(): string {
  return join(homedir(), CONFIG_FILENAME);
}

export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path.startsWith("$HOME/")) {
    return join(homedir(), path.slice(6));
  }
  return resolve(path);
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return ConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${configPath}`);
    }
    throw error;
  }
}

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const validated = ConfigSchema.parse(config);
  writeFileSync(configPath, JSON.stringify(validated, null, 2) + "\n");
}

export function getNotesDirectory(config: Config): string {
  return expandPath(config.notesDirectory);
}

export function getIndexDirectory(config: Config): string {
  return join(getNotesDirectory(config), ".index");
}

export function getDatabasePath(config: Config): string {
  return join(getIndexDirectory(config), "notes.db");
}

export function getPidFilePath(config: Config): string {
  if (config.daemon.pidFile) {
    return expandPath(config.daemon.pidFile);
  }
  return join(getIndexDirectory(config), "daemon.pid");
}

export function getLogFilePath(config: Config): string {
  if (config.daemon.logFile) {
    return expandPath(config.daemon.logFile);
  }
  return join(getIndexDirectory(config), "daemon.log");
}

export function ensureDirectories(config: Config): void {
  const notesDir = getNotesDirectory(config);
  const indexDir = getIndexDirectory(config);

  if (!existsSync(notesDir)) {
    mkdirSync(notesDir, { recursive: true });
  }

  if (!existsSync(indexDir)) {
    mkdirSync(indexDir, { recursive: true });
  }
}

export function getGitIgnorePath(config: Config): string {
  return join(getNotesDirectory(config), ".gitignore");
}

export function ensureGitIgnore(config: Config): void {
  const gitignorePath = getGitIgnorePath(config);
  const content = `.index/
`;

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, content);
  } else {
    const existing = readFileSync(gitignorePath, "utf-8");
    if (!existing.includes(".index")) {
      writeFileSync(gitignorePath, existing + "\n" + content);
    }
  }
}

export * from "./schema.js";
