/**
 * GoWild Flight Monitor
 * Automated monitoring with notifications
 */

import { scanRoute, FlightResult, ScanResult } from "./scanner";
import { hasCookies } from "./playwright";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_PATH = path.join(DATA_DIR, "monitor-config.json");
const ALERTS_PATH = path.join(DATA_DIR, "sent-alerts.json");

export interface MonitorConfig {
  // Origins to monitor (e.g., ["DEN", "LAS"])
  origins: string[];

  // Destinations to monitor (empty = all Frontier destinations)
  destinations: string[];

  // Maximum price (taxes+fees) to alert on
  maxPrice: number;

  // How often to scan (minutes)
  intervalMinutes: number;

  // Notification settings
  notifications: {
    discord?: {
      webhookUrl: string;
    };
    email?: {
      to: string;
      // Uses system mail command or external service
    };
    console: boolean;
  };

  // Days to look ahead (1 = tomorrow only, 2 = tomorrow + day after)
  daysAhead: number;

  // Only alert for GoWild-eligible flights
  goWildOnly: boolean;
}

interface SentAlert {
  key: string; // origin-dest-date-flightTime
  sentAt: number;
}

// All Frontier destinations
const ALL_DESTINATIONS = [
  "ANU", "NAS", "BZE", "LIR", "SJO", "PUJ", "SDQ", "SAL", "GUA", "KIN",
  "MBJ", "SJD", "GDL", "PVR", "MTY", "CUN", "CZM", "SXM", "PHX", "XNA",
  "LIT", "OAK", "ONT", "SNA", "SMF", "SAN", "SFO", "LAX", "DEN", "BDL",
  "FLL", "RSW", "JAX", "MIA", "MCO", "PNS", "SRQ", "TPA", "PBI", "ATL",
  "SAV", "BMI", "MDW", "ORD", "IND", "CID", "DSM", "CVG", "MSY", "PWM",
  "BWI", "BOS", "DTW", "GRR", "MSP", "MCI", "STL", "MSO", "OMA", "LAS",
  "TTN", "BUF", "ISP", "SWF", "LGA", "EWR", "SYR", "CLT", "RDU", "FAR",
  "CLE", "CMH", "OKC", "PDX", "MDT", "PHL", "PIT", "BQN", "PSE", "SJU",
  "CHS", "MYR", "TYS", "MEM", "BNA", "AUS", "DFW", "ELP", "IAH", "SAT",
  "STT", "SLC", "DCA", "ORF", "SEA", "GRB", "MSN", "MKE"
];

// Popular destinations (faster scanning)
const POPULAR_DESTINATIONS = [
  "LAS", "DEN", "PHX", "MCO", "MIA", "FLL", "ATL", "DFW", "LAX", "SFO",
  "SEA", "BOS", "LGA", "CUN", "SJU", "PUJ", "ORD", "MDW", "MSP", "SLC"
];

function getDefaultConfig(): MonitorConfig {
  return {
    origins: ["DEN"],
    destinations: POPULAR_DESTINATIONS,
    maxPrice: 50, // Alert for flights under $50 in taxes/fees
    intervalMinutes: 60,
    notifications: {
      console: true,
    },
    daysAhead: 2,
    goWildOnly: true,
  };
}

export function loadConfig(): MonitorConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = getDefaultConfig();
    saveConfig(defaultConfig);
    return defaultConfig;
  }

  try {
    const data = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(data) as MonitorConfig;
  } catch {
    return getDefaultConfig();
  }
}

export function saveConfig(config: MonitorConfig): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadSentAlerts(): Map<string, number> {
  if (!fs.existsSync(ALERTS_PATH)) {
    return new Map();
  }

  try {
    const data = fs.readFileSync(ALERTS_PATH, "utf-8");
    const alerts = JSON.parse(data) as SentAlert[];
    const map = new Map<string, number>();

    // Only keep alerts from last 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const alert of alerts) {
      if (alert.sentAt > cutoff) {
        map.set(alert.key, alert.sentAt);
      }
    }

    return map;
  } catch {
    return new Map();
  }
}

function saveSentAlerts(alerts: Map<string, number>): void {
  const data: SentAlert[] = Array.from(alerts.entries()).map(([key, sentAt]) => ({
    key,
    sentAt,
  }));
  fs.writeFileSync(ALERTS_PATH, JSON.stringify(data, null, 2));
}

function getAlertKey(flight: FlightResult): string {
  return `${flight.origin}-${flight.destination}-${flight.date}-${flight.departTime}`;
}

async function sendDiscordNotification(
  webhookUrl: string,
  flights: FlightResult[]
): Promise<void> {
  const embed = {
    title: "GoWild Flights Found!",
    color: 0x00ff00,
    fields: flights.slice(0, 10).map((f) => ({
      name: `${f.origin} -> ${f.destination}`,
      value: [
        `Date: ${f.date}`,
        `Depart: ${f.departTime}`,
        `Stops: ${f.stops}`,
        `Price: $${f.taxesAndFees?.toFixed(2) || "N/A"}`,
        f.isGoWild ? "GoWild Eligible" : "",
      ].filter(Boolean).join("\n"),
      inline: true,
    })),
    footer: {
      text: `Found ${flights.length} flight(s) | ${new Date().toLocaleString()}`,
    },
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    console.log("[Monitor] Discord notification sent");
  } catch (error) {
    console.error("[Monitor] Discord notification failed:", error);
  }
}

function formatFlightForConsole(flight: FlightResult): string {
  const price = flight.taxesAndFees?.toFixed(2) || "N/A";
  const goWild = flight.isGoWild ? " [GoWild]" : "";
  return `  ${flight.origin} -> ${flight.destination} | ${flight.date} ${flight.departTime} | ${flight.stops} stops | $${price}${goWild}`;
}

function getDateString(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

export async function runMonitorScan(config: MonitorConfig): Promise<FlightResult[]> {
  if (!hasCookies()) {
    console.error("[Monitor] Not logged in. Please run the web app and login first.");
    return [];
  }

  const sentAlerts = loadSentAlerts();
  const allFlights: FlightResult[] = [];
  const newFlights: FlightResult[] = [];

  console.log(`\n[Monitor] Starting scan at ${new Date().toLocaleString()}`);
  console.log(`[Monitor] Origins: ${config.origins.join(", ")}`);
  console.log(`[Monitor] Checking ${config.destinations.length} destinations`);
  console.log(`[Monitor] Max price: $${config.maxPrice}`);

  // Generate routes to scan
  const routes: Array<{ origin: string; destination: string; date: string }> = [];

  for (const origin of config.origins) {
    for (let day = 1; day <= config.daysAhead; day++) {
      const date = getDateString(day);
      for (const dest of config.destinations) {
        if (dest !== origin) {
          routes.push({ origin, destination: dest, date });
        }
      }
    }
  }

  console.log(`[Monitor] Total routes to scan: ${routes.length}`);

  // Scan routes (with some parallelism)
  const batchSize = 3;
  for (let i = 0; i < routes.length; i += batchSize) {
    const batch = routes.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((r) => scanRoute(r.origin, r.destination, r.date))
    );

    for (const result of results) {
      if (result.error) {
        console.log(`[Monitor] Error: ${result.origin}->${result.destination}: ${result.error}`);
        continue;
      }

      for (const flight of result.flights) {
        // Filter by criteria
        if (config.goWildOnly && !flight.isGoWild) continue;
        if (flight.taxesAndFees && flight.taxesAndFees > config.maxPrice) continue;

        allFlights.push(flight);

        // Check if we already alerted for this flight
        const alertKey = getAlertKey(flight);
        if (!sentAlerts.has(alertKey)) {
          newFlights.push(flight);
          sentAlerts.set(alertKey, Date.now());
        }
      }
    }

    // Progress update
    const progress = Math.min(i + batchSize, routes.length);
    process.stdout.write(`\r[Monitor] Progress: ${progress}/${routes.length} routes scanned`);
  }

  console.log(); // New line after progress

  // Save updated alerts
  saveSentAlerts(sentAlerts);

  // Send notifications for new flights
  if (newFlights.length > 0) {
    console.log(`\n[Monitor] Found ${newFlights.length} NEW flights meeting criteria:`);

    if (config.notifications.console) {
      for (const flight of newFlights) {
        console.log(formatFlightForConsole(flight));
      }
    }

    if (config.notifications.discord?.webhookUrl) {
      await sendDiscordNotification(config.notifications.discord.webhookUrl, newFlights);
    }
  } else {
    console.log(`[Monitor] No new flights found meeting criteria (found ${allFlights.length} total matching flights)`);
  }

  return newFlights;
}

export async function startMonitor(config?: MonitorConfig): Promise<void> {
  const cfg = config || loadConfig();

  console.log("========================================");
  console.log("  GoWild Flight Monitor Started");
  console.log("========================================");
  console.log(`Interval: ${cfg.intervalMinutes} minutes`);
  console.log(`Origins: ${cfg.origins.join(", ")}`);
  console.log(`Max Price: $${cfg.maxPrice}`);
  console.log(`Days Ahead: ${cfg.daysAhead}`);
  console.log("========================================\n");

  // Run immediately
  await runMonitorScan(cfg);

  // Then run on interval
  setInterval(async () => {
    await runMonitorScan(cfg);
  }, cfg.intervalMinutes * 60 * 1000);
}

export const monitor = {
  loadConfig,
  saveConfig,
  runMonitorScan,
  startMonitor,
  ALL_DESTINATIONS,
  POPULAR_DESTINATIONS,
};

export default monitor;
