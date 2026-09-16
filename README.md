# Live Text Editor + File Share

A minimal realtime text editor with Monaco and a file sharing page (uploads/downloads, nested folders, delete with confirmation, drag-and-drop folder upload). Built with Node.js + Express.

## Requirements

- Node.js 18+ (tested with Node 24)

## Install & Run

```bash
npm install
npm run start
```

- Editor: http://localhost:3000
- File Share: http://localhost:3000/share

## Features

- Live editor with auto language detection (toggle + manual override)
- WebSocket broadcast on save and file watcher sync
- Dedicated File Share page:
  - Upload files and folders (drag-and-drop or Upload button)
  - Downloads
  - Delete with custom confirmation modal
  - Preserves folder structure under `uploads/`

## Project Structure

```
app.js           # Express server + WebSocket + file API
index.html       # Editor (Monaco) UI
share.html       # File Share UI (upload/list/download/delete)
note.txt         # Backing file for the editor
uploads/         # Ignored folder where uploaded files land (auto-created)
note.example.txt # Placeholder; copy to note.txt locally (note.txt is gitignored)
```

## Git setup

Initialize and push to GitHub:

```bash
git init
git add .
git commit -m "Initial commit: editor + file share"
# Create repo on GitHub, then link remote:
# git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

## Notes

- The uploads folder is ignored by Git (`uploads/` in `.gitignore`).
- note.txt is ignored; the server reads and writes `note.txt`. You can copy `note.example.txt` to `note.txt` if you want a starter file.
- If you deploy behind HTTPS, WebSocket upgrades automatically use `wss://`.
- Consider upgrading `multer` to v2 when convenient.

## Saving and recovery

- Both editors autosave after one second of inactivity. **Ctrl/Cmd+S** saves immediately.
- “Saved” appears only after the server confirms the write. Failed saves retry automatically.
- Unsaved drafts are stored in browser storage when available and recovered on reload. The editor warns before leaving with unsaved changes. Browser storage has a quota, so keep the tab open if draft storage is unavailable.
- Other tabs and devices receive change notifications. If both have edited the document, a banner offers **Use saved version** or **Save my version**; changes are not merged automatically.
- Connections retry automatically, and reconnecting reloads the current revision.
- The server serializes saves and replaces document files atomically. Revision checks coordinate clients within one server process; run one instance per data directory. External file changes are watched, but an external writer does not participate in the server's write queue.
- New pasted/uploaded rich-text images are stored in `images/` (PNG, JPEG, GIF, WebP; 10 MB maximum). Existing embedded images remain supported. Back up `images/` with `rich.json`.
- Shared uploads are staged on disk, with a limit of 50 MB per file and 100 files per request.
- Language detection samples at most 12,000 characters and remembers manual language selections.

## Development

Run `npm test` for save/recovery, revision conflicts, WebSocket notifications, language detection, uploads, and public-file boundaries. Server tests use isolated temporary files and a temporary localhost port.

Run `npm run test:browser` to check actual Monaco and Quill loading, saving, reloading, and synchronization across tabs in headless Chrome. This uses temporary documents and a separate browser profile. Chrome defaults to its macOS application path; set `CHROME_PATH` on other systems. The test needs access to the editor libraries on jsDelivr.

Set `PORT` to change the default port (3000), or `HOST` to change the bind address (default `0.0.0.0`). Restart the server and refresh existing tabs after upgrading: both editors now use the revision-aware `/api/documents/code` and `/api/documents/rich` endpoints.
