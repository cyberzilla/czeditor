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

// ===== FILE DOWNLOAD (respects encoding & EOL) =====
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
        // Encode content as UTF-16 LE
        const buf = new ArrayBuffer(content.length * 2);
        const view = new Uint16Array(buf);
        for (let i = 0; i < content.length; i++) view[i] = content.charCodeAt(i);
        blobParts = [bom, new Uint8Array(buf)];
    } else if (enc === 'UTF-16 BE BOM') {
        const bom = new Uint8Array([0xFE, 0xFF]);
        // Encode content as UTF-16 BE (swap bytes)
        const buf = new Uint8Array(content.length * 2);
        for (let i = 0; i < content.length; i++) {
            const code = content.charCodeAt(i);
            buf[i*2] = (code >> 8) & 0xFF;
            buf[i*2+1] = code & 0xFF;
        }
        blobParts = [bom, buf];
    } else {
        // UTF-8 (no BOM) and ANSI — browser Blob uses UTF-8 by default
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
            downloadFile(f);
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

// ===== COMMAND PALETTE =====
function getCommands() {
    return [
        { name: CZi18n.t('cmd_new_file'), shortcut:'Ctrl+N', action:()=>CZUI.createNewFile() },
        { name: CZi18n.t('cmd_save'), shortcut:'Ctrl+S', action:()=>{ const f=CZUI.getActiveFile(); if(f) downloadFile(f); }},
        { name: CZi18n.t('cmd_toggle_comment'), shortcut:'Ctrl+/', action:()=>toggleComment(CZEngine.getLangConfig(CZUI.getActiveFile()?.language)) },
        { name: CZi18n.t('sc_duplicate'), shortcut:'Ctrl+D', action:()=>duplicateLine() },
        { name: CZi18n.t('cmd_delete_line'), shortcut:'Ctrl+Shift+K', action:()=>deleteLine() },
        { name: CZi18n.t('shortcuts_title'), shortcut:'', action:()=>document.getElementById('shortcuts-modal').classList.remove('hidden') },
        { name: CZi18n.t('font_config_title'), shortcut:'', action:()=>{ CZUI.fontConfigModal.classList.remove('hidden'); CZUI.settingsPopup.classList.add('hidden'); }},
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
}

return {
    handleKeydown, handleCursorMove, onInput,
    hideAutocomplete, toggleCommandPalette, renderCommandPalette,
    get acVisible() { return acVisible; }
};
})();
