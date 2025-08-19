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
