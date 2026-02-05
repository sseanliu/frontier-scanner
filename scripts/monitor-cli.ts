#!/usr/bin/env npx tsx
/**
 * GoWild Flight Monitor CLI
 *
 * Usage:
 *   npx tsx scripts/monitor-cli.ts              # Run once with default config
 *   npx tsx scripts/monitor-cli.ts --daemon     # Run continuously
 *   npx tsx scripts/monitor-cli.ts --config     # Edit configuration
 */

import { monitor, MonitorConfig } from "../src/lib/monitor";
import { hasCookies, validateSession } from "../src/lib/playwright";
import * as readline from "readline";

const args = process.argv.slice(2);

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function configureMonitor(): Promise<void> {
  console.log("\n=== GoWild Monitor Configuration ===\n");

  const config = monitor.loadConfig();

  // Origins
  const originsInput = await prompt(
    `Origin airports (comma-separated) [${config.origins.join(",")}]: `
  );
  if (originsInput) {
    config.origins = originsInput.toUpperCase().split(",").map((s) => s.trim());
  }

  // Destinations mode
  const destMode = await prompt(
    "Destination mode:\n  1. Popular destinations only (faster)\n  2. All Frontier destinations\n  3. Custom list\nChoice [1]: "
  );

  if (destMode === "2") {
    config.destinations = monitor.ALL_DESTINATIONS;
  } else if (destMode === "3") {
    const customDests = await prompt("Enter destinations (comma-separated): ");
    config.destinations = customDests.toUpperCase().split(",").map((s) => s.trim());
  } else {
    config.destinations = monitor.POPULAR_DESTINATIONS;
  }

  // Max price
  const maxPriceInput = await prompt(`Max price (taxes/fees) to alert [$${config.maxPrice}]: `);
  if (maxPriceInput) {
    config.maxPrice = parseFloat(maxPriceInput) || config.maxPrice;
  }

  // Days ahead
  const daysInput = await prompt(`Days to look ahead [${config.daysAhead}]: `);
  if (daysInput) {
    config.daysAhead = parseInt(daysInput) || config.daysAhead;
  }

  // Interval
  const intervalInput = await prompt(`Scan interval (minutes) [${config.intervalMinutes}]: `);
  if (intervalInput) {
    config.intervalMinutes = parseInt(intervalInput) || config.intervalMinutes;
  }

  // Discord notifications
  const discordInput = await prompt(
    `Discord webhook URL (leave empty to skip) [${config.notifications.discord?.webhookUrl || "none"}]: `
  );
  if (discordInput) {
    config.notifications.discord = { webhookUrl: discordInput };
  }

  // Save config
  monitor.saveConfig(config);
  console.log("\nConfiguration saved to data/monitor-config.json");
  console.log("\nCurrent config:");
  console.log(JSON.stringify(config, null, 2));
}

async function checkAuth(): Promise<boolean> {
  if (!hasCookies()) {
    console.error("\n[Error] Not logged in to Frontier.");
    console.error("Please run the web app first and complete login:");
    console.error("  1. pnpm dev");
    console.error("  2. Open http://localhost:3000/settings");
    console.error("  3. Click 'Login to Frontier' and complete login");
    console.error("  4. Come back and run this script again\n");
    return false;
  }

  console.log("Validating session...");
  const validation = await validateSession();

  if (!validation.valid) {
    console.error(`\n[Error] Session invalid: ${validation.message}`);
    console.error("Please login again via the web app.\n");
    return false;
  }

  console.log("Session is valid!\n");
  return true;
}

async function main(): Promise<void> {
  console.log("\n========================================");
  console.log("  Frontier GoWild Flight Monitor");
  console.log("========================================\n");

  // Handle --config flag
  if (args.includes("--config")) {
    await configureMonitor();
    return;
  }

  // Check authentication
  const isAuth = await checkAuth();
  if (!isAuth) {
    process.exit(1);
  }

  const config = monitor.loadConfig();

  // Handle --daemon flag (continuous monitoring)
  if (args.includes("--daemon")) {
    console.log("Starting in daemon mode (continuous monitoring)...\n");
    await monitor.startMonitor(config);
    // Keep process alive
    process.on("SIGINT", () => {
      console.log("\n\nMonitor stopped.");
      process.exit(0);
    });
  } else {
    // Single scan
    console.log("Running single scan...\n");
    const flights = await monitor.runMonitorScan(config);
    console.log(`\nScan complete. Found ${flights.length} new flights.\n`);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
