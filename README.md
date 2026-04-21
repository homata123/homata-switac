# Kiro Account Switcher

Switch between multiple Kiro accounts without going through the browser login flow every time.

## Features

- Save your current logged-in Kiro account as a named profile
- Switch between profiles from the status bar or command palette
- Active account always visible in the status bar
- Delete profiles you no longer need

## Usage

1. Log in to Kiro with your first account normally
2. Open command palette → **Kiro: Save Current Account as Profile** (e.g. `work`)
3. Log in to Kiro with a second account
4. Save it as another profile (e.g. `personal`)
5. From now on, use **Kiro: Switch Account** (or click the status bar) to swap between them

## Keyboard Shortcut

`Ctrl+Shift+Alt+K` (Windows/Linux) / `Cmd+Shift+Alt+K` (Mac) — opens the account switcher

## Commands

| Command | Description |
|---|---|
| `Kiro: Switch Account` | Pick a saved profile to switch to |
| `Kiro: Save Current Account as Profile` | Snapshot current auth as a named profile |
| `Kiro: Delete Profile` | Remove a saved profile |
| `Kiro: List Saved Profiles` | Show all saved profiles |

## How it works

Profiles are stored in `~/.kiro-profiles/`. Each profile is a snapshot of Kiro's local auth token files. Switching restores those files and prompts a window reload so Kiro picks up the new credentials.

> Note: After switching, Kiro may ask you to re-authenticate if the token has expired.
