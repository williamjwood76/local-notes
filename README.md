# Notes

Personal markdown notes for a Mac. Notes stay as plain files in a folder you choose.

## Run it on a work Mac

Sign in to GitHub as **williamjwood76**. This repository is private.

1. Install the tools once. In Terminal:

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Install Node.js from https://nodejs.org if `node` is not already available. Close Terminal and open it again so Rust is on your path.

2. Download the project:

```bash
gh auth login
gh repo clone williamjwood76/local-notes
cd local-notes
git pull
rm -rf node_modules
npm install --include=dev
```

The company registry refuses packages published in the last few weeks. This repository pins older copies, so install from the latest `main`. If the folder is named `local-notes-main`, that is a zip download. Delete it and use the clone above instead.

If Terminal says `tauri: command not found`, you are in this folder and the line above has not finished successfully. Run `npm install --include=dev` again. Do not run `tauri` by itself.

3. Start it:

```bash
source "$HOME/.cargo/env"
npm run tauri dev
```

Leave that Terminal window open. The Notes window opens when the build finishes. The first build can take a few minutes. Choose **Open…** and pick the folder of markdown files.

## Open it without Terminal

From the project folder:

```bash
source "$HOME/.cargo/env"
npm run tauri build
```

The app is saved at `src-tauri/target/release/bundle/macos/Notes.app`. The first time you open it, right-click it and choose **Open**.

This build runs on Apple silicon Macs.
