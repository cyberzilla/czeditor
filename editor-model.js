// ==========================================
// CZEditor Model — Monaco-style Line-based Text Storage
// ==========================================
const EditorModel = (() => {
    'use strict';

    class TextModel {
        constructor() {
            this.lines = [''];
            this.version = 0;
            this._listeners = [];
            this._undoStack = [];
            this._redoStack = [];
            this._lastEditTime = 0;
            this._COALESCE_MS = 400;
        }

        getLineCount() { return this.lines.length; }
        getLine(n) { return this.lines[n] || ''; }
        getLineLength(n) { return (this.lines[n] || '').length; }
        getValue() { return this.lines.join('\n'); }

        setValue(text) {
            this.lines = (text || '').split('\n');
            this.version++;
            this._undoStack = [];
            this._redoStack = [];
            this._fire({ type: 'full' });
        }

        getTotalLength() {
            let len = 0;
            for (let i = 0; i < this.lines.length; i++) {
                len += this.lines[i].length;
                if (i < this.lines.length - 1) len++;
            }
            return len;
        }

        getOffsetAt(line, col) {
            let offset = 0;
            const maxLine = Math.min(line, this.lines.length - 1);
            for (let i = 0; i < maxLine; i++) offset += this.lines[i].length + 1;
            offset += Math.min(col, this.lines[maxLine].length);
            return offset;
        }

        getPositionAt(offset) {
            let remaining = offset;
            for (let i = 0; i < this.lines.length; i++) {
                if (remaining <= this.lines[i].length) return { line: i, col: remaining };
                remaining -= this.lines[i].length + 1;
            }
            const last = this.lines.length - 1;
            return { line: last, col: this.lines[last].length };
        }

        clampPosition(line, col) {
            line = Math.max(0, Math.min(line, this.lines.length - 1));
            col = Math.max(0, Math.min(col, this.lines[line].length));
            return { line, col };
        }

        insert(pos, text) {
            if (!text) return pos;
            const { line, col } = this.clampPosition(pos.line, pos.col);
            const before = this.lines[line].substring(0, col);
            const after = this.lines[line].substring(col);
            const insertLines = text.split('\n');

            this._pushUndo({ type: 'insert', pos: { line, col }, text });

            if (insertLines.length === 1) {
                this.lines[line] = before + insertLines[0] + after;
            } else {
                const newLines = [before + insertLines[0]];
                for (let i = 1; i < insertLines.length - 1; i++) newLines.push(insertLines[i]);
                newLines.push(insertLines[insertLines.length - 1] + after);
                this.lines.splice(line, 1, ...newLines);
            }

            this.version++;
            const endLine = line + insertLines.length - 1;
            const endCol = insertLines.length === 1 ? col + text.length : insertLines[insertLines.length - 1].length;
            const endPos = { line: endLine, col: endCol };
            this._fire({ type: 'insert', pos: { line, col }, text, endPos });
            return endPos;
        }

        delete(range) {
            const start = this.clampPosition(range.startLine, range.startCol);
            const end = this.clampPosition(range.endLine, range.endCol);
            if (start.line === end.line && start.col === end.col) return '';

            let deleted = '';
            if (start.line === end.line) {
                deleted = this.lines[start.line].substring(start.col, end.col);
            } else {
                deleted = this.lines[start.line].substring(start.col);
                for (let i = start.line + 1; i < end.line; i++) deleted += '\n' + this.lines[i];
                deleted += '\n' + this.lines[end.line].substring(0, end.col);
            }

            this._pushUndo({ type: 'delete', pos: { line: start.line, col: start.col }, text: deleted });

            const before = this.lines[start.line].substring(0, start.col);
            const after = this.lines[end.line].substring(end.col);
            this.lines.splice(start.line, end.line - start.line + 1, before + after);

            this.version++;
            this._fire({ type: 'delete', startPos: start, endPos: end, deleted });
            return deleted;
        }

        replaceRange(range, text) {
            this.delete(range);
            return this.insert({ line: range.startLine, col: range.startCol }, text);
        }

        // Undo/Redo with coalescing
        _pushUndo(op) {
            const now = Date.now();
            const last = this._undoStack[this._undoStack.length - 1];

            if (last && (now - this._lastEditTime) < this._COALESCE_MS
                && last.type === 'insert' && op.type === 'insert'
                && op.text.length === 1 && !/\n/.test(op.text)
                && last.pos.line === op.pos.line) {
                last.text += op.text;
                this._lastEditTime = now;
                this._redoStack = [];
                return;
            }
            if (last && (now - this._lastEditTime) < this._COALESCE_MS
                && last.type === 'delete' && op.type === 'delete'
                && op.text.length === 1 && !/\n/.test(op.text)
                && last.pos.line === op.pos.line) {
                if (op.pos.col === last.pos.col - 1) {
                    last.text = op.text + last.text;
                    last.pos.col = op.pos.col;
                } else if (op.pos.col === last.pos.col) {
                    last.text += op.text;
                }
                this._lastEditTime = now;
                this._redoStack = [];
                return;
            }

            this._undoStack.push(op);
            this._redoStack = [];
            this._lastEditTime = now;
            if (this._undoStack.length > 500) this._undoStack.shift();
        }

        undo() {
            const op = this._undoStack.pop();
            if (!op) return null;
            this._lastEditTime = 0;

            if (op.type === 'insert') {
                const endPos = this.getPositionAt(this.getOffsetAt(op.pos.line, op.pos.col) + op.text.length);
                const before = this.lines[op.pos.line].substring(0, op.pos.col);
                const after = this.lines[endPos.line].substring(endPos.col);
                this.lines.splice(op.pos.line, endPos.line - op.pos.line + 1, before + after);
                this.version++;
                this._redoStack.push(op);
                this._fire({ type: 'undo' });
                return { line: op.pos.line, col: op.pos.col };
            } else if (op.type === 'delete') {
                const insertLines = op.text.split('\n');
                const before = this.lines[op.pos.line].substring(0, op.pos.col);
                const after = this.lines[op.pos.line].substring(op.pos.col);
                if (insertLines.length === 1) {
                    this.lines[op.pos.line] = before + insertLines[0] + after;
                } else {
                    const newLines = [before + insertLines[0]];
                    for (let i = 1; i < insertLines.length - 1; i++) newLines.push(insertLines[i]);
                    newLines.push(insertLines[insertLines.length - 1] + after);
                    this.lines.splice(op.pos.line, 1, ...newLines);
                }
                this.version++;
                this._redoStack.push(op);
                this._fire({ type: 'undo' });
                const endLine = op.pos.line + insertLines.length - 1;
                const endCol = insertLines.length === 1 ? op.pos.col + op.text.length : insertLines[insertLines.length - 1].length;
                return { line: endLine, col: endCol };
            }
            return null;
        }

        redo() {
            const op = this._redoStack.pop();
            if (!op) return null;
            this._lastEditTime = 0;

            if (op.type === 'insert') {
                const insertLines = op.text.split('\n');
                const before = this.lines[op.pos.line].substring(0, op.pos.col);
                const after = this.lines[op.pos.line].substring(op.pos.col);
                if (insertLines.length === 1) {
                    this.lines[op.pos.line] = before + insertLines[0] + after;
                } else {
                    const newLines = [before + insertLines[0]];
                    for (let i = 1; i < insertLines.length - 1; i++) newLines.push(insertLines[i]);
                    newLines.push(insertLines[insertLines.length - 1] + after);
                    this.lines.splice(op.pos.line, 1, ...newLines);
                }
                this.version++;
                this._undoStack.push(op);
                this._fire({ type: 'redo' });
                const endLine = op.pos.line + insertLines.length - 1;
                const endCol = insertLines.length === 1 ? op.pos.col + op.text.length : insertLines[insertLines.length - 1].length;
                return { line: endLine, col: endCol };
            } else if (op.type === 'delete') {
                const endPos = this.getPositionAt(this.getOffsetAt(op.pos.line, op.pos.col) + op.text.length);
                const before = this.lines[op.pos.line].substring(0, op.pos.col);
                const after = this.lines[endPos.line].substring(endPos.col);
                this.lines.splice(op.pos.line, endPos.line - op.pos.line + 1, before + after);
                this.version++;
                this._undoStack.push(op);
                this._fire({ type: 'redo' });
                return { line: op.pos.line, col: op.pos.col };
            }
            return null;
        }

        onChange(cb) { this._listeners.push(cb); }
        offChange(cb) { this._listeners = this._listeners.filter(l => l !== cb); }
        _fire(e) { this._listeners.forEach(cb => { try { cb(e); } catch (err) { console.error(err); } }); }
    }

    return { TextModel };
})();
