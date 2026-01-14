// File share JavaScript functionality
document.addEventListener('DOMContentLoaded', () => {
    const picker = document.getElementById("picker");
    const uploadBtn = document.getElementById("upload");
    const refreshBtn = document.getElementById("refresh");
    const downloadAllBtn = document.getElementById("downloadAll");
    const downloadZipBtn = document.getElementById("downloadZip");
    const deleteAllBtn = document.getElementById("deleteAll");
    const list = document.getElementById("list");
    const dropzone = document.getElementById("dropzone");

    // Navigation handlers
    document.getElementById('toEditor').addEventListener('click', function (e) {
        e.preventDefault();
        document.body.classList.add('slide-right');
        setTimeout(() => {
            window.location.href = this.href;
        }, 200);
    });

    document.getElementById('toRich').addEventListener('click', function (e) {
        e.preventDefault();
        document.body.classList.add('slide-left');
        setTimeout(() => {
            window.location.href = this.href;
        }, 200);
    });

    // Upload functionality
    uploadBtn.addEventListener("click", () => picker.click());
    dropzone.addEventListener("click", () => picker.click());
    dropzone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            picker.click();
        }
    });

    picker.addEventListener("change", async () => {
        if (!picker.files.length) return; // user canceled
        const form = new FormData();
        for (const f of picker.files) form.append("files", f, f.name);
        const prev = uploadBtn.textContent;
        uploadBtn.disabled = true;
        uploadBtn.textContent = "Uploading…";
        try {
            const res = await fetch("/files/upload", {
                method: "POST",
                body: form,
            });
            if (!res.ok) throw new Error("upload failed");
            await res.json();
            picker.value = "";
            await refresh();
        } catch (e) {
            alert("Upload failed");
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.textContent = prev;
        }
    });

    refreshBtn.addEventListener("click", refresh);
    downloadAllBtn.addEventListener("click", async () => {
        const prev = downloadAllBtn.textContent;
        downloadAllBtn.disabled = true;
        downloadAllBtn.textContent = "Starting…";
        try {
            const files = await fetchFilesList();
            if (!files.length) {
                alert("No files to download");
                return;
            }
            for (const f of files) {
                const a = document.createElement("a");
                a.href = `/files/${encodeURI(f.name)}`;
                a.download = f.name;
                a.style.display = "none";
                document.body.appendChild(a);
                a.click();
                a.remove();
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        } catch (err) {
            alert("Download failed");
        } finally {
            downloadAllBtn.disabled = false;
            downloadAllBtn.textContent = prev;
        }
    });

    downloadZipBtn.addEventListener("click", async () => {
        const prev = downloadZipBtn.textContent;
        downloadZipBtn.disabled = true;
        downloadZipBtn.textContent = "Preparing…";
        try {
            const files = await fetchFilesList();
            if (!files.length) {
                alert("No files to download");
                return;
            }
            const link = document.createElement("a");
            link.href = "/files.zip";
            link.download = "shared-files.zip";
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            alert("Zip download failed");
        } finally {
            downloadZipBtn.disabled = false;
            downloadZipBtn.textContent = prev;
        }
    });

    let deleteAllConfirmTimeout = null;
    deleteAllBtn.addEventListener("click", async () => {
        const isConfirming = deleteAllBtn.dataset.confirming === "true";
        if (!isConfirming) {
            deleteAllBtn.dataset.confirming = "true";
            deleteAllBtn.textContent = "Confirm delete all?";
            deleteAllBtn.classList.add("danger");
            deleteAllBtn.classList.remove("secondary");
            deleteAllConfirmTimeout = setTimeout(() => {
                resetDeleteAllButton();
                deleteAllConfirmTimeout = null;
            }, 4000);
            return;
        }
        deleteAllBtn.disabled = true;
        deleteAllBtn.textContent = "Deleting…";
        if (deleteAllConfirmTimeout) {
            clearTimeout(deleteAllConfirmTimeout);
            deleteAllConfirmTimeout = null;
        }
        try {
            const res = await fetch("/files", { method: "DELETE" });
            if (!res.ok) throw new Error("delete failed");
            await refresh();
        } catch (err) {
            alert("Delete all failed");
        } finally {
            resetDeleteAllButton();
        }
    });

    // --- Drag & Drop (supports folders) ---
    ["dragenter", "dragover"].forEach((evt) =>
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add("hover");
        })
    );
    ["dragleave", "drop"].forEach((evt) =>
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove("hover");
        })
    );

    dropzone.addEventListener("drop", async (e) => {
        const items = [...(e.dataTransfer?.items || [])];
        if (!items.length) return;
        const files = [];
        const paths = [];

        async function traverseEntry(entry, prefix = "") {
            return new Promise((resolve, reject) => {
                if (entry.isFile) {
                    entry.file((file) => {
                        files.push(file);
                        paths.push(prefix + entry.name);
                        resolve();
                    }, reject);
                } else if (entry.isDirectory) {
                    const reader = entry.createReader();
                    const relPrefix = prefix + entry.name + "/";
                    reader.readEntries(async (ents) => {
                        for (const ent of ents) {
                            await traverseEntry(ent, relPrefix);
                        }
                        resolve();
                    }, reject);
                } else {
                    resolve();
                }
            });
        }

        // Prefer entries API for folders, fallback to files
        const entryPromises = [];
        for (const item of items) {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (entry) entryPromises.push(traverseEntry(entry));
        }
        if (entryPromises.length) {
            const prev = uploadBtn.textContent;
            uploadBtn.disabled = true;
            uploadBtn.textContent = "Uploading…";
            try {
                await Promise.all(entryPromises);
                const form = new FormData();
                files.forEach((f, i) => {
                    form.append("files", f, f.name);
                    form.append("paths", paths[i]);
                });
                const res = await fetch("/files/upload", {
                    method: "POST",
                    body: form,
                });
                if (!res.ok) throw new Error("upload failed");
                await res.json();
                await refresh();
            } catch (err) {
                alert("Upload failed");
            } finally {
                uploadBtn.disabled = false;
                uploadBtn.textContent = prev;
            }
            return;
        }

        // Fallback: simple files (no folders)
        const dtFiles = [...(e.dataTransfer?.files || [])];
        if (dtFiles.length) {
            const prev = uploadBtn.textContent;
            uploadBtn.disabled = true;
            uploadBtn.textContent = "Uploading…";
            try {
                const form = new FormData();
                dtFiles.forEach((f) => form.append("files", f, f.name));
                const res = await fetch("/files/upload", {
                    method: "POST",
                    body: form,
                });
                if (!res.ok) throw new Error("upload failed");
                await res.json();
                await refresh();
            } catch (err) {
                alert("Upload failed");
            } finally {
                uploadBtn.disabled = false;
                uploadBtn.textContent = prev;
            }
        }
    });

    async function fetchFilesList() {
        const res = await fetch("/files");
        const files = await res.json();
        if (!Array.isArray(files)) throw new Error("bad response");
        return files;
    }

    function resetDeleteAllButton() {
        if (deleteAllBtn) {
            deleteAllBtn.dataset.confirming = "false";
            deleteAllBtn.disabled = false;
            deleteAllBtn.textContent = "Delete all";
            deleteAllBtn.classList.remove("danger");
            if (!deleteAllBtn.classList.contains("secondary")) {
                deleteAllBtn.classList.add("secondary");
            }
        }
    }

    async function refresh() {
        list.textContent = "Loading…";
        try {
            resetDeleteAllButton();
            const files = await fetchFilesList();
            list.innerHTML = "";
            if (!files.length) {
                const div = document.createElement("div");
                div.className = "empty";
                div.textContent =
                    "No shared files yet. Upload some to get started.";
                list.appendChild(div);
                return;
            }
            for (const f of files) {
                const item = document.createElement("div");
                item.className = "file-item";
                const left = document.createElement("div");
                const name = document.createElement("div");
                name.className = "file-name";
                name.textContent = f.name;
                const meta = document.createElement("div");
                meta.className = "file-meta";
                const sizeKB = (f.size / 1024).toFixed(1);
                const date = new Date(f.mtimeMs);
                meta.textContent = `${sizeKB} KB • ${date.toLocaleString()}`;
                left.appendChild(name);
                left.appendChild(meta);
                const right = document.createElement("div");

                // Inline delete confirmation state
                let confirming = false;
                let cancelBtn = null;
                const link = document.createElement("a");
                link.href = `/files/${encodeURI(f.name)}`;
                link.className = "download";
                link.download = f.name;
                const btn = document.createElement("button");
                btn.textContent = "Download";
                link.appendChild(btn);
                right.appendChild(link);

                const del = document.createElement("button");
                del.className = "secondary";
                del.style.marginLeft = "8px";
                del.textContent = "Delete";

                // Inline confirmation logic
                del.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (!confirming) {
                        confirming = true;
                        del.textContent = "Confirm delete?";
                        del.classList.add("danger");
                        del.classList.remove("secondary");
                        link.style.display = "none";

                        // Add cancel (X) button
                        cancelBtn = document.createElement("button");
                        cancelBtn.className = "cancel";
                        cancelBtn.innerHTML = "&#10005;"; // Unicode X
                        right.insertBefore(cancelBtn, del);

                        // Cancel logic
                        const revert = () => {
                            confirming = false;
                            del.textContent = "Delete";
                            del.classList.remove("danger");
                            del.classList.add("secondary");
                            link.style.display = "";
                            if (cancelBtn && cancelBtn.parentNode)
                                cancelBtn.parentNode.removeChild(cancelBtn);
                            document.removeEventListener("click", docHandler, true);
                            clearTimeout(timeoutId);
                        };
                        cancelBtn.addEventListener(
                            "click",
                            (evt) => {
                                evt.stopPropagation();
                                revert();
                            },
                            { once: true }
                        );
                        const docHandler = (evt) => {
                            if (!item.contains(evt.target)) revert();
                        };
                        document.addEventListener("click", docHandler, true);
                        const timeoutId = setTimeout(() => revert(), 4000);
                        del._revert = revert;
                    } else {
                        // Confirmed, do delete
                        del.disabled = true;
                        if (cancelBtn) cancelBtn.disabled = true;
                        try {
                            const res = await fetch(`/files/${encodeURI(f.name)}`, {
                                method: "DELETE",
                            });
                            if (!res.ok) throw new Error("delete failed");
                            await refresh();
                        } catch (e) {
                            alert("Delete failed");
                            del.disabled = false;
                            if (cancelBtn) cancelBtn.disabled = false;
                            if (del._revert) del._revert();
                        }
                    }
                });
                right.appendChild(del);
                item.appendChild(left);
                item.appendChild(right);
                list.appendChild(item);
            }
        } catch (e) {
            list.textContent = "Failed to load files.";
        }
    }

    // Initialize
    refresh();
});
