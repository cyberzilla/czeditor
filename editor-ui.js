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
    fontConfigModal = $('font-config-modal'), activeLineHL = $('active-line-highlight');

let files = [], activeFileId = null, saveTimeout = null, isDraggingTab = false;
let targetContextTabId = null, promptCb = null, confirmCb = null;
let currentLineCount = 0, lastBracketKey = '';

function getFiles() { return files; }
function setFiles(f) { files = f; }
function getActiveId() { return activeFileId; }
function setActiveId(id) { activeFileId = id; }
function getEditingArea() { return editingArea; }
function getActiveFile() { return files.find(f => f.id === activeFileId); }

// ===== EMPTY STATE =====
function checkEmptyState() {
    const empty = files.length === 0;
    welcomeScreen.classList.toggle('active', empty);
    editorBody.classList.toggle('hidden', empty);
    toolbarRight.classList.toggle('hidden', empty);
    editorFooter.classList.toggle('hidden', empty);
    if (activeLineHL) activeLineHL.style.display = empty ? 'none' : 'block';
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
    localStorage.setItem('cz_files', JSON.stringify(files));
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
        startX=e.pageX-tabsContainer.offsetLeft; scrollLeft=tabsContainer.scrollLeft;
    });
    tabsContainer.addEventListener('mouseleave', () => isDown=false);
    tabsContainer.addEventListener('mouseup', () => { isDown=false; tabsContainer.style.scrollBehavior='smooth'; });
    tabsContainer.addEventListener('mousemove', e => {
        if (!isDown) return; e.preventDefault();
        const walk=(e.pageX-tabsContainer.offsetLeft-startX)*1.5;
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
    editingArea.value = f.content;
    langSelector.value = f.language;
    currentLineCount = 0; lastBracketKey = '';
    renderTabs(); updateEditorVisuals(); updateFootbar(); scrollToActiveTab();
    localStorage.setItem('cz_active_id', activeFileId);
    CZEngine.loadLanguage(f.language).then(() => updateEditorVisuals());
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
    get targetContextTabId() { return targetContextTabId; },
    set targetContextTabId(v) { targetContextTabId = v; },
    get lastBracketKey() { return lastBracketKey; },
    set lastBracketKey(v) { lastBracketKey = v; },
    $, tabContextMenu, settingsPopup, fontConfigModal, editingArea, langSelector, dropOverlay
};
})();
