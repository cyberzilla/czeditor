// CZEditor Filesystem Module — File System Access API
const CZFS = (() => {
    'use strict';

    let directoryHandle = null;
    let currentTree = [];

    // ===== IndexedDB for FileSystemHandle persistence =====
    const IDB_NAME = 'czeditor_fs';
    const IDB_VERSION = 1;
    const IDB_STORE = 'handles';
    const IDB_RECENT = 'recent_folders';

    function openIDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
                if (!db.objectStoreNames.contains(IDB_RECENT)) {
                    db.createObjectStore(IDB_RECENT, { keyPath: 'name' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbPut(storeName, key, value) {
        const db = await openIDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            // If store has keyPath (inline keys), don't pass external key
            const req = store.keyPath ? store.put(value) : store.put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => db.close();
        });
    }

    async function idbGet(storeName, key) {
        const db = await openIDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => db.close();
        });
    }

    async function idbGetAll(storeName) {
        const db = await openIDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => db.close();
        });
    }

    async function idbDelete(storeName, key) {
        const db = await openIDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => db.close();
        });
    }

    // Save current directory handle for persistence
    async function saveCurrentHandle() {
        if (!directoryHandle) return;
        try {
            await idbPut(IDB_STORE, 'current_dir', directoryHandle);
            // Add to recent folders
            await idbPut(IDB_RECENT, directoryHandle.name, {
                name: directoryHandle.name,
                handle: directoryHandle,
                timestamp: Date.now()
            });
        } catch (e) {
            console.warn('[CZFS] Failed to persist handle:', e.message);
        }
    }

    // Restore last opened folder on page load
    async function restoreLastFolder() {
        try {
            const handle = await idbGet(IDB_STORE, 'current_dir');
            if (!handle) return null;
            // Verify permission (will show prompt if needed)
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                directoryHandle = handle;
                currentTree = await readDirectoryTree(handle, 0);
                return { handle, tree: currentTree, name: handle.name };
            }
            // Permission not granted yet — needs user gesture to request
            // Store it for later re-request
            directoryHandle = handle;
            return { handle, tree: null, name: handle.name, needsPermission: true };
        } catch (e) {
            console.warn('[CZFS] Restore failed:', e.message);
            return null;
        }
    }

    // Request permission for a stored handle (must be called from user gesture)
    async function requestPermission(handle) {
        try {
            const perm = await handle.requestPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                directoryHandle = handle;
                currentTree = await readDirectoryTree(handle, 0);
                await saveCurrentHandle();
                return { handle, tree: currentTree, name: handle.name };
            }
            return null;
        } catch (e) {
            console.warn('[CZFS] Permission request failed:', e.message);
            return null;
        }
    }

    // Get recent folders list
    async function getRecentFolders() {
        try {
            const all = await idbGetAll(IDB_RECENT);
            return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
        } catch (e) {
            return [];
        }
    }

    // Remove a recent folder
    async function removeRecentFolder(name) {
        try {
            await idbDelete(IDB_RECENT, name);
        } catch (e) { /* ignore */ }
    }

    // Clear current folder (close project)
    async function clearFolder() {
        directoryHandle = null;
        currentTree = [];
        try {
            await idbDelete(IDB_STORE, 'current_dir');
        } catch (e) { /* ignore */ }
    }

    // Settings with defaults
    const SETTINGS_KEY = 'cz_fs_settings';
    let settings = {
        maxDepth: 10,
        excludePatterns: ['.git', 'node_modules', '.idea', '__pycache__', '.DS_Store', 'Thumbs.db']
    };

    function loadSettings() {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.maxDepth !== undefined) settings.maxDepth = parsed.maxDepth;
                if (parsed.excludePatterns !== undefined) settings.excludePatterns = parsed.excludePatterns;
            }
        } catch (e) { /* ignore */ }
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function getSettings() { return { ...settings }; }

    function updateSettings(newSettings) {
        if (newSettings.maxDepth !== undefined) settings.maxDepth = Math.max(1, Math.min(50, newSettings.maxDepth));
        if (newSettings.excludePatterns !== undefined) settings.excludePatterns = newSettings.excludePatterns;
        saveSettings();
    }

    function isSupported() {
        return 'showDirectoryPicker' in window && 'showOpenFilePicker' in window;
    }

    function getDirectoryHandle() { return directoryHandle; }
    function getCurrentTree() { return currentTree; }

    // ===== OPEN FOLDER =====
    async function openFolder() {
        if (!isSupported()) {
            throw new Error('File System Access API not supported');
        }
        try {
            directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            currentTree = await readDirectoryTree(directoryHandle, 0);
            await saveCurrentHandle();
            return { handle: directoryHandle, tree: currentTree, name: directoryHandle.name };
        } catch (e) {
            if (e.name === 'AbortError') return null; // User cancelled
            throw e;
        }
    }

    // ===== READ DIRECTORY TREE =====
    async function readDirectoryTree(dirHandle, depth) {
        if (depth >= settings.maxDepth) return [];

        const entries = [];
        try {
            for await (const [name, handle] of dirHandle.entries()) {
                // Apply exclude filter
                if (settings.excludePatterns.some(p => {
                    if (p.startsWith('*.')) return name.endsWith(p.substring(1));
                    return name === p;
                })) continue;

                if (handle.kind === 'directory') {
                    const children = await readDirectoryTree(handle, depth + 1);
                    entries.push({
                        name,
                        kind: 'directory',
                        handle,
                        children,
                        expanded: depth < 1 // Auto-expand first level
                    });
                } else {
                    entries.push({
                        name,
                        kind: 'file',
                        handle
                    });
                }
            }
        } catch (e) {
            console.warn('[CZFS] Failed to read directory:', e.message);
        }

        // Sort: folders first, then files, alphabetical within each
        entries.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        return entries;
    }

    // ===== REFRESH TREE =====
    async function refreshTree() {
        if (!directoryHandle) return null;
        try {
            // Verify we still have permission
            const perm = await directoryHandle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                const req = await directoryHandle.requestPermission({ mode: 'readwrite' });
                if (req !== 'granted') return null;
            }
            currentTree = await readDirectoryTree(directoryHandle, 0);
            return currentTree;
        } catch (e) {
            console.warn('[CZFS] Refresh failed:', e.message);
            return null;
        }
    }

    // ===== READ FILE =====
    async function readFile(fileHandle) {
        const file = await fileHandle.getFile();
        // Read as ArrayBuffer for encoding detection
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        let encoding = 'UTF-8', bomLen = 0;
        if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) { encoding = 'UTF-8 BOM'; bomLen = 3; }
        else if (bytes[0] === 0xFF && bytes[1] === 0xFE) { encoding = 'UTF-16 LE BOM'; bomLen = 2; }
        else if (bytes[0] === 0xFE && bytes[1] === 0xFF) { encoding = 'UTF-16 BE BOM'; bomLen = 2; }
        else {
            let isAscii = true;
            for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
                if (bytes[i] > 127) { isAscii = false; break; }
            }
            if (!isAscii) {
                let isUTF8 = true;
                for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
                    if (bytes[i] > 127) {
                        const len = bytes[i] >= 0xF0 ? 4 : bytes[i] >= 0xE0 ? 3 : bytes[i] >= 0xC0 ? 2 : 0;
                        if (len === 0) { isUTF8 = false; break; }
                        for (let j = 1; j < len; j++) {
                            if ((bytes[i + j] & 0xC0) !== 0x80) { isUTF8 = false; break; }
                        }
                        if (!isUTF8) break;
                        i += len - 1;
                    }
                }
                if (!isUTF8) encoding = 'ANSI';
            }
        }

        // Read as text
        let content = await file.text();

        // Detect EOL
        let eol = 'LF';
        if (content.includes('\r\n')) eol = 'CRLF';
        else if (content.includes('\r')) eol = 'CR';

        // Normalize to LF internally
        content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        return { content, encoding, eol, name: file.name };
    }

    // ===== SAVE FILE (direct to disk) =====
    async function saveFile(fileHandle, content, encoding, eol) {
        // Apply EOL conversion
        let output = content;
        if (eol === 'CRLF') output = output.replace(/\n/g, '\r\n');
        else if (eol === 'CR') output = output.replace(/\n/g, '\r');

        // Build blob parts with optional BOM
        let blobParts;
        if (encoding === 'UTF-8 BOM') {
            const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
            blobParts = [bom, output];
        } else if (encoding === 'UTF-16 LE BOM') {
            const bom = new Uint8Array([0xFF, 0xFE]);
            const buf = new ArrayBuffer(output.length * 2);
            const view = new Uint16Array(buf);
            for (let i = 0; i < output.length; i++) view[i] = output.charCodeAt(i);
            blobParts = [bom, new Uint8Array(buf)];
        } else if (encoding === 'UTF-16 BE BOM') {
            const bom = new Uint8Array([0xFE, 0xFF]);
            const buf = new Uint8Array(output.length * 2);
            for (let i = 0; i < output.length; i++) {
                const code = output.charCodeAt(i);
                buf[i * 2] = (code >> 8) & 0xFF;
                buf[i * 2 + 1] = code & 0xFF;
            }
            blobParts = [bom, buf];
        } else {
            blobParts = [output];
        }

        try {
            const writable = await fileHandle.createWritable();
            const blob = new Blob(blobParts, { type: 'application/octet-stream' });
            await writable.write(blob);
            await writable.close();
            return true;
        } catch (e) {
            console.error('[CZFS] Save failed:', e);
            return false;
        }
    }

    // ===== SAVE FILE WITH PICKER (no existing handle) =====
    async function saveFileAs(fileName, content, encoding, eol) {
        if (!isSupported()) return false;
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                    description: 'All Files',
                    accept: { 'application/octet-stream': [] }
                }]
            });
            const ok = await saveFile(handle, content, encoding, eol);
            return ok ? handle : null;
        } catch (e) {
            if (e.name === 'AbortError') return null;
            console.error('[CZFS] SaveAs failed:', e);
            return null;
        }
    }

    // ===== OPEN FILE WITH PICKER =====
    async function openFilePicker() {
        if (!isSupported()) return null;
        try {
            const handles = await window.showOpenFilePicker({ multiple: true });
            const results = [];
            for (const handle of handles) {
                const data = await readFile(handle);
                results.push({ ...data, handle });
            }
            return results;
        } catch (e) {
            if (e.name === 'AbortError') return null;
            throw e;
        }
    }

    // ===== FOLDER OPERATIONS =====
    async function createFile(parentHandle, fileName) {
        try {
            const fileHandle = await parentHandle.getFileHandle(fileName, { create: true });
            // Write empty content
            const writable = await fileHandle.createWritable();
            await writable.write('');
            await writable.close();
            return fileHandle;
        } catch (e) {
            console.error('[CZFS] Create file failed:', e);
            return null;
        }
    }

    async function createFolder(parentHandle, folderName) {
        try {
            return await parentHandle.getDirectoryHandle(folderName, { create: true });
        } catch (e) {
            console.error('[CZFS] Create folder failed:', e);
            return null;
        }
    }

    async function deleteEntry(parentHandle, entryName, isDirectory) {
        try {
            await parentHandle.removeEntry(entryName, { recursive: isDirectory });
            return true;
        } catch (e) {
            console.error('[CZFS] Delete failed:', e);
            return false;
        }
    }

    async function renameEntry(parentHandle, oldName, newName, isDirectory) {
        try {
            // File System Access API doesn't have a native rename
            // We need to copy content and delete old entry
            if (isDirectory) {
                // For directories, create new, copy contents recursively, delete old
                const oldDirHandle = await parentHandle.getDirectoryHandle(oldName);
                const newDirHandle = await parentHandle.getDirectoryHandle(newName, { create: true });
                await copyDirectoryContents(oldDirHandle, newDirHandle);
                await parentHandle.removeEntry(oldName, { recursive: true });
                return newDirHandle;
            } else {
                const oldFileHandle = await parentHandle.getFileHandle(oldName);
                const file = await oldFileHandle.getFile();
                const content = await file.arrayBuffer();
                const newFileHandle = await parentHandle.getFileHandle(newName, { create: true });
                const writable = await newFileHandle.createWritable();
                await writable.write(content);
                await writable.close();
                await parentHandle.removeEntry(oldName);
                return newFileHandle;
            }
        } catch (e) {
            console.error('[CZFS] Rename failed:', e);
            return null;
        }
    }

    async function copyDirectoryContents(srcHandle, destHandle) {
        for await (const [name, handle] of srcHandle.entries()) {
            if (handle.kind === 'file') {
                const file = await handle.getFile();
                const content = await file.arrayBuffer();
                const newFile = await destHandle.getFileHandle(name, { create: true });
                const writable = await newFile.createWritable();
                await writable.write(content);
                await writable.close();
            } else {
                const newDir = await destHandle.getDirectoryHandle(name, { create: true });
                await copyDirectoryContents(handle, newDir);
            }
        }
    }

    // ===== RESOLVE PATH =====
    // Get relative path from root to a file handle
    async function resolvePath(fileHandle) {
        if (!directoryHandle) return null;
        try {
            const path = await directoryHandle.resolve(fileHandle);
            return path ? path.join('/') : null;
        } catch (e) {
            return null;
        }
    }

    // Initialize settings on load
    loadSettings();

    return {
        isSupported,
        openFolder,
        openFilePicker,
        readFile,
        saveFile,
        saveFileAs,
        refreshTree,
        readDirectoryTree,
        getDirectoryHandle,
        getCurrentTree,
        createFile,
        createFolder,
        deleteEntry,
        renameEntry,
        resolvePath,
        getSettings,
        updateSettings,
        loadSettings,
        // Persistence
        restoreLastFolder,
        requestPermission,
        getRecentFolders,
        removeRecentFolder,
        clearFolder,
        saveCurrentHandle
    };
})();
