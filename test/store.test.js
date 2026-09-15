const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDocumentStore } = require('../document-store');

test('concurrent saves reject stale revisions and preserve a complete document', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-store-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'note.txt');
    const events = [];
    const store = createDocumentStore({ code: { path: file } }, (...event) => events.push(event));
    const initial = await store.read('code');
    const [first, second] = await Promise.all([
        store.save('code', 'first edit', initial.revision),
        store.save('code', 'second edit', initial.revision),
    ]);
    assert.equal(first.content, 'first edit');
    assert.equal(second.conflict, true);
    assert.equal(second.content, 'first edit');
    assert.equal(await fs.readFile(file, 'utf8'), 'first edit');
    assert.equal(events.length, 1);
    assert.deepEqual(await fs.readdir(dir), ['note.txt']);
    await fs.writeFile(file, 'external edit');
    assert.equal((await store.save('code', 'old tab', first.revision)).conflict, true);
});

test('rich content round trips and malformed disk data is reported', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-rich-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'rich.json');
    const store = createDocumentStore({ rich: { path: file, rich: true } });
    const initial = await store.read('rich');
    const content = { ops: [{ insert: 'Hello\n', attributes: { bold: true } }] };
    await store.save('rich', content, initial.revision);
    assert.deepEqual((await store.read('rich')).content, content);
    await fs.writeFile(file, 'broken JSON');
    await assert.rejects(store.read('rich'));
});
