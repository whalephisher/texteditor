const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

// Serialize reads and writes per document, including revision checks.
function createDocumentStore(files, onSave = () => {}) {
    const queues = new Map();
    function enqueue(id, operation) {
        const pending = (queues.get(id) || Promise.resolve()).then(operation);
        queues.set(id, pending.catch(() => {}));
        return pending;
    }
    async function read(id) {
        const config = files[id];
        if (!config) throw new Error('Unknown document');
        let raw;
        try { raw = await fs.readFile(config.path, 'utf8'); }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            raw = config.rich ? '{"ops":[]}' : '';
        }
        return {
            content: config.rich ? JSON.parse(raw) : raw,
            revision: createHash('sha256').update(raw).digest('hex'),
        };
    }
    return {
        read: id => enqueue(id, () => read(id)),
        save: (id, content, revision) => enqueue(id, async () => {
            const current = await read(id);
            if (revision !== current.revision) return { conflict: true, ...current };
            const config = files[id];
            const raw = config.rich ? JSON.stringify(content) : content;
            const temporary = path.join(path.dirname(config.path), `.${path.basename(config.path)}.${randomUUID()}.tmp`);
            try {
                await fs.writeFile(temporary, raw, 'utf8');
                await fs.rename(temporary, config.path);
            } finally {
                await fs.rm(temporary, { force: true });
            }
            const result = { content, revision: createHash('sha256').update(raw).digest('hex') };
            onSave(id, result.revision);
            return result;
        }),
    };
}
module.exports = { createDocumentStore };
