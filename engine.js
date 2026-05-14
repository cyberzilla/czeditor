// ==========================================
// CZEditor Engine v2.0 — Language, Syntax, Autocomplete, Emmet
// ==========================================

const CZEngine = (() => {
    const langCache = {};
    const LANG_DIR = 'lang';

    // ===== LANGUAGE LOADER =====
    async function loadLanguage(langId) {
        if (langId === 'plaintext') return null;
        if (langCache[langId]) return langCache[langId];
        try {
            const r = await fetch(`${LANG_DIR}/${langId}.json`);
            if (!r.ok) return null;
            const cfg = await r.json();
            cfg._compiled = cfg.syntax.map(rule => {
                const flags = rule.flags || '';
                return { re: new RegExp(rule.match, 'g' + flags), scope: rule.scope };
            });
            langCache[langId] = cfg;
            return cfg;
        } catch (e) { console.warn('Lang load fail:', langId, e); return null; }
    }

    function getLangConfig(langId) { return langCache[langId] || null; }

    // ===== TOKENIZER =====
    function tokenize(text, langConfig) {
        if (!langConfig || !langConfig._compiled) return [{ text, scope: null }];
        const rules = langConfig._compiled;
        const tokens = [];
        const len = text.length;
        const covered = new Uint8Array(len);
        const hits = [];

        for (const rule of rules) {
            rule.re.lastIndex = 0;
            let m;
            while ((m = rule.re.exec(text)) !== null) {
                const start = m.index, end = start + m[0].length;
                let overlap = false;
                for (let i = start; i < end; i++) { if (covered[i]) { overlap = true; break; } }
                if (overlap) continue;
                for (let i = start; i < end; i++) covered[i] = 1;
                hits.push({ start, end, scope: rule.scope, text: m[0] });
            }
        }
        hits.sort((a, b) => a.start - b.start);

        let pos = 0;
        for (const h of hits) {
            if (h.start > pos) tokens.push({ text: text.slice(pos, h.start), scope: null });
            tokens.push({ text: h.text, scope: h.scope });
            pos = h.end;
        }
        if (pos < len) tokens.push({ text: text.slice(pos), scope: null });
        return tokens;
    }

    function escapeHTML(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function renderTokens(tokens, bracketPositions) {
        let html = '';
        let globalPos = 0;
        const bp = bracketPositions || [];

        for (const tok of tokens) {
            let escaped = escapeHTML(tok.text);
            if (bp.length === 2) {
                const chars = [];
                for (let i = 0; i < tok.text.length; i++) {
                    const gp = globalPos + i;
                    const ec = escapeHTML(tok.text[i]);
                    if (gp === bp[0] || gp === bp[1]) {
                        chars.push('<span class="syn-bracket-match">' + ec + '</span>');
                    } else {
                        chars.push(ec);
                    }
                }
                escaped = chars.join('');
            }
            globalPos += tok.text.length;
            if (tok.scope) {
                html += `<span class="syn-${tok.scope}">${escaped}</span>`;
            } else {
                html += escaped;
            }
        }
        return html;
    }

    // ===== BRACKET MATCHING (uses tokenizer for accurate skip map) =====
    function getMatchingBrackets(text, pos, langConfig) {
        const open = ['{','[','('], close = ['}',']',')'];
        let ti = -1, dir = 0;
        if (open.includes(text[pos])) { ti = pos; dir = 1; }
        else if (close.includes(text[pos])) { ti = pos; dir = -1; }
        else if (pos > 0 && open.includes(text[pos-1])) { ti = pos-1; dir = 1; }
        else if (pos > 0 && close.includes(text[pos-1])) { ti = pos-1; dir = -1; }
        if (ti === -1) return [];

        // Build skip map using tokenizer — skips ALL non-plain scopes
        // (string, comment, regex, decorator, template literals, etc.)
        const skip = new Uint8Array(text.length);
        if (langConfig && langConfig._compiled) {
            const tokens = tokenize(text, langConfig);
            let offset = 0;
            for (const tok of tokens) {
                if (tok.scope !== null) {
                    for (let i = offset; i < offset + tok.text.length; i++) skip[i] = 1;
                }
                offset += tok.text.length;
            }
        }
        if (skip[ti]) return [];

        const ch = text[ti];
        const idx = Math.max(open.indexOf(ch), close.indexOf(ch));
        const match = dir === 1 ? close[idx] : open[idx];
        let depth = 0;

        if (dir === 1) {
            for (let i = ti + 1; i < text.length; i++) {
                if (skip[i]) continue;
                if (text[i] === ch) depth++;
                else if (text[i] === match) { if (depth === 0) return [ti, i]; depth--; }
            }
        } else {
            for (let i = ti - 1; i >= 0; i--) {
                if (skip[i]) continue;
                if (text[i] === ch) depth++;
                else if (text[i] === match) { if (depth === 0) return [i, ti]; depth--; }
            }
        }
        return [];
    }

    // ===== AUTOCOMPLETE =====
    function getAutocompleteItems(word, text, langConfig) {
        if (!word || word.length < 1) return [];
        const lw = word.toLowerCase();
        const items = [];
        const seen = new Set();

        function addItem(label, type, detail) {
            if (seen.has(label)) return;
            seen.add(label);
            const ll = label.toLowerCase();
            if (!ll.startsWith(lw) && !fuzzyMatch(lw, ll)) return;
            const score = ll.startsWith(lw) ? 0 : 1;
            items.push({ label, type, detail, score });
        }

        if (langConfig) {
            const snips = langConfig.snippets || {};
            for (const k in snips) addItem(k, 'snippet', snips[k].description);
            const ac = langConfig.autocomplete || {};
            (ac.keywords || []).forEach(k => addItem(k, 'keyword', 'keyword'));
            (ac.builtins || []).forEach(k => addItem(k, 'function', 'built-in'));
        }

        // Scrape identifiers from document
        const idRegex = /\b[a-zA-Z_$][a-zA-Z0-9_$]{2,}\b/g;
        let m;
        while ((m = idRegex.exec(text)) !== null) {
            if (m[0] !== word) addItem(m[0], 'variable', 'identifier');
        }

        items.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label));
        return items.slice(0, 30);
    }

    function fuzzyMatch(query, target) {
        let qi = 0;
        for (let ti = 0; ti < target.length && qi < query.length; ti++) {
            if (target[ti] === query[qi]) qi++;
        }
        return qi === query.length;
    }

    function highlightMatch(label, word) {
        if (!word) return escapeHTML(label);
        const lw = word.toLowerCase(), ll = label.toLowerCase();
        let result = '', qi = 0;
        for (let i = 0; i < label.length; i++) {
            if (qi < lw.length && ll[i] === lw[qi]) {
                result += `<span class="ac-match">${escapeHTML(label[i])}</span>`;
                qi++;
            } else {
                result += escapeHTML(label[i]);
            }
        }
        return result;
    }

    // ===== EMMET ENGINE =====
    function expandEmmet(token, langId, langConfig) {
        // 1. Check snippets first
        if (langConfig && langConfig.snippets && langConfig.snippets[token]) {
            return langConfig.snippets[token].body;
        }
        // 2. HTML Emmet parser
        if (langId === 'html') return expandHTMLEmmet(token, langConfig);
        // 3. CSS dynamic abbreviations
        if (langId === 'css') return expandCSSEmmet(token);
        return null;
    }

    function expandHTMLEmmet(abbr, langConfig) {
        if (!abbr || abbr.length === 0) return null;
        // Reject if it looks like plain text
        if (/\s/.test(abbr) || /^[0-9]/.test(abbr)) return null;

        const voidTags = (langConfig && langConfig.voidTags) ||
            ['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'];

        try {
            let pos = 0;
            function parseExpr() {
                const nodes = [];
                let node = parseClimbOrChild();
                nodes.push(node);
                while (pos < abbr.length && abbr[pos] === '+') {
                    pos++;
                    nodes.push(parseClimbOrChild());
                }
                return nodes;
            }
            function parseClimbOrChild() {
                let node = parseMult();
                while (pos < abbr.length) {
                    if (abbr[pos] === '>') {
                        pos++;
                        const child = parseMult();
                        appendDeepest(node, child);
                    } else if (abbr[pos] === '^') {
                        pos++;
                        break;
                    } else break;
                }
                return node;
            }
            function parseMult() {
                let node = parseGroup();
                if (pos < abbr.length && abbr[pos] === '*') {
                    pos++;
                    let n = ''; while (pos < abbr.length && /\d/.test(abbr[pos])) n += abbr[pos++];
                    node.repeat = parseInt(n) || 1;
                }
                return node;
            }
            function parseGroup() {
                if (pos < abbr.length && abbr[pos] === '(') {
                    pos++;
                    const inner = parseExpr();
                    if (pos < abbr.length && abbr[pos] === ')') pos++;
                    return { type: 'group', children: inner, repeat: 1 };
                }
                return parseTag();
            }
            function parseTag() {
                const node = { type: 'tag', tag: '', id: '', classes: [], text: '', attrs: {}, children: [], repeat: 1, numbered: false };
                while (pos < abbr.length && /[a-zA-Z0-9-]/.test(abbr[pos])) node.tag += abbr[pos++];
                while (pos < abbr.length && (abbr[pos] === '#' || abbr[pos] === '.' || abbr[pos] === '[')) {
                    if (abbr[pos] === '#') { pos++; let v=''; while (pos<abbr.length&&/[a-zA-Z0-9_-]/.test(abbr[pos])) v+=abbr[pos++]; node.id=v; }
                    else if (abbr[pos] === '.') { pos++; let v=''; while (pos<abbr.length&&/[a-zA-Z0-9_-]/.test(abbr[pos])) v+=abbr[pos++]; node.classes.push(v); }
                    else if (abbr[pos] === '[') { pos++; let a=''; while (pos<abbr.length&&abbr[pos]!==']') a+=abbr[pos++]; pos++; const pts=a.split('='); node.attrs[pts[0]]=pts[1]||''; }
                }
                if (pos < abbr.length && abbr[pos] === '{') {
                    pos++; let t = '', d = 1;
                    while (pos < abbr.length && d > 0) { if (abbr[pos]==='{') d++; else if (abbr[pos]==='}') {d--;if(d===0){pos++;break;}} t+=abbr[pos++]; }
                    node.text = t;
                }
                if (!node.tag && (node.id || node.classes.length)) node.tag = 'div';
                if (!node.tag && !node.id && !node.classes.length && !node.text) return node;
                node.numbered = (node.tag+node.id+node.classes.join('')+node.text).includes('$');
                return node;
            }
            function appendDeepest(parent, child) {
                if (parent.type === 'group') {
                    const last = parent.children[parent.children.length-1];
                    if (last) appendDeepest(last, child);
                    else parent.children.push(child);
                } else {
                    if (parent.children.length > 0) appendDeepest(parent.children[parent.children.length-1], child);
                    else parent.children.push(child);
                }
            }
            function render(nodes, indent, counter) {
                let out = '';
                for (const node of nodes) {
                    const rep = node.repeat || 1;
                    for (let i = 1; i <= rep; i++) {
                        if (node.type === 'group') {
                            out += render(node.children, indent, i);
                        } else {
                            if (!node.tag) continue;
                            const num = i;
                            const tag = node.tag.replace(/\$/g, num);
                            const id = node.id.replace(/\$/g, num);
                            const cls = node.classes.map(c => c.replace(/\$/g, num));
                            const txt = node.text.replace(/\$/g, num);
                            let attrs = '';
                            if (id) attrs += ` id="${id}"`;
                            if (cls.length) attrs += ` class="${cls.join(' ')}"`;
                            for (const k in node.attrs) { const v=node.attrs[k].replace(/\$/g,num); attrs += v ? ` ${k}="${v}"` : ` ${k}`; }
                            if (voidTags.includes(tag.toLowerCase())) {
                                out += `${indent}<${tag}${attrs}>\n`;
                            } else if (node.children.length) {
                                out += `${indent}<${tag}${attrs}>\n`;
                                out += render(node.children, indent+'\t', num);
                                out += `${indent}</${tag}>\n`;
                            } else {
                                out += `${indent}<${tag}${attrs}>${txt}$1</${tag}>\n`;
                            }
                        }
                    }
                }
                return out;
            }
            const ast = parseExpr();
            if (pos < abbr.length) return null; // Didn't consume all input
            const result = render(ast, '', 1).replace(/\n$/, '');
            if (!result || result === '<>$1</>') return null;
            return result;
        } catch (e) { return null; }
    }

    function expandCSSEmmet(token) {
        // Dynamic patterns: m10 → margin: 10px; p10-20 → padding: 10px 20px;
        const propMap = {
            'm':'margin','p':'padding','w':'width','h':'height',
            'mt':'margin-top','mr':'margin-right','mb':'margin-bottom','ml':'margin-left',
            'pt':'padding-top','pr':'padding-right','pb':'padding-bottom','pl':'padding-left',
            'fz':'font-size','fw':'font-weight','lh':'line-height','ls':'letter-spacing',
            'ta':'text-align','td':'text-decoration','tt':'text-transform',
            'bd':'border','bdrs':'border-radius','bg':'background','bgc':'background-color',
            'c':'color','op':'opacity','zi':'z-index','t':'top','r':'right','b':'bottom','l':'left',
            'mw':'max-width','mh':'max-height','miw':'min-width','mih':'min-height',
            'g':'gap','fl':'flex'
        };
        const match = token.match(/^([a-z]+)(-?\d+(?:-\d+)*)(?:(p|e|r|vh|vw|%))?$/);
        if (match) {
            const prop = propMap[match[1]];
            if (prop) {
                const unitMap = { p:'%', e:'em', r:'rem', vh:'vh', vw:'vw', '%':'%' };
                const unit = match[3] ? (unitMap[match[3]] || 'px') : 'px';
                const vals = match[2].split('-').map(v => v + unit);
                return `${prop}: ${vals.join(' ')};`;
            }
        }
        return null;
    }

    // ===== AUTO CLOSE TAG =====
    function getAutoCloseTag(text, pos) {
        const before = text.substring(0, pos);
        const match = before.match(/<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>$/);
        if (!match) return null;
        const tag = match[1].toLowerCase();
        const voidTags = ['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'];
        if (voidTags.includes(tag)) return null;
        // Check if it's a self-closing tag
        if (before.endsWith('/>')) return null;
        return `</${match[1]}>`;
    }

    // ===== LANGUAGE DETECTION =====
    function detectLanguage(content) {
        if (!content || !content.trim()) return 'plaintext';
        if (/(<\?xml|<svg|<xsl:|xmlns[:=])/i.test(content)) return 'xml';
        if (/(<html|<body|<div|<p|<span|<!DOCTYPE)/i.test(content)) return 'html';
        if (/([\\.#][a-zA-Z0-9\-_]+\s*\{|[a-zA-Z\-]+\s*:\s*[^;]+;)/.test(content) && !/<[^>]+>/.test(content)) return 'css';
        if (/(function\s+|const\s+|let\s+|var\s+|=>|console\.log|window\.|document\.)/.test(content)) return 'javascript';
        if (/(<\?php|namespace\s|use\s.*\\|\$[a-zA-Z])/.test(content)) return 'php';
        if (/(def\s+\w+|import\s+\w+|class\s+\w+.*:|print\s*\(|if\s+.*:$)/m.test(content)) return 'python';
        if (/\b(public\s+class|private\s+static|System\.out\.println|import\s+java\.)/m.test(content)) return 'java';
        if (/\b(fun\s+\w+|val\s+|var\s+|companion\s+object|data\s+class|suspend\s+fun)/m.test(content)) return 'kotlin';
        if (/\b(using\s+System|namespace\s+\w+|Console\.Write|async\s+Task)/m.test(content)) return 'csharp';
        if (/(#include\s*<|#define\s+|int\s+main\s*\(|std::)/m.test(content)) return 'c';
        if (/\b(SELECT\s+.*\s+FROM|INSERT\s+INTO|CREATE\s+TABLE|ALTER\s+TABLE)/im.test(content)) return 'sql';
        if (/^#!\s*\/(?:bin|usr\/bin)\/(?:ba)?sh/m.test(content)) return 'shell';
        if (/\b(Sub\s+\w+|Dim\s+\w+|End\s+Sub|Module\s+\w+)/m.test(content)) return 'vb';
        if (/^---\s*$/m.test(content) && /^\s*[a-zA-Z_]+\s*:/m.test(content)) return 'yaml';
        if (/@echo\s+off|\bSETLOCAL\b|\bENDLOCAL\b|%%[a-zA-Z]/im.test(content)) return 'batch';
        if (/\$[a-zA-Z_]+\s*=|\b(?:Get|Set|New|Remove|Write)-[A-Z][a-z]+|\[CmdletBinding\(\)\]|\bparam\s*\(/m.test(content)) return 'powershell';
        return 'plaintext';
    }

    function detectByExtension(ext) {
        const map = {
            // JavaScript
            js:'javascript', mjs:'javascript', cjs:'javascript', jsx:'javascript',
            // TypeScript
            ts:'typescript', tsx:'typescript', mts:'typescript',
            // Web
            html:'html', htm:'html', xhtml:'html',
            css:'css', scss:'css', less:'css',
            // XML/SVG
            xml:'xml', svg:'xml', xsl:'xml', xslt:'xml', xsd:'xml',
            rss:'xml', atom:'xml', xaml:'xml', plist:'xml',
            csproj:'xml', fsproj:'xml', vbproj:'xml', vcxproj:'xml',
            props:'xml', targets:'xml', resx:'xml', nuspec:'xml', wsdl:'xml',
            // Python
            py:'python', pyw:'python',
            // PHP
            php:'php', phtml:'php',
            // Java
            java:'java',
            // Kotlin
            kt:'kotlin', kts:'kotlin',
            // C#
            cs:'csharp',
            // C/C++
            c:'c', h:'c', cpp:'c', hpp:'c', cc:'c', cxx:'c', hh:'c', hxx:'c', ino:'c',
            // Visual Basic
            vb:'vb', vbs:'vb', bas:'vb', cls:'vb', frm:'vb',
            // SQL
            sql:'sql', ddl:'sql', dml:'sql',
            // Shell
            sh:'shell', bash:'shell', zsh:'shell', fish:'shell', ksh:'shell',
            // Windows scripting
            bat:'batch', cmd:'batch',
            ps1:'powershell', psm1:'powershell', psd1:'powershell', ps1xml:'powershell',
            // Data formats
            json:'json', jsonc:'json', json5:'json',
            yml:'yaml', yaml:'yaml',
            // Markdown
            md:'markdown', markdown:'markdown',
            // Config (treat as YAML or relevant)
            toml:'yaml', ini:'yaml', cfg:'yaml',
            // Dockerfile / Makefile (shell-like)
            dockerfile:'shell', makefile:'shell'
        };
        return map[ext] || null;
    }

    // ===== PUBLIC API =====
    return {
        loadLanguage, getLangConfig, tokenize, renderTokens,
        getMatchingBrackets, getAutocompleteItems, highlightMatch,
        expandEmmet, getAutoCloseTag, detectLanguage, detectByExtension, escapeHTML
    };
})();
