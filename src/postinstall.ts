#!/usr/bin/env node

import { configExists } from "./config/index.js";
import chalk from "chalk";

// This script runs after npm install
// It just checks if setup is needed and provides helpful output

if (!configExists()) {
  console.log(chalk.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(chalk.bold("  📝 @better-notes/cli installed successfully!"));
  console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
  console.log("  Run the following command to set up:");
  console.log(chalk.green("    better-notes init\n"));
  console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
}
