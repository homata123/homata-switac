import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
