import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { listProfiles, deleteProfile, renameProfile, PROFILES_DIR } from './profileManager';

export class ProfileDashboard {
  static currentPanel: ProfileDashboard | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly ctx: vscode.ExtensionContext;
  private readonly onSwitch: (name: string) => Promise<void>;

  static open(
    ctx: vscode.ExtensionContext,
    onSwitch: (name: string) => Promise<void>
  ) {
    if (ProfileDashboard.currentPanel) {
      ProfileDashboard.currentPanel.panel.reveal();
      ProfileDashboard.currentPanel.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'switaxDashboard',
      'Switax — Profile Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    ProfileDashboard.currentPanel = new ProfileDashboard(panel, ctx, onSwitch);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    ctx: vscode.ExtensionContext,
    onSwitch: (name: string) => Promise<void>
  ) {
    this.panel = panel;
    this.ctx = ctx;
    this.onSwitch = onSwitch;

    this.refresh();

    panel.onDidDispose(() => {
      ProfileDashboard.currentPanel = undefined;
    });

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'switch':
          await this.onSwitch(msg.name);
          this.refresh();
          break;

        case 'delete': {
          const confirm = await vscode.window.showWarningMessage(
            `Delete profile "${msg.name}"? This cannot be undone.`,
            { modal: true },
            'Delete'
          );
          if (confirm !== 'Delete') return;
          try {
            deleteProfile(msg.name);
            const active = this.ctx.globalState.get<string>('activeProfile');
            if (active === msg.name) {
              this.ctx.globalState.update('activeProfile', undefined);
            }
            this.refresh();
          } catch (e: any) {
            vscode.window.showErrorMessage(e.message);
          }
          break;
        }

        case 'rename': {
          const newName = await vscode.window.showInputBox({
            prompt: `Rename profile "${msg.name}" to`,
            value: msg.name,
            validateInput: v => (v && v.trim() ? null : 'Name cannot be empty'),
          });
          if (!newName || newName.trim() === msg.name) return;
          try {
            renameProfile(msg.name, newName.trim());
            const active = this.ctx.globalState.get<string>('activeProfile');
            if (active === msg.name) {
              this.ctx.globalState.update('activeProfile', newName.trim());
            }
            this.refresh();
          } catch (e: any) {
            vscode.window.showErrorMessage(e.message);
          }
          break;
        }

        case 'add':
          await vscode.commands.executeCommand('kiro-switcher.addProfile');
          this.refresh();
          break;
      }
    });
  }

  refresh() {
    const profiles = listProfiles();
    const active = this.ctx.globalState.get<string>('activeProfile');
    const profileData = profiles.map(name => {
      const profilePath = path.join(PROFILES_DIR, name);
      let savedAt = '';
      try {
        const stat = fs.statSync(profilePath);
        savedAt = stat.mtime.toLocaleString();
      } catch {}
      return { name, active: name === active, savedAt };
    });
    this.panel.webview.html = getHtml(profileData, active);
  }
}

interface ProfileEntry {
  name: string;
  active: boolean;
  savedAt: string;
}

function getHtml(profiles: ProfileEntry[], active: string | undefined): string {
  const rows = profiles.length === 0
    ? `<tr><td colspan="4" class="empty">No profiles saved yet. Click "Save Current Account" to get started.</td></tr>`
    : profiles.map(p => `
        <tr class="${p.active ? 'active-row' : ''}">
          <td>
            <span class="profile-name">${esc(p.name)}</span>
            ${p.active ? '<span class="badge">active</span>' : ''}
          </td>
          <td class="muted">${esc(p.savedAt)}</td>
          <td>
            <span class="auth-path">${esc(p.name)}</span>
          </td>
          <td class="actions">
            ${!p.active ? `<button class="btn btn-primary" onclick="send('switch','${esc(p.name)}')">Switch</button>` : ''}
            <button class="btn btn-secondary" onclick="send('rename','${esc(p.name)}')">Rename</button>
            <button class="btn btn-danger" onclick="send('delete','${esc(p.name)}')">Delete</button>
          </td>
        </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Switax Dashboard</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; }
  h1 { font-size: 1.4rem; margin-bottom: 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.85rem; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: middle; }
  .active-row td { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .profile-name { font-weight: 600; }
  .badge { display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 10px; font-size: 0.72rem; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .muted { color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
  .auth-path { font-family: var(--vscode-editor-font-family); font-size: 0.8rem; color: var(--vscode-descriptionForeground); }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .btn { padding: 4px 12px; border: none; border-radius: 3px; cursor: pointer; font-size: 0.82rem; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-danger { background: transparent; color: var(--vscode-errorForeground); border: 1px solid var(--vscode-errorForeground); }
  .btn-danger:hover { background: var(--vscode-inputValidation-errorBackground); }
  .empty { color: var(--vscode-descriptionForeground); padding: 32px; text-align: center; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .btn-add { padding: 6px 16px; font-size: 0.9rem; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; }
  .btn-add:hover { background: var(--vscode-button-hoverBackground); }
  .active-label { font-size: 0.85rem; color: var(--vscode-descriptionForeground); }
  .active-label strong { color: var(--vscode-foreground); }
</style>
</head>
<body>
<h1>Switax — Kiro Profile Dashboard</h1>
<p class="subtitle">Manage your saved Kiro accounts. Profiles are stored in <code>~/.kiro-profiles/</code></p>

<div class="toolbar">
  <span class="active-label">
    Active profile: <strong>${active ? esc(active) : 'none'}</strong>
  </span>
  <button class="btn-add" onclick="send('add','')">+ Save Current Account</button>
</div>

<table>
  <thead>
    <tr>
      <th>Profile</th>
      <th>Last saved</th>
      <th>Folder name</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<script>
  const vscode = acquireVsCodeApi();
  function send(command, name) {
    vscode.postMessage({ command, name });
  }
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
