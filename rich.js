let quill, richSync;

document.addEventListener('DOMContentLoaded', () => {
    const status = document.getElementById('richStatus');
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/png,image/jpeg,image/gif,image/webp';
    quill = new Quill('#quill-editor', {
        theme: 'snow',
        modules: { toolbar: { container: '#quill-toolbar', handlers: { image: () => picker.click() } } },
    });
    richSync = new DocumentSync('rich', {
        read: () => quill.getContents(),
        write: content => {
            const selection = quill.getSelection();
            const scroll = quill.root.scrollTop;
            // Apply a diff so remote changes participate in Quill's undo history.
            quill.updateContents(quill.getContents().diff(content), 'api');
            if (selection) {
                const index = Math.min(selection.index, Math.max(0, quill.getLength() - 1));
                quill.setSelection(index, Math.min(selection.length, quill.getLength() - 1 - index), 'silent');
            }
            quill.root.scrollTop = scroll;
        },
        editable: enabled => quill.enable(enabled),
    }, status);
    quill.on('text-change', () => richSync.changed());
    let uploading = false;
    window.addEventListener('beforeunload', event => {
        if (uploading) { event.preventDefault(); event.returnValue = ''; }
    });
    async function insertImage(file) {
        if (!file || !richSync.ready || uploading) return;
        if (file.size > 10 * 1024 * 1024) { status.textContent = 'Images must be 10 MB or smaller'; return; }
        uploading = true;
        status.textContent = 'Uploading image…';
        const data = new FormData();
        data.append('image', file);
        try {
            const response = await fetch('/images', { method: 'POST', body: data });
            if (!response.ok) throw new Error('Upload failed');
            const { url } = await response.json();
            const range = quill.getSelection(true) || { index: Math.max(0, quill.getLength() - 1) };
            quill.insertEmbed(range.index, 'image', url, 'user');
            quill.setSelection(range.index + 1, 0, 'silent');
        } catch { status.textContent = 'Image upload failed — try again'; }
        finally { uploading = false; picker.value = ''; }
    }
    picker.onchange = () => insertImage(picker.files[0]);
    quill.root.addEventListener('paste', event => {
        const items = event.clipboardData?.items || [];
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                event.preventDefault();
                event.stopImmediatePropagation();
                insertImage(item.getAsFile());
                return;
            }
        }
    }, true);
});
