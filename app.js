const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const chokidar = require('chokidar');
const multer = require('multer');
const archiver = require('archiver');
const { createDocumentStore } = require('./document-store');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const FILE_PATH = path.join(__dirname, 'note.txt');
const RICH_PATH = path.join(__dirname, 'rich.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Stage uploads on disk instead of retaining the entire request in memory.
const os = require('os');
const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 50 * 1024 * 1024, files: 100, fields: 100, fieldSize: 4096 },
});

async function listUploadedFiles() {
    const base = path.resolve(UPLOAD_DIR);
    async function walk(dir, prefix = '') {
        const out = [];
        const ents = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const ent of ents) {
            const rel = prefix ? path.posix.join(prefix, ent.name) : ent.name;
            const abs = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                out.push(...await walk(abs, rel));
            } else if (ent.isFile()) {
                const st = await fs.promises.stat(abs);
                out.push({ name: rel, size: st.size, mtimeMs: st.mtimeMs });
            }
        }
        return out;
    }
    const detailed = await walk(base);
    return detailed.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

app.use(bodyParser.json({ limit: '60mb' }));
// Only these browser assets are public; source, notes and dependencies are not.
for (const asset of ['index.js', 'rich.js', 'share.js', 'sync.js', 'language.js', 'style.css', 'rich.css']) {
    app.get('/' + asset, (req, res) => res.sendFile(path.join(__dirname, asset)));
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/share', (req, res) => {
    res.sendFile(path.join(__dirname, 'share.html'));
});

app.get('/rich', (req, res) => {
    res.sendFile(path.join(__dirname, 'rich.html'));
});

const documents = createDocumentStore({
    code: { path: FILE_PATH },
    rich: { path: RICH_PATH, rich: true },
}, (document, revision) => wsBroadcast({ type: 'document-changed', document, revision }));

app.get('/api/documents/:id', async (req, res) => {
    if (!['code', 'rich'].includes(req.params.id)) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store');
    try { res.json(await documents.read(req.params.id)); }
    catch { res.status(500).json({ error: 'Could not load document' }); }
});

app.put('/api/documents/:id', async (req, res) => {
    const id = req.params.id;
    if (!['code', 'rich'].includes(id)) return res.sendStatus(404);
    const { content, revision } = req.body || {};
    const valid = id === 'code' ? typeof content === 'string' :
        content && Array.isArray(content.ops) && content.ops.every(op =>
            op && (typeof op.insert === 'string' ||
                (op.insert && typeof op.insert === 'object' && !Array.isArray(op.insert))));
    if (!valid || typeof revision !== 'string') return res.status(400).json({ error: 'Invalid document or revision' });
    try {
        const result = await documents.save(id, content, revision);
        res.status(result.conflict ? 409 : 200).json(result.conflict ? result : { revision: result.revision });
    } catch { res.status(500).json({ error: 'Could not save document' }); }
});

// Store rich-text images separately from shared files and document JSON.
const IMAGE_DIR = path.join(__dirname, 'images');
fs.mkdirSync(IMAGE_DIR, { recursive: true });
const imageUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
app.post('/images', (req, res, next) => {
    imageUpload.single('image')(req, res, error => {
        if (error) return res.status(400).json({ error: error.message });
        next();
    });
}, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Image required' });
    try {
        const handle = await fs.promises.open(req.file.path, 'r');
        const header = Buffer.alloc(12);
        try { await handle.read(header, 0, 12, 0); } finally { await handle.close(); }
        const signature = header.toString('hex');
        let extension;
        if (signature.startsWith('89504e470d0a1a0a')) extension = 'png';
        else if (signature.startsWith('ffd8ff')) extension = 'jpg';
        else if (/^GIF8[79]a/.test(header.toString('ascii'))) extension = 'gif';
        else if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') extension = 'webp';
        if (!extension) return res.status(400).json({ error: 'Use a PNG, JPEG, GIF or WebP image' });
        const name = require('crypto').randomUUID() + '.' + extension;
        await fs.promises.copyFile(req.file.path, path.join(IMAGE_DIR, name));
        res.json({ url: '/images/' + name });
    } catch { res.status(500).json({ error: 'Image upload failed' }); }
    finally { await fs.promises.rm(req.file.path, { force: true }).catch(() => {}); }
});
app.use('/images', express.static(IMAGE_DIR, { dotfiles: 'deny', setHeaders: res => res.set('X-Content-Type-Options', 'nosniff') }));

// Simple file sharing API (separate from editor)
// List uploaded files
app.get('/files', async (req, res) => {
    try {
        const detailed = await listUploadedFiles();
        res.json(detailed);
    } catch (e) {
        res.json([]);
    }
});

// Download all files as a zip archive
app.get('/files.zip', async (req, res) => {
    try {
        const files = await listUploadedFiles();
        if (!files.length) return res.status(404).send('No files to download');

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=\"files.zip\"');

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', () => {
            if (!res.headersSent) res.status(500);
            res.end();
        });
        archive.pipe(res);
        for (const f of files) {
            const abs = path.resolve(path.join(UPLOAD_DIR, f.name));
            archive.file(abs, { name: f.name });
        }
        archive.finalize();
    } catch (e) {
        res.status(500).send('Zip failed');
    }
});

// Upload one or more files
app.post('/files/upload', (req, res, next) => {
    upload.array('files')(req, res, error => {
        if (error) return res.status(400).json({ ok: false, error: error.message });
        next();
    });
}, async (req, res) => {
    try {
        const files = req.files || [];
        let paths = req.body.paths || [];
        if (!Array.isArray(paths)) paths = paths ? [paths] : [];
        const base = path.resolve(UPLOAD_DIR) + path.sep;
        const saved = [];
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const relRaw = paths[i] || f.originalname;
            // Normalize to posix-style for URLs then convert to system paths where needed
            const relClean = relRaw.replace(/^\/+/, '').replace(/\\/g, '/');
            const targetPath = path.resolve(path.join(UPLOAD_DIR, relClean));
            if (!targetPath.startsWith(base)) throw new Error('Invalid path');
            await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.promises.copyFile(f.path, targetPath);
            saved.push(relClean);
        }
        res.json({ ok: true, files: saved });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Upload failed' });
    } finally {
        await Promise.all((req.files || []).map(f => fs.promises.rm(f.path, { force: true }).catch(() => {})));
    }
});

// Delete all uploaded files
app.delete('/files', async (req, res) => {
    try {
        await fs.promises.rm(UPLOAD_DIR, { recursive: true, force: true });
        await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Delete failed' });
    }
});

// Download (support nested paths)
app.get(/^\/files\/(.*)$/, (req, res) => {
    const rel = req.params[0] || '';
    const base = path.resolve(UPLOAD_DIR) + path.sep;
    const filepath = path.resolve(path.join(UPLOAD_DIR, rel));
    if (!filepath.startsWith(base)) return res.status(400).send('Invalid path');
    fs.access(filepath, fs.constants.R_OK, (err) => {
        if (err) return res.status(404).send('Not found');
        res.download(filepath, path.basename(filepath));
    });
});

// Delete (support nested paths)
app.delete(/^\/files\/(.*)$/, async (req, res) => {
    try {
        const rel = req.params[0] || '';
        const base = path.resolve(UPLOAD_DIR) + path.sep;
        const filepath = path.resolve(path.join(UPLOAD_DIR, rel));
        if (!filepath.startsWith(base)) return res.status(400).json({ ok: false, error: 'Invalid path' });
        await fs.promises.unlink(filepath);
        res.json({ ok: true });
    } catch (e) {
        if (e && e.code === 'ENOENT') return res.status(404).json({ ok: false, error: 'Not found' });
        res.status(500).json({ ok: false, error: 'Delete failed' });
    }
});

// Broadcast helper for all websocket clients (JSON messages only)
function wsBroadcast(obj, except) {
    const payload = JSON.stringify(obj);
    wss.clients.forEach(client => {
        if (client !== except && client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// Allow access from other devices
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, error => {
    if (error) { console.error(error); process.exit(1); }
    console.log(`Editor running at http://0.0.0.0:${server.address().port}`);
});

const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat (optional resilience)
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false; ws.ping();
    });
}, 30000);

// Invalidate clients for external edits too. Revision checks suppress duplicate updates.
chokidar.watch([FILE_PATH, RICH_PATH], { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } })
    .on('all', (event, filename) => {
        if (!['add', 'change', 'unlink'].includes(event)) return;
        const document = filename === RICH_PATH ? 'rich' : 'code';
        documents.read(document).then(result => {
            wsBroadcast({ type: 'document-changed', document, revision: result.revision });
        }).catch(() => {});
    });
