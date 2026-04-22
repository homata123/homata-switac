import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import { PROFILES_DIR } from './profileManager';

const USAGE_API = 'https://q.us-east-1.amazonaws.com/getUsageLimits';
const RESOURCE_TYPES = ['AGENTIC_REQUEST', 'CREDIT', 'CHAT_REQUEST'];

export interface UsageBreakdown {
  resourceType: string;
  displayName: string;
  currentUsage: number;
  usageLimit: number;
  freeTrialInfo?: {
    currentUsage: number;
    usageLimit: number;
    freeTrialStatus: string;
    freeTrialExpiry: number;
  };
  nextDateReset: number;
}

export interface UsageResult {
  profileArn: string;
  subscriptionTitle: string;
  usageBreakdownList: UsageBreakdown[];
  nextDateReset: number;
  error?: string;
}

interface KiroAuthToken {
  accessToken: string;
  refreshToken?: string;
  profileArn: string | null;
  expiresAt: string;
  authMethod: string;
  provider: string;
}

// ── Live token path — platform-aware, tries all known locations ──────────────

function getLiveTokenPaths(): string[] {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === 'win32') {
    return [
      path.join(home, '.aws', 'sso', 'cache', 'kiro-auth-token.json'),
      path.join(home, 'AppData', 'Roaming', 'kiro', 'kiro-auth-token.json'),
    ];
  }
  if (platform === 'darwin') {
    return [
      path.join(home, '.kiro', 'kiro-auth-token.json'),
      path.join(home, 'Library', 'Application Support', 'kiro', 'kiro-auth-token.json'),
      path.join(home, '.aws', 'sso', 'cache', 'kiro-auth-token.json'),
    ];
  }
  // linux + fallback
  return [
    path.join(home, '.kiro', 'kiro-auth-token.json'),
    path.join(home, '.config', 'kiro', 'kiro-auth-token.json'),
    path.join(home, '.local', 'share', 'kiro', 'kiro-auth-token.json'),
    path.join(home, '.aws', 'sso', 'cache', 'kiro-auth-token.json'),
  ];
}

function readLiveToken(): KiroAuthToken | null {
  for (const p of getLiveTokenPaths()) {
    const token = readTokenFile(p);
    if (token?.accessToken) return token;
  }
  return null;
}

function readTokenFile(filePath: string): KiroAuthToken | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as KiroAuthToken;
  } catch { return null; }
}

// ── Read profileArn from snapshot (multiple possible locations) ──────────────

function readSnapshotProfileArn(profileName: string): string | null {
  const profileDir = path.join(PROFILES_DIR, profileName);
  if (!fs.existsSync(profileDir)) return null;
  let entries: string[];
  try { entries = fs.readdirSync(profileDir); } catch { return null; }

  for (const entry of entries) {
    const entryPath = path.join(profileDir, entry);
    try { if (!fs.statSync(entryPath).isDirectory()) continue; } catch { continue; }

    // 1. kiro-auth-token.json at snapshot root — social accounts (all platforms)
    const tokenData = readTokenFile(path.join(entryPath, 'kiro-auth-token.json'));
    if (tokenData?.profileArn) return tokenData.profileArn;

    // 2. profile.json — BuilderId/IdC accounts
    //    Windows: User/globalStorage/kiro.kiroagent/profile.json
    //    Linux/macOS: globalStorage/kiro.kiroagent/profile.json (no User/ prefix)
    const profileJsonCandidates = [
      path.join(entryPath, 'User', 'globalStorage', 'kiro.kiroagent', 'profile.json'),
      path.join(entryPath, 'globalStorage', 'kiro.kiroagent', 'profile.json'),
    ];
    for (const profileJson of profileJsonCandidates) {
      try {
        if (fs.existsSync(profileJson)) {
          const data = JSON.parse(fs.readFileSync(profileJson, 'utf-8'));
          if (data?.arn) return data.arn as string;
        }
      } catch { /* skip */ }
    }
  }
  return null;
}

// ── Read snapshot token for cosmetic info (provider, authMethod) ─────────────

function readSnapshotToken(profileName: string): KiroAuthToken | null {
  const profileDir = path.join(PROFILES_DIR, profileName);
  if (!fs.existsSync(profileDir)) return null;
  let entries: string[];
  try { entries = fs.readdirSync(profileDir); } catch { return null; }

  for (const entry of entries) {
    const entryPath = path.join(profileDir, entry);
    try { if (!fs.statSync(entryPath).isDirectory()) continue; } catch { continue; }
    const data = readTokenFile(path.join(entryPath, 'kiro-auth-token.json'));
    if (data) return data;
  }
  return null;
}

// ── Main export: resolve auth for a profile ───────────────────────────────────
// - profileArn  → from snapshot (token file or profile.json)
// - accessToken → always from the LIVE token file (never expired)
// - provider/authMethod → from snapshot token (cosmetic)

export function readProfileAuth(profileName: string): {
  profileArn: string;
  accessToken: string;
  provider: string;
  authMethod: string;
  expiresAt: string;
} | null {
  const profileArn = readSnapshotProfileArn(profileName);
  if (!profileArn) return null;

  const liveToken = readLiveToken();
  if (!liveToken?.accessToken) return null;

  const snapshotToken = readSnapshotToken(profileName);

  return {
    profileArn,
    accessToken: liveToken.accessToken,
    provider: snapshotToken?.provider ?? liveToken.provider ?? 'Unknown',
    authMethod: snapshotToken?.authMethod ?? liveToken.authMethod ?? 'Unknown',
    expiresAt: liveToken.expiresAt ?? '',
  };
}

// ── Fetch usage from the AWS API ─────────────────────────────────────────────

export async function fetchUsage(profileArn: string, bearerToken: string): Promise<UsageResult> {
  const results: UsageBreakdown[] = [];

  for (const resourceType of RESOURCE_TYPES) {
    try {
      const data = await httpGet(
        `${USAGE_API}?origin=AI_EDITOR&profileArn=${encodeURIComponent(profileArn)}&resourceType=${resourceType}`,
        { 'Authorization': `Bearer ${bearerToken}` }
      );
      const parsed = JSON.parse(data);
      if (parsed.usageBreakdownList?.length) {
        results.push(...parsed.usageBreakdownList.map((b: any) => ({
          resourceType: b.resourceType,
          displayName: b.displayName ?? b.resourceType,
          currentUsage: b.freeTrialInfo?.currentUsage ?? b.currentUsage ?? 0,
          usageLimit: b.freeTrialInfo?.usageLimit ?? b.usageLimitWithPrecision ?? b.usageLimit ?? 0,
          freeTrialInfo: b.freeTrialInfo,
          nextDateReset: b.nextDateReset ?? parsed.nextDateReset,
        })));
        return {
          profileArn,
          subscriptionTitle: parsed.subscriptionInfo?.subscriptionTitle ?? 'Unknown',
          usageBreakdownList: results,
          nextDateReset: parsed.nextDateReset ?? 0,
        };
      }
    } catch { /* try next resourceType */ }
  }

  return {
    profileArn,
    subscriptionTitle: 'Unknown',
    usageBreakdownList: results,
    nextDateReset: 0,
    error: 'No usage data returned',
  };
}

function httpGet(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers },
      (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}
