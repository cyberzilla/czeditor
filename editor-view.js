// ==========================================
// CZEditor View — Monaco-style Virtual Line Renderer
// ==========================================
const EditorView = (() => {
'use strict';
const BUFFER = 20; // extra lines above/below viewport
const LINE_PAD = 8; // must match .virt-line padding-left

class View {
    constructor(container) {
        this.container = container;
        this.model = new EditorModel.TextModel();
        this.cursor = { line: 0, col: 0 };
        this.anchor = null; // selection anchor, null = no selection
        this.lh = 24; this.cw = 7.8; // lineHeight, charWidth
        this._visLines = new Map(); // lineNum -> div element
        this._pool = [];
        this._rafId = 0;
        this._lastVersion = -1;
        this._composing = false;
        this._focused = false;
        this._buildDOM();
        this._measureFont();
        this._bindEvents();
        this._cursorChangeCallbacks = [];
        this.model.onChange(() => this._scheduleRender());
        // Remeasure once fonts are fully loaded (initial measure may use fallback)
        document.fonts.ready.then(() => {
            const oldCw = this.cw, oldLh = this.lh;
            this._measureFont();
            // Only re-render if measurements actually changed
            if (this.cw !== oldCw || this.lh !== oldLh) {
                this._render(true);
            }
        });
    }

    // ===== DOM CONSTRUCTION =====
    _buildDOM() {
        const c = this.container;
        c.classList.add('virt-editor');

        // Capture preload placeholder (will be removed after first render)
        this._preloadEl = c.firstElementChild || null;

        // Scroll container
        this.scrollEl = document.createElement('div');
        this.scrollEl.className = 'virt-scroll';
        this.scrollEl.tabIndex = -1;

        // Content sizer (sets total height for scrollbar)
        this.sizer = document.createElement('div');
        this.sizer.className = 'virt-sizer';

        // Line number gutter (outside scroll container — never scrolls horizontally)
        this.gutter = document.createElement('div');
        this.gutter.className = 'virt-gutter';

        // Lines container (visible lines rendered here)
        this.linesEl = document.createElement('div');
        this.linesEl.className = 'virt-lines';

        // Active line highlight
        this.activeLineEl = document.createElement('div');
        this.activeLineEl.className = 'virt-active-line';

        // Cursor
        this.cursorEl = document.createElement('div');
        this.cursorEl.className = 'virt-cursor';

        // Selection layer
        this.selLayer = document.createElement('div');
        this.selLayer.className = 'virt-sel-layer';

        // Hidden textarea for input capture
        this.inputEl = document.createElement('textarea');
        this.inputEl.className = 'virt-input';
        this.inputEl.setAttribute('autocorrect', 'off');
        this.inputEl.setAttribute('autocapitalize', 'off');
        this.inputEl.setAttribute('autocomplete', 'off');
        this.inputEl.setAttribute('spellcheck', 'false');
        this.inputEl.setAttribute('wrap', 'off');

        // Indent guides layer
        this.indentLayer = document.createElement('div');
        this.indentLayer.className = 'virt-indent-layer';

        // Assemble off-screen — gutter is OUTSIDE scroll container
        this.sizer.appendChild(this.selLayer);
        this.sizer.appendChild(this.indentLayer);
        this.sizer.appendChild(this.activeLineEl);
        this.sizer.appendChild(this.linesEl);
        this.sizer.appendChild(this.cursorEl);
        this.sizer.appendChild(this.inputEl);
        this.scrollEl.appendChild(this.sizer);

        // Append virtual editor BEHIND the preload placeholder (both visible briefly)
        // Preload sits on top (position:absolute;inset:0) hiding the virtual editor
        // until first render removes it
        c.appendChild(this.gutter);
        c.appendChild(this.scrollEl);
    }

    // ===== FONT MEASUREMENT =====
    _measureFont() {
        const rs = getComputedStyle(document.documentElement);
        this.lh = parseFloat(rs.getPropertyValue('--editor-line-height')) || 24;
        const fs = rs.getPropertyValue('--editor-font-size').trim() || '15px';
        const fw = rs.getPropertyValue('--editor-font-weight').trim() || '400';
        const fm = rs.getPropertyValue('--font-mono').trim() || '"Maple Mono NF","Fira Code",monospace';
        const span = document.createElement('span');
        span.style.cssText = [
            'position:fixed', 'left:-9999px', 'top:0', 'visibility:hidden',
            'white-space:pre', `font-size:${fs}`, `font-weight:${fw}`, `font-family:${fm}`,
            'font-variant-ligatures:contextual common-ligatures',
            'font-feature-settings:"liga" 1, "calt" 1'
        ].join(';') + ';';
        span.textContent = 'X'.repeat(100);
        document.body.appendChild(span);
        this.cw = span.getBoundingClientRect().width / 100;
        document.body.removeChild(span);
    }

    remeasure() {
        this._measureFont();
        this._render(true);
    }

    // ===== CORE RENDERING =====
    _scheduleRender() {
        cancelAnimationFrame(this._rafId);
        this._rafId = requestAnimationFrame(() => this._render());
    }

    _render(force) {
        const m = this.model;
        const totalLines = m.getLineCount();
        const scrollTop = this.scrollEl.scrollTop;
        const viewH = this.scrollEl.clientHeight || 400;
        const gutterW = Math.max(40, (String(totalLines).length + 1) * this.cw + 12);

        // Update sizer height (scroll-past-end: last line can reach top of viewport)
        const totalH = (totalLines - 1) * this.lh + viewH;
        this.sizer.style.height = totalH + 'px';
        this.gutter.style.width = gutterW + 'px';
        // Offset scroll container to leave room for gutter
        this.scrollEl.style.left = gutterW + 'px';
        this.linesEl.style.left = '0';
        this.selLayer.style.left = '0';
        this.activeLineEl.style.left = '0';

        // Calculate visible range
        const first = Math.max(0, Math.floor(scrollTop / this.lh) - BUFFER);
        const last = Math.min(totalLines - 1, Math.ceil((scrollTop + viewH) / this.lh) + BUFFER);

        // Calculate max line width for horizontal scrolling
        let maxLineLen = 0;
        for (let ln = first; ln <= last; ln++) {
            maxLineLen = Math.max(maxLineLen, m.getLineLength(ln));
        }
        const contentW = LINE_PAD + maxLineLen * this.cw + this.cw * 2;
        this.sizer.style.minWidth = contentW + 'px';

        // Get language config for tokenization
        const f = typeof CZUI !== 'undefined' ? CZUI.getActiveFile() : null;
        const langId = f ? f.language : null;
        const langCfg = langId ? CZEngine.getLangConfig(langId) : null;

        // For HTML: build line-level language map for embedded <script>/<style>
        let lineLangMap = null;
        if (langId === 'html' && langCfg) {
            lineLangMap = this._buildHTMLLangMap(m, first, last);
        }

        // Build multiline comment state map (only for languages with block comments)
        const hasBlockComment = langCfg && langCfg.comment && langCfg.comment.blockStart;
        const commentMap = hasBlockComment ? this._buildCommentStateMap(m, first, last) : {};

        // Remove lines out of range
        const toRemove = [];
        this._visLines.forEach((div, ln) => {
            if (ln < first || ln > last) { toRemove.push(ln); }
        });
        for (const ln of toRemove) {
            const div = this._visLines.get(ln);
            div.remove();
            if (div._gutterEl) {
                div._gutterEl.classList.remove('active');
                div._gutterEl.remove();
                // Invalidate cached reference if this was the active line
                if (div._gutterEl === this._activeGutterEl) {
                    this._activeGutterEl = null;
                }
            }
            this._pool.push(div);
            this._visLines.delete(ln);
        }

        // Render visible lines
        for (let ln = first; ln <= last; ln++) {
            let div = this._visLines.get(ln);
            const top = ln * this.lh;
            // Gutter number position: viewport-relative (gutter doesn't scroll)
            const gutterTop = top - scrollTop;
            if (!div) {
                div = this._pool.pop() || document.createElement('div');
                div.className = 'virt-line';
                div.style.top = top + 'px';
                div.style.height = this.lh + 'px';

                // Tokenize and render line
                const lineText = m.getLine(ln);
                const lineLang = lineLangMap ? lineLangMap[ln] : null;
                const effCfg = lineLang ? (CZEngine.getLangConfig(lineLang) || langCfg) : langCfg;
                const effId = lineLang || langId;
                div.innerHTML = this._renderLine(lineText, effCfg, effId, commentMap[ln]);
                this.linesEl.appendChild(div);

                // Gutter number
                let gutEl = div._gutterEl;
                if (!gutEl) {
                    gutEl = document.createElement('div');
                    gutEl.className = 'virt-gutter-num';
                    div._gutterEl = gutEl;
                }
                gutEl.textContent = ln + 1;
                gutEl.style.top = gutterTop + 'px';
                gutEl.style.height = this.lh + 'px';
                gutEl.style.width = gutterW + 'px';
                this.gutter.appendChild(gutEl);

                this._visLines.set(ln, div);
            } else if (force || m.version !== this._lastVersion) {
                // Re-render if model changed
                const lineLang2 = lineLangMap ? lineLangMap[ln] : null;
                const effCfg2 = lineLang2 ? (CZEngine.getLangConfig(lineLang2) || langCfg) : langCfg;
                const effId2 = lineLang2 || langId;
                div.innerHTML = this._renderLine(m.getLine(ln), effCfg2, effId2, commentMap[ln]);
                div.style.top = top + 'px';
                if (div._gutterEl) {
                    div._gutterEl.textContent = ln + 1;
                    div._gutterEl.style.top = gutterTop + 'px';
                    div._gutterEl.style.width = gutterW + 'px';
                }
            } else {
                // Just update gutter position for scroll
                if (div._gutterEl) div._gutterEl.style.top = gutterTop + 'px';
            }
        }

        this._lastVersion = m.version;
        this._updateCursor(gutterW);
        this._updateSelection(gutterW);
        this._updateSearchHighlights(gutterW);
        this._updateBracketMatch(gutterW);
        this._updateActiveLine(gutterW);
        this._updateGutterActive();
        this._updateIndentGuides();
    }

    /** Remove preload placeholder — called externally after scroll is restored */
    removePreload() {
        if (this._preloadEl) {
            this._preloadEl.remove();
            this._preloadEl = null;
        }
    }

    _buildHTMLLangMap(model, firstVisible, lastVisible) {
        // Scan full document for <script>/<style> open/close tags
        // Returns object mapping lineNumber → 'javascript'|'css' for embedded lines
        const map = {};
        const lineCount = model.getLineCount();
        let insideTag = null; // 'javascript' or 'css'
        for (let i = 0; i < lineCount; i++) {
            const line = model.getLine(i);
            if (insideTag) {
                // Check for closing tag
                const closeRe = insideTag === 'javascript' ? /<\/script>/i : /<\/style>/i;
                if (closeRe.test(line)) {
                    // This line has the closing tag — treat as HTML
                    insideTag = null;
                } else {
                    map[i] = insideTag;
                }
            } else {
                // Check for opening tag (only if no close on same line)
                const scriptOpen = /<script[\s>]/i.test(line) && !/<\/script>/i.test(line);
                const styleOpen = /<style[\s>]/i.test(line) && !/<\/style>/i.test(line);
                if (scriptOpen) insideTag = 'javascript';
                else if (styleOpen) insideTag = 'css';
            }
        }
        return map;
    }

    _commentStateCache = null;
    _commentStateCacheVersion = -1;

    _buildCommentStateMap(model, firstVisible, lastVisible) {
        // Build/use cached per-line comment state, only re-scan when content changes
        if (this._commentStateCacheVersion !== model.version) {
            this._commentStateCache = this._scanCommentState(model);
            this._commentStateCacheVersion = model.version;
        }
        // Extract visible portion from cache
        const map = {};
        const cache = this._commentStateCache;
        if (cache) {
            for (let i = firstVisible; i <= lastVisible; i++) {
                if (cache[i]) map[i] = cache[i];
            }
        }
        return map;
    }

    _scanCommentState(model) {
        // Scan entire document once, return array of comment states per line
        const lineCount = model.getLineCount();
        const states = new Array(lineCount);
        let insideComment = null; // null | 'comment' | 'doccomment'

        for (let i = 0; i < lineCount; i++) {
            const line = model.getLine(i);
            if (insideComment) {
                states[i] = insideComment;
                if (line.indexOf('*/') >= 0) {
                    insideComment = null;
                }
            } else {
                const docIdx = line.indexOf('/**');
                const blockIdx = line.indexOf('/*');
                if (docIdx >= 0 && line.indexOf('*/', docIdx + 3) === -1) {
                    insideComment = 'doccomment';
                    states[i] = 'doccomment';
                } else if (blockIdx >= 0 && line.indexOf('*/', blockIdx + 2) === -1) {
                    insideComment = 'comment';
                    states[i] = 'comment';
                }
                // Single-line block comments (/* ... */ on same line) → let tokenizer handle
            }
        }
        return states;
    }

    _renderLine(text, langCfg, langId, commentScope) {
        if (!text && text !== '') return '&nbsp;';
        if (!langCfg) return CZEngine.escapeHTML(text) || '&nbsp;';
        // If entire line is inside a multiline comment, render as single scope
        if (commentScope) {
            const escaped = CZEngine.escapeHTML(text);
            return `<span class="syn-${commentScope}">${escaped}</span>` || '&nbsp;';
        }
        const tokens = CZEngine.tokenize(text, langCfg, langId);
        const html = CZEngine.renderTokens(tokens);
        return html || '&nbsp;';
    }

    // ===== CURSOR =====
    _lastCursorLine = -1;
    _lastCursorCol = -1;
    _updateCursor(gutterW) {
        const x = LINE_PAD + this.cursor.col * this.cw;
        const y = this.cursor.line * this.lh;
        this.cursorEl.style.left = x + 'px';
        this.cursorEl.style.top = y + 'px';
        this.cursorEl.style.height = this.lh + 'px';
        // Only reposition textarea and restart blink when cursor actually moved
        if (this.cursor.line !== this._lastCursorLine || this.cursor.col !== this._lastCursorCol) {
            this._lastCursorLine = this.cursor.line;
            this._lastCursorCol = this.cursor.col;
            // Position hidden textarea at cursor for IME
            this.inputEl.style.left = x + 'px';
            this.inputEl.style.top = y + 'px';
            this.inputEl.style.height = this.lh + 'px';
            this.inputEl.style.fontSize = getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size') || '15px';
            // Restart blink animation
            this.cursorEl.classList.remove('blink');
            void this.cursorEl.offsetWidth; // force reflow
            this.cursorEl.classList.add('blink');
            // Notify listeners
            for (const cb of this._cursorChangeCallbacks) cb(this.cursor);
        }
    }

    _updateActiveLine(gutterW) {
        this.activeLineEl.style.top = (this.cursor.line * this.lh) + 'px';
        this.activeLineEl.style.height = this.lh + 'px';
    }

    _updateGutterActive() {
        const curLine = this.cursor.line;
        // Remove previous active
        if (this._activeGutterEl && this._activeGutterLine !== curLine) {
            this._activeGutterEl.classList.remove('active');
            this._activeGutterEl = null;
        }
        // Find current gutter element
        const div = this._visLines.get(curLine);
        if (div && div._gutterEl) {
            div._gutterEl.classList.add('active');
            this._activeGutterEl = div._gutterEl;
            this._activeGutterLine = curLine;
        }
    }

    // ===== INDENT GUIDES =====
    _indentGuidePool = [];
    _indentGuideUsed = 0;

    _getIndentGuide() {
        if (this._indentGuideUsed < this._indentGuidePool.length) {
            const el = this._indentGuidePool[this._indentGuideUsed++];
            el.style.display = '';
            return el;
        }
        const el = document.createElement('div');
        el.className = 'virt-indent-guide';
        this.indentLayer.appendChild(el);
        this._indentGuidePool.push(el);
        this._indentGuideUsed++;
        return el;
    }

    _updateIndentGuides() {
        const m = this.model;
        const lh = this.lh;
        const cw = this.cw;
        const tabSize = this._detectIndentSize(m);
        const scrollTop = this.scrollEl.scrollTop;
        const viewH = this.scrollEl.clientHeight;
        const first = Math.floor(scrollTop / lh);
        const last = Math.min(m.getLineCount() - 1, Math.ceil((scrollTop + viewH) / lh));

        // Calculate active guide level for highlighting
        const cursorLine = this.cursor.line;
        const cursorLineText = m.getLine(cursorLine);
        const cursorIndent = this._getIndentLevel(cursorLineText, tabSize);
        // If cursor is on a block opener/closer, highlight the children's guide (indent+1)
        const trimmed = cursorLineText.trimEnd();
        const trimmedStart = cursorLineText.trimStart();
        // Detect openers: { [ ( : or HTML opening tag
        const isBlockOpener = /[\{\[\(:]$/.test(trimmed) ||
            (trimmed.endsWith('>') && !trimmed.endsWith('/>') && /<[a-zA-Z]/.test(trimmed));
        // Detect closers: } ] ) or HTML closing tag </...>
        const isBlockCloser = /^[\}\]\)]/.test(trimmedStart) ||
            /^<\/[a-zA-Z]/.test(trimmedStart);

        // When BOTH opener+closer (e.g. "} catch {", "} else {"),
        // use cursor column to decide: before closer → show block above, after opener → show block below
        let effectiveOpener = isBlockOpener;
        let effectiveCloser = isBlockCloser;
        if (isBlockOpener && isBlockCloser) {
            const leadingSpaces = cursorLineText.length - cursorLineText.trimStart().length;
            const closerCol = leadingSpaces + 1; // } and one char after it
            const openerCol = trimmed.length - 1; // { at end
            const col = this.cursor.col;
            if (col <= closerCol) {
                // Cursor at/beside the closing bracket → show block above
                effectiveOpener = false;
                effectiveCloser = true;
            } else if (col >= openerCol) {
                // Cursor at/beside the opening bracket → show block below
                effectiveOpener = true;
                effectiveCloser = false;
            } else {
                // Cursor in middle → show parent scope
                effectiveOpener = false;
                effectiveCloser = false;
            }
        }
        const activeLevel = (effectiveOpener || effectiveCloser) ? cursorIndent + 1 : cursorIndent;

        // Find the block range for active guide (only highlight within this scope)
        let activeStart = cursorLine, activeEnd = cursorLine;
        if (activeLevel > 0) {
            // Scan upward: find where this block starts
            for (let i = cursorLine - 1; i >= 0; i--) {
                const t = m.getLine(i);
                const ind = this._getIndentLevel(t, tabSize);
                if (t.trim() === '') continue;
                if (ind < activeLevel) { activeStart = i + 1; break; }
                if (i === 0) activeStart = 0;
            }

            // Scan downward: find where this block ends
            for (let i = cursorLine + 1; i < m.getLineCount(); i++) {
                const t = m.getLine(i);
                const ind = this._getIndentLevel(t, tabSize);
                if (t.trim() === '') continue;
                if (ind < activeLevel) { activeEnd = i - 1; break; }
                if (i === m.getLineCount() - 1) activeEnd = i;
            }

            // Opener: guide starts AFTER the opener line
            if (effectiveOpener) activeStart = cursorLine + 1;
            // Closer: guide ends BEFORE the closer line
            if (effectiveCloser) activeEnd = cursorLine - 1;
        }

        // Reset pool
        this._indentGuideUsed = 0;

        for (let ln = first; ln <= last; ln++) {
            const lineText = m.getLine(ln);
            const indent = this._getIndentLevel(lineText, tabSize);
            const isBlank = lineText.trim() === '';

            // For blank lines, use the indent of surrounding non-blank lines
            let effectiveIndent = indent;
            if (isBlank) {
                effectiveIndent = this._getBlankLineIndent(ln, m, tabSize);
            }

            for (let level = 1; level <= effectiveIndent; level++) {
                const guide = this._getIndentGuide();
                const x = LINE_PAD + (level - 1) * tabSize * cw;
                guide.style.top = (ln * lh) + 'px';
                guide.style.left = x + 'px';
                guide.style.height = lh + 'px';
                // Only highlight guide within the active block scope
                const isActive = level === activeLevel && ln >= activeStart && ln <= activeEnd;
                guide.classList.toggle('active', isActive);
            }
        }

        // Hide unused pool elements
        for (let i = this._indentGuideUsed; i < this._indentGuidePool.length; i++) {
            this._indentGuidePool[i].style.display = 'none';
        }
    }

    _cachedIndentSize = 0;
    _cachedIndentVersion = -1;

    _detectIndentSize(model) {
        // Cache per model version to avoid re-scanning on every render
        if (this._cachedIndentVersion === model.version && this._cachedIndentSize > 0) {
            return this._cachedIndentSize;
        }
        const lineCount = Math.min(model.getLineCount(), 200);
        // Collect indentation levels, then find smallest positive delta
        const indents = [];
        for (let i = 0; i < lineCount; i++) {
            const line = model.getLine(i);
            const trimmed = line.trimStart();
            if (trimmed === '') continue;
            // Check if file uses tabs
            if (line[0] === '\t') {
                this._cachedIndentSize = 4;
                this._cachedIndentVersion = model.version;
                return 4;
            }
            // Skip block comment continuation lines ( * ...)
            if (trimmed[0] === '*') continue;
            // Count leading spaces
            let spaces = 0;
            for (let j = 0; j < line.length; j++) {
                if (line[j] === ' ') spaces++;
                else break;
            }
            indents.push(spaces);
        }
        // Find smallest positive difference between consecutive indent levels
        let minDelta = Infinity;
        for (let i = 1; i < indents.length; i++) {
            const delta = Math.abs(indents[i] - indents[i - 1]);
            if (delta > 0 && delta < minDelta) {
                minDelta = delta;
            }
        }
        const result = (minDelta !== Infinity && minDelta >= 2 && minDelta <= 8) ? minDelta : 4;
        this._cachedIndentSize = result;
        this._cachedIndentVersion = model.version;
        return result;
    }

    _getIndentLevel(line, tabSize) {
        let spaces = 0;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === ' ') spaces++;
            else if (line[i] === '\t') spaces += tabSize;
            else break;
        }
        return Math.floor(spaces / tabSize);
    }

    _getBlankLineIndent(ln, model, tabSize) {
        // Look up and down for nearest non-blank lines, use minimum indent
        let above = 0, below = 0;
        for (let i = ln - 1; i >= 0; i--) {
            const t = model.getLine(i);
            if (t.trim() !== '') { above = this._getIndentLevel(t, tabSize); break; }
        }
        for (let i = ln + 1; i < model.getLineCount(); i++) {
            const t = model.getLine(i);
            if (t.trim() !== '') { below = this._getIndentLevel(t, tabSize); break; }
        }
        return Math.min(above, below);
    }

    // ===== SELECTION =====
    hasSelection() {
        return this.anchor !== null &&
            (this.anchor.line !== this.cursor.line || this.anchor.col !== this.cursor.col);
    }

    getSelectionRange() {
        if (!this.hasSelection()) return null;
        const a = this.anchor, c = this.cursor;
        let start, end;
        if (a.line < c.line || (a.line === c.line && a.col < c.col)) {
            start = a; end = c;
        } else {
            start = c; end = a;
        }
        return { startLine: start.line, startCol: start.col, endLine: end.line, endCol: end.col };
    }

    getSelectedText() {
        const r = this.getSelectionRange();
        if (!r) return '';
        const m = this.model;
        if (r.startLine === r.endLine) return m.getLine(r.startLine).substring(r.startCol, r.endCol);
        let text = m.getLine(r.startLine).substring(r.startCol);
        for (let i = r.startLine + 1; i < r.endLine; i++) text += '\n' + m.getLine(i);
        text += '\n' + m.getLine(r.endLine).substring(0, r.endCol);
        return text;
    }

    _updateSelection(gutterW) {
        this.selLayer.innerHTML = '';
        if (!this.hasSelection()) return;
        const r = this.getSelectionRange();
        for (let ln = r.startLine; ln <= r.endLine; ln++) {
            const lineLen = this.model.getLineLength(ln);
            const startCol = ln === r.startLine ? r.startCol : 0;
            const endCol = ln === r.endLine ? r.endCol : lineLen;
            if (startCol === endCol && ln !== r.endLine) {
                // Empty line in selection — show thin highlight
            }
            const div = document.createElement('div');
            div.className = 'virt-sel-rect';
            div.style.top = (ln * this.lh) + 'px';
            div.style.left = (LINE_PAD + startCol * this.cw) + 'px';
            div.style.width = ((endCol - startCol) * this.cw || this.cw * 0.5) + 'px';
            div.style.height = this.lh + 'px';
            this.selLayer.appendChild(div);
        }
    }

    _updateSearchHighlights(gutterW) {
        // Remove old search highlights
        this.selLayer.querySelectorAll('.virt-search-match').forEach(el => el.remove());
        if (typeof CZFeatures === 'undefined') return;
        const matches = CZFeatures.getSearchMatches();
        if (!matches || matches.length === 0) return;
        const currentIdx = CZFeatures.getSearchCurrentIdx();
        const m = this.model;
        const scrollTop = this.scrollEl.scrollTop;
        const viewH = this.scrollEl.clientHeight;
        const firstVisLine = Math.floor(scrollTop / this.lh);
        const lastVisLine = Math.min(m.getLineCount() - 1, Math.ceil((scrollTop + viewH) / this.lh));

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const startPos = m.getPositionAt(match.start);
            const endPos = m.getPositionAt(match.end);
            // Skip matches outside visible area
            if (endPos.line < firstVisLine || startPos.line > lastVisLine) continue;

            for (let ln = startPos.line; ln <= endPos.line; ln++) {
                if (ln < firstVisLine || ln > lastVisLine) continue;
                const lineLen = m.getLineLength(ln);
                const sc = ln === startPos.line ? startPos.col : 0;
                const ec = ln === endPos.line ? endPos.col : lineLen;
                const div = document.createElement('div');
                div.className = i === currentIdx ? 'virt-search-match current' : 'virt-search-match';
                div.style.top = (ln * this.lh) + 'px';
                div.style.left = (LINE_PAD + sc * this.cw) + 'px';
                div.style.width = ((ec - sc) * this.cw) + 'px';
                div.style.height = this.lh + 'px';
                this.selLayer.appendChild(div);
            }
        }
    }

    _updateBracketMatch(gutterW) {
        // Remove old bracket highlights
        this.selLayer.querySelectorAll('.virt-bracket-match').forEach(el => el.remove());
        if (typeof CZEngine === 'undefined') return;
        const text = this.model.getValue();
        const offset = this.model.getOffsetAt(this.cursor.line, this.cursor.col);
        const f = typeof CZUI !== 'undefined' ? CZUI.getActiveFile() : null;
        const cfg = f ? CZEngine.getLangConfig(f.language) : null;
        const brackets = CZEngine.getMatchingBrackets(text, offset, cfg);
        if (!brackets || brackets.length !== 2) return;
        for (const bpos of brackets) {
            const pos = this.model.getPositionAt(bpos);
            const div = document.createElement('div');
            div.className = 'virt-bracket-match';
            div.style.top = (pos.line * this.lh) + 'px';
            div.style.left = (LINE_PAD + pos.col * this.cw) + 'px';
            div.style.width = this.cw + 'px';
            div.style.height = this.lh + 'px';
            this.selLayer.appendChild(div);
        }
    }

    // ===== INPUT HANDLING =====
    _bindEvents() {
        const el = this.inputEl;
        const sc = this.scrollEl;

        // Gutter click: select entire line and focus editor
        this.gutter.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const rect = this.gutter.getBoundingClientRect();
            const y = e.clientY - rect.top + sc.scrollTop;
            const line = Math.max(0, Math.min(this.model.getLineCount() - 1, Math.floor(y / this.lh)));
            const lineLen = this.model.getLineLength(line);
            // Select the full line
            this.anchor = { line, col: 0 };
            this.cursor = { line, col: lineLen };
            this.inputEl.focus({ preventScroll: true });
            this._scheduleRender();
        });

        // Focus management
        sc.addEventListener('mousedown', (e) => {
            if (e.target === el) return;
            // Ignore clicks on scrollbar area
            const rect = sc.getBoundingClientRect();
            if (e.clientX > rect.left + sc.clientWidth) return;
            if (e.clientY > rect.top + sc.clientHeight) return;
            e.preventDefault();
            // Clicks below actual content → place cursor at end of last line
            const totalLines = this.model.getLineCount();
            const contentBottom = totalLines * this.lh - sc.scrollTop;
            if (e.clientY - rect.top > contentBottom) {
                this.inputEl.focus({ preventScroll: true });
                const lastLine = totalLines - 1;
                const lastCol = this.model.getLineLength(lastLine);
                this.cursor = { line: lastLine, col: lastCol };
                this.anchor = null;
                this._scheduleRender();
                return;
            }
            this._handleMouseDown(e);
        });
        el.addEventListener('focus', () => { this._focused = true; this.cursorEl.classList.add('blink'); });
        el.addEventListener('blur', () => { this._focused = false; this.cursorEl.classList.remove('blink'); });

        // Input
        el.addEventListener('compositionstart', () => { this._composing = true; });
        el.addEventListener('compositionend', () => {
            this._composing = false;
            this._handleInput();
        });
        el.addEventListener('input', () => {
            if (!this._composing) this._handleInput();
        });

        // Keyboard
        el.addEventListener('keydown', (e) => this._handleKeydown(e));

        // Scroll
        // Scroll
        sc.addEventListener('scroll', () => this._scheduleRender());

        // Mouse selection: use document-level listeners so drag works outside editor
        const onMouseMove = (e) => { if (this._mouseDown) this._handleMouseMove(e); };
        const onMouseUp = () => {
            this._mouseDown = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        // mousedown starts the drag and registers document-level listeners
        this._startDragListeners = () => {
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
        sc.addEventListener('dblclick', (e) => this._handleDblClick(e));

        // Paste
        el.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            if (text) this.insertText(text);
        });

        // Copy/Cut
        el.addEventListener('copy', (e) => {
            e.preventDefault();
            const sel = this.getSelectedText();
            if (sel) e.clipboardData.setData('text/plain', sel);
        });
        el.addEventListener('cut', (e) => {
            e.preventDefault();
            const sel = this.getSelectedText();
            if (sel) {
                e.clipboardData.setData('text/plain', sel);
                this.deleteSelection();
            }
        });

        // Resize
        this._resizeObs = new ResizeObserver(() => this._scheduleRender());
        this._resizeObs.observe(sc);
    }

    _handleInput() {
        const val = this.inputEl.value;
        if (!val) return;
        this.inputEl.value = '';
        this.insertText(val);
    }

    insertText(text) {
        if (this.hasSelection()) this.deleteSelection();
        const endPos = this.model.insert(this.cursor, text);
        this.cursor = { ...endPos };
        this.anchor = null;
        this._scrollToCursor();
        this._onContentChange();
    }

    deleteSelection() {
        const r = this.getSelectionRange();
        if (!r) return '';
        const deleted = this.model.delete(r);
        this.cursor = { line: r.startLine, col: r.startCol };
        this.anchor = null;
        this._onContentChange();
        return deleted;
    }

    _onContentChange() {
        // Notify CZUI that content changed
        if (typeof CZUI !== 'undefined') {
            const f = CZUI.getActiveFile();
            if (f) {
                f.content = this.model.getValue();
                f.dirty = true;
                CZUI.triggerAutosave();
                CZUI.updateFootbar();
            }
        }
        // Trigger autocomplete
        if (typeof CZFeatures !== 'undefined') CZFeatures.onInput();
    }

    // ===== KEYBOARD =====
    _handleKeydown(e) {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;

        // --- Delegate to CZFeatures for ALL feature handling ---
        // CZFeatures handles: autocomplete, auto-close brackets, Emmet, save,
        // comment toggle, duplicate line, move line, search, etc.
        // If CZFeatures calls preventDefault(), we stop here.
        if (typeof CZFeatures !== 'undefined') {
            // Skip only Ctrl+Z/Y/A/C/V/X (EditorView native undo/redo/select/clipboard)
            const isNativeCtrl = ctrl && ['z','y','a','c','v','x'].includes(e.key.toLowerCase());
            // Skip arrow keys when autocomplete is NOT visible (EditorView handles cursor)
            const isArrow = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key);
            const skipArrow = isArrow && !CZFeatures.acVisible;

            if (!isNativeCtrl && !skipArrow) {
                CZFeatures.handleKeydown(e);
                if (e.defaultPrevented) return;
            }
        }

        // Arrow keys
        if (e.key === 'ArrowLeft') { e.preventDefault(); this._moveCursor(0, -1, shift, ctrl); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); this._moveCursor(0, 1, shift, ctrl); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this._moveCursor(-1, 0, shift); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this._moveCursor(1, 0, shift); return; }

        // Home/End
        if (e.key === 'Home') {
            e.preventDefault();
            if (ctrl) this._setCursor(0, 0, shift);
            else this._setCursor(this.cursor.line, 0, shift);
            return;
        }
        if (e.key === 'End') {
            e.preventDefault();
            if (ctrl) {
                const last = this.model.getLineCount() - 1;
                this._setCursor(last, this.model.getLineLength(last), shift);
            } else {
                this._setCursor(this.cursor.line, this.model.getLineLength(this.cursor.line), shift);
            }
            return;
        }

        // Page Up/Down
        if (e.key === 'PageUp') {
            e.preventDefault();
            const lines = Math.floor(this.scrollEl.clientHeight / this.lh);
            this._moveCursor(-lines, 0, shift);
            return;
        }
        if (e.key === 'PageDown') {
            e.preventDefault();
            const lines = Math.floor(this.scrollEl.clientHeight / this.lh);
            this._moveCursor(lines, 0, shift);
            return;
        }

        // Backspace
        if (e.key === 'Backspace') {
            e.preventDefault();
            if (this.hasSelection()) { this.deleteSelection(); }
            else if (this.cursor.col > 0) {
                this.model.delete({ startLine: this.cursor.line, startCol: this.cursor.col - 1,
                    endLine: this.cursor.line, endCol: this.cursor.col });
                this.cursor.col--;
            } else if (this.cursor.line > 0) {
                const prevLen = this.model.getLineLength(this.cursor.line - 1);
                this.model.delete({ startLine: this.cursor.line - 1, startCol: prevLen,
                    endLine: this.cursor.line, endCol: 0 });
                this.cursor = { line: this.cursor.line - 1, col: prevLen };
            }
            this._onContentChange();
            this._scrollToCursor();
            return;
        }

        // Delete key
        if (e.key === 'Delete') {
            e.preventDefault();
            if (this.hasSelection()) { this.deleteSelection(); }
            else if (this.cursor.col < this.model.getLineLength(this.cursor.line)) {
                this.model.delete({ startLine: this.cursor.line, startCol: this.cursor.col,
                    endLine: this.cursor.line, endCol: this.cursor.col + 1 });
            } else if (this.cursor.line < this.model.getLineCount() - 1) {
                this.model.delete({ startLine: this.cursor.line, startCol: this.cursor.col,
                    endLine: this.cursor.line + 1, endCol: 0 });
            }
            this._onContentChange();
            return;
        }

        // Enter
        if (e.key === 'Enter' && !ctrl) {
            e.preventDefault();
            if (this.hasSelection()) this.deleteSelection();
            // Smart indent
            const line = this.model.getLine(this.cursor.line);
            const indent = line.match(/^(\s*)/)[1];
            const before = line.substring(0, this.cursor.col).trimEnd();
            const lastChar = before.slice(-1);
            let insert = '\n' + indent;
            if (lastChar && '{(['.includes(lastChar)) insert += '\t';
            this.insertText(insert);
            return;
        }

        // Tab
        if (e.key === 'Tab') {
            e.preventDefault();
            if (shift) {
                // Outdent
                const line = this.model.getLine(this.cursor.line);
                if (line.startsWith('\t')) {
                    this.model.delete({ startLine: this.cursor.line, startCol: 0,
                        endLine: this.cursor.line, endCol: 1 });
                    this.cursor.col = Math.max(0, this.cursor.col - 1);
                    this._onContentChange();
                }
            } else {
                this.insertText('\t');
            }
            return;
        }

        // Ctrl+Z: Undo
        if (ctrl && e.key === 'z' && !shift) {
            e.preventDefault();
            const pos = this.model.undo();
            if (pos) { this.cursor = pos; this.anchor = null; this._scrollToCursor(); this._onContentChange(); }
            return;
        }
        // Ctrl+Y / Ctrl+Shift+Z: Redo
        if (ctrl && (e.key === 'y' || (e.key === 'z' && shift))) {
            e.preventDefault();
            const pos = this.model.redo();
            if (pos) { this.cursor = pos; this.anchor = null; this._scrollToCursor(); this._onContentChange(); }
            return;
        }

        // Ctrl+A: Select all
        if (ctrl && e.key === 'a') {
            e.preventDefault();
            this.anchor = { line: 0, col: 0 };
            const last = this.model.getLineCount() - 1;
            this.cursor = { line: last, col: this.model.getLineLength(last) };
            this._scheduleRender();
            return;
        }
    }

    // ===== CURSOR MOVEMENT =====
    _moveCursor(dLine, dCol, shift, wordJump) {
        let { line, col } = this.cursor;
        const m = this.model;

        if (dCol !== 0) {
            if (wordJump) {
                // Ctrl+Arrow: jump by word
                const lineText = m.getLine(line);
                if (dCol > 0) {
                    const after = lineText.substring(col);
                    const match = after.match(/^\s*\w+|^\s*\S/);
                    col += match ? match[0].length : 1;
                } else {
                    const before = lineText.substring(0, col);
                    const match = before.match(/\w+\s*$|\S\s*$/);
                    col -= match ? match[0].length : 1;
                }
            } else {
                col += dCol;
            }
            // Wrap to prev/next line
            if (col < 0) {
                if (line > 0) { line--; col = m.getLineLength(line); }
                else col = 0;
            } else if (col > m.getLineLength(line)) {
                if (line < m.getLineCount() - 1) { line++; col = 0; }
                else col = m.getLineLength(line);
            }
        }
        if (dLine !== 0) {
            line = Math.max(0, Math.min(m.getLineCount() - 1, line + dLine));
            col = Math.min(col, m.getLineLength(line));
        }

        this._setCursor(line, col, shift);
    }

    _setCursor(line, col, extendSelection) {
        if (extendSelection) {
            if (!this.anchor) this.anchor = { ...this.cursor };
        } else {
            this.anchor = null;
        }
        this.cursor = { line, col };
        this._scrollToCursor();
        this._scheduleRender();
        // Notify autocomplete of cursor position change
        if (typeof CZFeatures !== 'undefined') CZFeatures.handleCursorMove();
    }

    _scrollToCursor() {
        const y = this.cursor.line * this.lh;
        const viewH = this.scrollEl.clientHeight;
        const st = this.scrollEl.scrollTop;
        // Vertical auto-scroll — keep cursor visible with 1-line margin
        if (y < st) this.scrollEl.scrollTop = Math.max(0, y);
        else if (y + this.lh > st + viewH) this.scrollEl.scrollTop = y - viewH + this.lh;

        // Horizontal auto-scroll — cursor position is relative to scroll container
        const cursorX = LINE_PAD + this.cursor.col * this.cw;
        const viewW = this.scrollEl.clientWidth;
        const sl = this.scrollEl.scrollLeft;
        const margin = this.cw * 2; // 2 char margin
        if (cursorX - sl > viewW - margin) {
            this.scrollEl.scrollLeft = cursorX - viewW + this.cw * 4;
        } else if (cursorX - sl < margin) {
            this.scrollEl.scrollLeft = Math.max(0, cursorX - this.cw * 4);
        }
    }

    // ===== MOUSE =====
    _mouseDown = false;
    _getLineColFromMouse(e) {
        const rect = this.scrollEl.getBoundingClientRect();
        const x = e.clientX - rect.left + this.scrollEl.scrollLeft - LINE_PAD;
        const y = e.clientY - rect.top + this.scrollEl.scrollTop;
        const line = Math.max(0, Math.min(this.model.getLineCount() - 1, Math.floor(y / this.lh)));
        const col = Math.max(0, Math.min(this.model.getLineLength(line), Math.round(x / this.cw)));
        return { line, col };
    }

    _handleMouseDown(e) {
        this.inputEl.focus({ preventScroll: true });
        const pos = this._getLineColFromMouse(e);
        if (e.shiftKey) {
            if (!this.anchor) this.anchor = { ...this.cursor };
            this.cursor = pos;
        } else {
            this.cursor = pos;
            this.anchor = { ...pos };
        }
        this._mouseDown = true;
        if (this._startDragListeners) this._startDragListeners();
        this._scheduleRender();
    }

    _handleMouseMove(e) {
        if (!this._mouseDown) return;
        const pos = this._getLineColFromMouse(e);
        this.cursor = pos;
        this._scheduleRender();
    }

    _handleDblClick(e) {
        const pos = this._getLineColFromMouse(e);
        const line = this.model.getLine(pos.line);
        // Select word under cursor (supports Unicode letters)
        const isWordChar = (ch) => /[\p{L}\p{N}_]/u.test(ch);
        let start = pos.col, end = pos.col;
        while (start > 0 && isWordChar(line[start - 1])) start--;
        while (end < line.length && isWordChar(line[end])) end++;
        if (start === end) {
            // Didn't match word chars, try selecting non-whitespace
            while (start > 0 && /\S/.test(line[start - 1])) start--;
            while (end < line.length && /\S/.test(line[end])) end++;
        }
        this.anchor = { line: pos.line, col: start };
        this.cursor = { line: pos.line, col: end };
        this._scheduleRender();
    }

    // ===== PUBLIC API =====
    focus() { this.inputEl.focus({ preventScroll: true }); }
    onCursorChange(cb) { this._cursorChangeCallbacks.push(cb); }

    setValue(text) {
        this.model.setValue(text);
        // Clamp cursor to valid range (don't reset to 0,0 — caller may restore position)
        const maxLine = Math.max(0, this.model.getLineCount() - 1);
        if (this.cursor.line > maxLine) {
            this.cursor = { line: maxLine, col: 0 };
        }
        this.anchor = null;
        this._visLines.forEach(d => { d.remove(); d._gutterEl?.remove(); });
        this._visLines.clear();
        this._commentStateCacheVersion = -1; // invalidate comment cache
        this._scheduleRender();
    }

    getValue() { return this.model.getValue(); }

    getCursorOffset() {
        return this.model.getOffsetAt(this.cursor.line, this.cursor.col);
    }

    getScrollTop() { return this.scrollEl.scrollTop; }
    setScrollTop(v) { this.scrollEl.scrollTop = v; }

    /** Get cursor position info for footbar */
    getCursorInfo() {
        return { line: this.cursor.line + 1, col: this.cursor.col + 1 };
    }

    destroy() {
        this._resizeObs?.disconnect();
        this.container.innerHTML = '';
    }
}

return { View };
})();
