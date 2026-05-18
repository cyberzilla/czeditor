// CZEditor UI Module — Tabs, Files, Dialogs
const CZUI = (() => {
    const $ = id => document.getElementById(id);
    const tabsContainer = $('tabs-container'),
        langSelector = $('lang-selector'), saveStatus = $('save-status'),
        dropOverlay = $('drop-overlay'),
        welcomeScreen = $('welcome-screen'), editorBody = $('editor-body'),
        toolbarRight = $('toolbar-right'), editorFooter = $('editor-footer'),
        tabContextMenu = $('tab-context-menu'), settingsPopup = $('settings-popup'),
        fontConfigModal = $('font-config-modal'),
        sidebar = $('sidebar'), sidebarTree = $('sidebar-tree'), sidebarEmpty = $('sidebar-empty'),
        sidebarContextMenu = $('sidebar-context-menu'), explorerSettingsModal = $('explorer-settings-modal'),
        sidebarActions = $('sidebar-actions'), btnSidebarReopen = $('btn-sidebar-reopen');

    // Virtual editor instance
    const editorContainer = $('virtual-editor');
    let editorView = null; // initialized after DOM ready

    // Backward-compat shim: editingArea proxies to the hidden input
    const editingArea = {
        get value() { return editorView ? editorView.getValue() : ''; },
        set value(v) { if (editorView) editorView.setValue(v); },
        get selectionStart() { return editorView ? editorView.getCursorOffset() : 0; },
        set selectionStart(v) {
            if (!editorView) return;
            const pos = editorView.model.getPositionAt(v);
            editorView.cursor = pos;
            editorView._scheduleRender();
        },
        get selectionEnd() {
            if (!editorView) return 0;
            if (editorView.hasSelection()) {
                const r = editorView.getSelectionRange();
                if (r) return editorView.model.getOffsetAt(r.endLine, r.endCol);
            }
            return this.selectionStart;
        },
        set selectionEnd(v) { /* handled by setSelectionRange */ },
        setSelectionRange(start, end) {
            if (!editorView) return;
            const m = editorView.model;
            const startPos = m.getPositionAt(start);
            const endPos = m.getPositionAt(end);
            if (start === end) {
                editorView.cursor = startPos;
                editorView.anchor = null;
            } else {
                editorView.anchor = startPos;
                editorView.cursor = endPos;
            }
            editorView._scrollToCursor();
            editorView._scheduleRender();
        },
        get scrollTop() { return editorView ? editorView.getScrollTop() : 0; },
        set scrollTop(v) { if (editorView) editorView.setScrollTop(v); },
        get scrollLeft() { return editorView ? editorView.scrollEl.scrollLeft : 0; },
        set scrollLeft(v) { if (editorView) editorView.scrollEl.scrollLeft = v; },
        get clientHeight() { return editorView ? editorView.scrollEl.clientHeight : 0; },
        get scrollWidth() { return editorView ? editorView.scrollEl.scrollWidth : 0; },
        get offsetHeight() { return editorView ? editorView.scrollEl.offsetHeight : 0; },
        get parentElement() { return editorContainer; },
        get classList() { return editorContainer.classList; },
        get style() { return editorContainer.style; },
        focus() { if (editorView) editorView.focus(); },
        select() { /* select all via model */ },
        getBoundingClientRect() { return editorView ? editorView.scrollEl.getBoundingClientRect() : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
        addEventListener(t, fn) { if (editorView) editorView.scrollEl.addEventListener(t, fn); },
        removeEventListener(t, fn) { if (editorView) editorView.scrollEl.removeEventListener(t, fn); }
    };

    let files = [], activeFileId = null, saveTimeout = null, isDraggingTab = false;
    let targetContextTabId = null, promptCb = null, confirmCb = null;
    let currentLineCount = 0, lastBracketKey = '';
    let sidebarContextTarget = null; // {handle, parentHandle, name, kind}

    // ===== CUSTOMIZABLE FILE ICONS =====
    const ICON_STORAGE_KEY = 'cz_file_icons';
    const DEFAULT_FILE_ICONS = {
        // Code
        js: '📜', mjs: '📜', cjs: '📜', jsx: '📜',
        ts: '🔷', tsx: '🔷',
        html: '🌐', htm: '🌐',
        css: '🎨', scss: '🎨', less: '🎨',
        json: '📋', xml: '📋', yaml: '📋', yml: '📋', toml: '📋',
        md: '📝', txt: '📝', log: '📝',
        py: '🐍', rb: '💎', php: '🐘',
        java: '☕', kt: '🟣', swift: '🍎',
        c: '⚙️', cpp: '⚙️', h: '⚙️', rs: '🦀', go: '🔵',
        // Media
        png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', ico: '🖼️', webp: '🖼️', bmp: '🖼️', avif: '🖼️',
        mp3: '🎵', wav: '🎵', ogg: '🎵', flac: '🎵',
        mp4: '🎬', avi: '🎬', mkv: '🎬', webm: '🎬',
        // Archives
        zip: '📦', tar: '📦', gz: '📦', rar: '📦', '7z': '📦',
        // Shell
        sh: '💻', bat: '💻', ps1: '💻', cmd: '💻',
        // Config
        env: '🔒', gitignore: '🚫', dockerignore: '🚫',
        lock: '🔒',
        // Fonts
        woff2: '🔤', woff: '🔤', ttf: '🔤', otf: '🔤',
        // Default
        _default: '📄',
        _folder: '📁',
        _folder_open: '📂'
    };

    let fileIcons = { ...DEFAULT_FILE_ICONS };
    function loadFileIcons() {
        try {
            const saved = localStorage.getItem(ICON_STORAGE_KEY);
            if (saved) fileIcons = { ...DEFAULT_FILE_ICONS, ...JSON.parse(saved) };
        } catch (e) { /* ignore */ }
    }
    function saveFileIcons() {
        localStorage.setItem(ICON_STORAGE_KEY, JSON.stringify(fileIcons));
    }
    function getFileIcons() { return { ...fileIcons }; }
    function setFileIcons(icons) {
        fileIcons = { ...DEFAULT_FILE_ICONS, ...icons };
        saveFileIcons();
    }
    loadFileIcons();

    const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'avif']);
    const BINARY_EXTENSIONS = new Set([
        // Fonts
        'woff2', 'woff', 'ttf', 'otf', 'eot',
        // Archives
        'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz', 'jar',
        // Audio
        'mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a',
        // Video
        'mp4', 'avi', 'mkv', 'webm', 'mov', 'wmv', 'flv',
        // Documents
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
        // Executables
        'exe', 'dll', 'so', 'dylib', 'class', 'pyc', 'msi',
        // Database
        'db', 'sqlite', 'sqlite3',
        // Other binary
        'bin', 'dat', 'iso', 'img', 'o', 'obj', 'lib', 'a'
    ]);
    function isImageFile(name) {
        const ext = name.split('.').pop().toLowerCase();
        return IMAGE_EXTENSIONS.has(ext);
    }
    function isBinaryFile(name) {
        const ext = name.split('.').pop().toLowerCase();
        return BINARY_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
    }
    function isSvgFile(name) {
        return name.split('.').pop().toLowerCase() === 'svg';
    }
    function isMarkdownFile(name) {
        const ext = name.split('.').pop().toLowerCase();
        return ['md', 'markdown', 'mdown', 'mkd'].includes(ext);
    }
    function isHtmlFile(name) {
        const ext = name.split('.').pop().toLowerCase();
        return ['html', 'htm'].includes(ext);
    }
    function isPreviewableFile(f) {
        return f && !f.isImage && !f.isBinary && (f.isSvg || isSvgFile(f.name) || isMarkdownFile(f.name) || isHtmlFile(f.name) || isLottieContent(f));
    }
    function isLottieContent(f) {
        if (!f || !f.content || !f.name.endsWith('.json')) return false;
        try {
            const d = JSON.parse(f.content);
            return d && typeof d.v !== 'undefined' && typeof d.fr === 'number' && Array.isArray(d.layers);
        } catch (e) { return false; }
    }
    // Check if a fileHandle is a real FileSystemFileHandle (not a stale deserialized object)
    function isValidHandle(h) {
        return h && typeof h.getFile === 'function';
    }
    // Cross-OS filename validation — returns error i18n key or null if valid
    function validateFileName(name) {
        if (!name || !name.trim()) return 'filename_empty';
        const n = name.trim();
        // Illegal characters for Windows/macOS/Linux
        if (/[\\/:*?"<>|]/.test(n)) return 'filename_illegal_chars';
        // Control characters (0x00–0x1F)
        if (/[\x00-\x1f]/.test(n)) return 'filename_illegal_chars';
        // Windows reserved names
        if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)/i.test(n)) return 'filename_reserved';
        // Names that are only dots
        if (/^\.+$/.test(n)) return 'filename_only_dots';
        // Trailing dot or space (Windows)
        if (/[. ]$/.test(n)) return 'filename_trailing';
        // Too long (255 bytes is the common limit)
        if (n.length > 255) return 'filename_too_long';
        return null;
    }
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }
    function getBinaryIcon(name) {
        const ext = name.split('.').pop().toLowerCase();
        const iconMap = {
            // Fonts
            woff2: '🔤', woff: '🔤', ttf: '🔤', otf: '🔤', eot: '🔤',
            // Archives
            zip: '📦', tar: '📦', gz: '📦', rar: '📦', '7z': '📦', bz2: '📦', xz: '📦', jar: '📦',
            // Audio
            mp3: '🎵', wav: '🎵', ogg: '🎵', flac: '🎵', aac: '🎵', wma: '🎵', m4a: '🎵',
            // Video
            mp4: '🎬', avi: '🎬', mkv: '🎬', webm: '🎬', mov: '🎬', wmv: '🎬', flv: '🎬',
            // Documents
            pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
            // Executables
            exe: '⚙️', dll: '⚙️', so: '⚙️', msi: '⚙️',
            // Database
            db: '🗄️', sqlite: '🗄️', sqlite3: '🗄️',
            // Images
            png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', ico: '🖼️', webp: '🖼️', bmp: '🖼️', avif: '🖼️',
        };
        return iconMap[ext] || '📄';
    }

    function getFiles() { return files; }
    function setFiles(f) { files = f; }
    function getActiveId() { return activeFileId; }
    function setActiveId(id) { activeFileId = id; }
    function getEditingArea() { return editingArea; }
    function getActiveFile() { return files.find(f => f.id === activeFileId); }

    // ===== EMPTY STATE =====
    function checkEmptyState() {
        const empty = files.length === 0;
        const activeFile = getActiveFile();
        const isNonEditor = activeFile && (activeFile.isImage || activeFile.isBinary);

        welcomeScreen.classList.toggle('active', empty);
        // Don't show editor-body if active file is a binary/image
        editorBody.classList.toggle('hidden', empty || isNonEditor);
        toolbarRight.classList.toggle('hidden', empty);
        editorFooter.classList.toggle('hidden', empty);
        // Active line highlight handled by EditorView
        // Show/hide image viewer based on whether active file is a binary image
        const iv = $('image-viewer');
        if (iv) iv.classList.toggle('hidden', empty || !activeFile?.isImage);
        // Show/hide binary panel
        const bp = $('binary-file-panel');
        if (bp) bp.classList.toggle('hidden', empty || !activeFile?.isBinary);
        // Show/hide preview toggle button for SVG/MD files
        const previewBtn = $('btn-preview-toggle');
        const canPreview = !empty && isPreviewableFile(activeFile);
        if (previewBtn) previewBtn.classList.toggle('hidden', !canPreview);
        // Close preview if file is not previewable
        if (!canPreview && previewOpen) closePreview();
    }

    // ===== DIALOGS =====
    function openPrompt(title, defaultVal, opts) {
        return new Promise(resolve => {
            $('prompt-title').textContent = title;
            const inp = $('prompt-input');
            const errEl = $('prompt-validation-error');
            const okBtn = $('btn-prompt-ok');
            inp.value = defaultVal;
            errEl.textContent = '';
            inp.classList.remove('input-invalid');
            okBtn.disabled = false;

            // Live filename validation
            const doValidate = opts && opts.validateFilename;
            inp._liveValidate = doValidate ? function () {
                const err = validateFileName(inp.value);
                if (err) {
                    errEl.textContent = CZi18n.t(err);
                    inp.classList.add('input-invalid');
                    okBtn.disabled = true;
                } else {
                    errEl.textContent = '';
                    inp.classList.remove('input-invalid');
                    okBtn.disabled = false;
                }
            } : null;

            if (inp._liveValidate) {
                inp.addEventListener('input', inp._liveValidate);
            }

            $('custom-prompt-modal').classList.remove('hidden');
            inp.focus(); inp.select(); promptCb = resolve;
        });
    }
    function closePrompt(val) {
        const inp = $('prompt-input');
        // Clean up live validation listener
        if (inp._liveValidate) {
            inp.removeEventListener('input', inp._liveValidate);
            inp._liveValidate = null;
        }
        inp.classList.remove('input-invalid');
        $('prompt-validation-error').textContent = '';
        $('btn-prompt-ok').disabled = false;
        $('custom-prompt-modal').classList.add('hidden');
        if (promptCb) promptCb(val); promptCb = null;
    }
    function openConfirm(title, msg) {
        return new Promise(resolve => {
            $('confirm-title').textContent = title;
            $('confirm-message').textContent = msg;
            $('custom-confirm-modal').classList.remove('hidden');
            confirmCb = resolve;
        });
    }
    function closeConfirm(val) {
        $('custom-confirm-modal').classList.add('hidden');
        if (confirmCb) confirmCb(val); confirmCb = null;
    }
    function openAlert(title, msg) {
        $('alert-title').textContent = title;
        $('alert-message').textContent = msg;
        $('custom-alert-modal').classList.remove('hidden');
    }
    function closeAlert() { $('custom-alert-modal').classList.add('hidden'); }

    // ===== FONT =====
    function applyFontSettings() {
        const w = $('font-weight-select').value, s = parseInt($('font-size-input').value) || 15;
        const lh = Math.round(s * 1.6);
        document.documentElement.style.setProperty('--editor-font-weight', w);
        document.documentElement.style.setProperty('--editor-font-size', s + 'px');
        document.documentElement.style.setProperty('--editor-line-height', lh + 'px');
        localStorage.setItem('cz_font_weight', w);
        localStorage.setItem('cz_font_size', s);
        // Re-measure virtual editor after font change
        if (editorView) editorView.remeasure();
    }

    // ===== SAVE =====
    function saveData() {
        // Save all files — strip non-serializable and runtime-only properties
        const saveable = files.map(f => {
            const { fileHandle, dirty, ...rest } = f;
            // Strip blob: URLs (non-persistent), keep data: URLs (base64)
            if (rest.imageUrl && rest.imageUrl.startsWith('blob:')) {
                delete rest.imageUrl;
            }
            return rest;
        });
        localStorage.setItem('cz_files', JSON.stringify(saveable));
        if (activeFileId) localStorage.setItem('cz_active_id', activeFileId);
        else localStorage.removeItem('cz_active_id');
    }
    function triggerAutosave() {
        saveStatus.textContent = CZi18n.t('status_saving');
        saveStatus.className = 'save-status saving';
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            saveData();
            // Also save to disk for files with fileHandle
            const f = getActiveFile();
            if (f && f.fileHandle && f.dirty && isValidHandle(f.fileHandle)) {
                const ok = await CZFS.saveFile(f.fileHandle, f.content, f.encoding || 'UTF-8', f.eol || 'LF');
                if (ok) f.dirty = false;
            }
            saveStatus.textContent = CZi18n.t('status_saved');
            saveStatus.className = 'save-status saved';
            // Lightweight dot update — avoid full renderTabs which triggers checkEmptyState
            updateTabDirtyDot();
        }, 1200);
    }

    function updateTabDirtyDot() {
        tabsContainer.querySelectorAll('.tab').forEach(tab => {
            const id = tab.dataset.id;
            const file = files.find(f => f.id === id);
            if (!file) return;
            const nameEl = tab.querySelector('.tab-name');
            if (!nameEl) return;
            const dot = nameEl.querySelector('.tab-dot');
            if (file.dirty && !dot) {
                nameEl.insertAdjacentHTML('afterbegin', '<span class="tab-dot">●</span>');
            } else if (!file.dirty && dot) {
                dot.remove();
            }
        });
    }

    // ===== TABS =====
    function renderTabs() {
        tabsContainer.innerHTML = '';
        files.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        files.forEach(file => {
            const tab = document.createElement('div');
            tab.className = `tab ${file.id === activeFileId ? 'active' : ''}`;
            tab.dataset.id = file.id;
            tab.onclick = e => { if (!isDraggingTab && e.button !== 2) switchFile(file.id); };
            tab.ondblclick = () => { if (!isDraggingTab) renameFile(file.id); };
            const pin = file.isPinned ? '<span class="tab-pin-icon">📌</span>' : '';
            const dot = file.dirty ? '<span class="tab-dot">●</span>' : '';
            tab.innerHTML = `<span class="tab-name">${pin}${dot}${CZEngine.escapeHTML(file.name)}</span>
            <span class="tab-close" data-close="${file.id}">&times;</span>`;
            tabsContainer.appendChild(tab);
        });
        tabsContainer.querySelectorAll('.tab-close').forEach(btn => {
            btn.onclick = e => { e.stopPropagation(); closeFile(btn.dataset.close); };
        });
        checkEmptyState();
        highlightActiveInTree();
    }

    function scrollToActiveTab(instant) {
        const doScroll = () => {
            const t = tabsContainer.querySelector('.tab.active');
            if (t) tabsContainer.scrollTo({ left: t.offsetLeft - tabsContainer.clientWidth / 2 + t.clientWidth / 2, behavior: instant ? 'instant' : 'smooth' });
        };
        if (instant) doScroll();
        else setTimeout(doScroll, 10);
    }

    function setupTabDragging() {
        let isDown = false, startX, scrollLeft;
        tabsContainer.addEventListener('mousedown', e => {
            if (e.button === 2) return;
            isDown = true; isDraggingTab = false; tabsContainer.style.scrollBehavior = 'auto';
            startX = e.pageX; scrollLeft = tabsContainer.scrollLeft;
        });
        tabsContainer.addEventListener('mouseleave', () => isDown = false);
        tabsContainer.addEventListener('mouseup', () => { isDown = false; tabsContainer.style.scrollBehavior = 'smooth'; });
        tabsContainer.addEventListener('mousemove', e => {
            if (!isDown) return; e.preventDefault();
            const walk = e.pageX - startX;
            if (Math.abs(walk) > 5) isDraggingTab = true;
            tabsContainer.scrollLeft = scrollLeft - walk;
        });
        // Mouse wheel horizontal scroll
        tabsContainer.addEventListener('wheel', e => {
            if (Math.abs(e.deltaY) > 0) {
                e.preventDefault();
                tabsContainer.style.scrollBehavior = 'auto';
                tabsContainer.scrollLeft += e.deltaY;
                requestAnimationFrame(() => tabsContainer.style.scrollBehavior = 'smooth');
            }
        }, { passive: false });
    }

    // ===== FILE OPERATIONS =====
    function getNextUntitledName() {
        const used = new Set();
        files.forEach(f => {
            if (f.name === 'Untitled') used.add(1);
            else { const m = f.name.match(/^Untitled-(\d+)$/); if (m) used.add(parseInt(m[1])); }
        });
        let n = 1; while (used.has(n)) n++;
        return n === 1 ? 'Untitled' : `Untitled-${n}`;
    }

    function createNewFile() {
        const nf = {
            id: 'file_' + Math.random().toString(36).substr(2, 9),
            name: getNextUntitledName(), language: 'plaintext', content: '', isPinned: false,
            encoding: 'UTF-8', eol: 'LF'
        };
        files.push(nf); saveData(); switchFile(nf.id);
    }

    async function closeFile(id) {
        const f = files.find(x => x.id === id);
        if (!f) return;
        // Only confirm if file has unsaved changes
        if (f.dirty) {
            const ok = await openConfirm(CZi18n.t('confirm_close_title'), CZi18n.t('confirm_close_file', f.name));
            if (!ok) return;
        }
        const idx = files.findIndex(x => x.id === id);
        if (idx > -1) files.splice(idx, 1);
        if (files.length === 0) activeFileId = null;
        else if (id === activeFileId) activeFileId = (files[idx] || files[idx - 1]).id;
        saveData();
        if (files.length > 0) switchFile(activeFileId);
        else { renderTabs(); checkEmptyState(); }
    }

    async function renameFile(id) {
        const f = files.find(x => x.id === id);
        if (!f) return;
        const nn = await openPrompt("Nama File Baru:", f.name, { validateFilename: true });
        if (nn && nn.trim() && nn !== f.name) {
            const oldName = f.name;
            const newName = nn.trim();
            const err = validateFileName(newName);
            if (err) { openAlert(CZi18n.t('alert_title'), CZi18n.t(err)); return; }
            f.name = newName;
            const ext = newName.split('.').pop().toLowerCase();
            const detected = CZEngine.detectByExtension(ext);
            if (detected) f.language = detected;
            if (id === activeFileId) langSelector.value = f.language;

            // Rename on disk for project files
            if (f.fileHandle && f.parentHandle && isValidHandle(f.fileHandle)) {
                try {
                    const newHandle = await CZFS.renameEntry(f.parentHandle, oldName, newName, false);
                    if (newHandle) {
                        f.fileHandle = newHandle;
                        // Refresh sidebar tree
                        const tree = await CZFS.refreshTree();
                        if (tree) renderSidebar(tree);
                    }
                } catch (e) {
                    console.warn('[CZUI] Disk rename failed:', e.message);
                }
            }

            saveData(); renderTabs();
            // Re-show editor if this is the active file (fixes editor hiding bug)
            if (id === activeFileId) {
                editorBody.classList.remove('hidden');
            }
            updateEditorVisuals(); updateFootbar();
            CZEngine.loadLanguage(f.language).then(() => updateEditorVisuals());
        }
    }

    function switchFile(id, opts) {
        const f = files.find(x => x.id === id);
        if (!f) return;
        activeFileId = id;

        // Render tabs first (this calls checkEmptyState internally)
        renderTabs(); scrollToActiveTab(opts && opts.instant);
        highlightActiveInTree();
        localStorage.setItem('cz_active_id', activeFileId);

        const imageViewer = $('image-viewer');
        const binaryPanel = $('binary-file-panel');

        if (f.isBinary) {
            // Switching to binary — hide editor and image viewer, show binary panel
            editorBody.classList.add('hidden');
            if (imageViewer) imageViewer.classList.add('hidden');
            showBinaryPanel(f);
        } else if (f.isImage) {
            // Switching to image — hide editor and binary panel, show image viewer
            editorBody.classList.add('hidden');
            if (binaryPanel) binaryPanel.classList.add('hidden');
            showImageViewer(f);
        } else {
            // Normal code file — hide binary/image panels, keep editor-body visible
            if (imageViewer) imageViewer.classList.add('hidden');
            if (binaryPanel) binaryPanel.classList.add('hidden');
            editorBody.classList.remove('hidden');
            editingArea.value = f.content;
            langSelector.value = f.language;
            lastBracketKey = '';
            updateEditorVisuals(); updateFootbar();
            // Focus the virtual editor so user can type immediately
            if (editorView) requestAnimationFrame(() => editorView.focus());
            CZEngine.loadLanguage(f.language).then(() => updateEditorVisuals());
            // Update preview if open
            if (previewOpen) {
                if (isPreviewableFile(f)) {
                    updatePreview();
                } else {
                    closePreview();
                }
            }
        }
    }

    async function showImageViewer(f) {
        const viewer = $('image-viewer');
        if (!viewer) return;
        viewer.classList.remove('hidden');

        const img = $('image-viewer-img');
        const info = $('image-viewer-info');

        // Set image source — always create fresh blob URL
        if (img) {
            img.draggable = false; // Prevent native drag triggering drop overlay
            try {
                if (f.fileHandle) {
                    const file = await f.fileHandle.getFile();
                    img.src = URL.createObjectURL(file);
                } else if (f.imageUrl) {
                    img.src = f.imageUrl;
                } else {
                    // No handle or URL (e.g. after refresh) — show placeholder
                    img.removeAttribute('src');
                    if (info) info.textContent = f.name + ' — re-open folder to view';
                }
            } catch (e) {
                console.warn('[CZUI] Failed to load image:', e.message);
                if (f.imageUrl) img.src = f.imageUrl;
                else if (info) info.textContent = f.name + ' — re-open folder to view';
            }
            img.onload = () => {
                if (info) {
                    const dims = img.naturalWidth && img.naturalHeight
                        ? `${img.naturalWidth} × ${img.naturalHeight}px`
                        : f.name;
                    info.textContent = dims;
                }
            };
            img.onerror = () => {
                if (info) info.textContent = f.name;
            };
        }

        // NOTE: editor-body hide/show is handled by switchFile, not here
        toolbarRight.classList.remove('hidden');
        editorFooter.classList.remove('hidden');
    }

    // ===== BINARY FILE PANEL =====
    async function showBinaryPanel(f) {
        const panel = $('binary-file-panel');
        if (!panel) return;
        panel.classList.remove('hidden');

        $('binary-file-icon').textContent = getBinaryIcon(f.name);
        $('binary-file-name').textContent = f.name;

        // Get file size
        if (isValidHandle(f.fileHandle)) {
            try {
                const file = await f.fileHandle.getFile();
                $('binary-file-size').textContent = formatFileSize(file.size);
            } catch (e) {
                $('binary-file-size').textContent = '';
            }
        } else {
            $('binary-file-size').textContent = '';
        }

        toolbarRight.classList.remove('hidden');
        editorFooter.classList.remove('hidden');
    }

    async function openBinaryAsCode() {
        const f = getActiveFile();
        if (!f || !f.isBinary) return;

        try {
            if (isValidHandle(f.fileHandle)) {
                const data = await CZFS.readFile(f.fileHandle);
                f.content = data.content;
                f.encoding = data.encoding;
                f.eol = data.eol;
            }
            // Convert to normal text file
            f.isBinary = false;
            f.isImage = false;
            const extM = f.name.match(/\.([a-z0-9]+)$/i);
            f.language = extM ? (CZEngine.detectByExtension(extM[1].toLowerCase()) || 'plaintext') : 'plaintext';
            switchFile(f.id);
        } catch (e) {
            console.error('[CZUI] Failed to read binary as code:', e);
            openAlert(CZi18n.t('alert_title'), CZi18n.t('binary_open_error') || 'Failed to read file: ' + e.message);
        }
    }

    async function openBinaryExternal() {
        const f = getActiveFile();
        if (!f) return;

        try {
            if (isValidHandle(f.fileHandle)) {
                const file = await f.fileHandle.getFile();
                const url = URL.createObjectURL(file);
                const a = document.createElement('a');
                a.href = url;
                a.download = f.name;
                a.target = '_blank';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            } else {
                openAlert(CZi18n.t('alert_title'), CZi18n.t('binary_no_handle') || 'File handle not available. Re-open the folder.');
            }
        } catch (e) {
            console.error('[CZUI] Failed to open externally:', e);
            openAlert(CZi18n.t('alert_title'), 'Failed: ' + e.message);
        }
    }

    // ===== SPLIT PREVIEW PANEL =====
    let previewOpen = false;
    let previewZoom = 100;

    function togglePreview() {
        const pane = $('preview-pane');
        const handle = $('preview-resize-handle');
        const btn = $('btn-preview-toggle');
        const editorPane = pane?.parentElement?.querySelector('.editor-pane');
        const container = pane?.parentElement;
        if (!pane || !handle || !editorPane || !container) return;

        previewOpen = !previewOpen;
        // Guard: don't open preview for non-previewable files
        if (previewOpen) {
            const f = getActiveFile();
            if (!isPreviewableFile(f)) { previewOpen = false; return; }
        }
        if (previewOpen) {
            pane.classList.remove('hidden');
            handle.classList.remove('hidden');
            if (btn) { btn.textContent = '👁 Preview ✓'; btn.classList.add('active'); }
            // Calculate editor width from saved preview width or default 50%
            const savedW = localStorage.getItem('cz_preview_width');
            const handleW = handle.offsetWidth;
            let editorW;
            if (savedW) {
                editorW = container.clientWidth - parseInt(savedW) - handleW;
            } else {
                editorW = Math.floor(container.clientWidth * 0.5);
            }
            editorW = Math.max(200, editorW);
            editorPane.style.width = editorW + 'px';
            editorPane.style.flexGrow = '0';
            editorPane.style.flexShrink = '1';
            editorPane.style.flexBasis = editorW + 'px';
            // Set preview pane width explicitly (remaining space)
            const previewW = Math.max(180, container.clientWidth - editorW - handleW);
            pane.style.width = previewW + 'px';
            pane.style.flexGrow = '1';
            pane.style.flexShrink = '1';
            pane.style.flexBasis = previewW + 'px';
            // Delay preview init until browser has fully laid out the pane
            requestAnimationFrame(() => requestAnimationFrame(() => updatePreview()));
        } else {
            pane.classList.add('hidden');
            handle.classList.add('hidden');
            if (btn) { btn.textContent = '👁 Preview'; btn.classList.remove('active'); }
            // Reset editor pane to default flex
            editorPane.style.width = '';
            editorPane.style.flexGrow = '';
            editorPane.style.flexShrink = '';
            editorPane.style.flexBasis = '';
            pane.style.width = '';
            pane.style.flexGrow = '';
            pane.style.flexShrink = '';
            pane.style.flexBasis = '';
        }
    }


    function closePreview() {
        if (lottieAnim) { try { lottieAnim.destroy(); } catch (e) {} lottieAnim = null; }
        lottieLastHash = '';
        if (previewOpen) togglePreview();
    }

    let htmlPreviewDebounceTimer = null;

    function updatePreview() {
        if (!previewOpen) return;
        const f = getActiveFile();
        const content = $('preview-content');
        const title = $('preview-title');
        if (!f || !content) return;

        if (f.isSvg) {
            content.className = 'preview-content';
            if (title) title.textContent = 'SVG Preview';
            const sanitized = f.content.replace(/<script[\s\S]*?<\/script>/gi, '');
            content.innerHTML = '<div style="transform:scale(' + (previewZoom / 100) + ');transform-origin:center center;transition:transform 0.15s">' + sanitized + '</div>';
        } else if (isLottieContent(f)) {
            content.className = 'preview-content lottie-preview';
            if (title) title.textContent = 'Lottie Preview';
            // Only rebuild DOM if lottie-container doesn't exist (first render / file switch)
            if (!document.getElementById('lottie-container')) {
                content.innerHTML = '<div id="lottie-container" style="display:flex;align-items:center;justify-content:center;transform:scale(' + (previewZoom / 100) + ');transform-origin:center center;transition:transform 0.15s"></div>' +
                    '<div class="lottie-controls">' +
                    '<button class="preview-zoom-btn" id="btn-lottie-restart" title="Restart">\u27f2</button>' +
                    '<button class="preview-zoom-btn" id="btn-lottie-playpause" title="Play/Pause">\u23f8</button>' +
                    '<span class="lottie-frame-info" id="lottie-frame-info"></span>' +
                    '</div>';
            }
            loadLottieAnimation(f.content);
        } else if (isHtmlFile(f.name)) {
            content.className = 'preview-content html-preview';
            // Extract <title> from HTML content, fallback to 'HTML Preview'
            const titleMatch = f.content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const htmlTitle = titleMatch ? titleMatch[1].trim() : '';
            if (title) title.textContent = htmlTitle || 'HTML Preview';
            // Reuse existing iframe if present, otherwise create one
            let iframe = content.querySelector('.html-preview-iframe');
            if (!iframe) {
                content.innerHTML = '';
                iframe = document.createElement('iframe');
                iframe.className = 'html-preview-iframe';
                iframe.sandbox = 'allow-scripts allow-same-origin';
                iframe.setAttribute('referrerpolicy', 'no-referrer');
                iframe.setAttribute('loading', 'lazy');
                content.appendChild(iframe);
            }
            // Apply zoom via CSS transform on iframe
            iframe.style.transform = 'scale(' + (previewZoom / 100) + ')';
            iframe.style.width = (10000 / previewZoom) + '%';
            iframe.style.height = (10000 / previewZoom) + '%';
            // Write content into iframe using srcdoc for safety
            iframe.srcdoc = f.content;
        } else if (isMarkdownFile(f.name)) {
            content.className = 'preview-content markdown-preview';
            if (title) title.textContent = 'Markdown Preview';
            const html = renderMarkdown(f.content);
            content.innerHTML = '<div style="transform:scale(' + (previewZoom / 100) + ');transform-origin:top left;transition:transform 0.15s;width:' + (10000 / previewZoom) + '%">' + html + '</div>';
        } else {
            content.innerHTML = '';
        }
    }

    function setPreviewZoom(level) {
        previewZoom = Math.max(25, Math.min(300, level));
        $('preview-zoom-level').textContent = previewZoom + '%';
        // Lottie: update transform directly without destroying animation
        const lc = document.getElementById('lottie-container');
        if (lc && lottieAnim) {
            lc.style.transform = 'scale(' + (previewZoom / 100) + ')';
            return;
        }
        // HTML iframe: update transform directly without reloading srcdoc
        const iframe = $('preview-content')?.querySelector('.html-preview-iframe');
        if (iframe) {
            iframe.style.transform = 'scale(' + (previewZoom / 100) + ')';
            iframe.style.width = (10000 / previewZoom) + '%';
            iframe.style.height = (10000 / previewZoom) + '%';
            return;
        }
        updatePreview();
    }

    // ===== LOTTIE ANIMATION PLAYER =====
    let lottieAnim = null;
    let lottieLibLoaded = false;
    let lottieLastHash = '';
    let lottieDebounceTimer = null;

    function hashString(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        return h;
    }

    function loadLottieAnimation(jsonContent) {
        const container = document.getElementById('lottie-container');
        if (!container) return;

        // Skip if content hasn't changed
        const hash = hashString(jsonContent);
        if (hash === lottieLastHash && lottieAnim) return;
        lottieLastHash = hash;

        // Destroy previous animation
        if (lottieAnim) {
            try { lottieAnim.destroy(); } catch (e) {}
            lottieAnim = null;
        }

        function initLottie() {
            try {
                const animData = JSON.parse(jsonContent);

                // Set container dimensions BEFORE animation init so canvas gets correct size
                if (animData.w && animData.h) {
                    container.style.aspectRatio = animData.w + '/' + animData.h;
                    container.style.maxWidth = '100%';
                    container.style.maxHeight = '100%';
                    container.style.width = 'auto';
                    container.style.height = 'auto';
                }

                lottieAnim = lottie.loadAnimation({
                    container: container,
                    renderer: 'canvas',
                    loop: true,
                    autoplay: true,
                    animationData: animData,
                    rendererSettings: {
                        clearCanvas: true,
                        progressiveLoad: true
                    }
                });

                // Frame info — throttle to ~10fps for UI performance
                const frameInfo = document.getElementById('lottie-frame-info');
                let lastFrameUpdate = 0;
                if (frameInfo) {
                    lottieAnim.addEventListener('enterFrame', () => {
                        const now = performance.now();
                        if (now - lastFrameUpdate > 100) {
                            lastFrameUpdate = now;
                            frameInfo.textContent = Math.round(lottieAnim.currentFrame) + ' / ' + Math.round(lottieAnim.totalFrames) + ' @ ' + animData.fr + 'fps';
                        }
                    });
                }

                // Play/Pause button
                const ppBtn = document.getElementById('btn-lottie-playpause');
                if (ppBtn) {
                    ppBtn.onclick = () => {
                        if (lottieAnim.isPaused) {
                            lottieAnim.play();
                            ppBtn.textContent = '\u23f8';
                            ppBtn.title = 'Pause';
                        } else {
                            lottieAnim.pause();
                            ppBtn.textContent = '\u25b6';
                            ppBtn.title = 'Play';
                        }
                    };
                }

                // Restart button
                const restartBtn = document.getElementById('btn-lottie-restart');
                if (restartBtn) {
                    restartBtn.onclick = () => {
                        lottieAnim.goToAndPlay(0, true);
                        const ppBtn2 = document.getElementById('btn-lottie-playpause');
                        if (ppBtn2) { ppBtn2.textContent = '\u23f8'; ppBtn2.title = 'Pause'; }
                    };
                }
            } catch (e) {
                container.innerHTML = '<p style="color:var(--text-muted);text-align:center">Failed to load Lottie animation</p>';
            }
        }

        // Lazy load lottie-web from CDN
        if (lottieLibLoaded || typeof lottie !== 'undefined') {
            lottieLibLoaded = true;
            initLottie();
        } else {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';
            script.onload = () => { lottieLibLoaded = true; initLottie(); };
            script.onerror = () => {
                container.innerHTML = '<p style="color:var(--text-muted);text-align:center">Failed to load Lottie library</p>';
            };
            document.head.appendChild(script);
        }
    }

    // ===== MARKDOWN RENDERER =====
    function renderMarkdown(md) {
        // Normalize line endings
        md = md.replace(/\r\n?/g, '\n');

        // 1) Extract fenced code blocks BEFORE escaping (to preserve raw chars for ligatures + highlighting)
        const langAliases = {
            bash: 'shell', sh: 'shell', zsh: 'shell',
            ts: 'typescript', js: 'javascript',
            py: 'python', rb: 'ruby',
            cs: 'csharp', kt: 'kotlin',
            yml: 'yaml', md: 'markdown',
            htm: 'html', bat: 'batch', cmd: 'batch',
            ps1: 'powershell', psm1: 'powershell',
            '': 'text'
        };
        const codeBlocks = [];
        md = md.replace(/```(\w*)[ \t]*\n([\s\S]*?)\n?```/g, (_, lang, code) => {
            const idx = codeBlocks.length;
            const resolved = langAliases[lang] || lang || 'text';
            codeBlocks.push({ lang: resolved, code: code.trimEnd() });
            return '%%CZCB:' + idx + '%%';
        });

        // 2) Escape HTML
        let html = md
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Inline code
        html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

        // Headings
        html = html.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

        // Horizontal rules
        html = html.replace(/^(?:---+|\*\*\*+|___+)$/gm, '<hr>');

        // Blockquotes
        html = html.replace(/^&gt;\s+(.*)$/gm, '<blockquote>$1</blockquote>');
        // Merge consecutive blockquotes
        html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

        // Images
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        // Bold + italic
        html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');

        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

        // Strikethrough
        html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

        // Task lists
        html = html.replace(/^[-*+]\s+\[x\]\s+(.*)$/gm, '<li class="task"><input type="checkbox" checked disabled> $1</li>');
        html = html.replace(/^[-*+]\s+\[ \]\s+(.*)$/gm, '<li class="task"><input type="checkbox" disabled> $1</li>');

        // Unordered lists
        html = html.replace(/^[-*+]\s+(.*)$/gm, '<li>$1</li>');

        // Ordered lists — use <oli> temp tag so <ul> wrapping doesn't touch them
        html = html.replace(/^\d+\.\s+(.*)$/gm, '<oli>$1</oli>');

        // Wrap unordered <li> in <ul> FIRST (while ordered items are still <oli>)
        html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

        // THEN wrap <oli> in <ol>, convert <oli> → <li>
        html = html.replace(/((?:<oli>.*<\/oli>\n?)+)/g, (m) => {
            return '<ol>' + m.replace(/<oli>/g, '<li>').replace(/<\/oli>/g, '</li>') + '</ol>';
        });

        // Tables
        html = html.replace(/^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)*)/gm, (_, header, sep, body) => {
            const ths = header.split('|').filter(c => c.trim()).map(c => '<th>' + c.trim() + '</th>').join('');
            const rows = body.trim().split('\n').map(row => {
                const tds = row.split('|').filter(c => c.trim()).map(c => '<td>' + c.trim() + '</td>').join('');
                return '<tr>' + tds + '</tr>';
            }).join('');
            return '<table><thead><tr>' + ths + '</tr></thead><tbody>' + rows + '</tbody></table>';
        });

        // Paragraphs — wrap remaining loose text (skip code block placeholders)
        html = html.replace(/^(?!<[a-z/])(?!%%CZCB:)((?:.(?!<[a-z/]))+.)$/gm, '<p>$1</p>');

        // Clean up empty paragraphs
        html = html.replace(/<p>\s*<\/p>/g, '');

        // 3) Re-inject code blocks with syntax highlighting — LAST step to avoid paragraph corruption
        html = html.replace(/%%CZCB:(\d+)%%/g, (_, idx) => {
            const block = codeBlocks[parseInt(idx)];
            let highlighted;
            try {
                const langConfig = CZEngine.getLangConfig(block.lang);
                if (langConfig && langConfig._compiled) {
                    const tokens = CZEngine.tokenize(block.code, langConfig, block.lang);
                    highlighted = CZEngine.renderTokens(tokens);
                } else if (block.lang !== 'text' && block.lang !== 'plaintext') {
                    // Load language async, re-render only on success
                    CZEngine.loadLanguage(block.lang).then(cfg => {
                        if (cfg && previewOpen) updatePreview();
                    });
                    highlighted = CZEngine.escapeHTML(block.code);
                } else {
                    highlighted = CZEngine.escapeHTML(block.code);
                }
            } catch (e) {
                highlighted = CZEngine.escapeHTML(block.code);
            }
            return '<pre><code class="language-' + block.lang + '">' + highlighted + '</code></pre>';
        });

        // Safety: remove any unmatched placeholders
        html = html.replace(/%%CZCB:\d+%%/g, '');

        return html;
    }

    // ===== PREVIEW RESIZE HANDLE =====
    function setupPreviewResize() {
        const handle = $('preview-resize-handle');
        if (!handle) return;

        let startX, startWidth, handleW, rafId;

        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            const pane = $('preview-pane');
            const editorPane = pane?.parentElement?.querySelector('.editor-pane');
            const container = pane?.parentElement;
            if (!pane || !editorPane || !container) return;
            startX = e.clientX;
            startWidth = editorPane.offsetWidth;
            handleW = handle.offsetWidth; // cache once — avoid layout thrash
            handle.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            // Block iframe from stealing mouse events during drag
            pane.style.pointerEvents = 'none';

            function onMove(ev) {
                // Batch DOM writes to next animation frame
                cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    const dx = ev.clientX - startX;
                    const containerW = container.clientWidth;
                    const maxEditorW = containerW - handleW - 200; // min preview 200px
                    const newEditorW = Math.max(200, Math.min(startWidth + dx, maxEditorW));
                    const previewW = containerW - newEditorW - handleW;
                    editorPane.style.width = newEditorW + 'px';
                    editorPane.style.flexGrow = '0';
                    editorPane.style.flexShrink = '1';
                    editorPane.style.flexBasis = newEditorW + 'px';
                    // Preview gets exact remaining width
                    pane.style.width = previewW + 'px';
                    pane.style.flexGrow = '1';
                    pane.style.flexShrink = '1';
                    pane.style.flexBasis = previewW + 'px';
                });
            }
            function onUp() {
                cancelAnimationFrame(rafId);
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                handle.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                // Restore pointer events on preview pane
                pane.style.pointerEvents = '';
                // Persist as preview width ratio
                if (pane) localStorage.setItem('cz_preview_width', pane.offsetWidth);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    function closeFolder() {
        // Close all files that have a fileHandle from this folder
        files = files.filter(f => !f.fileHandle);
        if (files.length === 0) activeFileId = null;
        else if (!files.find(f => f.id === activeFileId)) {
            activeFileId = files[0].id;
        }
        saveData();
        // Reset sidebar
        sidebarTree.innerHTML = '';
        sidebarEmpty.style.display = 'flex';
        sidebarTree.appendChild(sidebarEmpty);
        // Clear persisted folder and folder state
        CZFS.clearFolder();
        localStorage.removeItem('cz_expanded_folders');
        localStorage.removeItem('cz_tree_html');
        // Hide sidebar action buttons
        if (sidebarActions) sidebarActions.classList.add('hidden');
        // Re-render recent folders
        renderRecentFolders();
        // Re-render
        if (files.length > 0) switchFile(activeFileId);
        else { renderTabs(); checkEmptyState(); }
    }

    async function renderRecentFolders() {
        const container = $('recent-folders');
        if (!container) return;
        container.innerHTML = '';

        const recents = await CZFS.getRecentFolders();
        if (recents.length === 0) return;

        const title = document.createElement('div');
        title.className = 'recent-folders-title';
        title.textContent = CZi18n.t('recent_folders_title') || 'Recent Folders';
        container.appendChild(title);

        recents.forEach(item => {
            const row = document.createElement('div');
            row.className = 'recent-folder-item';
            row.innerHTML = `<span class="recent-icon">📁</span><span class="recent-name">${CZEngine.escapeHTML(item.name)}</span><span class="recent-remove" title="Remove">✕</span>`;

            // Click to re-open folder
            row.onclick = async (e) => {
                if (e.target.classList.contains('recent-remove')) return;
                const result = await CZFS.requestPermission(item.handle);
                if (result) {
                    renderSidebar(result.tree, result.name);
                    if (!isSidebarOpen()) toggleSidebar();
                }
            };

            // Remove from recents
            row.querySelector('.recent-remove').onclick = async (e) => {
                e.stopPropagation();
                await CZFS.removeRecentFolder(item.name);
                renderRecentFolders();
            };

            container.appendChild(row);
        });
    }

    // ===== SIDEBAR =====
    function toggleSidebar() {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('cz_sidebar_collapsed', sidebar.classList.contains('collapsed'));
        // Re-center active tab after sidebar transition completes (200ms)
        setTimeout(() => scrollToActiveTab(false), 220);
    }

    function isSidebarOpen() {
        return !sidebar.classList.contains('collapsed');
    }

    function restoreSidebarState() {
        const collapsed = localStorage.getItem('cz_sidebar_collapsed');
        if (collapsed === 'true') sidebar.classList.add('collapsed');
        // Restore sidebar width (already applied via preload script, but ensure inline style is set)
        const savedWidth = localStorage.getItem('cz_sidebar_width');
        if (savedWidth) sidebar.style.width = savedWidth + 'px';
        // Setup resize handle drag
        setupSidebarResize();
    }

    // ===== THEME SWITCHING =====
    function setTheme(name) {
        const link = document.getElementById('cz-theme');
        if (link) link.href = 'themes/' + name + '.css';
        localStorage.setItem('cz_theme', name);
        // Update meta theme-color for browser chrome
        const meta = document.getElementById('meta-theme-color');
        if (meta) {
            const colors = { dark: '#1e1e2e', light: '#eff1f5' };
            meta.content = colors[name] || colors.dark;
        }
        // Sync the dropdown if called programmatically
        const sel = document.getElementById('theme-selector');
        if (sel && sel.value !== name) sel.value = name;
    }

    // Remove preload flash-prevention styles after sidebar is fully initialized
    function removePreloadStyles() {
        const preload = document.getElementById('cz-preload-styles');
        if (!preload) return;
        // Keep sidebar transition suppressed during preload removal
        sidebar.style.transition = 'none';
        preload.remove();
        // Clear preloaded tree marker
        delete sidebarTree.dataset.preloaded;
        // Re-enable sidebar transitions after a frame so the initial layout is stable
        requestAnimationFrame(() => {
            sidebar.style.transition = '';
        });
    }

    function setupSidebarResize() {
        const handle = $('sidebar-resize-handle');
        if (!handle) return;
        let isDragging = false, startX, startWidth;

        handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            isDragging = true;
            startX = e.clientX;
            startWidth = sidebar.getBoundingClientRect().width;
            handle.classList.add('active');
            document.body.classList.add('sidebar-resizing');
            // Disable transitions during drag for instant feedback
            sidebar.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const newWidth = startWidth + (e.clientX - startX);
            const clamped = Math.max(180, Math.min(450, newWidth));
            sidebar.style.width = clamped + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            handle.classList.remove('active');
            document.body.classList.remove('sidebar-resizing');
            sidebar.style.transition = '';
            // Save width
            localStorage.setItem('cz_sidebar_width', parseInt(sidebar.getBoundingClientRect().width));
        });
    }

    // ===== FOLDER EXPAND/COLLAPSE STATE =====
    function getExpandedPaths() {
        try {
            const raw = localStorage.getItem('cz_expanded_folders');
            return raw ? new Set(JSON.parse(raw)) : new Set();
        } catch { return new Set(); }
    }

    function saveExpandedPaths(tree, parentPath) {
        const expanded = new Set();
        function collect(nodes, prefix) {
            nodes.forEach(n => {
                if (n.kind === 'directory') {
                    const path = prefix + '/' + n.name;
                    if (n.expanded) expanded.add(path);
                    if (n.children) collect(n.children, path);
                }
            });
        }
        collect(tree, parentPath || '');
        localStorage.setItem('cz_expanded_folders', JSON.stringify([...expanded]));
    }

    function applyExpandedPaths(tree, parentPath) {
        // If no saved state exists, keep default (first level expanded)
        if (!localStorage.getItem('cz_expanded_folders')) return;
        const expanded = getExpandedPaths();
        function apply(nodes, prefix) {
            nodes.forEach(n => {
                if (n.kind === 'directory') {
                    const path = prefix + '/' + n.name;
                    n.expanded = expanded.has(path);
                    if (n.children) apply(n.children, path);
                }
            });
        }
        apply(tree, parentPath || '');
    }

    function getFileIcon(name) {
        const ext = name.split('.').pop().toLowerCase();
        return fileIcons[ext] || fileIcons._default || '📄';
    }

    function renderSidebar(tree, folderName) {
        sidebarEmpty.style.display = 'none';

        if (!tree || tree.length === 0) {
            delete sidebarTree.dataset.preloaded;
            sidebarTree.innerHTML = '';
            if (!CZFS.getDirectoryHandle()) {
                sidebarEmpty.style.display = 'flex';
                sidebarTree.appendChild(sidebarEmpty);
                if (sidebarActions) sidebarActions.classList.add('hidden');
                renderRecentFolders();
            }
            return;
        }

        // Folder is open — show action buttons
        if (sidebarActions) sidebarActions.classList.remove('hidden');

        // Restore folder expand/collapse state from localStorage
        applyExpandedPaths(tree, folderName || '');

        // If tree was preloaded, skip DOM rebuild — just attach event handlers
        if (sidebarTree.dataset.preloaded) {
            delete sidebarTree.dataset.preloaded;
            attachTreeHandlers(tree, sidebarTree, 1, CZFS.getDirectoryHandle(), folderName);
            highlightActiveInTree();
            // Update cached tree HTML with current expand state
            try { localStorage.setItem('cz_tree_html', sidebarTree.innerHTML); } catch (e) { /* quota */ }
            return;
        }

        // Build new tree in a fragment to avoid flash
        const frag = document.createDocumentFragment();

        // Render folder name header
        if (folderName) {
            const header = document.createElement('div');
            header.className = 'tree-item tree-root-folder';
            header.style.fontWeight = '600';
            header.style.paddingLeft = '8px';
            header.innerHTML = `<span class="tree-icon">${fileIcons._folder_open || '📂'}</span><span class="tree-name">${CZEngine.escapeHTML(folderName)}</span>`;
            header.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                sidebarContextTarget = { handle: CZFS.getDirectoryHandle(), parentHandle: null, name: folderName, kind: 'root' };
                showSidebarContextMenu(e.pageX, e.pageY);
            };
            frag.appendChild(header);
        }

        renderTreeNodes(tree, frag, 1, CZFS.getDirectoryHandle());

        // Atomic replace — no empty-frame flash between clear and insert
        sidebarTree.replaceChildren(frag);

        highlightActiveInTree();
        // Cache tree HTML for instant pre-render on next page load
        try { localStorage.setItem('cz_tree_html', sidebarTree.innerHTML); } catch (e) { /* quota */ }
    }

    // Walk preloaded DOM tree and attach live event handlers without rebuilding DOM
    function attachTreeHandlers(treeData, container, depth, parentHandle, folderName) {
        // Attach root folder header handler
        const rootHeader = container.querySelector('.tree-root-folder');
        if (rootHeader && folderName) {
            rootHeader.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                sidebarContextTarget = { handle: CZFS.getDirectoryHandle(), parentHandle: null, name: folderName, kind: 'root' };
                showSidebarContextMenu(e.pageX, e.pageY);
            };
        }
        // Walk tree data and match to DOM nodes
        attachNodeHandlers(treeData, container, 1, parentHandle);
    }

    function attachNodeHandlers(nodes, container, depth, parentHandle) {
        // Get direct child tree-folders and tree-items (files) in order
        const folderDivs = [];
        const fileDivs = [];
        for (const child of container.children) {
            if (child.classList.contains('tree-folder')) folderDivs.push(child);
            else if (child.classList.contains('tree-item') && child.dataset.kind === 'file') fileDivs.push(child);
        }

        let fi = 0, di = 0;
        nodes.forEach(node => {
            if (node.kind === 'directory') {
                const folderDiv = folderDivs[di++];
                if (!folderDiv) return;
                const item = folderDiv.querySelector(':scope > .tree-item');
                const childrenDiv = folderDiv.querySelector(':scope > .tree-folder-children');
                if (item) {
                    // Sync expand/collapse DOM state with restored node.expanded
                    const arrowEl = item.querySelector('.folder-arrow');
                    if (arrowEl) arrowEl.classList.toggle('expanded', !!node.expanded);
                    if (childrenDiv) childrenDiv.classList.toggle('collapsed', !node.expanded);

                    item.onclick = (e) => {
                        e.stopPropagation();
                        node.expanded = !node.expanded;
                        const arrowEl = item.querySelector('.folder-arrow');
                        if (arrowEl) arrowEl.classList.toggle('expanded', node.expanded);
                        if (childrenDiv) childrenDiv.classList.toggle('collapsed', !node.expanded);
                        const tree = CZFS.getCurrentTree();
                        if (tree) saveExpandedPaths(tree, CZFS.getDirectoryHandle()?.name || '');
                        // Update cached tree HTML
                        try { localStorage.setItem('cz_tree_html', sidebarTree.innerHTML); } catch (e) { /* quota */ }
                    };
                    item.oncontextmenu = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        sidebarContextTarget = { handle: node.handle, parentHandle, name: node.name, kind: 'directory' };
                        showSidebarContextMenu(e.pageX, e.pageY);
                    };
                }
                // Recurse into children
                if (childrenDiv && node.children && node.children.length > 0) {
                    attachNodeHandlers(node.children, childrenDiv, depth + 1, node.handle);
                }
            } else {
                const item = fileDivs[fi++];
                if (!item) return;
                item.onclick = async (e) => {
                    e.stopPropagation();
                    await openFileFromTree(node.handle, node.name, parentHandle);
                };
                item.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    sidebarContextTarget = { handle: node.handle, parentHandle, name: node.name, kind: 'file' };
                    showSidebarContextMenu(e.pageX, e.pageY);
                };
                item._fileHandle = node.handle;
            }
        });
    }

    function renderTreeNodes(nodes, container, depth, parentHandle) {
        nodes.forEach(node => {
            if (node.kind === 'directory') {
                const folderDiv = document.createElement('div');
                folderDiv.className = 'tree-folder';

                const item = document.createElement('div');
                item.className = 'tree-item';
                item.style.paddingLeft = (8 + depth * 16) + 'px';
                item.dataset.name = node.name;
                item.dataset.kind = 'directory';

                const arrow = node.expanded ? '▶' : '▶';
                const arrowClass = node.expanded ? 'tree-icon folder-arrow expanded' : 'tree-icon folder-arrow';
                item.innerHTML = `<span class="${arrowClass}">${arrow}</span><span class="tree-icon">📁</span><span class="tree-name">${CZEngine.escapeHTML(node.name)}</span>`;

                item.onclick = (e) => {
                    e.stopPropagation();
                    node.expanded = !node.expanded;
                    const arrowEl = item.querySelector('.folder-arrow');
                    arrowEl.classList.toggle('expanded', node.expanded);
                    childrenDiv.classList.toggle('collapsed', !node.expanded);
                    // Persist folder state
                    const tree = CZFS.getCurrentTree();
                    if (tree) saveExpandedPaths(tree, CZFS.getDirectoryHandle()?.name || '');
                    // Update cached tree HTML
                    try { localStorage.setItem('cz_tree_html', sidebarTree.innerHTML); } catch (e) { /* quota */ }
                };

                item.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    sidebarContextTarget = { handle: node.handle, parentHandle, name: node.name, kind: 'directory' };
                    showSidebarContextMenu(e.pageX, e.pageY);
                };

                folderDiv.appendChild(item);

                const childrenDiv = document.createElement('div');
                childrenDiv.className = 'tree-folder-children' + (node.expanded ? '' : ' collapsed');
                if (node.children && node.children.length > 0) {
                    renderTreeNodes(node.children, childrenDiv, depth + 1, node.handle);
                }
                folderDiv.appendChild(childrenDiv);
                container.appendChild(folderDiv);
            } else {
                const item = document.createElement('div');
                item.className = 'tree-item';
                item.style.paddingLeft = (8 + depth * 16 + 16) + 'px';
                item.dataset.name = node.name;
                item.dataset.kind = 'file';

                const icon = getFileIcon(node.name);
                item.innerHTML = `<span class="tree-icon">${icon}</span><span class="tree-name">${CZEngine.escapeHTML(node.name)}</span>`;

                item.onclick = async (e) => {
                    e.stopPropagation();
                    await openFileFromTree(node.handle, node.name, parentHandle);
                };

                item.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    sidebarContextTarget = { handle: node.handle, parentHandle, name: node.name, kind: 'file' };
                    showSidebarContextMenu(e.pageX, e.pageY);
                };

                // Store handle ref for matching
                item._fileHandle = node.handle;
                container.appendChild(item);
            }
        });
    }

    function showSidebarContextMenu(x, y) {
        const kind = sidebarContextTarget?.kind; // 'file', 'directory', or 'root'

        // Show/hide items based on target kind
        sidebarContextMenu.querySelectorAll('[data-action]').forEach(el => {
            const action = el.dataset.action;
            let show = true;
            if (kind === 'file') {
                // Files: no "new-file", "new-folder", "close-folder"
                if (['new-file', 'new-folder', 'close-folder'].includes(action)) show = false;
            } else if (kind === 'directory') {
                // Folders: no "close-folder" (that's for root only)
                if (action === 'close-folder') show = false;
            } else if (kind === 'root') {
                // Root folder: no "rename", "delete"
                if (['rename', 'delete'].includes(action)) show = false;
            }
            el.style.display = show ? '' : 'none';
        });

        // Hide dividers adjacent to hidden items
        sidebarContextMenu.querySelectorAll('.context-menu-divider').forEach(div => {
            const prev = div.previousElementSibling;
            const next = div.nextElementSibling;
            const prevHidden = !prev || prev.style.display === 'none' || prev.classList.contains('context-menu-divider');
            const nextHidden = !next || next.style.display === 'none' || next.classList.contains('context-menu-divider');
            div.style.display = (prevHidden || nextHidden) ? 'none' : '';
        });

        // Position menu, then clamp within viewport
        sidebarContextMenu.classList.remove('hidden');
        const rect = sidebarContextMenu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let mx = x, my = y;
        if (mx + rect.width > vw - 4) mx = vw - rect.width - 4;
        if (my + rect.height > vh - 4) my = vh - rect.height - 4;
        if (mx < 4) mx = 4;
        if (my < 4) my = 4;
        sidebarContextMenu.style.left = mx + 'px';
        sidebarContextMenu.style.top = my + 'px';
    }

    async function openFileFromTree(fileHandle, fileName, parentHandle) {
        // Check if already open — match by fileHandle identity OR by fileName for folder files
        const existing = files.find(f => {
            // Exact handle identity (same session, same object)
            if (isValidHandle(f.fileHandle) && f.fileHandle === fileHandle) return true;
            // Match by name for folder-originated files (handles change after refresh)
            if (f.fromFolder && f.name === fileName) return true;
            // After page reload, fileHandle is lost/stale — match by name
            if (!isValidHandle(f.fileHandle) && f.name === fileName) return true;
            return false;
        });
        if (existing) {
            // Re-attach fresh handles
            if (fileHandle) existing.fileHandle = fileHandle;
            if (parentHandle) existing.parentHandle = parentHandle;
            switchFile(existing.id);
            return;
        }

        try {
            // Check if it's a binary file (images, fonts, archives, video, etc.)
            if (isBinaryFile(fileName)) {
                const isImg = isImageFile(fileName);
                const nf = {
                    id: 'file_' + Math.random().toString(36).substr(2, 9),
                    name: fileName,
                    language: isImg ? 'image' : 'binary',
                    content: '',
                    isPinned: false,
                    encoding: 'binary',
                    eol: 'LF',
                    fileHandle: fileHandle,
                    parentHandle: parentHandle,
                    isBinary: !isImg, // images go to image viewer, others to binary panel
                    isImage: isImg,
                    fromFolder: true
                };
                // For images, create a blob URL for the viewer
                if (isImg) {
                    const file = await fileHandle.getFile();
                    nf.imageUrl = URL.createObjectURL(file);
                }
                if (files.length === 1 && files[0].name.startsWith('Untitled') && !files[0].content && !files[0].isPinned) {
                    files[0] = { ...nf, id: files[0].id };
                    activeFileId = files[0].id;
                } else {
                    files.push(nf);
                    activeFileId = nf.id;
                }
                saveData(); switchFile(activeFileId);
                return;
            }

            // Text-based file (code, SVG, config, etc.)
            const data = await CZFS.readFile(fileHandle);
            const extM = fileName.match(/\.([a-z0-9]+)$/i);
            let lang = 'plaintext';
            if (extM) { lang = CZEngine.detectByExtension(extM[1].toLowerCase()) || CZEngine.detectLanguage(data.content); }
            else { lang = CZEngine.detectLanguage(data.content); }

            const nf = {
                id: 'file_' + Math.random().toString(36).substr(2, 9),
                name: fileName,
                language: lang,
                content: data.content,
                isPinned: false,
                encoding: data.encoding,
                eol: data.eol,
                fileHandle: fileHandle,
                parentHandle: parentHandle,
                isSvg: isSvgFile(fileName),
                fromFolder: true
            };

            // Replace empty untitled if present
            if (files.length === 1 && files[0].name.startsWith('Untitled') && !files[0].content && !files[0].isPinned) {
                files[0] = { ...nf, id: files[0].id };
                activeFileId = files[0].id;
            } else {
                files.push(nf);
                activeFileId = nf.id;
            }
            saveData();
            switchFile(activeFileId);
        } catch (e) {
            console.error('[CZUI] Failed to open file:', e);
            openAlert(CZi18n.t('alert_title'), 'Failed to open file: ' + e.message);
        }
    }

    function highlightActiveInTree() {
        if (!sidebarTree) return;
        // Skip if tree is preloaded (will be re-rendered with full data later)
        if (sidebarTree.dataset.preloaded) return;
        sidebarTree.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
        const activeFile = getActiveFile();
        if (!activeFile) return;
        // Find matching tree item by handle OR by name
        sidebarTree.querySelectorAll('.tree-item[data-kind="file"]').forEach(el => {
            if (activeFile.fileHandle && el._fileHandle === activeFile.fileHandle) {
                el.classList.add('active');
            } else if (el.dataset.name === activeFile.name) {
                el.classList.add('active');
            }
        });
    }

    // Re-attach fileHandles to open tabs after folder restore (browser refresh)
    function reattachFileHandles() {
        const tree = CZFS.getCurrentTree();
        if (!tree) return;
        function walkTree(nodes) {
            nodes.forEach(n => {
                if (n.kind === 'file') {
                    const openFile = files.find(f => f.name === n.name && !isValidHandle(f.fileHandle));
                    if (openFile) {
                        openFile.fileHandle = n.handle;
                        openFile.fromFolder = true;
                    }
                } else if (n.kind === 'directory' && n.children) {
                    walkTree(n.children);
                }
            });
        }
        walkTree(tree);
        // Refresh active tab if it's an image/binary that now has a handle
        const active = getActiveFile();
        if (active && (active.isImage || active.isBinary) && isValidHandle(active.fileHandle)) {
            switchFile(activeFileId);
        }
    }

    function collapseAllFolders() {
        const tree = CZFS.getCurrentTree();
        function collapseRecursive(nodes) {
            nodes.forEach(n => {
                if (n.kind === 'directory') {
                    n.expanded = false;
                    if (n.children) collapseRecursive(n.children);
                }
            });
        }
        collapseRecursive(tree);
        // Save empty state so all folders stay collapsed after refresh
        localStorage.setItem('cz_expanded_folders', '[]');
        renderSidebar(tree, CZFS.getDirectoryHandle()?.name);
    }

    async function executeSidebarAction(action) {
        sidebarContextMenu.classList.add('hidden');
        const target = sidebarContextTarget;
        if (!target && action !== 'new-file' && action !== 'new-folder' && action !== 'explorer-settings' && action !== 'close-folder') return;

        if (action === 'explorer-settings') {
            openExplorerSettings();
            return;
        }

        if (action === 'close-folder') {
            closeFolder();
            return;
        }

        const parentHandle = (action === 'new-file' || action === 'new-folder')
            ? (target?.kind === 'directory' ? target.handle : (target?.parentHandle || CZFS.getDirectoryHandle()))
            : target.parentHandle;

        if (action === 'new-file') {
            const name = await openPrompt(CZi18n.t('prompt_new_file_title') || 'New File', 'untitled.txt', { validateFilename: true });
            if (!name || !name.trim()) return;
            const trimmed = name.trim();
            const err = validateFileName(trimmed);
            if (err) { openAlert(CZi18n.t('alert_title'), CZi18n.t(err)); return; }
            // Check if file already exists
            try {
                await parentHandle.getFileHandle(trimmed);
                // If no error, file exists
                openAlert(CZi18n.t('alert_title'), CZi18n.t('alert_file_exists') || `File '${trimmed}' already exists in this folder.`);
                return;
            } catch { /* file doesn't exist — good */ }
            const handle = await CZFS.createFile(parentHandle, trimmed);
            if (handle) {
                await refreshSidebar();
                await openFileFromTree(handle, trimmed);
            }
        } else if (action === 'new-folder') {
            const name = await openPrompt(CZi18n.t('prompt_new_folder_title') || 'New Folder', 'new-folder', { validateFilename: true });
            if (!name || !name.trim()) return;
            const trimmed = name.trim();
            const err = validateFileName(trimmed);
            if (err) { openAlert(CZi18n.t('alert_title'), CZi18n.t(err)); return; }
            // Check if folder already exists
            try {
                await parentHandle.getDirectoryHandle(trimmed);
                openAlert(CZi18n.t('alert_title'), CZi18n.t('alert_folder_exists') || `Folder '${trimmed}' already exists.`);
                return;
            } catch { /* folder doesn't exist — good */ }
            const handle = await CZFS.createFolder(parentHandle, trimmed);
            if (handle) await refreshSidebar();
        } else if (action === 'rename') {
            const newName = await openPrompt(CZi18n.t('prompt_rename_title'), target.name, { validateFilename: true });
            if (!newName || !newName.trim() || newName === target.name) return;
            const rnErr = validateFileName(newName.trim());
            if (rnErr) { openAlert(CZi18n.t('alert_title'), CZi18n.t(rnErr)); return; }
            const result = await CZFS.renameEntry(parentHandle, target.name, newName.trim(), target.kind === 'directory');
            if (result) {
                // Update open file if it was renamed
                if (target.kind === 'file') {
                    // Match by handle identity OR by name (handles can differ after refresh)
                    const openFile = files.find(f =>
                        f.fileHandle === target.handle ||
                        (f.fromFolder && f.name === target.name)
                    );
                    if (openFile) {
                        openFile.name = newName.trim();
                        openFile.fileHandle = result;
                        openFile.parentHandle = parentHandle;
                        const ext = newName.split('.').pop().toLowerCase();
                        const detected = CZEngine.detectByExtension(ext);
                        if (detected) openFile.language = detected;
                        if (openFile.id === activeFileId) langSelector.value = openFile.language;
                        renderTabs();
                        // Re-show editor (renderTabs→checkEmptyState can hide it)
                        if (openFile.id === activeFileId && !openFile.isImage && !openFile.isBinary) {
                            editorBody.classList.remove('hidden');
                        }
                        updateEditorVisuals(); updateFootbar();
                        CZEngine.loadLanguage(openFile.language).then(() => updateEditorVisuals());
                    }
                }
                await refreshSidebar();
            }
        } else if (action === 'delete') {
            const ok = await openConfirm(
                CZi18n.t('confirm_delete_title') || 'Delete',
                CZi18n.t('confirm_delete_entry', target.name) || `Delete '${target.name}'?`
            );
            if (!ok) return;
            const success = await CZFS.deleteEntry(parentHandle, target.name, target.kind === 'directory');
            if (success) {
                // Close open file if it was deleted
                if (target.kind === 'file') {
                    const openFile = files.find(f => f.fileHandle === target.handle);
                    if (openFile) {
                        const idx = files.findIndex(x => x.id === openFile.id);
                        if (idx > -1) files.splice(idx, 1);
                        if (files.length === 0) activeFileId = null;
                        else if (openFile.id === activeFileId) activeFileId = (files[idx] || files[idx - 1]).id;
                        saveData();
                        if (files.length > 0) switchFile(activeFileId);
                        else { renderTabs(); checkEmptyState(); }
                    }
                }
                await refreshSidebar();
            }
        }
    }

    async function refreshSidebar() {
        // Save current expanded state before tree is rebuilt
        const oldTree = CZFS.getCurrentTree();
        if (oldTree) saveExpandedPaths(oldTree, CZFS.getDirectoryHandle()?.name || '');
        const tree = await CZFS.refreshTree();
        if (tree) renderSidebar(tree, CZFS.getDirectoryHandle()?.name);
    }

    function openExplorerSettings() {
        const s = CZFS.getSettings();
        $('explorer-depth-input').value = s.maxDepth;
        $('explorer-filter-input').value = s.excludePatterns.join('\n');
        explorerSettingsModal.classList.remove('hidden');
    }

    async function applyExplorerSettings() {
        const depth = parseInt($('explorer-depth-input').value) || 10;
        const filterText = $('explorer-filter-input').value;
        const patterns = filterText.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        CZFS.updateSettings({ maxDepth: depth, excludePatterns: patterns });
        explorerSettingsModal.classList.add('hidden');
        if (CZFS.getDirectoryHandle()) {
            await refreshSidebar();
        }
    }

    function processImportedFile(fileObj) {
        const name = fileObj.name;

        // Handle image files — open in image viewer
        if (isImageFile(name)) {
            // Read as data URL (base64) so it persists in localStorage across refreshes
            const reader = new FileReader();
            reader.onload = () => {
                const url = reader.result; // data:image/...;base64,...
                const nf = {
                    id: 'file_' + Math.random().toString(36).substr(2, 9),
                    name, language: 'image', content: '', isPinned: false,
                    encoding: 'binary', eol: 'LF', isImage: true, imageUrl: url
                };
                if (files.length === 1 && files[0].name.startsWith('Untitled') && !files[0].content && !files[0].isPinned) {
                    files[0] = { ...nf, id: files[0].id }; activeFileId = files[0].id;
                } else { files.push(nf); activeFileId = nf.id; }
                saveData(); switchFile(activeFileId);
            };
            reader.readAsDataURL(fileObj);
            return;
        }

        // Handle other binary files — open in binary panel
        if (isBinaryFile(name)) {
            const nf = {
                id: 'file_' + Math.random().toString(36).substr(2, 9),
                name, language: 'binary', content: '', isPinned: false,
                encoding: 'binary', eol: 'LF', isBinary: true
            };
            if (files.length === 1 && files[0].name.startsWith('Untitled') && !files[0].content && !files[0].isPinned) {
                files[0] = { ...nf, id: files[0].id }; activeFileId = files[0].id;
            } else { files.push(nf); activeFileId = nf.id; }
            saveData(); switchFile(activeFileId);
            return;
        }

        // Text file — detect BOM and encoding
        const reader = new FileReader();
        const bomReader = new FileReader();
        bomReader.onload = be => {
            const bytes = new Uint8Array(be.target.result);
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
                            for (let j = 1; j < len; j++) { if ((bytes[i + j] & 0xC0) !== 0x80) { isUTF8 = false; break; } }
                            if (!isUTF8) break;
                            i += len - 1;
                        }
                    }
                    if (!isUTF8) encoding = 'ANSI';
                }
            }
            reader.onload = e => {
                let content = e.target.result;
                let eol = 'LF';
                if (content.includes('\r\n')) eol = 'CRLF';
                else if (content.includes('\r')) eol = 'CR';
                content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

                const extM = name.match(/\.([a-z0-9]+)$/i);
                let lang = 'plaintext';
                if (extM) { lang = CZEngine.detectByExtension(extM[1].toLowerCase()) || CZEngine.detectLanguage(content); }
                else { lang = CZEngine.detectLanguage(content); }
                const nf = {
                    id: 'file_' + Math.random().toString(36).substr(2, 9),
                    name, language: lang, content, isPinned: false,
                    encoding, eol, isSvg: isSvgFile(name)
                };
                if (files.length === 1 && files[0].name.startsWith('Untitled') && !files[0].content && !files[0].isPinned) {
                    files[0] = { ...nf, id: files[0].id }; activeFileId = files[0].id;
                } else { files.push(nf); activeFileId = nf.id; }
                saveData(); switchFile(activeFileId);
            };
            reader.readAsText(fileObj);
        };
        bomReader.readAsArrayBuffer(fileObj.slice(0, 8192));
    }

    // ===== FOOTER =====
    function updateFootbar() {
        if (!activeFileId || !files.length) return;
        const f = getActiveFile();
        if (!f) return;
        // Use EditorView for cursor info (avoids expensive text.split on large files)
        if (editorView) {
            const info = editorView.getCursorInfo();
            const m = editorView.model;
            $('stat-length').textContent = CZi18n.t('stat_length', m.getTotalLength());
            $('stat-lines').textContent = CZi18n.t('stat_lines', m.getLineCount());
            $('stat-cursor').textContent = `Ln ${info.line}, Col ${info.col}`;
        }
        langSelector.value = f.language;
        $('stat-lang').textContent = langSelector.options[langSelector.selectedIndex]?.text || f.language;
        $('stat-encoding').textContent = f.encoding || 'UTF-8';
        $('stat-eol').textContent = f.eol || 'LF';
    }

    // ===== ACTIVE LINE HIGHLIGHT =====
    function updateActiveLine() {
        // Handled by EditorView — no-op
    }

    // ===== SCROLL PAST END =====
    function updateScrollPastEnd() {
        // Handled by EditorView sizer height — no-op
    }

    // ===== EDITOR VISUALS =====
    function updateEditorVisuals() {
        // Delegate to virtual editor
        if (editorView) editorView._render(true);
        // Remove preload overrides
        if (editorContainer && editorContainer.classList.contains('preload-visible')) {
            editorContainer.classList.remove('preload-visible');
        }
    }

    function checkViewportUpdate() {
        // Handled by EditorView scroll listener — no-op
    }

    // Initialize virtual editor (called once from script.js)
    function initVirtualEditor() {
        if (!editorContainer) return;
        editorView = new EditorView.View(editorContainer);
    }

    function applySearchHighlights(text, tokens, matches, currentIdx, brackets) {
        // Build character-level search class map
        const hlMap = new Uint8Array(text.length); // 0=none, 1=match
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            for (let p = m.start; p < m.end; p++) hlMap[p] = 1;
        }

        // Walk tokens and split at highlight boundaries
        let html = '';
        let pos = 0;
        const bp = brackets || [];

        for (const tok of tokens) {
            const tokEnd = pos + tok.text.length;
            let i = pos;
            while (i < tokEnd) {
                const curHL = hlMap[i];
                // Find run of same highlight state within this token
                let j = i + 1;
                while (j < tokEnd && hlMap[j] === curHL) j++;
                const slice = tok.text.substring(i - pos, j - pos);
                let escaped = CZEngine.escapeHTML(slice);
                // Bracket matching within slice
                if (bp.length === 2) {
                    const chars = [];
                    for (let k = 0; k < slice.length; k++) {
                        const gp = i + k;
                        const ec = CZEngine.escapeHTML(slice[k]);
                        if (gp === bp[0] || gp === bp[1]) {
                            chars.push('<span class="syn-bracket-match">' + ec + '</span>');
                        } else chars.push(ec);
                    }
                    escaped = chars.join('');
                }
                // Build class list
                let cls = tok.scope ? `syn-${tok.scope}` : '';
                if (curHL === 1) cls += (cls ? ' ' : '') + 'search-hl';
                if (cls) html += `<span class="${cls}">${escaped}</span>`;
                else html += escaped;
                i = j;
            }
            pos = tokEnd;
        }
        return html;
    }

    function syncScroll() {
        // EditorView handles its own scroll — no-op
    }

    function ensureCursorVisible() {
        // EditorView handles cursor visibility — no-op
    }

    function handleInput() {
        const f = getActiveFile();
        if (!f) return;
        f.content = editingArea.value;
        f.dirty = true;
        if (!f.name.includes('.') && f.language === 'plaintext') {
            const det = CZEngine.detectLanguage(editingArea.value);
            if (det !== 'plaintext') { f.language = det; langSelector.value = det; CZEngine.loadLanguage(det).then(() => updateEditorVisuals()); }
        }
        updateEditorVisuals(); triggerAutosave(); updateFootbar(); ensureCursorVisible();
        // Live preview update (SVG / Markdown / Lottie / HTML)
        if (previewOpen && isPreviewableFile(f)) {
            if (isLottieContent(f)) {
                // Debounce Lottie to avoid destroy/recreate on every keystroke
                clearTimeout(lottieDebounceTimer);
                lottieDebounceTimer = setTimeout(() => updatePreview(), 800);
            } else if (isHtmlFile(f.name)) {
                // Debounce HTML to avoid iframe reload on every keystroke
                clearTimeout(htmlPreviewDebounceTimer);
                htmlPreviewDebounceTimer = setTimeout(() => updatePreview(), 500);
            } else {
                updatePreview();
            }
        }
    }

    // ===== CONTEXT MENU =====
    async function executeMenuAction(action) {
        tabContextMenu.classList.add('hidden');
        if (!targetContextTabId) return;
        const tf = files.find(f => f.id === targetContextTabId);
        if (action === 'close') closeFile(targetContextTabId);
        else if (action === 'close-other') {
            if (!await openConfirm(CZi18n.t('confirm_close_other_title'), CZi18n.t('confirm_close_other', tf.name))) return;
            files = files.filter(f => f.id === targetContextTabId || f.isPinned);
            if (!files.find(f => f.id === activeFileId)) activeFileId = targetContextTabId;
            saveData(); switchFile(activeFileId);
        } else if (action === 'close-all') {
            if (!await openConfirm(CZi18n.t('confirm_close_all_title'), CZi18n.t('confirm_close_all'))) return;
            files = files.filter(f => f.isPinned);
            activeFileId = files.length ? files[0].id : null;
            saveData(); renderTabs(); checkEmptyState();
        } else if (action === 'pin') {
            if (tf) tf.isPinned = !tf.isPinned;
            saveData(); renderTabs(); checkEmptyState(); scrollToActiveTab();
        } else if (action === 'reload') {
            // Reload file content from disk (project files only)
            if (tf && tf.fileHandle) {
                try {
                    const file = await tf.fileHandle.getFile();
                    tf.content = await file.text();
                    tf.dirty = false;
                    saveData();
                    if (tf.id === activeFileId) {
                        // Use switchFile for proper state management
                        switchFile(tf.id);
                    } else {
                        renderTabs();
                    }
                } catch (e) {
                    openAlert(CZi18n.t('alert_title'), CZi18n.t('ctx_reload_error') || 'Failed to reload: ' + e.message);
                }
            }
        } else if (action === 'rename') renameFile(targetContextTabId);
    }

    return {
        getFiles, setFiles, getActiveId, setActiveId, getEditingArea, getActiveFile,
        checkEmptyState, renderTabs, scrollToActiveTab, setupTabDragging,
        createNewFile, closeFile, renameFile, switchFile, processImportedFile,
        saveData, triggerAutosave, applyFontSettings, updateTabDirtyDot,
        openPrompt, closePrompt, openConfirm, closeConfirm, openAlert, closeAlert,
        handleInput, updateEditorVisuals, updateFootbar, syncScroll, updateActiveLine, ensureCursorVisible, updateScrollPastEnd, checkViewportUpdate,
        executeMenuAction,
        initVirtualEditor,
        get editorView() { return editorView; },
        // Sidebar
        toggleSidebar, isSidebarOpen, restoreSidebarState, removePreloadStyles, setTheme,
        renderSidebar, refreshSidebar, collapseAllFolders, closeFolder,
        openFileFromTree, highlightActiveInTree, renderRecentFolders, reattachFileHandles,
        executeSidebarAction, openExplorerSettings, applyExplorerSettings,
        // Image / SVG / Binary
        // Preview
        isPreviewableFile, togglePreview, updatePreview, closePreview, setupPreviewResize, setPreviewZoom,
        openBinaryAsCode, openBinaryExternal,
        // Icons
        getFileIcons, setFileIcons, getFileIcon,
        get targetContextTabId() { return targetContextTabId; },
        set targetContextTabId(v) { targetContextTabId = v; },
        get lastBracketKey() { return lastBracketKey; },
        set lastBracketKey(v) { lastBracketKey = v; },
        get sidebarContextTarget() { return sidebarContextTarget; },
        $, tabContextMenu, sidebarContextMenu, settingsPopup, fontConfigModal,
        explorerSettingsModal, editingArea, langSelector, dropOverlay
    };
})();