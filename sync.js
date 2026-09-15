/* Shared autosave and revision-aware synchronization for both editors. */
class DocumentSync {
    constructor(id, editor, status) {
        this.id = id;
        this.editor = editor;
        this.status = status;
        this.revision = null;
        this.generation = 0;
        this.dirty = false;
        this.ready = false;
        this.retryDelay = 1000;
        this.key = `editor-draft-${id}`;
        this.conflictBox = document.getElementById('conflict');
        document.getElementById('useRemote').onclick = () => this.useRemote();
        document.getElementById('keepLocal').onclick = () => this.keepLocal();
        editor.editable(false);
        window.addEventListener('beforeunload', event => {
            if (this.dirty) {
                this.persist();
                event.preventDefault();
                event.returnValue = '';
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.dirty) { this.persist(); this.save(); }
        });
        window.addEventListener('online', () => { this.refresh(); this.save(); });
        window.addEventListener('focus', () => this.refresh());
        document.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                this.save();
            }
        });
        this.refresh();
        this.connect();
    }
    message(text) { this.status.textContent = text; }
    changed() {
        if (!this.ready || this.applying) return;
        this.generation++;
        this.dirty = true;
        this.message(this.conflict ? 'Conflicting edits — choose which version to keep' : 'Unsaved changes');
        clearTimeout(this.timer);
        clearTimeout(this.draftTimer);
        this.draftTimer = setTimeout(() => this.persist(), 300);
        this.timer = setTimeout(() => this.save(), 1000);
    }
    persist(content = this.editor.read()) {
        if (!this.dirty) return;
        this.draftRaw = JSON.stringify({ content, revision: this.revision });
        this.draftStored = false;
        // Per-tab storage prevents another tab's draft from replacing this one on reload.
        try { sessionStorage.setItem(this.key, this.draftRaw); this.draftStored = true; } catch {}
        try { localStorage.setItem(this.key, this.draftRaw); this.draftStored = true; } catch {}
        if (!this.draftStored) this.message('Draft storage unavailable — keep this tab open until saved');
    }
    clearDraft() {
        try {
            if (sessionStorage.getItem(this.key) === this.draftRaw) sessionStorage.removeItem(this.key);
        } catch {}
        try {
            // Do not delete a draft written by another tab.
            if (localStorage.getItem(this.key) === this.draftRaw) localStorage.removeItem(this.key);
        } catch { /* Storage can be disabled. */ }
    }
    apply(content) {
        this.applying = true;
        try { this.editor.write(content); }
        finally { this.applying = false; }
    }
    equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    async request(method = 'GET', body) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`/api/documents/${this.id}`, {
                method,
                cache: 'no-store',
                signal: controller.signal,
                ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
            });
            if (!response.ok && response.status !== 409) throw new Error('Request failed');
            const data = await response.json();
            if (typeof data.revision !== 'string' || ((method === 'GET' || response.status === 409) && !Object.hasOwn(data, 'content'))) throw new Error('Invalid response');
            return data;
        } finally { clearTimeout(timeout); }
    }
    retry() {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
            if (!this.ready || !this.dirty) this.refresh();
            else this.save();
        }, this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 30000);
    }
    async refresh() {
        if (this.saving) { this.refreshAgain = true; return; }
        if (this.refreshing) { this.refreshAgain = true; return; }
        this.refreshing = true;
        try {
            const remote = await this.request();
            if (!this.ready) {
                let draft;
                try {
                    try { this.draftRaw = sessionStorage.getItem(this.key); } catch {}
                    if (!this.draftRaw) this.draftRaw = localStorage.getItem(this.key);
                    draft = JSON.parse(this.draftRaw);
                } catch { /* Ignore malformed or inaccessible draft storage. */ }
                this.revision = remote.revision;
                this.apply(remote.content);
                this.ready = true;
                this.editor.editable(true);
                if (draft && typeof draft.revision === 'string' && Object.hasOwn(draft, 'content') && !this.equal(draft.content, remote.content)) {
                    this.apply(draft.content);
                    this.dirty = true;
                    this.generation++;
                    this.revision = draft.revision;
                    if (draft.revision !== remote.revision) this.showConflict(remote);
                    else { this.message('Recovered unsaved draft'); this.timer = setTimeout(() => this.save(), 1000); }
                } else { this.clearDraft(); this.message('Saved'); }
            } else if (remote.revision !== this.revision) {
                if (this.dirty) {
                    if (this.equal(this.editor.read(), remote.content)) {
                        this.revision = remote.revision;
                        this.dirty = false;
                        this.clearConflict();
                        this.clearDraft();
                        this.message('Saved');
                    } else this.showConflict(remote);
                } else {
                    this.apply(remote.content);
                    this.revision = remote.revision;
                    this.message('Updated from another tab or device');
                }
            }
            if (!this.dirty) this.message('Saved');
            this.retryDelay = 1000;
        } catch {
            this.message(this.ready ? 'Offline — changes will retry automatically' : 'Unable to load — retrying');
            this.retry();
        } finally {
            this.refreshing = false;
            if (this.refreshAgain) { this.refreshAgain = false; this.refresh(); }
        }
    }
    showConflict(remote) {
        this.conflict = remote;
        this.conflictBox.hidden = false;
        this.persist();
        this.message('Conflicting edits — your changes are preserved here');
    }
    clearConflict() { this.conflict = null; this.conflictBox.hidden = true; }
    async useRemote() {
        if (!this.conflict || this.saving) return;
        // Keep a recovery copy when the user chooses to replace their local text.
        try { localStorage.setItem(`${this.key}-backup`, JSON.stringify({ content: this.editor.read(), revision: this.revision })); }
        catch { /* The choice to discard is explicit. */ }
        this.apply(this.conflict.content);
        this.revision = this.conflict.revision;
        this.dirty = false;
        this.clearDraft();
        this.clearConflict();
        this.message('Loaded saved version');
        await this.refresh();
    }
    keepLocal() {
        if (!this.conflict || this.saving) return;
        this.revision = this.conflict.revision;
        this.clearConflict();
        this.persist();
        this.save();
    }
    async save() {
        clearTimeout(this.timer);
        if (!this.ready || !this.dirty || this.conflict) return;
        if (this.refreshing) { this.timer = setTimeout(() => this.save(), 100); return; }
        if (this.saving) return;
        this.saving = true;
        const generation = this.generation;
        const content = this.editor.read();
        this.persist(content);
        this.message('Saving…');
        let saved = false;
        try {
            const result = await this.request('PUT', { content, revision: this.revision });
            if (result.conflict && !this.equal(result.content, content)) { this.showConflict(result); return; }
            this.revision = result.revision;
            saved = true;
            this.retryDelay = 1000;
            if (generation === this.generation) {
                this.dirty = false;
                this.clearDraft();
                this.message('Saved');
            } else { this.persist(); this.message('Unsaved changes'); }
        } catch {
            this.message(this.draftStored ? 'Save failed — draft kept locally; retrying' : 'Save failed — keep this tab open; retrying');
            this.retry();
        } finally {
            this.saving = false;
            if (saved && this.dirty && !this.conflict) this.timer = setTimeout(() => this.save(), 0);
            if (this.refreshAgain) { this.refreshAgain = false; this.refresh(); }
        }
    }
    connect() {
        const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
        this.socket = socket;
        socket.onopen = () => { this.reconnectDelay = 1000; this.refresh(); };
        socket.onmessage = event => {
            let data;
            try { data = JSON.parse(event.data); } catch { return; }
            if (data.type === 'document-changed' && data.document === this.id && data.revision !== this.revision) this.refresh();
        };
        socket.onerror = () => socket.close();
        socket.onclose = () => {
            this.message(this.dirty ? 'Disconnected — unsaved changes kept locally' : 'Live connection lost — reconnecting');
            this.reconnectDelay = Math.min((this.reconnectDelay || 500) * 2, 30000);
            this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
        };
    }
}

if (typeof module !== "undefined") module.exports = { DocumentSync };
