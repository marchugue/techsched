# TechSched

Monthly schedule generator. Pick a month, add events and people (with one or more positions) per day,
and TechSched writes an Excel sheet, a PDF and a PNG image into your chosen folder, and keeps a history.

## Run

```bash
npm install
npm start
```

## Development & Building

```bash
# Install dependencies
npm install

# Run locally in development mode
npm start

# Pack directory without creating installer (fast test)
npm run pack

# Build Windows installer .exe locally
npm run dist

# Publish release directly to GitHub (requires GH_TOKEN)
npm run release
```

## GitHub Releases & Auto-Updates

TechSched is configured with **electron-updater** to check for updates from GitHub Releases (`marchugue/techsched`).

### Publishing Releases

1. **Automatic via GitHub Actions (Recommended)**:
   - Push a version tag:
     ```bash
     git tag v1.0.0
     git push origin v1.0.0
     ```
   - Or go to GitHub -> **Actions** -> **Release TechSched** -> **Run workflow**.
   - GitHub Actions automatically builds the `.exe` installer and creates the release on GitHub.

2. **Publish locally with token**:
   ```powershell
   $env:GH_TOKEN="your_github_token"
   npm run release
   ```

When users run the installed app, TechSched automatically checks for new releases on startup (and via Settings -> "Check for updates"), downloads updates silently in the background, and prompts to restart and install when ready.

## Where things are

- `main.js`: window, file dialogs, generating and saving files
- `src/lib/layout.js`: the month grid shared by the editor, Excel, PDF and image
- `src/lib/excel.js`: Excel output (exceljs)
- `src/lib/render-html.js` + `capture.js`: PDF and PNG output through a hidden Electron window
- `src/lib/store.js`: settings (in the app data folder) and history (`techsched-history.json` inside your schedule folder)
- `src/renderer/`: the interface
