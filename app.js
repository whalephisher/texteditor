const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const chokidar = require('chokidar');
const multer = require('multer');

const app = express();
const PORT = 3000;
const FILE_PATH = path.join(__dirname, 'note.txt');
const RICH_PATH = path.join(__dirname, 'rich.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Use memory storage so we can write files to nested paths using a provided relative path
const upload = multer({ storage: multer.memoryStorage() });

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/share', (req, res) => {
    res.sendFile(path.join(__dirname, 'share.html'));
});

app.get('/rich', (req, res) => {
    res.sendFile(path.join(__dirname, 'rich.html'));
});

app.get('/load', (req, res) => {
    fs.readFile(FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.send('');
        res.send(data);
    });
});

// Load rich text delta (Quill)
app.get('/rich-load', (req, res) => {
    fs.readFile(RICH_PATH, 'utf8', (err, data) => {
        if (err) return res.json({ ops: [] });
        try {
            const parsed = JSON.parse(data);
            return res.json(parsed);
        } catch {
            return res.json({ ops: [] });
        }
    });
});

// Save rich text delta
app.post('/rich-save', (req, res) => {
    const delta = req.body && req.body.delta;
    if (!delta || typeof delta !== 'object') return res.status(400).json({ ok: false, error: 'Invalid delta' });
    fs.promises.writeFile(RICH_PATH, JSON.stringify(delta)).then(() => {
        res.json({ ok: true });
    }).catch(() => res.status(500).json({ ok: false }));
});

// Simple file sharing API (separate from editor)
// List uploaded files
app.get('/files', async (req, res) => {
    try {
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
        res.json(detailed.sort((a, b) => b.mtimeMs - a.mtimeMs));
    } catch (e) {
        res.json([]);
    }
});

// Upload one or more files
app.post('/files/upload', upload.array('files'), async (req, res) => {
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
            await fs.promises.writeFile(targetPath, f.buffer);
            saved.push(relClean);
        }
        res.json({ ok: true, files: saved });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Upload failed' });
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

const broadcast = (data) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
};

app.post('/save', async (req, res) => {
    const content = req.body.content;
    try {
        await fs.promises.writeFile(FILE_PATH, content);
        res.send('Saved');
        broadcast(content); // Immediately notify all clients
    } catch (err) {
        res.status(500).send('Error saving file');
    }
});

// Allow access from other devices
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Editor running at http://0.0.0.0:${PORT}`);
});

const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
    console.log('Client connected');
});

// Watch for external file changes (like from editing outside app)
chokidar.watch(FILE_PATH).on('change', () => {
    fs.readFile(FILE_PATH, 'utf8', (err, data) => {
        if (!err) {
            broadcast(data);
        }
    });
});
