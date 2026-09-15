const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../sync.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ draft, tabDraft, content = 'initial' } = {}) {
    const storage = new Map(draft ? [['editor-draft-code', JSON.stringify(draft)]] : []);
    const session = new Map(tabDraft ? [['editor-draft-code', JSON.stringify(tabDraft)]] : []);
    const controls = new Map(['conflict', 'useRemote', 'keepLocal'].map(key => [key, { hidden: true }]));
    const timers = new Map();
    const events = {};
    let nextTimer = 0;
    const state = { remote: { content, revision: 'r1' }, value: '', puts: [], fail: false, enabled: true };
    const context = vm.createContext({
        module: { exports: {} }, AbortController, console,
        setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
        clearTimeout: id => timers.delete(id),
        document: { getElementById: id => controls.get(id), addEventListener: () => {} },
        window: { addEventListener: (name, fn) => { events[name] = fn; } },
        location: { protocol: 'http:', host: 'localhost' },
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        sessionStorage: { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
        WebSocket: class { close() { this.onclose?.(); } },
        fetch: async (url, options) => {
            if (state.fail) throw new Error('offline');
            if (options.method === 'PUT') {
                const body = JSON.parse(options.body);
                state.puts.push(body);
                if (state.hold) await state.hold;
                if (body.revision !== state.remote.revision) return { ok: false, status: 409, json: async () => ({ ...state.remote, conflict: true }) };
                state.remote = { content: body.content, revision: `r${state.puts.length + 1}` };
            }
            return { ok: true, status: 200, json: async () => ({ ...state.remote }) };
        },
    });
    vm.runInContext(source, context);
    const status = {};
    const sync = new context.module.exports.DocumentSync('code', {
        read: () => state.value,
        write: value => { state.value = value; },
        editable: value => { state.enabled = value; },
    }, status);
    return { sync, state, status, storage, controls, timers, events };
}

test('save failures retain dirty state and a recovery draft; retry confirms save', async () => {
    const f = fixture(); await tick();
    f.state.value = 'my edit'; f.sync.changed();
    f.state.fail = true;
    await f.sync.save();
    assert.equal(f.sync.dirty, true);
    assert.equal(JSON.parse(f.storage.get('editor-draft-code')).content, 'my edit');
    f.state.fail = false;
    await f.sync.save();
    assert.equal(f.sync.dirty, false);
    assert.equal(f.state.remote.content, 'my edit');
    assert.equal(f.storage.has('editor-draft-code'), false);
});

test('edits during an in-flight save remain dirty and save against the new revision', async () => {
    const f = fixture(); await tick();
    f.state.value = 'one'; f.sync.changed();
    let release;
    f.state.hold = new Promise(resolve => { release = resolve; });
    const pending = f.sync.save();
    await tick();
    f.state.value = 'two'; f.sync.changed();
    release(); await pending;
    assert.equal(f.sync.dirty, true);
    assert.equal(JSON.parse(f.storage.get('editor-draft-code')).content, 'two');
    await f.sync.save();
    assert.equal(f.state.remote.content, 'two');
    assert.equal(f.state.puts[1].revision, 'r2');
    assert.equal(f.sync.dirty, false);
});

test('remote edits do not replace dirty content; explicit local choice resolves conflict', async () => {
    const f = fixture(); await tick();
    f.state.value = 'mine'; f.sync.changed();
    f.state.remote = { content: 'theirs', revision: 'r9' };
    await f.sync.refresh();
    assert.equal(f.state.value, 'mine');
    assert.equal(f.controls.get('conflict').hidden, false);
    await f.sync.save();
    assert.equal(f.state.puts.length, 0);
    f.sync.keepLocal(); await tick();
    assert.equal(f.state.remote.content, 'mine');
    assert.equal(f.sync.dirty, false);
});

test('stale saves return a conflict; choosing remote keeps a backup', async () => {
    const f = fixture(); await tick();
    f.state.value = 'mine'; f.sync.changed();
    f.state.remote = { content: 'theirs', revision: 'r9' };
    await f.sync.save();
    assert.equal(f.sync.dirty, true);
    await f.sync.useRemote();
    assert.equal(f.state.value, 'theirs');
    assert.equal(JSON.parse(f.storage.get('editor-draft-code-backup')).content, 'mine');
});

test('recovered draft with an old revision requires a conflict choice', async () => {
    const f = fixture({ draft: { content: 'recovered', revision: 'old' } }); await tick();
    assert.equal(f.state.value, 'recovered');
    assert.equal(f.sync.dirty, true);
    assert.equal(f.controls.get('conflict').hidden, false);
});

test('remote updates apply to clean editors and disconnection schedules reconnect', async () => {
    const f = fixture(); await tick();
    f.state.remote = { content: 'remote edit', revision: 'r8' };
    await f.sync.refresh();
    assert.equal(f.state.value, 'remote edit');
    assert.equal(f.sync.dirty, false);
    f.sync.socket.onclose();
    assert.ok([...f.timers.values()].some(timer => timer.ms === 1000));
});

test('typing does not read the full document immediately', async () => {
    const f = fixture(); await tick();
    f.sync.editor.read = () => { throw new Error('Unexpected document read'); };
    f.sync.changed();
    assert.equal(f.sync.dirty, true);
});

test('a lost save response followed by retry with identical content is acknowledged', async () => {
    const f = fixture(); await tick();
    f.state.value = 'mine'; f.sync.changed();
    f.state.remote = { content: 'mine', revision: 'r2' };
    await f.sync.save();
    assert.equal(f.sync.dirty, false);
    assert.equal(f.sync.conflict, undefined);
});


test('tab-specific recovery takes precedence over another tab’s shared draft', async () => {
    const f = fixture({ draft: { content: 'another tab', revision: 'r1' }, tabDraft: { content: 'this tab', revision: 'r1' } });
    await tick();
    assert.equal(f.state.value, 'this tab');
    assert.equal(f.sync.dirty, true);
});
