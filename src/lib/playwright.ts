import { chromium, Browser, BrowserContext, Page } from "playwright";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const COOKIES_PATH = path.join(DATA_DIR, "cookies.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Updated URLs - Frontier changed their site structure
const FRONTIER_LOGIN_URL = "https://www.flyfrontier.com/";
const FRONTIER_ACCOUNT_URL = "https://booking.flyfrontier.com/FrontierMiles/Profile";

// Store browser instance for login flow
let loginBrowser: Browser | null = null;
let loginPage: Page | null = null;

export interface StoredCookies {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  savedAt: number;
}

/**
 * Check if cookies file exists and has non-expired cookies
 */
export function hasCookies(): boolean {
  if (!fs.existsSync(COOKIES_PATH)) {
    return false;
  }
  
  // Also check if cookies are expired
  try {
    const data = fs.readFileSync(COOKIES_PATH, "utf-8");
    const parsed = JSON.parse(data) as StoredCookies;
    
    // Check if we have any cookies
    if (!parsed.cookies || parsed.cookies.length === 0) {
      return false;
    }
    
    // Check if session is older than 7 days (Frontier sessions typically expire)
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    if (parsed.savedAt && (Date.now() - parsed.savedAt) > maxAge) {
      console.log("[Playwright] Session is older than 7 days, may be expired");
      // Still return true but log warning - actual validation will happen on use
    }
    
    // Check if essential cookies exist
    const hasSessionCookie = parsed.cookies.some(
      (c) => c.domain.includes("flyfrontier.com") && (c.name.includes("session") || c.name.includes("auth") || c.name.includes("token"))
    );
    
    if (!hasSessionCookie) {
      // Still might work with other cookies, just log it
      console.log("[Playwright] Warning: No obvious session cookie found");
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Get saved cookies
 */
export function getSavedCookies(): StoredCookies | null {
  if (!hasCookies()) {
    return null;
  }
  try {
    const data = fs.readFileSync(COOKIES_PATH, "utf-8");
    return JSON.parse(data) as StoredCookies;
  } catch {
    return null;
  }
}

/**
 * Save cookies to file
 */
async function saveCookies(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies();
  const data: StoredCookies = {
    cookies: cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    })),
    savedAt: Date.now(),
  };
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(data, null, 2));
}

/**
 * Delete saved cookies
 */
export function deleteCookies(): void {
  if (fs.existsSync(COOKIES_PATH)) {
    fs.unlinkSync(COOKIES_PATH);
  }
}

/**
 * Start the login flow - opens a headed browser for manual login
 * Returns when the browser is ready for user interaction
 */
export async function startLoginFlow(): Promise<{ status: string }> {
  // Close any existing login browser
  if (loginBrowser) {
    await loginBrowser.close();
    loginBrowser = null;
    loginPage = null;
  }

  // Launch headed browser for manual login
  loginBrowser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await loginBrowser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  loginPage = await context.newPage();

  // Navigate to Frontier login page
  await loginPage.goto(FRONTIER_LOGIN_URL, { waitUntil: "networkidle" });

  return { status: "waiting_for_login" };
}

/**
 * Check if login is complete and save cookies
 */
export async function checkLoginStatus(): Promise<{
  status: "waiting" | "logged_in" | "error" | "no_browser";
  message: string;
}> {
  if (!loginBrowser || !loginPage) {
    return { status: "no_browser", message: "No login session in progress" };
  }

  try {
    const url = loginPage.url();

    // Check if we're on the account page or have been redirected from login
    // Updated patterns for new Frontier site structure
    const isLoggedIn =
      url.includes("/FrontierMiles/Profile") ||
      url.includes("/myfrontier/my-account") ||
      url.includes("/myfrontier/dashboard") ||
      url.includes("booking.flyfrontier.com") ||
      (url.includes("flyfrontier.com") && !url.includes("/login") && !url.includes("flyfrontier.com/"));

    // Also check for logged-in indicators on the page
    if (isLoggedIn) {
      // Save cookies
      const context = loginPage.context();
      await saveCookies(context);

      // Close the browser
      await loginBrowser.close();
      loginBrowser = null;
      loginPage = null;

      return { status: "logged_in", message: "Login successful! Cookies saved." };
    }

    return { status: "waiting", message: "Please log in to Frontier in the browser window" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Cancel the login flow
 */
export async function cancelLoginFlow(): Promise<void> {
  if (loginBrowser) {
    await loginBrowser.close();
    loginBrowser = null;
    loginPage = null;
  }
}

/**
 * Get an authenticated browser context using saved cookies
 * Throws if no cookies or session expired
 */
export async function getAuthenticatedContext(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const savedCookies = getSavedCookies();

  if (!savedCookies) {
    throw new Error("No saved cookies. Please log in first.");
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  // Add saved cookies
  await context.addCookies(savedCookies.cookies);

  const page = await context.newPage();

  return { browser, context, page };
}

/**
 * Check if session is valid by trying to access account page
 */
export async function validateSession(): Promise<{
  valid: boolean;
  message: string;
}> {
  let browser: Browser | null = null;

  try {
    const auth = await getAuthenticatedContext();
    browser = auth.browser;
    const page = auth.page;

    // Try to access account page
    await page.goto(FRONTIER_ACCOUNT_URL, { waitUntil: "networkidle", timeout: 30000 });

    const url = page.url();

    // If redirected to login, session is invalid
    if (url.includes("/login")) {
      deleteCookies();
      return { valid: false, message: "Session expired. Please log in again." };
    }

    return { valid: true, message: "Session is valid" };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export const playwright = {
  hasCookies,
  getSavedCookies,
  deleteCookies,
  startLoginFlow,
  checkLoginStatus,
  cancelLoginFlow,
  getAuthenticatedContext,
  validateSession,
};

export default playwright;
