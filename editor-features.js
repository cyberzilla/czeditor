// CZEditor Features — Autocomplete, Shortcuts, AutoClose, Emmet
const CZFeatures = (() => {
const acPopup = document.getElementById('autocomplete-popup');
const acList = document.getElementById('autocomplete-list');
let acItems = [], acIndex = -1, acWord = '', acWordStart = 0, acVisible = false;
let acSuppressUntil = 0;

// ===== TEXT INSERT (preserves undo stack) =====
function insertText(textarea, text) {
    textarea.focus();
    document.execCommand('insertText', false, text);
}
function replaceRange(textarea, start, end, text) {
    textarea.focus();
    textarea.setSelectionRange(start, end);
    document.execCommand('insertText', false, text);
}

// ===== FILE SAVE (native filesystem first, fallback to download) =====
async function saveFile(f) {
    if (!f) return;

    // 1. If file has a native handle, save directly to disk
    if (f.fileHandle) {
        const ok = await CZFS.saveFile(f.fileHandle, f.content, f.encoding || 'UTF-8', f.eol || 'LF');
        if (ok) {
            f.dirty = false;
            CZUI.updateTabDirtyDot();
            CZUI.saveData();
            return true;
        }
        // If save failed (permission revoked?), fall through
    }

    // 2. If File System Access is supported, try Save As picker
    if (CZFS.isSupported()) {
        const handle = await CZFS.saveFileAs(
            f.name.includes('.') ? f.name : f.name + '.txt',
            f.content,
            f.encoding || 'UTF-8',
            f.eol || 'LF'
        );
        if (handle) {
            f.fileHandle = handle; // Store handle for future saves
            // Update name from picked file if different
            const file = await handle.getFile();
            if (file.name !== f.name) {
                f.name = file.name;
                CZUI.renderTabs();
                CZUI.updateFootbar();
            }
            CZUI.saveData();
            CZUI.checkEmptyState();
            return true;
        }
        return false; // User cancelled
    }

    // 3. Fallback: download file
    downloadFile(f);
    return true;
}

function downloadFile(f) {
    let content = f.content;
    const eol = f.eol || 'LF';
    const enc = f.encoding || 'UTF-8';

    // Apply EOL conversion (internal is always LF)
    if (eol === 'CRLF') content = content.replace(/\n/g, '\r\n');
    else if (eol === 'CR') content = content.replace(/\n/g, '\r');

    // Build blob parts with optional BOM
    let blobParts;
    if (enc === 'UTF-8 BOM') {
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        blobParts = [bom, content];
    } else if (enc === 'UTF-16 LE BOM') {
        const bom = new Uint8Array([0xFF, 0xFE]);
        const buf = new ArrayBuffer(content.length * 2);
        const view = new Uint16Array(buf);
        for (let i = 0; i < content.length; i++) view[i] = content.charCodeAt(i);
        blobParts = [bom, new Uint8Array(buf)];
    } else if (enc === 'UTF-16 BE BOM') {
        const bom = new Uint8Array([0xFE, 0xFF]);
        const buf = new Uint8Array(content.length * 2);
        for (let i = 0; i < content.length; i++) {
            const code = content.charCodeAt(i);
            buf[i*2] = (code >> 8) & 0xFF;
            buf[i*2+1] = code & 0xFF;
        }
        blobParts = [bom, buf];
    } else {
        blobParts = [content];
    }

    const blob = new Blob(blobParts, { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name.includes('.') ? f.name : f.name + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
}

// ===== AUTOCOMPLETE =====
function showAutocomplete() {
    // Skip if suppressed (just accepted an item)
    if (Date.now() < acSuppressUntil) return;
    const ta = CZUI.getEditingArea();
    const text = ta.value, pos = ta.selectionStart;
    const before = text.substring(0, pos);
    const wordMatch = before.match(/([a-zA-Z_$@#.][a-zA-Z0-9_$-]*)$/);
    if (!wordMatch || wordMatch[1].length < 2) { hideAutocomplete(); return; }

    acWord = wordMatch[1]; acWordStart = pos - acWord.length;
    const f = CZUI.getActiveFile();
    const cfg = f ? CZEngine.getLangConfig(f.language) : null;
    acItems = CZEngine.getAutocompleteItems(acWord, text, cfg);
    if (!acItems.length) { hideAutocomplete(); return; }

    acIndex = 0; acVisible = true;
    renderAutocomplete();
    positionAutocomplete(ta, pos);
    acPopup.classList.remove('hidden');
}

function hideAutocomplete() {
    acPopup.classList.add('hidden');
    acVisible = false; acIndex = -1; acItems = [];
}

function renderAutocomplete() {
    acList.innerHTML = acItems.map((item, i) => {
        const iconMap = { keyword:'K', function:'F', snippet:'S', variable:'V', property:'P', emmet:'E' };
        const icon = iconMap[item.type] || '?';
        const label = CZEngine.highlightMatch(item.label, acWord);
        const active = i === acIndex ? ' active' : '';
        return `<div class="ac-item${active}" data-idx="${i}">
            <span class="ac-icon ${item.type}">${icon}</span>
            <span class="ac-label">${label}</span>
            <span class="ac-detail">${item.detail||''}</span></div>`;
    }).join('');
    acList.querySelectorAll('.ac-item').forEach(el => {
        el.onmousedown = e => { e.preventDefault(); acceptAutocomplete(parseInt(el.dataset.idx)); };
    });
    const active = acList.querySelector('.ac-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
}

function positionAutocomplete(ta, pos) {
    const text = ta.value.substring(0, pos);
    const lines = text.split('\n');
    const lineNum = lines.length - 1;
    const colNum = lines[lines.length-1].length;
    const lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--editor-line-height'))||24;
    const fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size'))||15;
    const rect = ta.getBoundingClientRect();
    let top = rect.top + 20 + (lineNum+1)*lh - ta.scrollTop;
    let left = rect.left + 20 + colNum*fs*0.6 - ta.scrollLeft;
    if (top + 230 > window.innerHeight) top = top - 230 - lh;
    if (left + 300 > window.innerWidth) left = window.innerWidth - 310;
    acPopup.style.top = top+'px'; acPopup.style.left = Math.max(0,left)+'px';
}

function acceptAutocomplete(idx) {
    if (idx === undefined) idx = acIndex;
    if (idx < 0 || idx >= acItems.length) return;
    const item = acItems[idx];
    const ta = CZUI.getEditingArea();
    let text = item.label;
    const f = CZUI.getActiveFile();
    const cfg = f ? CZEngine.getLangConfig(f.language) : null;
    // If it's a snippet, expand it
    if (item.type === 'snippet' && cfg && cfg.snippets && cfg.snippets[item.label]) {
        text = cfg.snippets[item.label].body;
    }
    const cursorOff = text.indexOf('$1');
    const finalText = text.replace(/\$\d/g, '');
    replaceRange(ta, acWordStart, ta.selectionStart, finalText);
    if (cursorOff !== -1) {
        const newPos = acWordStart + cursorOff;
        ta.setSelectionRange(newPos, newPos);
    }
    hideAutocomplete();
    acSuppressUntil = Date.now() + 300;
    CZUI.handleInput();
}

function navigateAutocomplete(dir) {
    acIndex = (acIndex + dir + acItems.length) % acItems.length;
    renderAutocomplete();
}

// ===== AUTO CLOSE PAIRS =====
function handleAutoClose(e, langConfig) {
    const ta = CZUI.getEditingArea();
    const pairs = langConfig?.autoClosePairs || [['{','}'],['"','"'],["'","'"],['[',']'],['(',')'],['`','`']];
    const start = ta.selectionStart, end = ta.selectionEnd;
    const text = ta.value;
    const ch = e.key;

    // Check if typing a closing char that already exists ahead
    for (const [open, close] of pairs) {
        if (ch === close && close !== open && text[start] === close) {
            e.preventDefault();
            ta.setSelectionRange(start+1, start+1);
            return true;
        }
    }
    // Same-char pairs (quotes): skip if next char is same
    for (const [open, close] of pairs) {
        if (open === close && ch === close && text[start] === close) {
            e.preventDefault();
            ta.setSelectionRange(start+1, start+1);
            return true;
        }
    }
    // Auto-insert closing char
    for (const [open, close] of pairs) {
        if (ch === open) {
            // For quotes, don't auto-close if previous char is alphanumeric
            if (open === close && start > 0 && /[a-zA-Z0-9_$]/.test(text[start-1])) return false;
            e.preventDefault();
            if (start !== end) {
                // Wrap selection
                const sel = text.substring(start, end);
                replaceRange(ta, start, end, open + sel + close);
                ta.setSelectionRange(start+1, start+1+sel.length);
            } else {
                insertText(ta, open + close);
                ta.setSelectionRange(start+1, start+1);
            }
            return true;
        }
    }
    return false;
}

// ===== BACKSPACE: delete pair =====
function handleBackspacePair(e, langConfig) {
    const ta = CZUI.getEditingArea();
    const pairs = langConfig?.autoClosePairs || [['{','}'],['"','"'],["'","'"],['[',']'],['(',')'],['`','`']];
    const pos = ta.selectionStart;
    if (pos === 0 || ta.selectionStart !== ta.selectionEnd) return false;
    const text = ta.value;
    const prev = text[pos-1], next = text[pos];
    for (const [open, close] of pairs) {
        if (prev === open && next === close) {
            e.preventDefault();
            replaceRange(ta, pos-1, pos+1, '');
            return true;
        }
    }
    return false;
}

// ===== ENTER: smart indent =====
function handleEnter(e) {
    const ta = CZUI.getEditingArea();
    const pos = ta.selectionStart, text = ta.value;
    const before = text.substring(0, pos), after = text.substring(pos);
    const currentLine = before.split('\n').pop();
    const indent = currentLine.match(/^(\s*)/)[1];
    const prevChar = before.trimEnd().slice(-1);
    const nextChar = after[0];

    e.preventDefault();
    // Between brackets: { | } or ( | ) or [ | ]
    if ((prevChar==='{' && nextChar==='}') || (prevChar==='(' && nextChar===')') || (prevChar==='[' && nextChar===']')) {
        insertText(ta, '\n'+indent+'\t\n'+indent);
        ta.setSelectionRange(pos+1+indent.length+1, pos+1+indent.length+1);
    } else if (prevChar==='{' || prevChar==='(' || prevChar==='[' || prevChar===':') {
        insertText(ta, '\n'+indent+'\t');
    } else {
        insertText(ta, '\n'+indent);
    }
    CZUI.handleInput();
}

// ===== KEYBOARD SHORTCUTS =====
function handleKeydown(e) {
    const ta = CZUI.getEditingArea();
    const f = CZUI.getActiveFile();
    const cfg = f ? CZEngine.getLangConfig(f.language) : null;

    // Autocomplete navigation
    if (acVisible) {
        if (e.key==='ArrowDown') { e.preventDefault(); navigateAutocomplete(1); return; }
        if (e.key==='ArrowUp') { e.preventDefault(); navigateAutocomplete(-1); return; }
        if (e.key==='Enter' || (e.key==='Tab' && acItems.length)) { e.preventDefault(); acceptAutocomplete(); return; }
        if (e.key==='Escape') { e.preventDefault(); hideAutocomplete(); return; }
    }

    // Tab: Emmet → Indent
    if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const start = ta.selectionStart, end = ta.selectionEnd;
        if (start === end) {
            const match = ta.value.substring(0, start).match(/(\S+)$/);
            if (match) {
                const token = match[1];
                const expanded = CZEngine.expandEmmet(token, f?.language || 'plaintext', cfg);
                if (expanded) {
                    const cursorOff = expanded.indexOf('$1');
                    const final = expanded.replace(/\$\d/g, '');
                    replaceRange(ta, start-token.length, start, final);
                    if (cursorOff !== -1) {
                        const np = start-token.length+cursorOff;
                        ta.setSelectionRange(np, np);
                    }
                    CZUI.handleInput(); return;
                }
            }
        }
        // Multi-line indent
        if (start !== end) {
            const text = ta.value;
            const lineStart = text.lastIndexOf('\n', start-1)+1;
            const lineEnd = text.indexOf('\n', end); const actualEnd = lineEnd===-1?text.length:lineEnd;
            const block = text.substring(lineStart, actualEnd);
            const indented = block.split('\n').map(l=>'\t'+l).join('\n');
            replaceRange(ta, lineStart, actualEnd, indented);
            ta.setSelectionRange(lineStart, lineStart+indented.length);
        } else {
            insertText(ta, '\t');
        }
        CZUI.handleInput(); return;
    }

    // Shift+Tab: outdent
    if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        const start = ta.selectionStart, end = ta.selectionEnd, text = ta.value;
        const lineStart = text.lastIndexOf('\n', start-1)+1;
        const lineEnd = text.indexOf('\n', end); const actualEnd = lineEnd===-1?text.length:lineEnd;
        const block = text.substring(lineStart, actualEnd);
        const outdented = block.split('\n').map(l => l.startsWith('\t')?l.slice(1):l.startsWith('    ')?l.slice(4):l).join('\n');
        replaceRange(ta, lineStart, actualEnd, outdented);
        ta.setSelectionRange(lineStart, lineStart+outdented.length);
        CZUI.handleInput(); return;
    }

    // Enter: smart indent
    if (e.key === 'Enter' && !e.shiftKey && !acVisible) { handleEnter(e); return; }

    // Backspace: delete pair
    if (e.key === 'Backspace') { if (handleBackspacePair(e, cfg)) { CZUI.handleInput(); return; } }

    // Auto-close pairs
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (handleAutoClose(e, cfg)) { CZUI.handleInput(); return; }
    }

    // Ctrl+S: Save/Download
    if ((e.ctrlKey||e.metaKey) && e.key==='s') {
        e.preventDefault();
        if (f) {
            saveFile(f);
        }
        return;
    }

    // Ctrl+N: New file
    if ((e.ctrlKey||e.metaKey) && e.key==='n') { e.preventDefault(); CZUI.createNewFile(); return; }

    // Ctrl+/: Toggle comment
    if ((e.ctrlKey||e.metaKey) && e.key==='/') {
        e.preventDefault(); toggleComment(cfg); return;
    }

    // Ctrl+D: Duplicate line
    if ((e.ctrlKey||e.metaKey) && e.key==='d' && !e.shiftKey) {
        e.preventDefault(); duplicateLine(); return;
    }

    // Ctrl+Shift+K: Delete line
    if ((e.ctrlKey||e.metaKey) && e.shiftKey && e.key==='K') {
        e.preventDefault(); deleteLine(); return;
    }

    // Ctrl+F: Find
    if ((e.ctrlKey||e.metaKey) && e.key==='f' && !e.shiftKey) {
        e.preventDefault(); openSearch(false); return;
    }

    // Ctrl+H: Find & Replace
    if ((e.ctrlKey||e.metaKey) && e.key==='h') {
        e.preventDefault(); openSearch(true); return;
    }

    // Alt+Up/Down: Move line
    if (e.altKey && (e.key==='ArrowUp'||e.key==='ArrowDown')) {
        e.preventDefault(); moveLine(e.key==='ArrowUp'?-1:1); return;
    }

    // Ctrl+L: Select line
    if ((e.ctrlKey||e.metaKey) && e.key==='l') {
        e.preventDefault();
        const text=ta.value, pos=ta.selectionStart;
        const ls = text.lastIndexOf('\n',pos-1)+1;
        const le = text.indexOf('\n',pos); const end = le===-1?text.length:le+1;
        ta.setSelectionRange(ls, end); return;
    }

    // Ctrl+P: Command palette
    if ((e.ctrlKey||e.metaKey) && e.key==='p') {
        e.preventDefault(); toggleCommandPalette(); return;
    }

    // Ctrl+] / Ctrl+[: Indent/Outdent
    if ((e.ctrlKey||e.metaKey) && e.key===']') {
        e.preventDefault();
        const pos=ta.selectionStart, text=ta.value;
        const ls=text.lastIndexOf('\n',pos-1)+1;
        replaceRange(ta, ls, ls, '\t');
        ta.setSelectionRange(pos+1, pos+1);
        CZUI.handleInput(); return;
    }
    if ((e.ctrlKey||e.metaKey) && e.key==='[') {
        e.preventDefault();
        const pos=ta.selectionStart, text=ta.value;
        const ls=text.lastIndexOf('\n',pos-1)+1;
        if (text[ls]==='\t') { replaceRange(ta,ls,ls+1,''); ta.setSelectionRange(pos-1,pos-1); }
        else if (text.substring(ls,ls+4)==='    ') { replaceRange(ta,ls,ls+4,''); ta.setSelectionRange(pos-4,pos-4); }
        CZUI.handleInput(); return;
    }
}

// ===== LINE OPERATIONS =====
function toggleComment(cfg) {
    const ta = CZUI.getEditingArea();
    const text = ta.value, start = ta.selectionStart, end = ta.selectionEnd;
    const ls = text.lastIndexOf('\n',start-1)+1;
    const le = text.indexOf('\n',end); const lineEnd = le===-1?text.length:le;
    const block = text.substring(ls, lineEnd);
    const lines = block.split('\n');
    const commentStr = cfg?.comment?.line || '//';
    const allCommented = lines.every(l => l.trimStart().startsWith(commentStr));
    let result;
    if (allCommented) {
        result = lines.map(l => { const i=l.indexOf(commentStr); return l.substring(0,i)+l.substring(i+commentStr.length+(l[i+commentStr.length]===' '?1:0)); }).join('\n');
    } else {
        result = lines.map(l => commentStr+' '+l).join('\n');
    }
    replaceRange(ta, ls, lineEnd, result);
    ta.setSelectionRange(ls, ls+result.length);
    CZUI.handleInput();
}

function duplicateLine() {
    const ta = CZUI.getEditingArea();
    const text = ta.value, pos = ta.selectionStart;
    const ls = text.lastIndexOf('\n',pos-1)+1;
    const le = text.indexOf('\n',pos); const lineEnd = le===-1?text.length:le;
    const line = text.substring(ls, lineEnd);
    replaceRange(ta, lineEnd, lineEnd, '\n'+line);
    ta.setSelectionRange(pos+line.length+1, pos+line.length+1);
    CZUI.handleInput();
}

function deleteLine() {
    const ta = CZUI.getEditingArea();
    const text = ta.value, pos = ta.selectionStart;
    const ls = text.lastIndexOf('\n',pos-1)+1;
    const le = text.indexOf('\n',pos);
    if (le===-1) replaceRange(ta, ls>0?ls-1:0, text.length, '');
    else replaceRange(ta, ls, le+1, '');
    CZUI.handleInput();
}

function moveLine(dir) {
    const ta = CZUI.getEditingArea();
    const text = ta.value, pos = ta.selectionStart;
    const lines = text.split('\n');
    const before = text.substring(0,pos);
    const lineIdx = before.split('\n').length-1;
    const targetIdx = lineIdx+dir;
    if (targetIdx<0 || targetIdx>=lines.length) return;
    const temp = lines[lineIdx];
    lines[lineIdx] = lines[targetIdx];
    lines[targetIdx] = temp;
    const newText = lines.join('\n');
    // Calculate new cursor position
    let newPos = 0;
    for (let i=0; i<targetIdx; i++) newPos += lines[i].length+1;
    newPos += pos - before.lastIndexOf('\n') - 1;
    ta.value = newText;
    ta.setSelectionRange(newPos, newPos);
    CZUI.handleInput();
}

// ===== CURSOR MOVE =====
function handleCursorMove() {
    CZUI.updateFootbar();
    CZUI.updateActiveLine();
    if (!CZUI.getActiveId()) return;
    const ta = CZUI.getEditingArea();
    const text = ta.value, pos = ta.selectionStart;
    const cfg = CZEngine.getLangConfig(CZUI.getActiveFile()?.language);
    const brackets = CZEngine.getMatchingBrackets(text, pos, cfg);
    const key = brackets.join(',');
    if (key !== CZUI.lastBracketKey) { CZUI.lastBracketKey = key; CZUI.updateEditorVisuals(); }
}

// ===== INPUT HANDLER (triggers autocomplete) =====
function onInput() {
    CZUI.handleInput();
    const ta = CZUI.getEditingArea();
    const text = ta.value, pos = ta.selectionStart;
    const cfg = CZEngine.getLangConfig(CZUI.getActiveFile()?.language);
    CZUI.lastBracketKey = CZEngine.getMatchingBrackets(text, pos, cfg).join(',');
    // Trigger autocomplete after a short delay
    clearTimeout(onInput._timer);
    onInput._timer = setTimeout(showAutocomplete, 100);
    // Live search update
    if (searchVisible) updateSearchMatches();
}

// ===== SEARCH & REPLACE =====
let searchVisible = false, searchCaseSensitive = false, searchUseRegex = false;
let searchMatches = [], searchCurrentIdx = -1;

const searchPanel = document.getElementById('search-panel');
const searchInput = document.getElementById('search-input');
const replaceInput = document.getElementById('replace-input');
const searchCount = document.getElementById('search-count');
const replaceRow = document.getElementById('replace-row');

function openSearch(withReplace) {
    searchVisible = true;
    searchPanel.classList.remove('hidden');
    if (withReplace) replaceRow.classList.remove('hidden');
    else replaceRow.classList.add('hidden');
    // Pre-fill with selection
    const ta = CZUI.getEditingArea();
    if (ta) {
        const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
        if (sel && !sel.includes('\n')) searchInput.value = sel;
    }
    searchInput.focus();
    searchInput.select();
    updateSearchMatches();
}

function closeSearch() {
    searchVisible = false;
    searchPanel.classList.add('hidden');
    searchMatches = [];
    searchCurrentIdx = -1;
    searchCount.textContent = '';
    searchCount.className = 'search-count';
    CZUI.updateEditorVisuals(); // Clear highlights
    const ta = CZUI.getEditingArea();
    if (ta) ta.focus();
}

function updateSearchMatches() {
    const query = searchInput.value;
    searchMatches = [];
    searchCurrentIdx = -1;

    if (!query) {
        searchCount.textContent = '';
        searchCount.className = 'search-count';
        CZUI.updateEditorVisuals();
        return;
    }

    const ta = CZUI.getEditingArea();
    if (!ta) return;
    const text = ta.value;

    try {
        let flags = 'g';
        if (!searchCaseSensitive) flags += 'i';
        const pattern = searchUseRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(pattern, flags);
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m[0].length === 0) { re.lastIndex++; continue; }
            searchMatches.push({ start: m.index, end: m.index + m[0].length });
        }
    } catch (e) {
        searchCount.textContent = 'Invalid regex';
        searchCount.className = 'search-count no-results';
        return;
    }

    if (searchMatches.length === 0) {
        searchCount.textContent = '0 results';
        searchCount.className = 'search-count no-results';
    } else {
        // Find closest match to cursor
        const cursorPos = ta.selectionStart;
        searchCurrentIdx = 0;
        for (let i = 0; i < searchMatches.length; i++) {
            if (searchMatches[i].start >= cursorPos) { searchCurrentIdx = i; break; }
        }
        updateSearchCountDisplay();
    }
    CZUI.updateEditorVisuals();
}

function updateSearchCountDisplay() {
    if (searchMatches.length === 0) {
        searchCount.textContent = '0 results';
        searchCount.className = 'search-count no-results';
    } else {
        searchCount.textContent = `${searchCurrentIdx + 1} of ${searchMatches.length}`;
        searchCount.className = 'search-count has-results';
    }
}

function searchNext() {
    if (searchMatches.length === 0) return;
    searchCurrentIdx = (searchCurrentIdx + 1) % searchMatches.length;
    goToMatch();
}

function searchPrev() {
    if (searchMatches.length === 0) return;
    searchCurrentIdx = (searchCurrentIdx - 1 + searchMatches.length) % searchMatches.length;
    goToMatch();
}

function goToMatch() {
    const match = searchMatches[searchCurrentIdx];
    if (!match) return;
    const ta = CZUI.getEditingArea();
    ta.focus();
    ta.setSelectionRange(match.start, match.end);
    updateSearchCountDisplay();
    // Scroll into view
    const text = ta.value.substring(0, match.start);
    const lineNum = text.split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--editor-line-height')) || 24;
    const targetScroll = lineNum * lh - ta.clientHeight / 2;
    ta.scrollTop = Math.max(0, targetScroll);
    CZUI.syncScroll();
}

function replaceOne() {
    if (searchMatches.length === 0 || searchCurrentIdx < 0) return;
    const match = searchMatches[searchCurrentIdx];
    const ta = CZUI.getEditingArea();
    ta.focus();
    ta.setSelectionRange(match.start, match.end);
    document.execCommand('insertText', false, replaceInput.value);
    CZUI.handleInput();
    updateSearchMatches();
}

function replaceAll() {
    if (searchMatches.length === 0) return;
    const ta = CZUI.getEditingArea();
    const replacement = replaceInput.value;
    // Replace from end to start to preserve indices
    ta.focus();
    const sorted = [...searchMatches].sort((a, b) => b.start - a.start);
    for (const match of sorted) {
        ta.setSelectionRange(match.start, match.end);
        document.execCommand('insertText', false, replacement);
    }
    CZUI.handleInput();
    updateSearchMatches();
}

function getSearchMatches() { return searchVisible ? searchMatches : []; }
function getSearchCurrentIdx() { return searchCurrentIdx; }

// Setup search panel events
if (searchInput) {
    searchInput.addEventListener('input', () => updateSearchMatches());
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); searchPrev(); }
        else if (e.key === 'Enter') { e.preventDefault(); searchNext(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
        else if (e.altKey && e.key === 'c') { e.preventDefault(); toggleSearchCase(); }
        else if (e.altKey && e.key === 'r') { e.preventDefault(); toggleSearchRegex(); }
    });
}
if (replaceInput) {
    replaceInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
        else if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    });
}

function toggleSearchCase() {
    searchCaseSensitive = !searchCaseSensitive;
    document.getElementById('search-toggle-case').classList.toggle('active', searchCaseSensitive);
    updateSearchMatches();
}
function toggleSearchRegex() {
    searchUseRegex = !searchUseRegex;
    document.getElementById('search-toggle-regex').classList.toggle('active', searchUseRegex);
    updateSearchMatches();
}

// Button bindings
document.getElementById('search-toggle-case')?.addEventListener('click', toggleSearchCase);
document.getElementById('search-toggle-regex')?.addEventListener('click', toggleSearchRegex);
document.getElementById('search-prev')?.addEventListener('click', searchPrev);
document.getElementById('search-next')?.addEventListener('click', searchNext);
document.getElementById('search-close')?.addEventListener('click', closeSearch);
document.getElementById('replace-one')?.addEventListener('click', replaceOne);
document.getElementById('replace-all')?.addEventListener('click', replaceAll);

// ===== MINIFY & BEAUTIFY =====
function minifyCode() {
    const f = CZUI.getActiveFile();
    if (!f) return;
    const ta = CZUI.getEditingArea();
    const text = ta.value;
    let result = text;
    const lang = f.language;

    if (lang === 'json') {
        try { result = JSON.stringify(JSON.parse(text)); } catch (e) { return; }
    } else if (lang === 'css') {
        result = text
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\s*([{}:;,>~+])\s*/g, '$1')
            .replace(/;\}/g, '}')
            .replace(/\s+/g, ' ')
            .trim();
    } else if (lang === 'javascript' || lang === 'typescript') {
        result = text
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\s*([{}():;,=<>!&|?+\-*\/])\s*/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();
    } else if (lang === 'html' || lang === 'xml') {
        result = text
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/>\s+</g, '><')
            .replace(/\s+/g, ' ')
            .trim();
    } else if (lang === 'sql') {
        result = text
            .replace(/--.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\s+/g, ' ')
            .trim();
    } else {
        result = text.replace(/\s+/g, ' ').trim();
    }

    ta.focus();
    ta.select();
    document.execCommand('insertText', false, result);
    CZUI.handleInput();
}

function beautifyCode() {
    const f = CZUI.getActiveFile();
    if (!f) return;
    const ta = CZUI.getEditingArea();
    const text = ta.value;
    let result = text;
    const lang = f.language;
    const indent = '\t';

    if (lang === 'json') {
        try { result = JSON.stringify(JSON.parse(text), null, indent); } catch (e) { return; }
    } else if (lang === 'css') {
        result = beautifyCSS(text, indent);
    } else if (lang === 'html' || lang === 'xml') {
        result = beautifyHTML(text, indent);
    } else if (lang === 'sql') {
        result = beautifySQL(text);
    } else {
        // Generic: re-indent based on braces
        result = beautifyGeneric(text, indent);
    }

    ta.focus();
    ta.select();
    document.execCommand('insertText', false, result);
    CZUI.handleInput();
}

function beautifyCSS(text, indent) {
    let result = text
        .replace(/\/\*[\s\S]*?\*\//g, m => '\n' + m + '\n')
        .replace(/\s*{\s*/g, ' {\n')
        .replace(/\s*}\s*/g, '\n}\n')
        .replace(/\s*;\s*/g, ';\n')
        .replace(/\n\s*\n/g, '\n');

    const lines = result.split('\n');
    let depth = 0;
    const out = [];
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('}')) depth = Math.max(0, depth - 1);
        out.push(indent.repeat(depth) + line);
        if (line.endsWith('{')) depth++;
    }
    return out.join('\n');
}

function beautifyHTML(text, indent) {
    const voidTags = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
    let result = text.replace(/>\s*</g, '>\n<');
    const lines = result.split('\n');
    let depth = 0;
    const out = [];
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const isClose = /^<\//.test(line);
        const isOpen = /^<[a-zA-Z]/.test(line) && !isClose;
        const isSelfClose = /\/>$/.test(line);
        const tagMatch = line.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
        const isVoid = tagMatch && voidTags.test(tagMatch[1]);

        if (isClose) depth = Math.max(0, depth - 1);
        out.push(indent.repeat(depth) + line);
        if (isOpen && !isSelfClose && !isVoid) depth++;
    }
    return out.join('\n');
}

function beautifySQL(text) {
    const kws = /\b(SELECT|FROM|WHERE|AND|OR|INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN|JOIN|ON|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|UNION|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|CREATE TABLE|ALTER TABLE|DROP TABLE|CASE|WHEN|THEN|ELSE|END|WITH)\b/gi;
    return text
        .replace(/\s+/g, ' ')
        .replace(kws, '\n$1')
        .replace(/,\s*/g, ',\n\t')
        .trim();
}

function beautifyGeneric(text, indent) {
    const lines = text.split('\n');
    let depth = 0;
    const out = [];
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) { out.push(''); continue; }
        const closers = (line.match(/^[}\])]/) || []).length;
        if (closers) depth = Math.max(0, depth - 1);
        out.push(indent.repeat(depth) + line);
        const opens = (line.match(/[{[(]$/g) || []).length;
        if (opens) depth++;
    }
    return out.join('\n');
}

// ===== COMMAND PALETTE =====
function getCommands() {
    return [
        { name: CZi18n.t('cmd_new_file'), shortcut:'Ctrl+N', action:()=>CZUI.createNewFile() },
        { name: CZi18n.t('cmd_save'), shortcut:'Ctrl+S', action:()=>{ const f=CZUI.getActiveFile(); if(f) saveFile(f); }},
        { name: CZi18n.t('cmd_toggle_comment'), shortcut:'Ctrl+/', action:()=>toggleComment(CZEngine.getLangConfig(CZUI.getActiveFile()?.language)) },
        { name: CZi18n.t('sc_duplicate'), shortcut:'Ctrl+D', action:()=>duplicateLine() },
        { name: CZi18n.t('cmd_delete_line'), shortcut:'Ctrl+Shift+K', action:()=>deleteLine() },
        { name: 'Find', shortcut:'Ctrl+F', action:()=>openSearch(false) },
        { name: 'Find & Replace', shortcut:'Ctrl+H', action:()=>openSearch(true) },
        { name: 'Minify Code', shortcut:'', action:()=>minifyCode() },
        { name: 'Beautify Code', shortcut:'', action:()=>beautifyCode() },
        { name: CZi18n.t('shortcuts_title'), shortcut:'', action:()=>document.getElementById('shortcuts-modal').classList.remove('hidden') },
        { name: CZi18n.t('font_config_title'), shortcut:'', action:()=>{ CZUI.fontConfigModal.classList.remove('hidden'); CZUI.settingsPopup.classList.add('hidden'); }},
        { name: CZi18n.t('cmd_open_folder'), shortcut:'', action:()=>document.getElementById('btn-open-folder').click() },
        { name: CZi18n.t('cmd_toggle_sidebar'), shortcut:'Ctrl+B', action:()=>CZUI.toggleSidebar() },
    ];
}
let cpVisible = false, cpIndex = 0;
function toggleCommandPalette() {
    const modal = document.getElementById('command-palette');
    cpVisible = !cpVisible;
    if (cpVisible) {
        modal.classList.remove('hidden');
        const input = document.getElementById('command-palette-input');
        input.value = ''; input.focus();
        renderCommandPalette('');
    } else { modal.classList.add('hidden'); }
}
function renderCommandPalette(query) {
    const list = document.getElementById('command-palette-list');
    const q = query.toLowerCase();
    const filtered = getCommands().filter(c => c.name.toLowerCase().includes(q));
    cpIndex = 0;
    list.innerHTML = filtered.map((c,i) =>
        `<div class="cp-item${i===0?' active':''}" data-idx="${i}">
            <span>${c.name}</span><span class="cp-shortcut">${c.shortcut}</span></div>`
    ).join('');
    list.querySelectorAll('.cp-item').forEach(el => {
        el.onmousedown = e => { e.preventDefault(); const idx=parseInt(el.dataset.idx); filtered[idx]?.action(); toggleCommandPalette(); };
    });
}

return {
    handleKeydown, handleCursorMove, onInput,
    hideAutocomplete, toggleCommandPalette, renderCommandPalette,
    saveFile, openSearch, closeSearch, getSearchMatches, getSearchCurrentIdx,
    minifyCode, beautifyCode,
    get acVisible() { return acVisible; },
    get searchVisible() { return searchVisible; }
};
})();