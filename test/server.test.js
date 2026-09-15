const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');
let directory, child, base;
before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-api-'));
    for (const file of ['app.js', 'document-store.js', 'index.html', 'rich.html', 'share.html', 'sync.js']) {
        await fs.copyFile(path.join(__dirname, '..', file), path.join(directory, file));
    }
    child = spawn(process.execPath, [path.join(directory, 'app.js')], {
        env: { ...process.env, PORT: '0', HOST: '127.0.0.1', NODE_PATH: path.join(__dirname, '..', 'node_modules') },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error('Server startup timed out: ' + output)), 10000);
        child.stderr.on('data', data => { output += data; });
        child.once('error', reject);
        child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
        child.stdout.on('data', data => {
            const match = data.toString().match(/http:\/\/0.0.0.0:(\d+)/);
            if (match) { clearTimeout(timeout); base = `http://127.0.0.1:${match[1]}`; resolve(); }
        });
    });
});
after(async () => {
    if (child && child.exitCode === null) {
        const exited = once(child, 'exit'); child.kill(); await exited;
    }
    if (directory) await fs.rm(directory, { recursive: true, force: true });
});
const put = (id, body) => fetch(`${base}/api/documents/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
test('API saves with revisions, rejects stale updates, and broadcasts rich autosaves', async () => {
    const socket = new WebSocket(base.replace('http:', 'ws:'));
    try {
        await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
        const initial = await (await fetch(`${base}/api/documents/rich`)).json();
        const message = once(socket, 'message', { signal: AbortSignal.timeout(5000) });
        const content = { ops: [{ insert: 'Synced rich text\n' }] };
        const response = await put('rich', { content, revision: initial.revision });
        assert.equal(response.status, 200);
        const [raw] = await message;
        const notification = JSON.parse(raw.toString());
        assert.equal(notification.type, 'document-changed');
        assert.equal(notification.document, 'rich');
        const stale = await put('rich', { content: { ops: [] }, revision: initial.revision });
        assert.equal(stale.status, 409);
        assert.deepEqual((await stale.json()).content, content);
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'rich.json'), 'utf8')), content);
    } finally { socket.terminate(); }
});
test('only intended assets are served and invalid documents are rejected', async () => {
    for (const url of ['/app.js', '/package.json', '/note.txt', '/rich.json', '/node_modules/express/package.json']) {
        assert.equal((await fetch(base + url)).status, 404, url);
    }
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await fetch(base + '/sync.js')).status, 200);
    assert.equal((await put('code', { content: 123, revision: 'x' })).status, 400);
    assert.equal((await put('rich', { content: { ops: [{ delete: 5 }] }, revision: 'x' })).status, 400);
});
test('disk-staged uploads preserve nested paths and support download', async () => {
    const form = new FormData();
    form.append('files', new Blob(['test upload']), 'file.txt');
    form.append('paths', 'folder/file.txt');
    const response = await fetch(base + '/files/upload', { method: 'POST', body: form });
    assert.equal(response.status, 200);
    assert.equal(await (await fetch(base + '/files/folder/file.txt')).text(), 'test upload');
    const bad = new FormData();
    bad.append('files', new Blob(['escape']), 'bad.txt');
    bad.append('paths', '../outside.txt');
    assert.equal((await fetch(base + '/files/upload', { method: 'POST', body: bad })).status, 500);
    await assert.rejects(fs.access(path.join(directory, 'outside.txt')));
});
test('images are stored separately and unsupported formats are rejected', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=', 'base64');
    const form = new FormData();
    form.append('image', new Blob([png], { type: 'image/png' }), 'pixel.png');
    const response = await fetch(base + '/images', { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const { url } = await response.json();
    const download = await fetch(base + url);
    assert.equal(download.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
    const bad = new FormData();
    bad.append('image', new Blob(['<svg></svg>'], { type: 'image/svg+xml' }), 'image.svg');
    assert.equal((await fetch(base + '/images', { method: 'POST', body: bad })).status, 400);
    assert.equal((await (await fetch(base + '/files')).json()).some(file => file.name.endsWith('.png')), false);
});


test('image upload limit rejects oversized files', async () => {
    const form = new FormData();
    form.append('image', new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
    const response = await fetch(base + '/images', { method: 'POST', body: form });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /too large/i);
});
