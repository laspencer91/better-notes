import { simpleGit, SimpleGit } from "simple-git";
import { existsSync } from "fs";
import { basename } from "path";
import { Config, expandPath, GitProject } from "../config/index.js";

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  author: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface ProjectActivity {
  project: GitProject;
  commits: CommitInfo[];
  error?: string;
}

export interface DailyGitActivity {
  date: string;
  projects: ProjectActivity[];
  totalCommits: number;
}

/**
 * Get commits for a single git repo on a specific date.
 */
async function getProjectCommits(
  project: GitProject,
  date: string
): Promise<ProjectActivity> {
  const repoPath = expandPath(project.path);

  if (!existsSync(repoPath)) {
    return {
      project,
      commits: [],
      error: `Directory not found: ${repoPath}`,
    };
  }

  const git: SimpleGit = simpleGit(repoPath);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        project,
        commits: [],
        error: `Not a git repository: ${repoPath}`,
      };
    }

    // Get commits for the given date range (start of day to end of day)
    const after = `${date}T00:00:00`;
    const before = `${date}T23:59:59`;

    const log = await git.log({
      "--after": after,
      "--before": before,
      "--all": null,
      "--stat": null,
    });

    const commits: CommitInfo[] = log.all.map((entry) => {
      // Parse stat summary from diff
      const diffStat = entry.diff?.changed ?? 0;
      const insertions = entry.diff?.insertions ?? 0;
      const deletions = entry.diff?.deletions ?? 0;

      return {
        hash: entry.hash,
        shortHash: entry.hash.slice(0, 7),
        message: entry.message,
        date: entry.date,
        author: entry.author_name,
        filesChanged: diffStat,
        insertions,
        deletions,
      };
    });

    return { project, commits };
  } catch (error) {
    return {
      project,
      commits: [],
      error: `Git error: ${(error as Error).message}`,
    };
  }
}

/**
 * Get git activity across all configured projects for a given date.
 */
export async function getDailyGitActivity(
  config: Config,
  date?: string
): Promise<DailyGitActivity> {
  const targetDate =
    date || new Date().toISOString().split("T")[0];
  const projects = config.gitProjects || [];

  const results = await Promise.all(
    projects.map((project) => getProjectCommits(project, targetDate))
  );

  const totalCommits = results.reduce(
    (sum, r) => sum + r.commits.length,
    0
  );

  return {
    date: targetDate,
    projects: results,
    totalCommits,
  };
}

/**
 * Format daily git activity as a readable string for terminal output.
 */
export function formatGitActivity(activity: DailyGitActivity): string {
  const lines: string[] = [];

  if (activity.totalCommits === 0) {
    lines.push(`No git activity found for ${activity.date}.`);

    const errors = activity.projects.filter((p) => p.error);
    if (errors.length > 0) {
      lines.push("");
      for (const p of errors) {
        lines.push(`  Warning: ${p.project.name} - ${p.error}`);
      }
    }

    return lines.join("\n");
  }

  lines.push(
    `Git activity for ${activity.date} (${activity.totalCommits} commit${activity.totalCommits === 1 ? "" : "s"} across ${activity.projects.filter((p) => p.commits.length > 0).length} project${activity.projects.filter((p) => p.commits.length > 0).length === 1 ? "" : "s"}):`
  );
  lines.push("");

  for (const project of activity.projects) {
    if (project.commits.length === 0 && !project.error) continue;

    lines.push(`  ${project.project.name} (${project.commits.length} commit${project.commits.length === 1 ? "" : "s"}):`);

    if (project.error) {
      lines.push(`    Warning: ${project.error}`);
    }

    for (const commit of project.commits) {
      const stats: string[] = [];
      if (commit.filesChanged > 0) {
        stats.push(`${commit.filesChanged} file${commit.filesChanged === 1 ? "" : "s"}`);
      }
      if (commit.insertions > 0) stats.push(`+${commit.insertions}`);
      if (commit.deletions > 0) stats.push(`-${commit.deletions}`);

      const statStr = stats.length > 0 ? ` (${stats.join(", ")})` : "";
      lines.push(`    ${commit.shortHash} ${commit.message}${statStr}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format daily git activity as markdown for embedding in a note.
 */
export function formatGitActivityMarkdown(activity: DailyGitActivity): string {
  const lines: string[] = [];

  if (activity.totalCommits === 0) {
    return "No git activity for today.";
  }

  lines.push(
    `${activity.totalCommits} commit${activity.totalCommits === 1 ? "" : "s"} across ${activity.projects.filter((p) => p.commits.length > 0).length} project${activity.projects.filter((p) => p.commits.length > 0).length === 1 ? "" : "s"}.`
  );
  lines.push("");

  for (const project of activity.projects) {
    if (project.commits.length === 0) continue;

    lines.push(`**${project.project.name}** (${project.commits.length} commit${project.commits.length === 1 ? "" : "s"}):`);

    for (const commit of project.commits) {
      const stats: string[] = [];
      if (commit.filesChanged > 0) {
        stats.push(`${commit.filesChanged} file${commit.filesChanged === 1 ? "" : "s"}`);
      }
      if (commit.insertions > 0) stats.push(`+${commit.insertions}`);
      if (commit.deletions > 0) stats.push(`-${commit.deletions}`);

      const statStr = stats.length > 0 ? ` _(${stats.join(", ")})_` : "";
      lines.push(`- \`${commit.shortHash}\` ${commit.message}${statStr}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Discover git repositories within a directory (one level deep).
 */
export async function discoverGitRepos(
  directory: string
): Promise<GitProject[]> {
  const dirPath = expandPath(directory);

  if (!existsSync(dirPath)) {
    return [];
  }

  const { readdirSync, statSync } = await import("fs");
  const entries = readdirSync(dirPath);
  const repos: GitProject[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const fullPath = `${dirPath}/${entry}`;
    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) continue;

      const git = simpleGit(fullPath);
      const isRepo = await git.checkIsRepo();
      if (isRepo) {
        repos.push({
          name: basename(fullPath),
          path: fullPath,
        });
      }
    } catch {
      // Skip entries we can't access
    }
  }

  return repos.sort((a, b) => a.name.localeCompare(b.name));
}
