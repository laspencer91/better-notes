#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";
import {
  loadConfig,
  saveConfig,
  configExists,
  getConfigPath,
  ensureDirectories,
  getNotesDirectory,
  expandPath,
} from "./config/index.js";
import { Config, GitProject } from "./config/schema.js";
import { runInteractiveSetup } from "./setup/interactive.js";
import { startDaemon, stopDaemon, getDaemonStatus, startDaemonBackground } from "./daemon.js";
import { NoteManager } from "./notes/manager.js";
import { Indexer } from "./index/indexer.js";
import { SearchEngine } from "./notes/search.js";
import {
  getDailyGitActivity,
  formatGitActivity,
  formatGitActivityMarkdown,
  discoverGitRepos,
} from "./sync/git-activity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

const program = new Command();

program
  .name("better-notes")
  .description("A powerful notes management system with MCP integration")
  .version(packageJson.version);

// Init command
program
  .command("init")
  .description("Initialize better-notes with interactive setup")
  .option("-f, --force", "Overwrite existing configuration")
  .action(async (options) => {
    await runInteractiveSetup({ force: options.force });
  });

// Serve command (MCP server)
program
  .command("serve")
  .description("Start the MCP server (for Claude integration)")
  .action(async () => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    // Import and run the MCP server
    const serverPath = join(__dirname, "index.js");
    const child = spawn(process.execPath, [serverPath], {
      stdio: "inherit",
    });

    child.on("error", (error) => {
      console.error(chalk.red(`Failed to start MCP server: ${error.message}`));
      process.exit(1);
    });

    child.on("exit", (code) => {
      process.exit(code || 0);
    });
  });

// Daemon commands
const daemonCmd = program.command("daemon").description("Manage the background daemon");

daemonCmd
  .command("start")
  .description("Start the background daemon")
  .option("-f, --foreground", "Run in foreground (don't detach)")
  .action(async (options) => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const status = getDaemonStatus();
    if (status.running) {
      console.log(chalk.yellow(`Daemon is already running (PID: ${status.pid})`));
      return;
    }

    if (options.foreground) {
      await startDaemon();
    } else {
      console.log("Starting daemon in background...");
      startDaemonBackground();

      // Wait for daemon to initialize (sql.js needs time to load)
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const newStatus = getDaemonStatus();
      if (newStatus.running) {
        console.log(chalk.green(`Daemon started (PID: ${newStatus.pid})`));
      } else {
        console.log(chalk.yellow("Daemon may have failed to start. Check logs."));
      }
    }
  });

daemonCmd
  .command("stop")
  .description("Stop the background daemon")
  .action(() => {
    stopDaemon();
  });

daemonCmd
  .command("status")
  .description("Check daemon status")
  .action(() => {
    const status = getDaemonStatus();
    if (status.running) {
      console.log(chalk.green(`Daemon is running (PID: ${status.pid})`));
    } else {
      console.log(chalk.yellow("Daemon is not running"));
    }
  });

daemonCmd
  .command("restart")
  .description("Restart the background daemon")
  .action(async () => {
    stopDaemon();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    startDaemonBackground();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const status = getDaemonStatus();
    if (status.running) {
      console.log(chalk.green(`Daemon restarted (PID: ${status.pid})`));
    } else {
      console.log(chalk.yellow("Daemon may have failed to restart. Check logs."));
    }
  });

// Hidden run command - used by startDaemonBackground() to spawn the daemon process
daemonCmd
  .command("run", { hidden: true })
  .action(async () => {
    await startDaemon();
  });

// Note commands
const noteCmd = program.command("note").description("Manage notes");

noteCmd
  .command("create")
  .description("Create a new note")
  .requiredOption("-t, --title <title>", "Note title")
  .option("-c, --content <content>", "Note content")
  .option("-C, --category <category>", "Note category")
  .option("--tags <tags>", "Comma-separated tags")
  .option("-d, --date <date>", "Date (YYYY-MM-DD)")
  .action(async (options) => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const config = loadConfig();
    ensureDirectories(config);
    const noteManager = new NoteManager(config);
    const indexer = await Indexer.create(config);

    const note = await noteManager.createNote({
      title: options.title,
      content: options.content || "",
      category: options.category,
      tags: options.tags ? options.tags.split(",").map((t: string) => t.trim()) : undefined,
      date: options.date,
    });

    indexer.indexNote(note);
    indexer.close();

    console.log(chalk.green(`Created note: ${note.filePath}`));
  });

noteCmd
  .command("today")
  .description("View today's note")
  .action(async () => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const config = loadConfig();
    const noteManager = new NoteManager(config);
    const note = await noteManager.getNoteForToday();

    if (!note) {
      console.log(chalk.yellow("No note for today."));
      return;
    }

    console.log(chalk.bold(`\n${note.frontmatter.title}\n`));
    console.log(chalk.dim(`Date: ${note.date}`));
    console.log(chalk.dim(`Category: ${note.frontmatter.category}`));
    console.log(chalk.dim(`Tags: ${note.frontmatter.tags.join(", ") || "none"}`));
    console.log(chalk.dim(`Mentions: ${note.frontmatter.mentions.join(", ") || "none"}\n`));
    console.log(note.content);
  });

noteCmd
  .command("recent")
  .description("List recent notes")
  .option("-n, --days <days>", "Number of days", "7")
  .action(async (options) => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const config = loadConfig();
    const noteManager = new NoteManager(config);
    const notes = await noteManager.getRecentNotes(parseInt(options.days, 10));

    if (notes.length === 0) {
      console.log(chalk.yellow(`No notes in the past ${options.days} days.`));
      return;
    }

    console.log(chalk.bold(`\nRecent notes (${notes.length}):\n`));
    for (const note of notes) {
      console.log(
        `${chalk.cyan(note.date)} - ${note.frontmatter.title} ${chalk.dim(`[${note.frontmatter.category}]`)}`
      );
    }
  });

// Search command
program
  .command("search <query>")
  .description("Search notes")
  .option("-l, --limit <limit>", "Maximum results", "20")
  .action(async (query, options) => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const config = loadConfig();
    const indexer = await Indexer.create(config);
    const searchEngine = new SearchEngine(indexer, config);

    const results = await searchEngine.search(query);
    indexer.close();

    if (results.length === 0) {
      console.log(chalk.yellow("No results found."));
      return;
    }

    console.log(chalk.bold(`\nFound ${results.length} results:\n`));
    for (const result of results) {
      console.log(`${chalk.cyan(result.date)} - ${chalk.bold(result.title)}`);
      console.log(chalk.dim(`File: ${result.filePath}`));
      console.log(result.snippet.replace(/<\/?mark>/g, ""));
      console.log();
    }
  });

// Index command
const indexCmd = program.command("index").description("Manage the search index");

indexCmd
  .command("rebuild")
  .description("Rebuild the search index from markdown files")
  .action(async () => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const config = loadConfig();
    const indexer = await Indexer.create(config);
    const noteManager = new NoteManager(config);

    console.log("Rebuilding index...");
    const count = await indexer.rebuildIndex(noteManager);
    indexer.close();

    console.log(chalk.green(`Index rebuilt: ${count} notes indexed.`));
  });

indexCmd
  .command("stats")
  .description("Show index statistics")
  .action(async () => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const config = loadConfig();
    const indexer = await Indexer.create(config);
    const stats = indexer.getStats();
    indexer.close();

    console.log(chalk.bold("\nIndex Statistics:\n"));
    console.log(`Notes indexed: ${stats.noteCount}`);
    console.log(`Entities tracked: ${stats.entityCount}`);
    console.log(`Last indexed: ${stats.lastIndexed || "never"}`);
  });

// Config command
program
  .command("config")
  .description("Show current configuration")
  .action(() => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const config = loadConfig();
    console.log(chalk.bold("\nConfiguration:\n"));
    console.log(`Config file: ${getConfigPath()}`);
    console.log(`Notes directory: ${getNotesDirectory(config)}`);
    console.log(`Git sync: ${config.gitSync.enabled ? "enabled" : "disabled"}`);
    console.log(`Daemon: ${config.daemon.enabled ? "enabled" : "disabled"}`);
    console.log(`Categories: ${config.categories.join(", ")}`);
  });

// Install service command
program
  .command("install-service")
  .description("Install as a system service (systemd/launchd/Task Scheduler)")
  .action(async () => {
    const platform = process.platform;

    if (platform === "linux") {
      console.log(chalk.bold("\nTo install as a systemd service:\n"));
      console.log("1. Create the service file:");
      console.log(chalk.dim("   sudo nano /etc/systemd/system/better-notes.service\n"));
      console.log("2. Add the following content:");
      console.log(chalk.cyan(`
[Unit]
Description=Better Notes Daemon
After=network.target

[Service]
Type=simple
User=${process.env.USER}
ExecStart=${process.execPath} ${join(__dirname, "daemon.js")} run
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`));
      console.log("3. Enable and start:");
      console.log(chalk.dim("   sudo systemctl enable better-notes"));
      console.log(chalk.dim("   sudo systemctl start better-notes"));
    } else if (platform === "darwin") {
      console.log(chalk.bold("\nTo install as a launchd service:\n"));
      console.log("1. Create the plist file:");
      console.log(chalk.dim(`   nano ~/Library/LaunchAgents/com.better-notes.daemon.plist\n`));
      console.log("2. Add the following content:");
      console.log(chalk.cyan(`
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.better-notes.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${join(__dirname, "daemon.js")}</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
`));
      console.log("3. Load the service:");
      console.log(chalk.dim("   launchctl load ~/Library/LaunchAgents/com.better-notes.daemon.plist"));
    } else if (platform === "win32") {
      console.log(chalk.bold("\nTo install as a Windows Task Scheduler task:\n"));
      console.log("1. Open Task Scheduler:");
      console.log(chalk.dim("   Press Win+R, type 'taskschd.msc', press Enter\n"));
      console.log("2. Create a new task:");
      console.log(chalk.dim("   Click 'Create Task...' in the right panel\n"));
      console.log("3. General tab:");
      console.log(chalk.dim("   - Name: Better Notes Daemon"));
      console.log(chalk.dim("   - Check 'Run whether user is logged on or not'"));
      console.log(chalk.dim("   - Check 'Run with highest privileges'\n"));
      console.log("4. Triggers tab:");
      console.log(chalk.dim("   - Click 'New...'"));
      console.log(chalk.dim("   - Begin the task: 'At log on'"));
      console.log(chalk.dim("   - Click OK\n"));
      console.log("5. Actions tab:");
      console.log(chalk.dim("   - Click 'New...'"));
      console.log(chalk.dim("   - Action: 'Start a program'"));
      console.log(chalk.dim(`   - Program/script: ${process.execPath}`));
      console.log(chalk.dim(`   - Arguments: "${join(__dirname, "daemon.js")}" run`));
      console.log(chalk.dim("   - Click OK\n"));
      console.log("6. Conditions tab:");
      console.log(chalk.dim("   - Uncheck 'Start only if on AC power' (for laptops)\n"));
      console.log("7. Settings tab:");
      console.log(chalk.dim("   - Check 'Allow task to be run on demand'"));
      console.log(chalk.dim("   - Check 'If the task fails, restart every: 1 minute'"));
      console.log(chalk.dim("   - Click OK\n"));
      console.log(chalk.bold("Alternative - using PowerShell (run as Admin):"));
      console.log(chalk.cyan(`
$action = New-ScheduledTaskAction -Execute '${process.execPath}' -Argument '"${join(__dirname, "daemon.js")}" run'
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "BetterNotesDaemon" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
`));
    } else {
      console.log(chalk.yellow(`Service installation is not supported on ${platform}.`));
    }
  });

// Projects command - manage tracked git repositories
program
  .command("projects")
  .description("Manage tracked git projects for daily summaries")
  .option("-a, --add <directory>", "Scan a directory for git repos to add")
  .option("-l, --list", "List currently tracked projects")
  .option("-r, --remove", "Interactively remove projects")
  .action(async (options) => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const config = loadConfig();
    const currentProjects = config.gitProjects || [];

    if (options.list) {
      if (currentProjects.length === 0) {
        console.log(chalk.yellow("\nNo projects tracked. Use 'better-notes projects --add <directory>' to add some."));
        return;
      }

      console.log(chalk.bold(`\nTracked projects (${currentProjects.length}):\n`));
      for (const project of currentProjects) {
        console.log(`  ${chalk.cyan(project.name)} ${chalk.dim(project.path)}`);
      }
      console.log();
      return;
    }

    if (options.remove) {
      if (currentProjects.length === 0) {
        console.log(chalk.yellow("\nNo projects to remove."));
        return;
      }

      const prompts = (await import("prompts")).default;
      const { toRemove } = await prompts({
        type: "multiselect",
        name: "toRemove",
        message: "Select projects to remove",
        choices: currentProjects.map((p) => ({
          title: `${p.name} ${chalk.dim(p.path)}`,
          value: p.path,
        })),
      });

      if (!toRemove || toRemove.length === 0) {
        console.log(chalk.yellow("No projects removed."));
        return;
      }

      const removeSet = new Set(toRemove);
      const updated: Config = {
        ...config,
        gitProjects: currentProjects.filter((p) => !removeSet.has(p.path)),
      };
      saveConfig(updated);
      console.log(chalk.green(`\nRemoved ${toRemove.length} project(s).`));
      return;
    }

    // Default behavior or --add: scan directory and offer multiselect
    const directory = options.add || undefined;

    if (!directory) {
      // No directory given - show interactive prompt to enter one
      const prompts = (await import("prompts")).default;
      const { dir } = await prompts({
        type: "text",
        name: "dir",
        message: "Enter a directory path to scan for git repos:",
        validate: (value) => {
          if (!value.trim()) return "Directory path is required";
          return true;
        },
      });

      if (!dir) {
        console.log(chalk.yellow("Cancelled."));
        return;
      }

      await scanAndSelectProjects(config, dir);
      return;
    }

    await scanAndSelectProjects(config, directory);
  });

async function scanAndSelectProjects(config: Config, directory: string): Promise<void> {
  const prompts = (await import("prompts")).default;
  const dirPath = expandPath(directory);

  console.log(chalk.dim(`\nScanning ${dirPath} for git repositories...`));
  const discovered = await discoverGitRepos(directory);

  if (discovered.length === 0) {
    console.log(chalk.yellow("No git repositories found in that directory."));
    return;
  }

  console.log(chalk.green(`Found ${discovered.length} git repo(s).\n`));

  const currentPaths = new Set((config.gitProjects || []).map((p) => p.path));

  const { selected } = await prompts({
    type: "multiselect",
    name: "selected",
    message: "Select projects to track (space to toggle, enter to confirm)",
    choices: discovered.map((repo) => ({
      title: `${repo.name} ${chalk.dim(repo.path)}`,
      value: repo,
      selected: currentPaths.has(repo.path),
    })),
    instructions: false,
    hint: "- Space to select. Enter to submit.",
  });

  if (!selected || selected.length === 0) {
    console.log(chalk.yellow("No projects selected."));
    return;
  }

  // Merge: keep existing projects not in this directory, add selected ones
  const selectedPaths = new Set(selected.map((s: GitProject) => s.path));
  const existingFromOtherDirs = (config.gitProjects || []).filter(
    (p) => !discovered.some((d) => d.path === p.path)
  );
  const kept = (config.gitProjects || []).filter(
    (p) => discovered.some((d) => d.path === p.path) && selectedPaths.has(p.path)
  );
  const newlyAdded = selected.filter(
    (s: GitProject) => !(config.gitProjects || []).some((p) => p.path === s.path)
  );

  const updatedProjects = [...existingFromOtherDirs, ...kept, ...newlyAdded];

  const updated: Config = {
    ...config,
    gitProjects: updatedProjects,
  };
  saveConfig(updated);

  console.log(chalk.green(`\nNow tracking ${updatedProjects.length} project(s) total.`));
  if (newlyAdded.length > 0) {
    console.log(chalk.dim(`Added: ${newlyAdded.map((p: GitProject) => p.name).join(", ")}`));
  }
}

// Changes command - view daily git activity
program
  .command("changes")
  .description("View git activity across tracked projects for a given day")
  .option("-d, --date <date>", "Date in YYYY-MM-DD format (defaults to today)")
  .action(async (options) => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const config = loadConfig();

    if (!config.gitProjects || config.gitProjects.length === 0) {
      console.log(chalk.yellow("\nNo git projects configured."));
      console.log(chalk.dim("Use 'better-notes projects --add <directory>' to add tracked repositories."));
      return;
    }

    const date = options.date || new Date().toISOString().split("T")[0];
    console.log(chalk.dim(`\nFetching git activity for ${date}...\n`));

    const activity = await getDailyGitActivity(config, date);
    console.log(formatGitActivity(activity));
  });

// Summarize command - create a daily summary note with git context
program
  .command("summarize")
  .description("Create a daily summary note including git activity")
  .option("-d, --date <date>", "Date in YYYY-MM-DD format (defaults to today)")
  .action(async (options) => {
    if (!configExists()) {
      console.error(chalk.red("No configuration found. Run 'better-notes init' first."));
      process.exit(1);
    }

    const config = loadConfig();
    ensureDirectories(config);
    const noteManager = new NoteManager(config);
    const indexer = await Indexer.create(config);

    const date = options.date || new Date().toISOString().split("T")[0];

    // Gather git activity if projects are configured
    let gitSection = "";
    if (config.gitProjects && config.gitProjects.length > 0) {
      console.log(chalk.dim("Fetching git activity..."));
      const activity = await getDailyGitActivity(config, date);
      if (activity.totalCommits > 0) {
        gitSection = `### Git Activity\n\n${formatGitActivityMarkdown(activity)}`;
      }
    }

    // Get existing note content for the day
    const existingNote = await noteManager.getNote(date);
    let noteSummarySection = "";
    if (existingNote && existingNote.content.trim()) {
      const entryCount = (existingNote.content.match(/^## /gm) || []).length;
      noteSummarySection = `### Notes\n\n${entryCount} note entr${entryCount === 1 ? "y" : "ies"} recorded today.`;
    }

    // Build summary content
    const parts: string[] = [];
    if (noteSummarySection) parts.push(noteSummarySection);
    if (gitSection) parts.push(gitSection);

    if (parts.length === 0) {
      console.log(chalk.yellow(`No activity found for ${date}. No summary created.`));
      indexer.close();
      return;
    }

    const summaryContent = parts.join("\n\n");

    const note = await noteManager.createNote({
      date,
      title: "Daily Summary",
      content: summaryContent,
      tags: ["summary"],
      category: "summary",
    });

    indexer.indexNote(note);
    indexer.close();

    console.log(chalk.green(`\nDaily summary added to: ${note.filePath}`));
    console.log(chalk.dim("\n--- Summary Preview ---\n"));
    console.log(summaryContent);
  });

program.parse();
