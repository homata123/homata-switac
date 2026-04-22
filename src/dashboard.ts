import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  listProfiles,
  deleteProfile,
  renameProfile,
  PROFILES_DIR,
  readProfileMeta,
  ProfileMeta,
  saveProfileMeta,
} from './profileManager';
import { readProfileAuth, fetchUsage } from './usageFetcher';

// Kiro main site — has a working Sign In button, avoids the OAuth param error
const KIRO_LOGIN_URL = 'https://kiro.dev';

export class ProfileDashboard {
  static currentPanel: ProfileDashboard | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly ctx: vscode.ExtensionContext;
  private readonly onSwitch: (name: string) => Promise<void>;

  static open(ctx: vscode.ExtensionContext, onSwitch: (name: string) => Promise<void>) {
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

    panel.onDidDispose(() => { ProfileDashboard.currentPanel = undefined; });

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'switch':
          await this.onSwitch(msg.name);
          this.refresh();
          break;

        case 'delete': {
          const confirm = await vscode.window.showWarningMessage(
            `Delete profile "${msg.name}"? This cannot be undone.`,
            { modal: true }, 'Delete'
          );
          if (confirm !== 'Delete') return;
          try {
            deleteProfile(msg.name);
            if (this.ctx.globalState.get<string>('activeProfile') === msg.name) {
              this.ctx.globalState.update('activeProfile', undefined);
            }
            this.refresh();
          } catch (e: any) { vscode.window.showErrorMessage(e.message); }
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
            if (this.ctx.globalState.get<string>('activeProfile') === msg.name) {
              this.ctx.globalState.update('activeProfile', newName.trim());
            }
            this.refresh();
          } catch (e: any) { vscode.window.showErrorMessage(e.message); }
          break;
        }

        case 'add':
          await vscode.commands.executeCommand('kiro-switcher.addProfile');
          this.refresh();
          break;

        case 'refreshDashboard':
          this.refresh();
          break;

        case 'refreshUsage': {
          const auth = readProfileAuth(msg.name);
          if (!auth) {
            vscode.window.showWarningMessage(`No auth token found in snapshot for "${msg.name}". Re-save the profile while logged in.`);
            return;
          }
          this.panel.webview.postMessage({ command: 'usageLoading', name: msg.name });
          try {
            const usage = await fetchUsage(auth.profileArn, auth.accessToken);
            if (usage.error) {
              this.panel.webview.postMessage({ command: 'usageError', name: msg.name, error: usage.error });
              return;
            }
            const meta = readProfileMeta(msg.name) ?? { email: '', provider: 'Unknown', savedAt: new Date().toISOString() };
            const breakdown = usage.usageBreakdownList[0];
            saveProfileMeta(msg.name, {
              ...meta,
              provider: auth.provider !== 'Unknown' ? auth.provider : meta.provider,
              authMethod: auth.authMethod,
              expiresAt: auth.expiresAt,
              plan: usage.subscriptionTitle,
              creditsUsed: breakdown?.currentUsage ?? meta.creditsUsed,
              creditsTotal: breakdown?.usageLimit ?? meta.creditsTotal,
              resetDate: breakdown?.nextDateReset
                ? new Date(breakdown.nextDateReset * 1000).toLocaleDateString()
                : meta.resetDate,
              bonusCredits: breakdown?.freeTrialInfo?.currentUsage ?? meta.bonusCredits,
              bonusExpiry: breakdown?.freeTrialInfo?.freeTrialExpiry
                ? new Date(breakdown.freeTrialInfo.freeTrialExpiry * 1000).toLocaleDateString()
                : meta.bonusExpiry,
            });
            this.panel.webview.postMessage({ command: 'usageResult', name: msg.name, usage });
          } catch (e: any) {
            this.panel.webview.postMessage({ command: 'usageError', name: msg.name, error: e.message });
          }
          break;
        }

        case 'openLogin':
          vscode.env.openExternal(vscode.Uri.parse(KIRO_LOGIN_URL));
          vscode.window.showInformationMessage(
            'Kiro.dev opened in your browser. Sign in with the new account there, then come back and click "Save Current Account".'
          );
          break;

        case 'editMeta': {
          // Let user update credits/plan info for a profile
          const meta = readProfileMeta(msg.name) ?? { email: '', provider: 'Unknown', savedAt: new Date().toISOString() };

          const creditsUsedStr = await vscode.window.showInputBox({
            prompt: `Credits used for "${msg.name}"`,
            value: String(meta.creditsUsed ?? 0),
            validateInput: v => isNaN(Number(v)) ? 'Enter a number' : null,
          });
          if (creditsUsedStr === undefined) return;

          const creditsTotalStr = await vscode.window.showInputBox({
            prompt: `Total credits in plan for "${msg.name}"`,
            value: String(meta.creditsTotal ?? 50),
            validateInput: v => isNaN(Number(v)) ? 'Enter a number' : null,
          });
          if (creditsTotalStr === undefined) return;

          const planOptions = ['Kiro Free', 'Kiro Pro', 'Kiro Enterprise'];
          const plan = await vscode.window.showQuickPick(planOptions, {
            placeHolder: 'Select plan',
          });
          if (!plan) return;

          const resetDate = await vscode.window.showInputBox({
            prompt: 'Usage reset date (e.g. 05/01)',
            value: meta.resetDate ?? '',
            placeHolder: 'MM/DD or leave blank',
          });

          const bonusStr = await vscode.window.showInputBox({
            prompt: 'Bonus credits (leave blank if none)',
            value: meta.bonusCredits !== undefined ? String(meta.bonusCredits) : '',
            placeHolder: 'e.g. 500 or leave blank',
          });

          const bonusExpiry = bonusStr?.trim()
            ? await vscode.window.showInputBox({
                prompt: 'Bonus credits expiry (e.g. "30 days")',
                value: meta.bonusExpiry ?? '',
              })
            : undefined;

          saveProfileMeta(msg.name, {
            ...meta,
            creditsUsed: Number(creditsUsedStr),
            creditsTotal: Number(creditsTotalStr),
            plan: plan as string,
            resetDate: resetDate ?? '',
            bonusCredits: bonusStr?.trim() ? Number(bonusStr) : undefined,
            bonusExpiry: bonusExpiry ?? undefined,
          });
          this.refresh();
          break;
        }
      }
    });
  }

  refresh() {
    const profiles = listProfiles();
    const active = this.ctx.globalState.get<string>('activeProfile');
    const entries: ProfileEntry[] = profiles.map(name => {
      const meta = readProfileMeta(name) ?? {} as Partial<ProfileMeta>;
      let savedAt = '';
      try { savedAt = fs.statSync(path.join(PROFILES_DIR, name)).mtime.toLocaleDateString(); } catch {}
      return {
        name,
        active: name === active,
        email: meta.email ?? '',
        provider: meta.provider ?? 'Unknown',
        authMethod: meta.authMethod ?? 'Unknown',
        expiresAt: meta.expiresAt ?? '',
        plan: meta.plan ?? 'Kiro Free',
        creditsUsed: meta.creditsUsed ?? 0,
        creditsTotal: meta.creditsTotal ?? 50,
        bonusCredits: meta.bonusCredits,
        bonusExpiry: meta.bonusExpiry,
        resetDate: meta.resetDate ?? '',
        savedAt,
      };
    });
    this.panel.webview.html = getHtml(entries, active);
  }
}

interface ProfileEntry {
  name: string;
  active: boolean;
  email: string;
  provider: string;
  authMethod: string;
  expiresAt: string;
  plan: string;
  creditsUsed: number;
  creditsTotal: number;
  bonusCredits?: number;
  bonusExpiry?: string;
  resetDate: string;
  savedAt: string;
}

function getHtml(profiles: ProfileEntry[], active: string | undefined): string {
  const cards = profiles.length === 0
    ? `<div class="empty">No profiles saved yet. Click "Add Account" to get started.</div>`
    : profiles.map(p => accountCard(p)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Switax Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 28px 32px;
    max-width: 860px;
    margin: 0 auto;
  }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .header h1 { font-size: 1.3rem; margin: 0; }
  .header .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.82rem; margin-top: 3px; }
  .btn-add-account {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 18px; border: none; border-radius: 6px; cursor: pointer;
    font-size: 0.88rem; font-weight: 600;
    background: #7c3aed; color: #fff;
  }
  .btn-add-account:hover { background: #6d28d9; }
  .btn-add-account svg { flex-shrink: 0; }
  .btn-refresh-all {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 14px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; cursor: pointer;
    font-size: 0.88rem; font-weight: 600;
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
  }
  .btn-refresh-all:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* ── Account Card ── */
  .card {
    background: var(--vscode-editorWidget-background, #1e1e2e);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 10px;
    margin-bottom: 20px;
    overflow: hidden;
  }
  .card.is-active { border-color: #7c3aed; }

  .card-header {
    display: flex; align-items: center; gap: 14px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .avatar {
    width: 46px; height: 46px; border-radius: 50%;
    background: #7c3aed;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.3rem; flex-shrink: 0;
  }
  .account-info { flex: 1; min-width: 0; }
  .account-email { font-size: 1rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .account-sub { font-size: 0.8rem; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .account-sub a { color: var(--vscode-textLink-foreground); text-decoration: underline; cursor: pointer; }
  .card-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .badge-active {
    padding: 3px 10px; border-radius: 12px; font-size: 0.72rem; font-weight: 600;
    background: #7c3aed22; color: #a78bfa; border: 1px solid #7c3aed55;
  }
  .btn-sm {
    padding: 5px 13px; border-radius: 5px; font-size: 0.8rem; cursor: pointer; border: none;
  }
  .btn-switch { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-switch:hover { background: var(--vscode-button-hoverBackground); }
  .btn-rename { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-rename:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-edit { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-edit:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-delete { background: transparent; color: var(--vscode-errorForeground); border: 1px solid var(--vscode-errorForeground) !important; }
  .btn-delete:hover { background: var(--vscode-inputValidation-errorBackground); }
  .btn-refresh { background: #065f46; color: #6ee7b7; border: 1px solid #059669 !important; }
  .btn-refresh:hover:not(:disabled) { background: #047857; }
  .btn-refresh.loading { opacity: 0.6; cursor: not-allowed; }
  .btn-refresh:disabled { opacity: 0.4; cursor: not-allowed; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-color: var(--vscode-panel-border) !important; }

  /* ── Credits section ── */
  .card-body { padding: 16px 20px; }
  .bonus-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .bonus-table thead tr { border-bottom: 1px solid var(--vscode-panel-border); }
  .bonus-table th {
    text-align: left; padding: 6px 8px; font-size: 0.78rem;
    color: var(--vscode-descriptionForeground); font-weight: 600;
  }
  .bonus-table th:first-child { display: flex; align-items: center; gap: 6px; }
  .bonus-table td { padding: 8px 8px; font-size: 0.85rem; }
  .bonus-table td:not(:first-child) { color: var(--vscode-descriptionForeground); }

  .usage-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .usage-label { font-size: 0.9rem; font-weight: 600; }
  .usage-label .reset { font-size: 0.75rem; font-weight: 400; color: var(--vscode-descriptionForeground); margin-left: 6px; }
  .plan-badge {
    padding: 3px 10px; border-radius: 5px; font-size: 0.78rem;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .credits-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .credits-label { font-size: 0.88rem; font-weight: 600; }
  .credits-value { font-size: 0.82rem; color: var(--vscode-descriptionForeground); }
  .progress-bar { width: 100%; height: 6px; border-radius: 3px; background: var(--vscode-scrollbarSlider-background); overflow: hidden; margin-bottom: 14px; }
  .progress-fill { height: 100%; border-radius: 3px; background: #7c3aed; transition: width 0.3s; }

  .card-footer {
    padding: 14px 20px;
    border-top: 1px solid var(--vscode-panel-border);
    display: flex; flex-direction: column; align-items: center; gap: 8px;
  }
  .btn-upgrade {
    width: 100%; padding: 11px; border: none; border-radius: 7px; cursor: pointer;
    font-size: 0.95rem; font-weight: 700; background: #7c3aed; color: #fff;
  }
  .btn-upgrade:hover { background: #6d28d9; }
  .billing-link { font-size: 0.8rem; color: var(--vscode-textLink-foreground); text-decoration: underline; cursor: pointer; }

  .empty { text-align: center; padding: 48px; color: var(--vscode-descriptionForeground); }
  .saved-at { font-size: 0.75rem; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .auth-badge {
    display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 0.7rem;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    margin-left: 5px; vertical-align: middle; text-transform: capitalize;
  }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>Switax — Kiro Profile Dashboard</h1>
    <div class="subtitle">Active: <strong>${active ? esc(active) : 'none'}</strong> &nbsp;·&nbsp; Profiles stored in <code>~/.kiro-profiles/</code></div>
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <button class="btn-refresh-all" onclick="send('refreshDashboard','')" title="Refresh active profile and profile list">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>
      Refresh
    </button>
    <button class="btn-add-account" onclick="send('add','')">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm1 6h2a1 1 0 1 1 0 2H9v2a1 1 0 1 1-2 0V9H5a1 1 0 1 1 0-2h2V5a1 1 0 1 1 2 0v2z"/></svg>
      Save Current Account
    </button>
  </div>
</div>

${cards}

<div style="margin-top:12px; text-align:center;">
  <button class="btn-add-account" style="display:inline-flex; margin:0 auto;" onclick="send('openLogin','')">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1A1.5 1.5 0 0 0 5 2.5V3H1.5A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 14.5 3H11v-.5A1.5 1.5 0 0 0 9.5 1h-3zm0 1h3a.5.5 0 0 1 .5.5V3H6v-.5a.5.5 0 0 1 .5-.5z"/></svg>
    Open kiro.dev to sign in with another account
  </button>
  <div style="font-size:0.75rem; color:var(--vscode-descriptionForeground); margin-top:6px;">
    Opens kiro.dev in your browser → click Sign In → log in with a different account → come back here and click "Save Current Account"
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function send(command, name) { vscode.postMessage({ command, name }); }

  function sendRefreshUsage(name) {
    const btn = document.getElementById('refresh-' + name);
    if (btn) { btn.textContent = '⟳ Loading…'; btn.classList.add('loading'); btn.disabled = true; }
    vscode.postMessage({ command: 'refreshUsage', name });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'usageLoading') {
      const btn = document.getElementById('refresh-' + msg.name);
      if (btn) { btn.textContent = '⟳ Loading…'; btn.classList.add('loading'); btn.disabled = true; }
    } else if (msg.command === 'usageResult') {
      const btn = document.getElementById('refresh-' + msg.name);
      if (btn) { btn.textContent = '⟳ Usage'; btn.classList.remove('loading'); btn.disabled = false; }
      // Update usage display inline
      const usage = msg.usage;
      if (usage.usageBreakdownList?.length) {
        const b = usage.usageBreakdownList[0];
        const usedEl = document.getElementById('used-' + msg.name);
        const totalEl = document.getElementById('total-' + msg.name);
        const barEl = document.getElementById('bar-' + msg.name);
        const planEl = document.getElementById('plan-' + msg.name);
        if (usedEl) usedEl.textContent = b.currentUsage;
        if (totalEl) totalEl.textContent = b.usageLimit;
        if (planEl) planEl.textContent = usage.subscriptionTitle;
        if (barEl) {
          const pct = b.usageLimit > 0 ? Math.min(100, (b.currentUsage / b.usageLimit) * 100) : 0;
          barEl.style.width = pct.toFixed(1) + '%';
        }
      }
    } else if (msg.command === 'usageError') {
      const btn = document.getElementById('refresh-' + msg.name);
      if (btn) { btn.textContent = '⟳ Usage'; btn.classList.remove('loading'); btn.disabled = false; }
      alert('Usage fetch failed for "' + msg.name + '": ' + msg.error);
    }
  });
</script>
</body>
</html>`;
}

function accountCard(p: ProfileEntry): string {
  const pct = p.creditsTotal > 0 ? Math.min(100, (p.creditsUsed / p.creditsTotal) * 100) : 0;
  const initials = p.email ? p.email[0].toUpperCase() : '?';
  const providerIcon = providerEmoji(p.provider);

  const bonusRow = p.bonusCredits !== undefined ? `
    <tr>
      <td>Credits</td>
      <td>${p.bonusExpiry ?? '—'}</td>
      <td>${p.bonusCredits} used / 500 total</td>
    </tr>` : `<tr><td colspan="3" style="color:var(--vscode-descriptionForeground);font-size:0.8rem;padding:8px;">No bonus credits</td></tr>`;

  return `
<div class="card ${p.active ? 'is-active' : ''}">
  <div class="card-header">
    <div class="avatar">${initials}</div>
    <div class="account-info">
      <div class="account-email">${esc(p.email || p.name)}</div>
      <div class="account-sub">
        ${providerIcon} Signed in with ${esc(p.provider)}
        ${p.authMethod && p.authMethod !== 'Unknown' ? `<span class="auth-badge">${esc(p.authMethod)}</span>` : ''}
        ${p.savedAt ? `<span class="saved-at">&nbsp;·&nbsp; saved ${esc(p.savedAt)}</span>` : ''}
        ${p.expiresAt ? `<span class="saved-at">&nbsp;·&nbsp; token expires ${esc(new Date(p.expiresAt).toLocaleDateString())}</span>` : ''}
      </div>
    </div>
    <div class="card-actions">
      ${p.active
        ? `<span class="badge-active">✓ active</span>`
        : `<button class="btn-sm btn-switch" onclick="send('switch','${esc(p.name)}')">Switch</button>`}
      ${p.active
        ? `<button class="btn-sm btn-refresh" id="refresh-${esc(p.name)}" onclick="sendRefreshUsage('${esc(p.name)}')">⟳ Usage</button>`
        : `<button class="btn-sm btn-refresh" disabled title="Switch to this profile to fetch usage info">⟳ Usage</button>`}
      <button class="btn-sm btn-edit" onclick="send('editMeta','${esc(p.name)}')">Edit info</button>
      <button class="btn-sm btn-rename" onclick="send('rename','${esc(p.name)}')">Rename</button>
      <button class="btn-sm btn-delete" onclick="send('delete','${esc(p.name)}')">Delete</button>
    </div>
  </div>

  <div class="card-body">
    <table class="bonus-table">
      <thead>
        <tr>
          <th><span>🎁</span> Bonus Credits</th>
          <th>Expiry</th>
          <th>Est. Usage</th>
        </tr>
      </thead>
      <tbody>${bonusRow}</tbody>
    </table>

    <div class="usage-row">
      <span class="usage-label">
        Estimated Usage
        ${p.resetDate ? `<span class="reset">resets on ${esc(p.resetDate)}</span>` : ''}
      </span>
      <span class="plan-badge" id="plan-${esc(p.name)}">${esc(p.plan)}</span>
    </div>

    <div class="credits-row">
      <span class="credits-label">Credits</span>
      <span class="credits-value"><span id="used-${esc(p.name)}">${p.creditsUsed}</span> used / <span id="total-${esc(p.name)}">${p.creditsTotal}</span> covered in plan</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" id="bar-${esc(p.name)}" style="width:${pct.toFixed(1)}%"></div>
    </div>
  </div>

  <div class="card-footer">
    <button class="btn-upgrade" onclick="vscode.env && send('openLogin','')">Upgrade Plan</button>
    <span class="billing-link" onclick="send('openLogin','')">Contact Billing Support</span>
  </div>
</div>`;
}

function providerEmoji(provider: string): string {
  const map: Record<string, string> = {
    'Google': '🔵',
    'GitHub': '⚫',
    'AWS Builder ID': '🟠',
    'AWS IAM Identity Center': '🟠',
  };
  return map[provider] ?? '🔑';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
