// Runs the real Monaco and Quill editors in an isolated Chrome profile and data directory.
// Set CHROME_PATH on machines where Chrome is installed elsewhere.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');
const root = path.join(__dirname, '..');
let directory, server, chrome, socket;
const processes = [];
async function launch(command, args, pattern, env) {
    const child = spawn(command, args, { env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    processes.push(child);
    const address = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Startup timed out')), 30000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Process exited ${code}`)); });
        for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
            const match = chunk.toString().match(pattern);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
    });
    return { child, address };
}
async function main() {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-browser-'));
    for (const name of ['app.js', 'document-store.js', 'index.html', 'rich.html', 'index.js', 'rich.js', 'sync.js', 'language.js', 'style.css', 'rich.css']) {
        await fs.copyFile(path.join(root, name), path.join(directory, name));
    }
    await fs.writeFile(path.join(directory, 'note.txt'), 'Existing saved text');
    await fs.writeFile(path.join(directory, 'rich.json'), JSON.stringify({ ops: [{ insert: 'Existing rich text\n' }] }));
    const started = await launch(process.execPath, [path.join(directory, 'app.js')], /http:\/\/0.0.0.0:(\d+)/, {
        ...process.env, HOST: '127.0.0.1', PORT: '0', NODE_PATH: path.join(root, 'node_modules'),
    });
    server = started.child;
    const base = `http://127.0.0.1:${started.address}`;
    const browser = await launch(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
        '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
        `--user-data-dir=${path.join(directory, 'profile')}`, 'about:blank',
    ], /DevTools listening on (ws:\/\/\S+)/);
    chrome = browser.child;
    socket = new WebSocket(browser.address);
    await once(socket, 'open');
    let counter = 0;
    const pending = new Map();
    socket.on('message', raw => {
        const message = JSON.parse(raw);
        if (!message.id) return;
        const callback = pending.get(message.id);
        if (callback) { pending.delete(message.id); callback(message); }
    });
    function command(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = ++counter;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000);
            pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
            socket.send(JSON.stringify({ id, method, params, sessionId }));
        });
    }
    async function tab(url) {
        const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
        await command('Page.enable', {}, sessionId);
        await command('Page.navigate', { url }, sessionId);
        return sessionId;
    }
    async function evaluate(session, expression) {
        const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
        return response.result.value;
    }
    async function until(session, expression) {
        const deadline = Date.now() + 30000;
        do {
            try { if (await evaluate(session, expression)) return; } catch {}
            await new Promise(resolve => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
        const details = await evaluate(session, '({ status: document.querySelector("[role=status]")?.textContent, quillLoaded: typeof Quill, syncLoaded: typeof DocumentSync, richError: (() => { try { quill.getContents().diff({ ops: [{ insert: \"probe\\n\" }] }); return null; } catch (e) { return e.message; } })() })');
        throw new Error(`Browser condition failed: ${expression}; ${JSON.stringify(details)}`);
    }
    const code = await tab(base);
    await until(code, 'typeof sync !== "undefined" && sync && sync.ready');
    assert.equal(await evaluate(code, 'monacoEditor.getValue()'), 'Existing saved text', 'Initial load must display the saved document');
    assert.equal(await evaluate(code, 'monacoEditor.getModel().canUndo()'), false, 'Initial load must not undo back to empty');
    console.log('PASS: real Monaco loads saved text while initially read-only, without an empty undo step');
    const unicodeNote = '2 × 6 min steady (~9:20–9:40) with 2–3 min easy; finish with 4–6 × 20 sec strides.';
    await evaluate(code, `monacoEditor.setValue(${JSON.stringify(unicodeNote)}); sync.save()`);
    await until(code, '!sync.dirty && !sync.saving');
    // Unicode decorations are computed asynchronously after content changes.
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(await evaluate(code, 'document.querySelectorAll(".view-lines .unicode-highlight").length'), 0,
        'Visible Unicode punctuation and symbols must not get warning boxes');
    await evaluate(code, 'window.__beforeReload = true');
    await command('Page.reload', {}, code);
    await until(code, '!window.__beforeReload && typeof sync !== "undefined" && sync && sync.ready');
    assert.equal(await evaluate(code, 'monacoEditor.getValue()'), unicodeNote);
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(await evaluate(code, 'document.querySelectorAll(".view-lines .unicode-highlight").length'), 0,
        'Unicode warning boxes must stay absent after reload');
    console.log('PASS: Unicode text survives save and reload without warning boxes');
    const second = await tab(base);
    await until(second, 'typeof sync !== "undefined" && sync && sync.ready');
    assert.equal(await evaluate(second, 'monacoEditor.getValue()'), unicodeNote);
    await evaluate(code, 'monacoEditor.setValue("Updated from first tab"); sync.save()');
    await until(second, 'monacoEditor.getValue() === "Updated from first tab"');
    console.log('PASS: clean second tab receives saved edits');
    const rich = await tab(base + '/rich');
    await until(rich, 'typeof richSync !== "undefined" && richSync && richSync.ready');
    assert.equal(await evaluate(rich, 'quill.getText()'), 'Existing rich text\n');
    await evaluate(rich, 'quill.setText("Rich edit\\n", "user"); richSync.save()');
    await until(rich, '!richSync.dirty && !richSync.saving');
    await evaluate(rich, 'window.__beforeReload = true');
    await command('Page.reload', {}, rich);
    await until(rich, '!window.__beforeReload && typeof richSync !== "undefined" && richSync && richSync.ready');
    assert.equal(await evaluate(rich, 'quill.getText()'), 'Rich edit\n');
    console.log('PASS: real Quill edits survive save and reload');
    const otherRich = await tab(base + '/rich');
    await until(otherRich, 'typeof richSync !== "undefined" && richSync && richSync.ready');
    await evaluate(rich, 'quill.setText("Remote rich edit\\n", "user"); richSync.save()');
    await until(otherRich, 'quill.getText() === "Remote rich edit\\n"');
    console.log('PASS: rich-text updates apply to a second tab');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    socket?.terminate();
    for (const child of processes.reverse()) {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
            child.kill(); await exited; clearTimeout(timeout);
        }
    }
    if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
