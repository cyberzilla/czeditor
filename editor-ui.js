// CZEditor UI Module — Tabs, Files, Dialogs
const CZUI = (() => {
const $ = id => document.getElementById(id);
const tabsContainer = $('tabs-container'), editingArea = $('editing'),
    highlightingContent = $('highlighting-content'), lineNumbers = $('line-numbers'),
    langSelector = $('lang-selector'), saveStatus = $('save-status'),
    highlighting = $('highlighting'), dropOverlay = $('drop-overlay'),
    welcomeScreen = $('welcome-screen'), editorBody = $('editor-body'),
    toolbarRight = $('toolbar-right'), editorFooter = $('editor-footer'),
    tabContextMenu = $('tab-context-menu'), settingsPopup = $('settings-popup'),
    fontConfigModal = $('font-config-modal'), activeLineHL = $('active-line-highlight'),
    sidebar = $('sidebar'), sidebarTree = $('sidebar-tree'), sidebarEmpty = $('sidebar-empty'),
    sidebarContextMenu = $('sidebar-context-menu'), explorerSettingsModal = $('explorer-settings-modal');

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
function isImageFile(name) {
    const ext = name.split('.').pop().toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
}
function isSvgFile(name) {
    return name.split('.').pop().toLowerCase() === 'svg';
}
// Check if a fileHandle is a real FileSystemFileHandle (not a stale deserialized object)
function isValidHandle(h) {
    return h && typeof h.getFile === 'function';
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
    const isImageActive = activeFile && activeFile.isImage;

    welcomeScreen.classList.toggle('active', empty);
    // Don't show editor-body if active file is a binary image
    editorBody.classList.toggle('hidden', empty || isImageActive);
    toolbarRight.classList.toggle('hidden', empty);
    editorFooter.classList.toggle('hidden', empty);
    if (activeLineHL) activeLineHL.style.display = (empty || isImageActive) ? 'none' : 'block';
    // Show/hide image viewer based on whether active file is a binary image
    const iv = $('image-viewer');
    if (iv) iv.classList.toggle('hidden', empty || !isImageActive);
}

// ===== DIALOGS =====
function openPrompt(title, defaultVal) {
    return new Promise(resolve => {
        $('prompt-title').textContent = title;
        const inp = $('prompt-input'); inp.value = defaultVal;
        $('custom-prompt-modal').classList.remove('hidden');
        inp.focus(); inp.select(); promptCb = resolve;
    });
}
function closePrompt(val) {
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
    const w = $('font-weight-select').value, s = parseInt($('font-size-input').value)||15;
    const lh = Math.round(s * 1.6);
    document.documentElement.style.setProperty('--editor-font-weight', w);
    document.documentElement.style.setProperty('--editor-font-size', s+'px');
    document.documentElement.style.setProperty('--editor-line-height', lh+'px');
    localStorage.setItem('cz_font_weight', w);
    localStorage.setItem('cz_font_size', s);
}

// ===== SAVE =====
function saveData() {
    // Filter out binary image files, strip non-serializable fileHandle from all
    const saveable = files.filter(f => !f.isImage).map(f => {
        const { fileHandle, imageUrl, ...rest } = f;
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
    saveTimeout = setTimeout(() => {
        saveData(); saveStatus.textContent = CZi18n.t('status_saved');
        saveStatus.className = 'save-status saved';
    }, 800);
}

// ===== TABS =====
function renderTabs() {
    tabsContainer.innerHTML = '';
    files.sort((a,b) => (b.isPinned?1:0) - (a.isPinned?1:0));
    files.forEach(file => {
        const tab = document.createElement('div');
        tab.className = `tab ${file.id === activeFileId ? 'active' : ''}`;
        tab.dataset.id = file.id;
        tab.onclick = e => { if (!isDraggingTab && e.button !== 2) switchFile(file.id); };
        tab.ondblclick = () => { if (!isDraggingTab) renameFile(file.id); };
        const pin = file.isPinned ? '<span class="tab-pin-icon">📌</span>' : '';
        tab.innerHTML = `<span class="tab-name">${pin}${CZEngine.escapeHTML(file.name)}</span>
            <span class="tab-close" data-close="${file.id}">&times;</span>`;
        tabsContainer.appendChild(tab);
    });
    tabsContainer.querySelectorAll('.tab-close').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); closeFile(btn.dataset.close); };
    });
    checkEmptyState();
    highlightActiveInTree();
}

function scrollToActiveTab() {
    setTimeout(() => {
        const t = tabsContainer.querySelector('.tab.active');
        if (t) tabsContainer.scrollTo({ left: t.offsetLeft - tabsContainer.clientWidth/2 + t.clientWidth/2, behavior:'smooth' });
    }, 10);
}

function setupTabDragging() {
    let isDown=false, startX, scrollLeft;
    tabsContainer.addEventListener('mousedown', e => {
        if (e.button===2) return;
        isDown=true; isDraggingTab=false; tabsContainer.style.scrollBehavior='auto';
        startX=e.pageX; scrollLeft=tabsContainer.scrollLeft;
    });
    tabsContainer.addEventListener('mouseleave', () => isDown=false);
    tabsContainer.addEventListener('mouseup', () => { isDown=false; tabsContainer.style.scrollBehavior='smooth'; });
    tabsContainer.addEventListener('mousemove', e => {
        if (!isDown) return; e.preventDefault();
        const walk=e.pageX-startX;
        if (Math.abs(walk)>5) isDraggingTab=true;
        tabsContainer.scrollLeft = scrollLeft-walk;
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
        if (f.name==='Untitled') used.add(1);
        else { const m=f.name.match(/^Untitled-(\d+)$/); if(m) used.add(parseInt(m[1])); }
    });
    let n=1; while(used.has(n)) n++;
    return n===1?'Untitled':`Untitled-${n}`;
}

function createNewFile() {
    const nf = { id:'file_'+Math.random().toString(36).substr(2,9),
        name:getNextUntitledName(), language:'plaintext', content:'', isPinned:false,
        encoding:'UTF-8', eol:'LF' };
    files.push(nf); saveData(); switchFile(nf.id);
}

async function closeFile(id) {
    const f = files.find(x=>x.id===id);
    if (!f) return;
    if (f.content && f.content.length > 0) {
        const ok = await openConfirm(CZi18n.t('confirm_close_title'), CZi18n.t('confirm_close_file', f.name));
        if (!ok) return;
    }
    const idx = files.findIndex(x=>x.id===id);
    if (idx>-1) files.splice(idx,1);
    if (files.length===0) activeFileId=null;
    else if (id===activeFileId) activeFileId=(files[idx]||files[idx-1]).id;
    saveData();
    if (files.length>0) switchFile(activeFileId);
    else { renderTabs(); checkEmptyState(); }
}

async function renameFile(id) {
    const f = files.find(x=>x.id===id);
    if (!f) return;
    const nn = await openPrompt("Nama File Baru:", f.name);
    if (nn && nn.trim() && nn !== f.name) {
        f.name = nn.trim();
        const ext = nn.split('.').pop().toLowerCase();
        const detected = CZEngine.detectByExtension(ext);
        if (detected) f.language = detected;
        if (id===activeFileId) langSelector.value = f.language;
        saveData(); renderTabs(); updateEditorVisuals(); updateFootbar();
        CZEngine.loadLanguage(f.language).then(() => updateEditorVisuals());
    }
}

function switchFile(id) {
    const f = files.find(x=>x.id===id);
    if (!f) return;
    activeFileId = id;

    // Render tabs first (this calls checkEmptyState internally)
    renderTabs(); scrollToActiveTab();
    highlightActiveInTree();
    localStorage.setItem('cz_active_id', activeFileId);

    const imageViewer = $('image-viewer');
    const svgPreviewOverlay = $('svg-preview-overlay');
    const svgPreviewBtn = $('btn-svg-preview-toggle');

    // Hide all viewers first
    if (imageViewer) imageViewer.classList.add('hidden');
    if (svgPreviewOverlay) svgPreviewOverlay.classList.add('hidden');
    if (svgPreviewBtn) svgPreviewBtn.classList.add('hidden');
    editorBody.classList.add('hidden');

    if (f.isImage) {
        // Show full-tab image viewer for binary images only
        showImageViewer(f);
    } else {
        // Normal code file (including SVG) — editor-body MUST be visible
        editorBody.classList.remove('hidden');
        editingArea.value = f.content;
        langSelector.value = f.language;
        currentLineCount = 0; lastBracketKey = '';
        updateEditorVisuals(); updateFootbar();
        CZEngine.loadLanguage(f.language).then(() => updateEditorVisuals());
        // Show SVG preview toggle for SVG files
        if (f.isSvg && svgPreviewBtn) {
            svgPreviewBtn.classList.remove('hidden');
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
        try {
            if (f.fileHandle) {
                const file = await f.fileHandle.getFile();
                img.src = URL.createObjectURL(file);
            } else if (f.imageUrl) {
                img.src = f.imageUrl;
            }
        } catch (e) {
            console.warn('[CZUI] Failed to load image:', e.message);
            if (f.imageUrl) img.src = f.imageUrl;
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

// ===== SVG FLOATING PREVIEW =====
function toggleSvgPreview() {
    const overlay = $('svg-preview-overlay');
    const btn = $('btn-svg-preview-toggle');
    if (!overlay) return;

    const isOpen = !overlay.classList.contains('hidden');
    if (isOpen) {
        overlay.classList.add('hidden');
        if (btn) btn.classList.remove('active');
    } else {
        overlay.classList.remove('hidden');
        if (btn) btn.classList.add('active');
        updateSvgPreview();
    }
}

function updateSvgPreview() {
    const overlay = $('svg-preview-overlay');
    const f = getActiveFile();
    if (!overlay || !f || !f.isSvg) return;
    const previewContent = $('svg-preview-content');
    if (!previewContent) return;
    // Sanitize and render SVG
    const sanitized = f.content.replace(/<script[\s\S]*?<\/script>/gi, '');
    previewContent.innerHTML = sanitized;
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
    // Clear persisted folder
    CZFS.clearFolder();
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
}

function isSidebarOpen() {
    return !sidebar.classList.contains('collapsed');
}

function restoreSidebarState() {
    const collapsed = localStorage.getItem('cz_sidebar_collapsed');
    if (collapsed === 'true') sidebar.classList.add('collapsed');
}

function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    return fileIcons[ext] || fileIcons._default || '📄';
}

function renderSidebar(tree, folderName) {
    sidebarTree.innerHTML = '';
    sidebarEmpty.style.display = 'none';

    if (!tree || tree.length === 0) {
        if (!CZFS.getDirectoryHandle()) {
            sidebarEmpty.style.display = 'flex';
            sidebarTree.appendChild(sidebarEmpty);
            renderRecentFolders();
        }
        return;
    }

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
        sidebarTree.appendChild(header);
    }

    renderTreeNodes(tree, sidebarTree, 1, CZFS.getDirectoryHandle());
    highlightActiveInTree();
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
                await openFileFromTree(node.handle, node.name);
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
    sidebarContextMenu.style.left = x + 'px';
    sidebarContextMenu.style.top = y + 'px';
    sidebarContextMenu.classList.remove('hidden');
}

async function openFileFromTree(fileHandle, fileName) {
    // Check if already open (match by fileHandle identity OR by fileName for restored tabs)
    const existing = files.find(f => {
        if (isValidHandle(f.fileHandle) && f.fileHandle === fileHandle) return true;
        // After page reload, fileHandle is lost/stale — match by name
        if (!isValidHandle(f.fileHandle) && f.name === fileName) return true;
        return false;
    });
    if (existing) {
        // Re-attach fileHandle if missing (restored tab)
        if (!existing.fileHandle) existing.fileHandle = fileHandle;
        switchFile(existing.id);
        return;
    }

    try {
        // Check if it's a binary image file (NOT SVG — SVG is text-based)
        if (isImageFile(fileName)) {
            const file = await fileHandle.getFile();
            const url = URL.createObjectURL(file);
            const nf = {
                id: 'file_' + Math.random().toString(36).substr(2, 9),
                name: fileName,
                language: 'image',
                content: '',
                isPinned: false,
                encoding: 'binary',
                eol: 'LF',
                fileHandle: fileHandle,
                imageUrl: url,
                isImage: true
            };
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
    sidebarTree.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
    const activeFile = getActiveFile();
    if (!activeFile || !activeFile.fileHandle) return;
    // Find matching tree item
    sidebarTree.querySelectorAll('.tree-item[data-kind="file"]').forEach(el => {
        if (el._fileHandle === activeFile.fileHandle) {
            el.classList.add('active');
        }
    });
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
        const name = await openPrompt(CZi18n.t('prompt_new_file_title') || 'New File', 'untitled.txt');
        if (!name || !name.trim()) return;
        const handle = await CZFS.createFile(parentHandle, name.trim());
        if (handle) {
            await refreshSidebar();
            await openFileFromTree(handle, name.trim());
        }
    } else if (action === 'new-folder') {
        const name = await openPrompt(CZi18n.t('prompt_new_folder_title') || 'New Folder', 'new-folder');
        if (!name || !name.trim()) return;
        const handle = await CZFS.createFolder(parentHandle, name.trim());
        if (handle) await refreshSidebar();
    } else if (action === 'rename') {
        const newName = await openPrompt(CZi18n.t('prompt_rename_title'), target.name);
        if (!newName || !newName.trim() || newName === target.name) return;
        const result = await CZFS.renameEntry(parentHandle, target.name, newName.trim(), target.kind === 'directory');
        if (result) {
            // Update open file if it was renamed
            if (target.kind === 'file') {
                const openFile = files.find(f => f.fileHandle === target.handle);
                if (openFile) {
                    openFile.name = newName.trim();
                    openFile.fileHandle = result;
                    const ext = newName.split('.').pop().toLowerCase();
                    const detected = CZEngine.detectByExtension(ext);
                    if (detected) openFile.language = detected;
                    renderTabs(); updateFootbar();
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
    const reader = new FileReader();
    // Read as ArrayBuffer first to detect BOM
    const bomReader = new FileReader();
    bomReader.onload = be => {
        const bytes = new Uint8Array(be.target.result);
        let encoding = 'UTF-8', bomLen = 0;
        if (bytes[0]===0xEF && bytes[1]===0xBB && bytes[2]===0xBF) { encoding = 'UTF-8 BOM'; bomLen = 3; }
        else if (bytes[0]===0xFF && bytes[1]===0xFE) { encoding = 'UTF-16 LE BOM'; bomLen = 2; }
        else if (bytes[0]===0xFE && bytes[1]===0xFF) { encoding = 'UTF-16 BE BOM'; bomLen = 2; }
        else {
            // Heuristic: check if all bytes are < 128 (ASCII/ANSI)
            let isAscii = true;
            for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
                if (bytes[i] > 127) { isAscii = false; break; }
            }
            // Check for valid UTF-8 sequences
            if (!isAscii) {
                let isUTF8 = true;
                for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
                    if (bytes[i] > 127) {
                        const len = bytes[i]>=0xF0?4:bytes[i]>=0xE0?3:bytes[i]>=0xC0?2:0;
                        if (len===0) { isUTF8=false; break; }
                        for (let j=1;j<len;j++) { if ((bytes[i+j]&0xC0)!==0x80) { isUTF8=false; break; } }
                        if (!isUTF8) break;
                        i += len - 1;
                    }
                }
                if (!isUTF8) encoding = 'ANSI';
            }
        }
        // Now read as text
        reader.onload = e => {
            let content = e.target.result;
            // Detect EOL
            let eol = 'LF';
            if (content.includes('\r\n')) eol = 'CRLF';
            else if (content.includes('\r')) eol = 'CR';
            // Normalize to LF internally
            content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

            const extM = fileObj.name.match(/\.([a-z0-9]+)$/i);
            let lang = 'plaintext';
            if (extM) { lang = CZEngine.detectByExtension(extM[1].toLowerCase()) || CZEngine.detectLanguage(content); }
            else { lang = CZEngine.detectLanguage(content); }
            const nf = { id:'file_'+Math.random().toString(36).substr(2,9),
                name:fileObj.name, language:lang, content, isPinned:false,
                encoding, eol };
            if (files.length===1 && files[0].name.startsWith('Untitled') && !files[0].content && !files[0].isPinned) {
                files[0] = {...nf, id:files[0].id}; activeFileId=files[0].id;
            } else { files.push(nf); activeFileId=nf.id; }
            saveData(); switchFile(activeFileId);
        };
        reader.readAsText(fileObj);
    };
    bomReader.readAsArrayBuffer(fileObj.slice(0, 8192));
}

// ===== FOOTER =====
function updateFootbar() {
    if (!activeFileId || !files.length) return;
    const text = editingArea.value, pos = editingArea.selectionStart;
    const lines = text.split('\n'), before = text.substring(0,pos).split('\n');
    $('stat-length').textContent = CZi18n.t('stat_length', text.length);
    $('stat-lines').textContent = CZi18n.t('stat_lines', lines.length);
    $('stat-cursor').textContent = `Ln ${before.length}, Col ${before[before.length-1].length+1}`;
    const f = getActiveFile();
    if (f) {
        langSelector.value = f.language;
        $('stat-lang').textContent = langSelector.options[langSelector.selectedIndex]?.text || f.language;
        $('stat-encoding').textContent = f.encoding || 'UTF-8';
        $('stat-eol').textContent = f.eol || 'LF';
    }
}

// ===== ACTIVE LINE HIGHLIGHT =====
function updateActiveLine() {
    if (!activeLineHL || !activeFileId) return;
    const text = editingArea.value, pos = editingArea.selectionStart;
    const lineNum = text.substring(0,pos).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--editor-line-height')) || 24;
    activeLineHL.style.display = 'block';
    activeLineHL.style.top = (20 + lineNum * lh - editingArea.scrollTop) + 'px';
}

// ===== EDITOR VISUALS =====
function updateEditorVisuals() {
    const text = editingArea.value;
    const newLC = text.split('\n').length;
    if (newLC !== currentLineCount) {
        lineNumbers.innerHTML = Array.from({length:newLC},(_,i)=>i+1).join('<br>');
        currentLineCount = newLC;
    }
    const f = getActiveFile();
    const langCfg = f ? CZEngine.getLangConfig(f.language) : null;
    const cursorPos = editingArea.selectionStart;
    const brackets = CZEngine.getMatchingBrackets(text, cursorPos, langCfg);
    const tokens = CZEngine.tokenize(text, langCfg);
    let html = CZEngine.renderTokens(tokens, brackets);
    highlightingContent.innerHTML = html + (text.endsWith('\n') ? ' ' : '');
    updateActiveLine();
}

function syncScroll() {
    highlighting.scrollTop = editingArea.scrollTop;
    highlighting.scrollLeft = editingArea.scrollLeft;
    lineNumbers.scrollTop = editingArea.scrollTop;
    updateActiveLine();
}

function ensureCursorVisible() {
    const ta = editingArea;
    if (!ta || !activeFileId) return;
    const text = ta.value;
    const pos = ta.selectionStart;
    const lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--editor-line-height')) || 24;
    const lineNum = text.substring(0, pos).split('\n').length - 1;
    const cursorY = 20 + lineNum * lh; // 20 = editor padding-top
    const viewTop = ta.scrollTop;
    const viewBottom = ta.scrollTop + ta.clientHeight;
    const margin = lh * 2; // keep 2 lines of margin

    if (cursorY + lh > viewBottom - margin) {
        // Cursor below visible area — scroll so cursor is near bottom with margin
        ta.scrollTop = cursorY + lh + margin - ta.clientHeight;
    } else if (cursorY < viewTop + margin) {
        // Cursor above visible area — scroll so cursor is near top with margin
        ta.scrollTop = Math.max(0, cursorY - margin);
    }
    syncScroll();
}

function handleInput() {
    const f = getActiveFile();
    if (!f) return;
    f.content = editingArea.value;
    if (!f.name.includes('.') && f.language==='plaintext') {
        const det = CZEngine.detectLanguage(editingArea.value);
        if (det!=='plaintext') { f.language=det; langSelector.value=det; CZEngine.loadLanguage(det).then(() => updateEditorVisuals()); }
    }
    updateEditorVisuals(); triggerAutosave(); updateFootbar(); ensureCursorVisible();
    // Live SVG preview update
    if (f.isSvg) updateSvgPreview();
}

// ===== CONTEXT MENU =====
async function executeMenuAction(action) {
    tabContextMenu.classList.add('hidden');
    if (!targetContextTabId) return;
    const tf = files.find(f=>f.id===targetContextTabId);
    if (action==='close') closeFile(targetContextTabId);
    else if (action==='close-other') {
        if (!await openConfirm(CZi18n.t('confirm_close_other_title'), CZi18n.t('confirm_close_other', tf.name))) return;
        files = files.filter(f=>f.id===targetContextTabId||f.isPinned);
        if (!files.find(f=>f.id===activeFileId)) activeFileId=targetContextTabId;
        saveData(); switchFile(activeFileId);
    } else if (action==='close-all') {
        if (!await openConfirm(CZi18n.t('confirm_close_all_title'), CZi18n.t('confirm_close_all'))) return;
        files = files.filter(f=>f.isPinned);
        activeFileId = files.length?files[0].id:null;
        saveData(); renderTabs(); checkEmptyState();
    } else if (action==='pin') {
        if (tf) tf.isPinned=!tf.isPinned;
        saveData(); renderTabs(); scrollToActiveTab();
    } else if (action==='rename') renameFile(targetContextTabId);
}

return {
    getFiles, setFiles, getActiveId, setActiveId, getEditingArea, getActiveFile,
    checkEmptyState, renderTabs, scrollToActiveTab, setupTabDragging,
    createNewFile, closeFile, renameFile, switchFile, processImportedFile,
    saveData, triggerAutosave, applyFontSettings,
    openPrompt, closePrompt, openConfirm, closeConfirm, openAlert, closeAlert,
    handleInput, updateEditorVisuals, updateFootbar, syncScroll, updateActiveLine, ensureCursorVisible,
    executeMenuAction,
    // Sidebar
    toggleSidebar, isSidebarOpen, restoreSidebarState,
    renderSidebar, refreshSidebar, collapseAllFolders, closeFolder,
    openFileFromTree, highlightActiveInTree, renderRecentFolders,
    executeSidebarAction, openExplorerSettings, applyExplorerSettings,
    // Image / SVG
    updateSvgPreview, toggleSvgPreview,
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
