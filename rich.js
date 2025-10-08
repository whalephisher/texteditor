// Rich text editor JavaScript
let quill, statusEl, saveTimeout, dirty = false, ws;

// Initialize Quill editor
function initQuill() {
    quill = new Quill("#quill-editor", {
        theme: "snow",
        modules: {
            toolbar: "#quill-toolbar",
        },
    });

    // Completely override Quill's clipboard for images
    quill.clipboard.addMatcher('IMG', () => ({ ops: [] })); // Block default image handling

    // Custom paste handler for images only
    quill.root.addEventListener('paste', (e) => {
        const clipboardData = e.clipboardData || window.clipboardData;
        const items = clipboardData.items;

        // Check for image data
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                e.stopImmediatePropagation(); // Prevent any other handlers

                const blob = items[i].getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    const range = quill.getSelection(true) || { index: quill.getLength() };

                    // Use setTimeout to ensure Quill is ready
                    setTimeout(() => {
                        quill.insertEmbed(range.index, 'image', event.target.result);
                        quill.setSelection(range.index + 1);
                        setStatus("Image added", false);
                    }, 10);
                };
                reader.readAsDataURL(blob);
                return;
            }
        }
    }, true); // Use capture phase to intercept early

    // Load existing delta
    fetch("/rich-load")
        .then((r) => r.json())
        .then((d) => {
            try {
                quill.setContents(d);
            } catch (e) { }
        });

    // Simplified text change handler - no problematic size limits
    quill.on("text-change", (delta, oldDelta, source) => {
        if (source === 'user') {
            dirty = true;
            setStatus("Editing...", true);
            clearTimeout(saveTimeout);

            // Simple save with reasonable delay
            saveTimeout = setTimeout(() => {
                const content = quill.getContents();
                save(content, true);
            }, 1000);
        }
    });
}

// Status management
function setStatus(msg, persist = false) {
    statusEl.textContent = msg;
    if (!persist) {
        clearTimeout(setStatus._t);
        setStatus._t = setTimeout(() => {
            if (!dirty) statusEl.textContent = "";
        }, 1200);
    }
}

// Save function - fixed to handle large content properly
function save(delta, broadcast = true) {
    setStatus("Saving...", true);

    const jsonString = JSON.stringify({ delta });

    // Check actual size in MB, not characters
    const sizeInMB = new Blob([jsonString]).size / (1024 * 1024);

    if (sizeInMB > 50) { // 50MB limit
        setStatus("Content too large - not saved", true);
        return;
    }

    fetch("/rich-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: jsonString,
    })
        .then((r) => r.json())
        .then((ok) => {
            if (ok.ok) {
                dirty = false;
                setStatus("Synced");
                if (broadcast && ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "rich-delta", delta }));
                }
            } else {
                setStatus("Error");
            }
        })
        .catch(() => {
            setStatus("Error");
        });
}

// WebSocket initialization
function initWebSocket() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(
        proto + "://" + (location.host || window.location.hostname + ":3000")
    );

    ws.onmessage = (ev) => {
        let data;
        try {
            data = JSON.parse(ev.data);
        } catch {
            return;
        }
        if (data.type === "rich-delta" && data.delta) {
            quill.updateContents(data.delta);
            setStatus("Updated");
        }
    };
}

// Navigation handlers
function initNavigation() {
    document.getElementById("toEditor").addEventListener("click", function (e) {
        e.preventDefault();
        document.body.classList.add("slide-right");
        setTimeout(() => (window.location.href = this.href), 200);
    });

    document.getElementById("toShare").addEventListener("click", function (e) {
        e.preventDefault();
        document.body.classList.add("slide-left");
        setTimeout(() => (window.location.href = this.href), 200);
    });
}

// Initialize everything when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    statusEl = document.getElementById("richStatus");
    initQuill();
    initWebSocket();
    initNavigation();
});