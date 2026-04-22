import * as vscode from 'vscode';
import {
  listProfiles,
  saveProfile,
  loadProfile,
  deleteProfile,
  getExistingAuthPaths,
  saveProfileMeta,
  findProfileByEmail,
  readSnapshotTokenMeta,
  readSnapshotMeta,
} from './profileManager';
import { ProfileDashboard } from './dashboard';

const STATE_KEY = 'activeProfile';

let statusBar: vscode.StatusBarItem;

export function activate(ctx: vscode.ExtensionContext) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'kiro-switcher.openDashboard';
  statusBar.tooltip = 'Click to open Switax Profile Dashboard';
  updateStatusBar(ctx);
  statusBar.show();
  ctx.subscriptions.push(statusBar);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('kiro-switcher.addProfile', () => cmdAddProfile(ctx)),
    vscode.commands.registerCommand('kiro-switcher.switch', () => cmdSwitch(ctx)),
    vscode.commands.registerCommand('kiro-switcher.deleteProfile', () => cmdDelete(ctx)),
    vscode.commands.registerCommand('kiro-switcher.openDashboard', () =>
      ProfileDashboard.open(ctx, (name) => switchToProfile(ctx, name))
    ),
  );
}

// ── Switch helper (shared by command + dashboard) ────────────────────────────

async function switchToProfile(ctx: vscode.ExtensionContext, name: string): Promise<void> {
  try {
    loadProfile(name);
    ctx.globalState.update(STATE_KEY, name);
    updateStatusBar(ctx);

    const action = await vscode.window.showInformationMessage(
      `Switched to "${name}". Reload window to apply the new account.`,
      'Reload Now'
    );
    if (action === 'Reload Now') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } catch (e: any) {
    vscode.window.showErrorMessage(e.message);
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdAddProfile(ctx: vscode.ExtensionContext) {
  const authPaths = getExistingAuthPaths();
  if (authPaths.length === 0) {
    vscode.window.showErrorMessage(
      'No Kiro auth files detected. Log in to Kiro first, then save a profile.'
    );
    return;
  }

  // Collect email for duplicate detection
  const email = await vscode.window.showInputBox({
    prompt: 'Enter the email address of the currently logged-in Kiro account',
    placeHolder: 'e.g. you@example.com',
    validateInput: v => {
      if (!v || !v.trim()) return 'Email cannot be empty';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return 'Enter a valid email address';
      return null;
    },
  });
  if (!email) return;

  // Duplicate check
  const existing = findProfileByEmail(email.trim());
  if (existing) {
    const action = await vscode.window.showWarningMessage(
      `An account with email "${email.trim()}" is already saved as profile "${existing}".`,
      'Update Existing', 'Cancel'
    );
    if (action !== 'Update Existing') return;
    // Overwrite the existing profile's snapshot
    try {
      saveProfile(existing);
      const tokenMeta = readSnapshotTokenMeta(existing);
      const prevMeta = readSnapshotMeta(existing);
      saveProfileMeta(existing, {
        email: email.trim(),
        provider: tokenMeta?.provider ?? prevMeta?.provider ?? 'Unknown',
        authMethod: tokenMeta?.authMethod ?? prevMeta?.authMethod,
        expiresAt: tokenMeta?.expiresAt ?? prevMeta?.expiresAt,
        savedAt: new Date().toISOString(),
        plan: prevMeta?.plan,
        creditsUsed: prevMeta?.creditsUsed,
        creditsTotal: prevMeta?.creditsTotal,
        bonusCredits: prevMeta?.bonusCredits,
        bonusExpiry: prevMeta?.bonusExpiry,
        resetDate: prevMeta?.resetDate,
      });
      ctx.globalState.update('activeProfile', existing);
      updateStatusBar(ctx);
      vscode.window.showInformationMessage(`Profile "${existing}" updated.`);
      ProfileDashboard.currentPanel?.refresh();
    } catch (e: any) {
      vscode.window.showErrorMessage(e.message);
    }
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Profile name',
    placeHolder: 'e.g. work, personal, client-a',
    value: email.trim().split('@')[0],
    validateInput: v => {
      if (!v || !v.trim()) return 'Name cannot be empty';
      if (listProfiles().includes(v.trim())) return `Profile "${v.trim()}" already exists`;
      return null;
    },
  });
  if (!name) return;

  try {
    saveProfile(name.trim());
    // Pull provider/authMethod/expiresAt from the token snapshot
    const tokenMeta = readSnapshotTokenMeta(name.trim());
    // Pull plan/credits from any previously saved meta (re-save scenario)
    const prevMeta = readSnapshotMeta(name.trim());
    saveProfileMeta(name.trim(), {
      email: email.trim(),
      provider: tokenMeta?.provider ?? prevMeta?.provider ?? 'Unknown',
      authMethod: tokenMeta?.authMethod ?? prevMeta?.authMethod,
      expiresAt: tokenMeta?.expiresAt ?? prevMeta?.expiresAt,
      savedAt: new Date().toISOString(),
      plan: prevMeta?.plan,
      creditsUsed: prevMeta?.creditsUsed,
      creditsTotal: prevMeta?.creditsTotal,
      bonusCredits: prevMeta?.bonusCredits,
      bonusExpiry: prevMeta?.bonusExpiry,
      resetDate: prevMeta?.resetDate,
    });
    ctx.globalState.update('activeProfile', name.trim());
    updateStatusBar(ctx);
    vscode.window.showInformationMessage(`Profile "${name.trim()}" saved.`);
    ProfileDashboard.currentPanel?.refresh();
  } catch (e: any) {
    vscode.window.showErrorMessage(e.message);
  }
}

async function cmdSwitch(ctx: vscode.ExtensionContext) {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    const action = await vscode.window.showWarningMessage(
      'No profiles saved yet. Save your current account first.',
      'Save Current Account'
    );
    if (action) vscode.commands.executeCommand('kiro-switcher.addProfile');
    return;
  }

  const active = ctx.globalState.get<string>(STATE_KEY);
  const items: vscode.QuickPickItem[] = profiles.map(p => ({
    label: p,
    description: p === active ? '$(check) active' : '',
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select Kiro account to switch to',
  });
  if (!selected) return;

  await switchToProfile(ctx, selected.label);
  ProfileDashboard.currentPanel?.refresh();
}

async function cmdDelete(ctx: vscode.ExtensionContext) {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    vscode.window.showInformationMessage('No profiles to delete.');
    return;
  }

  const selected = await vscode.window.showQuickPick(profiles, {
    placeHolder: 'Select profile to delete',
  });
  if (!selected) return;

  const confirm = await vscode.window.showWarningMessage(
    `Delete profile "${selected}"? This cannot be undone.`,
    { modal: true },
    'Delete'
  );
  if (confirm !== 'Delete') return;

  try {
    deleteProfile(selected);
    if (ctx.globalState.get<string>(STATE_KEY) === selected) {
      ctx.globalState.update(STATE_KEY, undefined);
      updateStatusBar(ctx);
    }
    vscode.window.showInformationMessage(`Profile "${selected}" deleted.`);
    ProfileDashboard.currentPanel?.refresh();
  } catch (e: any) {
    vscode.window.showErrorMessage(e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function updateStatusBar(ctx: vscode.ExtensionContext) {
  const active = ctx.globalState.get<string>(STATE_KEY);
  statusBar.text = active ? `$(account) Kiro: ${active}` : '$(account) Kiro: no profile';
}

export function deactivate() {}
