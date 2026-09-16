let monacoEditor;
let sync;
let autoDetect = true;
let langDetectTimeout;

document.addEventListener('DOMContentLoaded', () => {
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
    require(['vs/editor/editor.main'], () => {
        let preference = 'auto';
        try { preference = localStorage.getItem('editor-language') || 'auto'; } catch {}
        autoDetect = preference === 'auto';
        document.getElementById('autoDetectToggle').checked = autoDetect;
        monacoEditor = monaco.editor.create(document.getElementById('editor'), {
            value: '', language: autoDetect ? 'plaintext' : preference,
            theme: 'vs-dark', fontSize: 16, automaticLayout: true, wordWrap: 'on', readOnly: true,
        });
        if (!autoDetect) document.getElementById('languageSelector').value = preference;
        let loaded = false;
        sync = new DocumentSync('code', {
            read: () => monacoEditor.getValue(),
            write: text => {
                const model = monacoEditor.getModel();
                // Loading must work while the UI is read-only. executeEdits refuses
                // edits in that state, silently leaving a saved document blank.
                // Initial content also must not create an undo step back to empty.
                if (!loaded) {
                    model.setValue(text);
                    loaded = true;
                    detect();
                    return;
                }
                if (model.getValue() === text) return;
                const view = monacoEditor.saveViewState();
                // An undoable edit preserves undo history and the viewport.
                monacoEditor.pushUndoStop();
                model.pushEditOperations(monacoEditor.getSelections(), [{ range: model.getFullModelRange(), text }], () => null);
                monacoEditor.pushUndoStop();
                monacoEditor.restoreViewState(view);
                detect();
            },
            editable: enabled => monacoEditor.updateOptions({ readOnly: !enabled }),
        }, document.getElementById('status'));
        monacoEditor.onDidChangeModelContent(() => {
            sync.changed();
            clearTimeout(langDetectTimeout);
            if (autoDetect) langDetectTimeout = setTimeout(detect, 500);
        });
        function detect() {
            if (!autoDetect) return;
            const model = monacoEditor.getModel();
            const end = model.getPositionAt(Math.min(model.getValueLength(), 12000));
            const sample = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: end.lineNumber, endColumn: end.column });
            const language = detectLanguageFromContent(sample);
            if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
            document.getElementById('languageSelector').value = language;
        }
        function remember() {
            try { localStorage.setItem('editor-language', autoDetect ? 'auto' : document.getElementById('languageSelector').value); } catch {}
        }
        document.getElementById('autoDetectToggle').onchange = event => {
            autoDetect = event.target.checked;
            detect();
            remember();
        };
        document.getElementById('languageSelector').onchange = event => {
            autoDetect = false;
            document.getElementById('autoDetectToggle').checked = false;
            monaco.editor.setModelLanguage(monacoEditor.getModel(), event.target.value);
            remember();
        };
    });
});
