import * as vscode from 'vscode';
import {
  listProfiles,
  saveProfile,
  loadProfile,
  deleteProfile,
  getExistingAuthPaths,
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

  const name = await vscode.window.showInputBox({
    prompt: 'Profile name',
    placeHolder: 'e.g. work, personal, client-a',
    validateInput: v => (v && v.trim() ? null : 'Name cannot be empty'),
  });
  if (!name) return;

  try {
    saveProfile(name.trim());
    ctx.globalState.update(STATE_KEY, name.trim());
    updateStatusBar(ctx);
    vscode.window.showInformationMessage(`Profile "${name.trim()}" saved.`);
    // Refresh dashboard if open
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
