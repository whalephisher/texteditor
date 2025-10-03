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

    // Load existing delta
    fetch("/rich-load")
        .then((r) => r.json())
        .then((d) => {
            try {
                quill.setContents(d);
            } catch (e) { }
        });

    // Text change handler with size protection
    quill.on("text-change", () => {
        dirty = true;
        setStatus("Editing...", true);
        clearTimeout(saveTimeout);

        // Get content and check size
        const content = quill.getContents();
        const contentString = JSON.stringify(content);

        // Prevent saving if content is too large (over 1MB)
        if (contentString.length > 1024 * 1024) {
            setStatus("Content too large - not saved", true);
            return;
        }

        saveTimeout = setTimeout(() => save(content, true), 800);
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

// Save function
function save(delta, broadcast = true) {
    setStatus("Saving...", true);
    fetch("/rich-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta }),
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