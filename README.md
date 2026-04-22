# Switax — Kiro Account Switcher

Switch between multiple Kiro accounts without going through the browser login flow every time.

Built by [Homata](https://github.com/homata123) · [Report an issue](https://github.com/homata123/homata-switac/issues)

![Switax overview](Screenshot_1.png)

---

## Features

- Save your current logged-in Kiro account as a named profile
- Full UI dashboard tab — account cards with email, provider, credits, and usage info
- "Log in with another account" button opens Kiro login in browser — no manual sign-out needed
- Duplicate account detection by email when saving a new profile
- Active account always visible in the status bar
- Quick switch via command palette or keyboard shortcut

---

## Usage

1. Log in to Kiro with your first account normally
2. Open command palette (`Ctrl+Shift+P`) → **Switax: Save Current Account as Profile**
3. Enter the account email and select the sign-in provider
4. Click **"Log in with another account in browser"** in the dashboard to sign in with a second account in your browser
5. Come back to Kiro, save it as another profile
6. Use **Switax: Open Profile Dashboard** or click the status bar to manage and switch accounts

![Quick switch picker](Screenshot_2.png)

---

## Profile Dashboard

Open with `Ctrl+Shift+Alt+D` or via the status bar click. Each account card shows:

- Avatar initial, email address, and sign-in provider
- Bonus credits table (expiry + estimated usage)
- Estimated usage with plan badge and credits progress bar
- Upgrade Plan and Contact Billing Support links
- Switch, Rename, Delete actions per profile
- "Log in with another account in browser" button at the bottom

![Profile Dashboard](Screenshot_3.png)

![Profile Dashboard — sign-in info & credits](Screenshot_4.png)

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Alt+K` | Quick switch account (quick pick) |
| `Ctrl+Shift+Alt+D` | Open Profile Dashboard tab |

---

## Commands

| Command | Description |
|---|---|
| `Switax: Switch Account` | Quick pick switcher |
| `Switax: Save Current Account as Profile` | Snapshot current auth as a named profile |
| `Switax: Delete Profile` | Remove a saved profile |
| `Switax: Open Profile Dashboard` | Open the full UI dashboard tab |

---

## How it works

Profiles are stored in `~/.kiro-profiles/`. Each profile is a snapshot of Kiro's local auth token files plus a `meta.json` with email, provider, and usage info. Switching restores those files and prompts a window reload so Kiro picks up the new credentials.

> After switching, Kiro may ask you to re-authenticate if the token has expired.

---

## Installation

### Option A — Download VSIX from Releases (easiest, no build needed)

1. Go to the [Releases page](https://github.com/homata123/homata-switac/releases)
2. Download the latest `.vsix` file
3. In Kiro: `Ctrl+Shift+P` → **"Extensions: Install from VSIX"** → select the downloaded file
4. Reload Kiro when prompted

### Option B — Build from source

```bash
git clone https://github.com/homata123/homata-switac.git
cd homata-switac
npm install
npm run compile
npx vsce package
```

Then install the generated `.vsix` via `Ctrl+Shift+P` → "Extensions: Install from VSIX".

### Option C — Development mode (no install)

```bash
git clone https://github.com/homata123/homata-switac.git
cd homata-switac
npm install
npm run compile
```

Open the folder in Kiro and press `F5` — launches an Extension Development Host with Switax ready to use.

---

## Storage location

Profiles are saved to:

- Windows: `C:\Users\<you>\.kiro-profiles\`
- macOS/Linux: `~/.kiro-profiles/`

Each subfolder is a named profile containing snapshots of Kiro's auth token files and a `meta.json` file.

---

## Changelog

See [VERSIONS.md](VERSIONS.md) for the full version history.

### v0.2.1 — Sign-in info & credits fix
- Provider and auth method now auto-detected from `kiro-auth-token.json` at save time — no more "Unknown"
- Plan, credits, bonus credits, and reset date preserved from existing `meta.json` on re-save

### v0.2.0 — Account Info Dashboard
- Redesigned dashboard with per-account cards showing email, provider, credits, and usage
- "Log in with another account in browser" button — opens Kiro login page without manual sign-out
- Duplicate account detection by email when saving a new profile
- `meta.json` stored per profile (email, provider, plan, credits, reset date)
- Provider picker (Google, GitHub, AWS Builder ID, etc.) on profile save

### v0.1.0 — Initial Release
- Save/switch/rename/delete Kiro account profiles
- Status bar indicator for active profile
- Basic dashboard with profile list
- Safe file copy that skips locked Electron cache directories

> Older `.vsix` builds are kept in the [`archived/`](archived/) folder for reference and rollback.
