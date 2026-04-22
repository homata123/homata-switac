import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ProfileMeta {
  email: string;
  provider: string;       // e.g. "Google", "GitHub", "AWS Builder ID"
  authMethod?: string;    // e.g. "social", "iam"
  expiresAt?: string;     // ISO date string of token expiry
  savedAt: string;        // ISO date string
  plan?: string;
  creditsUsed?: number;
  creditsTotal?: number;
  bonusCredits?: number;
  bonusExpiry?: string;
  resetDate?: string;
}

// Kiro auth token locations — covers all platforms
export const KIRO_AUTH_PATHS: Record<string, string[]> = {
  win32: [
    path.join(os.homedir(), 'AppData', 'Roaming', 'kiro'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'kirodotdev.kiro'),
    path.join(os.homedir(), '.aws', 'sso', 'cache'),
  ],
  darwin: [
    path.join(os.homedir(), '.kiro'),
    path.join(os.homedir(), 'Library', 'Application Support', 'kiro'),
    path.join(os.homedir(), '.aws', 'sso', 'cache'),
  ],
  linux: [
    path.join(os.homedir(), '.kiro'),
    path.join(os.homedir(), '.config', 'kiro'),
    path.join(os.homedir(), '.local', 'share', 'kiro'),
    path.join(os.homedir(), '.aws', 'sso', 'cache'),
  ],
};

export const PROFILES_DIR = path.join(os.homedir(), '.kiro-profiles');

export function getAuthPaths(): string[] {
  const platform = process.platform as string;
  return KIRO_AUTH_PATHS[platform] ?? KIRO_AUTH_PATHS['linux'];
}

export function getExistingAuthPaths(): string[] {
  return getAuthPaths().filter(p => fs.existsSync(p));
}

export function listProfiles(): string[] {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs.readdirSync(PROFILES_DIR).filter(f =>
    fs.statSync(path.join(PROFILES_DIR, f)).isDirectory()
  );
}

// Directories that are either locked by the running process or irrelevant to auth
const SKIP_DIRS = new Set([
  'Cache', 'cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache',
  'DawnWebGPUCache', 'ShaderCache', 'logs', 'Logs', 'CrashPad',
  'blob_storage', 'Network', 'Service Worker',
  // Linux-specific Electron runtime artifacts
  'tmp', 'Singleton', 'SingletonLock', 'SingletonCookie',
]);

function copyDirSafe(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch {
    return; // can't read dir, skip
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      copyDirSafe(path.join(src, entry.name), path.join(dest, entry.name));
    } else {
      try {
        fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
      } catch {
        // file locked or unreadable — skip silently
      }
    }
  }
}

export function saveProfile(name: string): void {
  const profilePath = path.join(PROFILES_DIR, name);
  fs.mkdirSync(profilePath, { recursive: true });

  const authPaths = getExistingAuthPaths();
  if (authPaths.length === 0) {
    throw new Error('No Kiro auth files found. Make sure you are logged in to Kiro first.');
  }

  for (const authPath of authPaths) {
    const destKey = Buffer.from(authPath).toString('base64url');
    copyDirSafe(authPath, path.join(profilePath, destKey));
  }
}

export function loadProfile(name: string): void {
  const profilePath = path.join(PROFILES_DIR, name);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile "${name}" not found.`);
  }

  const savedKeys = fs.readdirSync(profilePath);
  for (const key of savedKeys) {
    const originalPath = Buffer.from(key, 'base64url').toString();
    const src = path.join(profilePath, key);
    copyDirSafe(src, originalPath);
  }
}

export function deleteProfile(name: string): void {
  const profilePath = path.join(PROFILES_DIR, name);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile "${name}" not found.`);
  }
  fs.rmSync(profilePath, { recursive: true, force: true });
}

export function renameProfile(oldName: string, newName: string): void {
  const oldPath = path.join(PROFILES_DIR, oldName);
  const newPath = path.join(PROFILES_DIR, newName);
  if (!fs.existsSync(oldPath)) {
    throw new Error(`Profile "${oldName}" not found.`);
  }
  if (fs.existsSync(newPath)) {
    throw new Error(`A profile named "${newName}" already exists.`);
  }
  fs.renameSync(oldPath, newPath);
}

// ── Profile metadata (email, provider, plan, credits) ────────────────────────

const META_FILE = 'meta.json';

export function saveProfileMeta(name: string, meta: ProfileMeta): void {
  const metaPath = path.join(PROFILES_DIR, name, META_FILE);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

export function readProfileMeta(name: string): ProfileMeta | null {
  const metaPath = path.join(PROFILES_DIR, name, META_FILE);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as ProfileMeta;
  } catch {
    return null;
  }
}

/** Returns the profile name that already uses this email, or null if none. */
export function findProfileByEmail(email: string): string | null {
  const normalised = email.trim().toLowerCase();
  for (const name of listProfiles()) {
    const meta = readProfileMeta(name);
    if (meta && meta.email.trim().toLowerCase() === normalised) {
      return name;
    }
  }
  return null;
}

/**
 * Reads the kiro-auth-token.json from inside the snapshot to extract
 * provider, authMethod, expiresAt. Searches one level deep in each snapshot
 * subfolder, covering all platform layouts.
 */
export function readSnapshotTokenMeta(name: string): Partial<ProfileMeta> | null {
  const profileDir = path.join(PROFILES_DIR, name);
  if (!fs.existsSync(profileDir)) return null;

  let entries: string[];
  try { entries = fs.readdirSync(profileDir); } catch { return null; }

  for (const entry of entries) {
    const entryPath = path.join(profileDir, entry);
    try { if (!fs.statSync(entryPath).isDirectory()) continue; } catch { continue; }

    // Check at snapshot root (Windows: AppData/Roaming/kiro/, Linux: ~/.kiro/)
    const candidates = [
      path.join(entryPath, 'kiro-auth-token.json'),
      // Linux: ~/.aws/sso/cache/kiro-auth-token.json lands one level up
      path.join(entryPath, '..', 'kiro-auth-token.json'),
    ];

    for (const tokenPath of candidates) {
      const resolved = path.resolve(tokenPath);
      if (!fs.existsSync(resolved)) continue;
      try {
        const token = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
        if (token.provider || token.authMethod) {
          return {
            provider: token.provider ?? undefined,
            authMethod: token.authMethod ?? undefined,
            expiresAt: token.expiresAt ?? undefined,
          };
        }
      } catch { continue; }
    }
  }
  return null;
}

/**
 * Reads the meta.json that was previously saved inside the snapshot folder.
 * This is different from readProfileMeta which reads from the profile root.
 * Used to restore plan/credit info when re-saving an existing profile.
 */
export function readSnapshotMeta(name: string): Partial<ProfileMeta> | null {
  const profileDir = path.join(PROFILES_DIR, name);
  if (!fs.existsSync(profileDir)) return null;

  // meta.json lives at the profile root (written by saveProfileMeta)
  // but we also check inside each snapshot subfolder for a legacy copy
  const rootMeta = path.join(profileDir, META_FILE);
  if (fs.existsSync(rootMeta)) {
    try { return JSON.parse(fs.readFileSync(rootMeta, 'utf-8')) as ProfileMeta; } catch {}
  }
  return null;
}
