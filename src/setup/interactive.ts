import prompts from "prompts";
import chalk from "chalk";
import { existsSync } from "fs";
import { execSync } from "child_process";
import {
  Config,
  DEFAULT_CONFIG,
  saveConfig,
  getConfigPath,
  configExists,
  expandPath,
  ensureDirectories,
  ensureGitIgnore,
  getNotesDirectory,
} from "../config/index.js";
import { initializeDatabase } from "../index/indexer.js";
import { simpleGit } from "simple-git";

export async function runInteractiveSetup(
  options: { force?: boolean } = {}
): Promise<Config | null> {
  console.log(chalk.bold("\n🗒️  Better Notes Setup\n"));

  if (configExists() && !options.force) {
    const { overwrite } = await prompts({
      type: "confirm",
      name: "overwrite",
      message: `Config already exists at ${getConfigPath()}. Overwrite?`,
      initial: false,
    });

    if (!overwrite) {
      console.log(chalk.yellow("Setup cancelled."));
      return null;
    }
  }

  const responses = await prompts(
    [
      {
        type: "text",
        name: "notesDirectory",
        message: "Where should notes be stored?",
        initial: DEFAULT_CONFIG.notesDirectory,
        validate: (value) => {
          if (!value.trim()) return "Directory path is required";
          return true;
        },
      },
      {
        type: "confirm",
        name: "gitSyncEnabled",
        message: "Enable git auto-sync?",
        initial: DEFAULT_CONFIG.gitSync.enabled,
      },
      {
        type: (prev) => (prev ? "text" : null),
        name: "gitRemote",
        message: "Git remote URL (leave empty to skip):",
        initial: "",
      },
      {
        type: (_, values) => (values.gitSyncEnabled ? "number" : null),
        name: "debounceSeconds",
        message: "Sync debounce time (seconds)?",
        initial: DEFAULT_CONFIG.gitSync.debounceSeconds,
        min: 5,
        max: 300,
      },
      {
        type: "list",
        name: "categories",
        message: "Default categories (comma-separated):",
        initial: DEFAULT_CONFIG.categories.join(", "),
        separator: ",",
      },
      {
        type: "confirm",
        name: "daemonEnabled",
        message: "Enable background daemon for file watching?",
        initial: DEFAULT_CONFIG.daemon.enabled,
      },
      {
        type: "confirm",
        name: "entityExtraction",
        message: "Enable entity extraction (@mentions)?",
        initial: DEFAULT_CONFIG.search.enableEntityExtraction,
      },
    ],
    {
      onCancel: () => {
        console.log(chalk.yellow("\nSetup cancelled."));
        process.exit(0);
      },
    }
  );

  const config: Config = {
    notesDirectory: responses.notesDirectory,
    categories: responses.categories.map((c: string) => c.trim()).filter(Boolean),
    defaultCategory: responses.categories[0]?.trim() || "personal",
    gitSync: {
      enabled: responses.gitSyncEnabled,
      debounceSeconds: responses.debounceSeconds || 30,
      autoCommit: responses.gitSyncEnabled,
      autoPush: responses.gitSyncEnabled,
      remote: responses.gitRemote || undefined,
    },
    daemon: {
      enabled: responses.daemonEnabled,
      watchFiles: responses.daemonEnabled,
    },
    search: {
      enableEntityExtraction: responses.entityExtraction,
      maxResults: 20,
    },
    summarySchedule: {},
    templates: {},
    gitProjects: [],
  };

  console.log(chalk.dim("\nCreating configuration..."));
  saveConfig(config);
  console.log(chalk.green(`✓ Created ${getConfigPath()}`));

  console.log(chalk.dim("Creating directories..."));
  ensureDirectories(config);
  console.log(chalk.green(`✓ Created ${getNotesDirectory(config)}`));

  console.log(chalk.dim("Initializing search index..."));
  try {
    await initializeDatabase(config);
    console.log(chalk.green("✓ Created SQLite index"));
  } catch (error) {
    console.log(chalk.yellow("⚠ Could not initialize database (will retry on first use)"));
  }

  if (config.gitSync.enabled) {
    console.log(chalk.dim("Setting up git..."));
    ensureGitIgnore(config);

    const notesDir = getNotesDirectory(config);
    const git = simpleGit(notesDir);

    try {
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        await git.init();
        console.log(chalk.green("✓ Initialized git repository"));
      } else {
        console.log(chalk.green("✓ Git repository already exists"));
      }

      if (config.gitSync.remote) {
        const remotes = await git.getRemotes();
        if (!remotes.find((r) => r.name === "origin")) {
          await git.addRemote("origin", config.gitSync.remote);
          console.log(chalk.green(`✓ Added remote: ${config.gitSync.remote}`));
        }
      }
    } catch (error) {
      console.log(chalk.yellow("⚠ Could not initialize git (is git installed?)"));
    }
  }

  console.log(chalk.bold.green("\n✨ Setup complete!\n"));
  console.log("Next steps:");
  console.log(chalk.dim("  1. Start the daemon:     ") + "better-notes daemon start");
  console.log(chalk.dim("  2. Create your first note with Claude or:"));
  console.log(chalk.dim("     ") + "better-notes note create --title 'My first note'");
  console.log(chalk.dim("  3. Configure your MCP client to use:"));
  console.log(chalk.dim("     ") + "better-notes serve\n");

  return config;
}

export async function checkFirstRun(): Promise<boolean> {
  if (!configExists()) {
    console.log(chalk.yellow("No configuration found. Running first-time setup...\n"));
    const config = await runInteractiveSetup();
    return config !== null;
  }
  return true;
}
