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

    // ===== FILE ICON SYSTEM (Atom Material Icons — CSS class) =====
    // Based on https://github.com/AtomMaterialUI/a-file-icon-idea
    // All SVG paths are in file-icons.css — JS only returns class names.

    // Extension → CSS class suffix mapping
    const FILE_ICON_MAP = {
        // JavaScript
        js: 'js', mjs: 'js', cjs: 'js',
        jsx: 'jsx', tsx: 'react',
        // TypeScript
        ts: 'ts', mts: 'ts', cts: 'ts',
        // Markup
        html: 'html', htm: 'html',
        xml: 'xml', xsl: 'xml',
        svg: 'svg',
        vue: 'vue',
        // Styles
        css: 'css', scss: 'sass', sass: 'sass', less: 'less',
        styl: 'stylus',
        // Data
        json: 'json', json5: 'json5',
        yaml: 'yaml', yml: 'yaml',
        toml: 'toml', ini: 'configs',
        csv: 'csv',
        // Documentation
        md: 'markdown', mdx: 'markdown',
        txt: 'text', log: 'log',
        // Languages
        py: 'python', pyw: 'python',
        rb: 'ruby', erb: 'ruby',
        php: 'php',
        java: 'java', class: 'java',
        kt: 'kotlin', kts: 'kotlinscript',
        swift: 'swift',
        c: 'c', h: 'c',
        cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
        cs: 'csharp',
        rs: 'rust',
        go: 'go',
        lua: 'lua',
        r: 'r', R: 'r',
        sql: 'sql',
        dart: 'dart',
        scala: 'scala',
        perl: 'perl', pl: 'perl',
        // Media
        png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
        ico: 'image', webp: 'image', bmp: 'image', avif: 'image',
        psd: 'psd',
        mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio',
        mp4: 'video', avi: 'video', mkv: 'video', webm: 'video', mov: 'video',
        // Subtitles / Lyrics
        srt: 'subtitle', vtt: 'subtitle', ass: 'subtitle', ssa: 'subtitle', sub: 'subtitle', lrc: 'subtitle',
        // Archives
        zip: 'archive', tar: 'archive', gz: 'archive', rar: 'archive',
        '7z': 'archive', bz2: 'archive',
        // Shell
        sh: 'shell', bash: 'shell', zsh: 'shell',
        bat: 'windows', cmd: 'windows',
        ps1: 'powershell',
        // Config / Env
        env: 'envs',
        gitignore: 'gitignore', gitattributes: 'git',
        dockerignore: 'dockerignore',
        lock: 'lock',
        editorconfig: 'editorconfig',
        // Fonts
        woff2: 'font', woff: 'font', ttf: 'font', otf: 'font', eot: 'font',
        // DevOps / Tools
        dockerfile: 'docker',
        eslintrc: 'eslint', eslintignore: 'eslintignore',
        prettierrc: 'prettierconfig', prettierignore: 'prettierignore',
        npmrc: 'npm', npmignore: 'npmignore',
        // Misc
        graphql: 'graphql', gql: 'graphql',
        proto: 'protobuf',
        tex: 'tex', latex: 'tex',
        pdf: 'pdf',
        gradle: 'gradle',
        makefile: 'makefile',
    };

    // Full-filename matches (case-insensitive)
    const FILE_NAME_MAP = {
        'dockerfile': 'docker',
        'docker-compose.yml': 'dockercompose',
        'docker-compose.yaml': 'dockercompose',
        '.gitignore': 'gitignore',
        '.gitattributes': 'git',
        '.editorconfig': 'editorconfig',
        '.eslintrc': 'eslint',
        '.eslintrc.js': 'eslint',
        '.eslintrc.json': 'eslint',
        '.eslintrc.yml': 'eslint',
        'eslint.config.js': 'eslintconfig',
        'eslint.config.mjs': 'eslintconfig',
        '.prettierrc': 'prettierconfig',
        '.prettierrc.js': 'prettierconfig',
        '.prettierrc.json': 'prettierconfig',
        '.prettierignore': 'prettierignore',
        'package.json': 'npm',
        'package-lock.json': 'npmlock',
        '.npmrc': 'npm',
        '.npmignore': 'npmignore',
        'tsconfig.json': 'tsconfig',
        'webpack.config.js': 'webpack',
        'webpack.config.ts': 'webpack',
        'babel.config.js': 'babel',
        '.babelrc': 'babel',
        'vite.config.js': 'vite',
        'vite.config.ts': 'vite',
        'makefile': 'makefile',
        'gruntfile.js': 'gruntfile',
        'gulpfile.js': 'gulpfile',
        'license': 'license',
        'license.md': 'license',
        'readme.md': 'readme',
        'readme': 'readme',
        'changelog.md': 'changelog',
        'changelog': 'changelog',
        '.env': 'envs',
        '.env.local': 'envs',
        '.env.production': 'envs',
        '.env.development': 'envs',
        '.dockerignore': 'dockerignore',
        'yarn.lock': 'yarnlock',
        '.yarnrc': 'yarn',
        'nuxt.config.js': 'nuxt',
        'nuxt.config.ts': 'nuxt',
        'next.config.js': 'nextjs',
        'next.config.mjs': 'nextjs',
        'tailwind.config.js': 'tailwindcss',
        'tailwind.config.ts': 'tailwindcss',
        'postcss.config.js': 'postcss',
        'rollup.config.js': 'rollup',
        'jest.config.js': 'jest',
        'jest.config.ts': 'jest',
        'vitest.config.ts': 'vitest',
        '.gitmodules': 'git',
        'pom.xml': 'maven',
        'build.gradle': 'gradle',
        'settings.gradle': 'gradle',
        'composer.json': 'composer',
        'cargo.toml': 'cargo',
        'cargo.lock': 'cargo',
        'go.mod': 'goconfig',
        'go.sum': 'goconfig',
        'requirements.txt': 'pythonconfigs',
        'pipfile': 'pipfile',
        'gemfile': 'ruby',
        'rakefile': 'ruby',
        '.rubocop.yml': 'rubyrc',
        'manifest.json': 'json',
        'sw.js': 'nodejs',
    };

    /**
     * Get CSS icon class for a filename
     * @param {string} name — filename (e.g. "index.js")
     * @returns {string} — CSS class (e.g. "fi fi-js")
     */
    function getFileIconClass(name) {
        const lower = name.toLowerCase();
        // 1. Exact full-name match
        if (FILE_NAME_MAP[lower]) return 'fi fi-' + FILE_NAME_MAP[lower];
        // 2. Extension match
        const ext = lower.split('.').pop();
        if (FILE_ICON_MAP[ext]) return 'fi fi-' + FILE_ICON_MAP[ext];
        // 3. Dotfile (e.g. ".eslintrc.json" → check "eslintrc")
        const parts = lower.split('.');
        if (parts.length > 1) {
            const withoutDot = parts.slice(0, -1).join('').replace(/^\./, '');
            if (FILE_ICON_MAP[withoutDot]) return 'fi fi-' + FILE_ICON_MAP[withoutDot];
        }
        // 4. Default
        return 'fi fi-default';
    }

    /** Return HTML string for a file icon <span> */
    function fileIconHTML(name) {
        return `<span class="${getFileIconClass(name)}"></span>`;
    }

    // Folder name → CSS class suffix mapping
    const FOLDER_NAME_MAP = {
        // Version control
        '.git': 'git', '.github': 'github', '.gitlab': 'gitlab', '.gitea': 'gitea',
        '.svn': 'svn', '.hg': 'mercurial',
        // Source
        'src': 'src', 'source': 'src', 'lib': 'lib', 'libs': 'lib',
        'dist': 'dist', 'build': 'dist', 'out': 'dist', 'output': 'dist',
        'bin': 'dist', 'target': 'target',
        // Web
        'public': 'global', 'static': 'global', 'assets': 'resource',
        'images': 'images', 'img': 'images', 'icons': 'icons',
        'fonts': 'fonts', 'font': 'fonts',
        'styles': 'styles', 'css': 'styles', 'scss': 'sass', 'sass': 'sass',
        'less': 'less', 'stylus': 'stylus',
        // JS ecosystem
        'node_modules': 'node', 'bower_components': 'bower',
        'vendor': 'lib', 'packages': 'packages',
        '.npm': 'node', '.yarn': 'yarn',
        // Frameworks
        'components': 'components', 'pages': 'views', 'views': 'views',
        'layouts': 'layouts', 'templates': 'views',
        'routes': 'routes', 'router': 'routes',
        'middleware': 'middleware', 'plugins': 'plugin',
        'modules': 'components', 'store': 'redux-stores',
        'stores': 'redux-stores', 'state': 'redux-stores',
        'actions': 'redux-actions', 'reducers': 'redux-reducers',
        // Backend
        'api': 'api', 'server': 'server', 'controllers': 'controllers',
        'models': 'models', 'services': 'server', 'helpers': 'helper',
        'utils': 'tools', 'tools': 'tools', 'scripts': 'scripts',
        // Config
        'config': 'config', 'configs': 'config', 'configuration': 'config',
        '.vscode': 'vscode', '.idea': 'idea', '.vs': 'vs',
        'env': 'env', '.env': 'env',
        // Testing
        'test': 'tests', 'tests': 'tests', '__tests__': 'tests',
        'spec': 'tests', 'specs': 'tests',
        'e2e': 'e2e', 'cypress': 'cypress',
        '__mocks__': 'mocks', 'mocks': 'mocks', 'mock': 'mocks',
        'fixtures': 'fixtures', '__fixtures__': 'fixtures',
        'coverage': 'coverage',
        // Docs
        'docs': 'docs', 'doc': 'docs', 'documentation': 'docs',
        // i18n
        'lang': 'i18n', 'langs': 'i18n', 'language': 'i18n', 'languages': 'i18n',
        'i18n': 'i18n', 'locale': 'i18n', 'locales': 'i18n',
        'translations': 'i18n', 'translate': 'i18n',
        // Database
        'db': 'db', 'database': 'db', 'sql': 'sql',
        'migrations': 'db', 'seeds': 'seed', 'seeders': 'seed',
        // DevOps
        'docker': 'docker', '.docker': 'docker',
        'kubernetes': 'kubernetes', 'k8s': 'kubernetes',
        '.circleci': 'circleci', '.github/workflows': 'ci',
        'deploy': 'deploy', 'terraform': 'terraform',
        // Specific frameworks
        '.next': 'next', '.nuxt': 'nuxt', '.svelte-kit': 'svelte',
        '.angular': 'angular', '.expo': 'expo',
        'android': 'android', 'ios': 'ios',
        // Content
        'logs': 'logs', 'log': 'logs',
        'temp': 'temp', 'tmp': 'temp', 'cache': 'temp',
        'backup': 'archive', 'backups': 'archive',
        'download': 'download', 'downloads': 'download',
        'upload': 'upload', 'uploads': 'upload',
        // Other
        'shared': 'shared', 'common': 'shared',
        'hooks': 'hook', 'decorators': 'decorators',
        'providers': 'providers', 'guards': 'guard',
        'resolvers': 'resolver', 'interceptors': 'interceptor',
        'events': 'events', 'listeners': 'events',
        'jobs': 'job', 'queues': 'queue',
        'notifications': 'notification', 'mailers': 'mailers',
        'tasks': 'tasks',
        'ui': 'ui', 'widgets': 'ui',
        'storybook': 'storybook', '.storybook': 'storybook',
        'graphql': 'graphql', 'prisma': 'prisma',
        'audio': 'audio', 'video': 'video', 'media': 'images',
        'svg': 'svg', 'animations': 'animations',
        'themes': 'themes', 'theme': 'themes',
    };

    /**
     * Get folder icon CSS class
     * @param {string} name — folder name (e.g. "src")
     * @param {boolean} open — is folder expanded
     * @returns {string} — CSS classes
     */
    function getFolderIconClass(name, open) {
        const lower = name.toLowerCase();
        const suffix = FOLDER_NAME_MAP[lower];
        if (suffix) {
            return 'fi ' + (open ? 'fi-fo-' + suffix + '-open' : 'fi-fo-' + suffix);
        }
        return 'fi ' + (open ? 'fi-folder-open' : 'fi-folder');
    }

    /** Return HTML string for a folder icon <span> */
    function folderIconHTML(open, name) {
        return `<span class="${getFolderIconClass(name || '', open)}"></span>`;
    }

    // Legacy compat stubs
    const ICON_STORAGE_KEY = 'cz_file_icons';
    let fileIcons = {};
    function loadFileIcons() {
        try { localStorage.removeItem(ICON_STORAGE_KEY); } catch (e) { /* ignore */ }
    }
    function saveFileIcons() { }
    function getFileIcons() { return {}; }
    function setFileIcons() { }
    loadFileIcons();

    const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'avif']);
    const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a', 'opus', 'webm']);
    const VIDEO_EXTENSIONS = new Set(['mp4', 'avi', 'mkv', 'webm', 'mov', 'wmv', 'flv', 'mpg', 'mpeg', 'm4v', 'ts', '3gp', 'ogv']);
    const BINARY_EXTENSIONS = new Set([
        // Fonts
        'woff2', 'woff', 'ttf', 'otf', 'eot',
        // Archives
        'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz', 'jar',
        // Audio
        'mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a', 'opus',
        // Video
        'mp4', 'avi', 'mkv', 'webm', 'mov', 'wmv', 'flv', 'mpg', 'mpeg', 'm4v', 'ts', '3gp', 'ogv',
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
    function isAudioFile(name) {
        const ext = name.split('.').pop().toLowerCase();
        return AUDIO_EXTENSIONS.has(ext);
    }
    function isVideoFile(name) {
        const ext = name.split('.').pop().toLowerCase();
        return VIDEO_EXTENSIONS.has(ext);
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
    function isCsvFile(name) {
        const ext = name.split('.').pop().toLowerCase();
        return ['csv', 'tsv'].includes(ext);
    }
    function parseCsv(text, name) {
        const isTsv = name && name.split('.').pop().toLowerCase() === 'tsv';
        const sep = isTsv ? '\t' : ',';
        const rows = [];
        const lines = text.split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            const row = [];
            let inQuote = false, cell = '';
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQuote) {
                    if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
                    else if (ch === '"') inQuote = false;
                    else cell += ch;
                } else {
                    if (ch === '"') inQuote = true;
                    else if (ch === sep) { row.push(cell); cell = ''; }
                    else if (ch === '\r') { /* skip */ }
                    else cell += ch;
                }
            }
            row.push(cell);
            rows.push(row);
        }
        return rows;
    }
    function renderCsvTable(rows) {
        if (!rows.length) return '<p style="color:var(--text-muted);padding:16px">Empty CSV</p>';
        const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let html = '<div class="csv-table-wrapper"><table class="csv-table">';
        // Header row
        html += '<thead><tr>';
        for (const cell of rows[0]) {
            html += '<th>' + esc(cell) + '</th>';
        }
        html += '</tr></thead><tbody>';
        // Data rows
        for (let i = 1; i < rows.length; i++) {
            html += '<tr>';
            for (let j = 0; j < rows[0].length; j++) {
                const val = rows[i][j] !== undefined ? rows[i][j] : '';
                html += '<td>' + esc(val) + '</td>';
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        html += '<div class="csv-info">' + (rows.length - 1) + ' rows \u00d7 ' + rows[0].length + ' columns</div>';
        return html;
    }
    function isPreviewableFile(f) {
        return f && !f.isImage && !f.isBinary && (f.isSvg || isSvgFile(f.name) || isMarkdownFile(f.name) || isHtmlFile(f.name) || isCsvFile(f.name) || isLottieContent(f));
    }
    function isLottieContent(f) {
        if (!f || !f.content || !f.name.endsWith('.json')) return false;
        // Return cached result — avoids JSON.parse on every keystroke
        if (typeof f._isLottie === 'boolean') return f._isLottie;
        try {
            const d = JSON.parse(f.content);
            const result = !!(d && typeof d.v !== 'undefined' && typeof d.fr === 'number' && Array.isArray(d.layers));
            f._isLottie = result;
            if (result) f._lottieData = d; // cache parsed data for reuse in loadLottieAnimation
            return result;
        } catch (e) {
            f._isLottie = false;
            return false;
        }
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
        return `<span class="${getFileIconClass(name)}" style="width:48px;height:48px"></span>`;
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
        const isNonEditor = activeFile && (activeFile.isImage || activeFile.isBinary || activeFile.isAudio || activeFile.isVideo);

        welcomeScreen.classList.toggle('active', empty);
        // Don't show editor-body if active file is a binary/image/audio/video
        editorBody.classList.toggle('hidden', empty || isNonEditor);
        toolbarRight.classList.toggle('hidden', empty);
        editorFooter.classList.toggle('hidden', empty);
        // Active line highlight handled by EditorView
        // Show/hide image viewer based on whether active file is a binary image
        const iv = $('image-viewer');
        if (iv) iv.classList.toggle('hidden', empty || !activeFile?.isImage);
        // Show/hide audio player
        const ap = $('audio-player-panel');
        if (ap) ap.classList.toggle('hidden', empty || !activeFile?.isAudio);
        // Show/hide video player
        const vp = $('video-player-panel');
        if (vp) vp.classList.toggle('hidden', empty || !activeFile?.isVideo);
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
        // Snapshot cursor position of currently active file before saving
        _saveCursorState();
        // Save all files — strip non-serializable and runtime-only properties
        const saveable = files.map(f => {
            const { fileHandle, parentHandle, dirty, ...rest } = f;
            // Strip blob: URLs (non-persistent), keep data: URLs (base64)
            if (rest.imageUrl && rest.imageUrl.startsWith('blob:')) {
                delete rest.imageUrl;
            }
            if (rest.audioUrl && rest.audioUrl.startsWith('blob:')) {
                delete rest.audioUrl;
            }
            if (rest.videoUrl && rest.videoUrl.startsWith('blob:')) {
                delete rest.videoUrl;
            }
            return rest;
        });
        // Save full data to IndexedDB (no size limit)
        if (typeof CZCache !== 'undefined') {
            CZCache.set('cz_files', saveable);
        }
        // Save metadata to localStorage for fast pre-render
        // Keep active file content (truncated if huge), strip large non-active files
        const meta = saveable.map(f => {
            if (f.id === activeFileId) {
                // Keep active file content for pre-render, truncate if very large
                if (f.content && f.content.length > 200000) {
                    return { ...f, content: f.content.substring(0, 200000) };
                }
                return f;
            }
            // Strip content from non-active files > 100KB
            if (f.content && f.content.length > 100000) {
                return { ...f, content: '' };
            }
            return f;
        });
        try {
            localStorage.setItem('cz_files', JSON.stringify(meta));
        } catch (_) {
            // Quota exceeded even with trimming — strip all large content
            const slim = saveable.map(f => {
                if (f.content && f.content.length > 50000) return { ...f, content: '' };
                return f;
            });
            try { localStorage.setItem('cz_files', JSON.stringify(slim)); } catch (_2) { /* give up */ }
        }
        if (activeFileId) localStorage.setItem('cz_active_id', activeFileId);
        else localStorage.removeItem('cz_active_id');
    }

    /** Save cursor position & scroll of the currently active file */
    function _saveCursorState() {
        if (!editorView || !activeFileId) return;
        // Don't overwrite saved state if editor has no content yet (initial load)
        if (editorView.model.getLineCount() <= 1 && !editorView.model.getLine(0)) return;
        const f = files.find(x => x.id === activeFileId);
        if (!f || f.isImage || f.isBinary || f.isAudio || f.isVideo) return;
        // Guard: don't save cursor if the model clearly doesn't belong to this file
        // (e.g. activeFileId was changed but model still has the previous file's content)
        // Use a tolerance check — small differences can occur from newline normalization
        const modelLen = editorView.model.getTotalLength();
        const fileLen = f.content ? f.content.length : 0;
        if (fileLen > 0 && Math.abs(modelLen - fileLen) / fileLen > 0.1) return;
        if (fileLen === 0 && modelLen > 0) return;
        const info = editorView.getCursorInfo();
        f.cursorLine = info.line - 1;  // store 0-indexed
        f.cursorCol = info.col - 1;
        f.scrollTop = editorView.getScrollTop();
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
            const icon = fileIconHTML(file.name);
            const pin = file.isPinned ? '<span class="tab-pin-icon fi fi-ui fi-ui-pin"></span>' : '';
            const dot = file.dirty ? '<span class="tab-dot">●</span>' : '';
            tab.innerHTML = `${icon}<span class="tab-name">${pin}${dot}${CZEngine.escapeHTML(file.name)}</span>
            <span class="tab-close" data-close="${file.id}"><span class="fi fi-ui fi-ui-close"></span></span>`;
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
        // Stop audio/video if closing such a file
        if (f.isAudio) stopAudioPlayer();
        if (f.isVideo) stopVideoPlayer();
        // Revoke blob URLs
        if (f.videoUrl) { try { URL.revokeObjectURL(f.videoUrl); } catch(e){} }
        if (f.audioUrl) { try { URL.revokeObjectURL(f.audioUrl); } catch(e){} }
        if (f.imageUrl) { try { URL.revokeObjectURL(f.imageUrl); } catch(e){} }
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
            const detected = CZEngine.detectByFilename(newName) || CZEngine.detectByExtension(ext);
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
        // Save cursor state of the file we're leaving
        _saveCursorState();

        const f = files.find(x => x.id === id);
        if (!f) return;
        activeFileId = id;

        // Render tabs first (this calls checkEmptyState internally)
        renderTabs(); scrollToActiveTab(opts && opts.instant);
        highlightActiveInTree();
        localStorage.setItem('cz_active_id', activeFileId);

        const imageViewer = $('image-viewer');
        const binaryPanel = $('binary-file-panel');

        const audioPanel = $('audio-player-panel');
        const videoPanel = $('video-player-panel');

        // Helper to hide all media panels
        function hideAllMedia() {
            if (imageViewer) imageViewer.classList.add('hidden');
            if (binaryPanel) binaryPanel.classList.add('hidden');
            if (audioPanel) audioPanel.classList.add('hidden');
            if (videoPanel) videoPanel.classList.add('hidden');
        }

        if (f.isVideo) {
            // Switching to video — hide everything else, show video player
            editorBody.classList.add('hidden');
            hideAllMedia();
            stopAudioPlayer();
            showVideoPlayer(f);
            updateFootbar();
        } else if (f.isAudio) {
            // Switching to audio — hide editor, image, binary, video panels, show audio player
            editorBody.classList.add('hidden');
            hideAllMedia();
            stopVideoPlayer();
            showAudioPlayer(f);
            updateFootbar();
        } else if (f.isBinary) {
            // Switching to binary — hide editor, image, audio, video panels, show binary panel
            editorBody.classList.add('hidden');
            hideAllMedia();
            stopAudioPlayer(); stopVideoPlayer();
            showBinaryPanel(f);
            updateFootbar();
        } else if (f.isImage) {
            // Switching to image — hide editor, binary, audio, video panels, show image viewer
            editorBody.classList.add('hidden');
            hideAllMedia();
            stopAudioPlayer(); stopVideoPlayer();
            showImageViewer(f);
            updateFootbar();
        } else {
            // Normal code file — hide all media panels, keep editor-body visible
            hideAllMedia();
            stopVideoPlayer();
            stopAudioPlayer();
            editorBody.classList.remove('hidden');
            editingArea.value = f.content;
            langSelector.value = f.language;
            lastBracketKey = '';
            // Restore cursor position and scroll SYNCHRONOUSLY after content change
            if (editorView) {
                const totalLines = editorView.model.getLineCount();
                const maxLine = Math.max(0, totalLines - 1);
                const line = Math.min(f.cursorLine || 0, maxLine);
                const maxCol = editorView.model.getLineLength(line);
                const col = Math.min(f.cursorCol || 0, maxCol);
                editorView.cursor = { line, col };
                editorView.anchor = null;
                // Set sizer height immediately so scrollTop can be applied
                const viewH = editorView.scrollEl.clientHeight || 400;
                editorView.sizer.style.height = ((totalLines - 1) * editorView.lh + viewH) + 'px';
                // Restore exact scroll position (or center cursor as fallback)
                const maxScroll = Math.max(0, (totalLines - 1) * editorView.lh);
                if (f.scrollTop > 0) {
                    editorView.setScrollTop(Math.min(f.scrollTop, maxScroll));
                } else if (line > 0) {
                    editorView.setScrollTop(Math.min(Math.max(0, line * editorView.lh - viewH / 2), maxScroll));
                } else {
                    editorView.setScrollTop(0);
                }
            }
            // Always update footer immediately (removes footer-binary class for text files)
            updateFootbar();
            // If preload is covering the editor, skip immediate render (user sees preload)
            const hasPreload = editorView && editorView._preloadEl;
            if (!hasPreload) {
                updateEditorVisuals();
            }
            // Load language config, then re-render with syntax colors
            if (editorView) {
                CZEngine.loadLanguage(f.language).then(() => {
                    requestAnimationFrame(() => {
                        // Re-render with syntax highlighting at current scroll position
                        editorView._render(true);
                        updateFootbar();
                        // Remove preload — content is now correct
                        editorView.removePreload();
                        // Focus editor so user can type immediately
                        editorView.focus();
                    });
                });
            } else {
                const ve = document.getElementById('virtual-editor');
                if (ve && ve.firstElementChild) ve.firstElementChild.remove();
            }
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
            img.style.display = 'none'; // Hide until source is ready to prevent broken icon flash
            // Show spinner while loading
            let spinEl = viewer.querySelector('.spin-loader');
            if (!spinEl) {
                spinEl = document.createElement('div');
                spinEl.className = 'spin-loader';
                img.parentElement.insertBefore(spinEl, img);
            }
            spinEl.style.display = '';
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
                img.style.display = ''; // Show image once loaded
                const sp = viewer.querySelector('.spin-loader');
                if (sp) sp.style.display = 'none';
                if (info) {
                    const dims = img.naturalWidth && img.naturalHeight
                        ? `${img.naturalWidth} × ${img.naturalHeight}px`
                        : f.name;
                    info.textContent = dims;
                }
            };
            img.onerror = () => {
                img.style.display = 'none'; // Keep hidden on error
                const sp = viewer.querySelector('.spin-loader');
                if (sp) sp.style.display = 'none';
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

        $('binary-file-icon').innerHTML = getBinaryIcon(f.name);
        $('binary-file-name').textContent = f.name;

        // Get file size — show dots loader while waiting
        const sizeEl = $('binary-file-size');
        if (sizeEl) sizeEl.innerHTML = '<span class="dots-loader"><span></span><span></span><span></span></span>';
        if (isValidHandle(f.fileHandle)) {
            try {
                const file = await f.fileHandle.getFile();
                if (sizeEl) sizeEl.textContent = formatFileSize(file.size);
            } catch (e) {
                if (sizeEl) sizeEl.textContent = '';
            }
        } else {
            if (sizeEl) sizeEl.textContent = '';
        }

        toolbarRight.classList.remove('hidden');
        editorFooter.classList.remove('hidden');
    }

    // ===== AUDIO PLAYER =====
    let _audioEl = null;
    let _audioRafId = 0;

    function formatTime(sec) {
        if (!isFinite(sec) || sec < 0) return '00:00:00';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const pad = v => (v < 10 ? '0' : '') + v;
        return pad(h) + ':' + pad(m) + ':' + pad(s);
    }
    function formatTimeShort(sec) {
        if (!isFinite(sec) || sec < 0) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    async function showAudioPlayer(f) {
        const panel = $('audio-player-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        toolbarRight.classList.remove('hidden');
        editorFooter.classList.remove('hidden');

        $('audio-player-name').textContent = f.name;
        const metaEl = $('audio-player-meta');
        const iconEl = $('audio-player-icon');
        if (metaEl) metaEl.innerHTML = '<span class="dots-loader"><span></span><span></span><span></span></span>';
        if (iconEl) iconEl.classList.remove('playing');

        // Get or create audio element
        _audioEl = $('audio-element');
        if (!_audioEl) return;

        // Set audio source — reuse cached blob URL if available
        let audioSrc = '';
        if (f.audioUrl) {
            audioSrc = f.audioUrl;
        } else if (isValidHandle(f.fileHandle)) {
            try {
                const file = await f.fileHandle.getFile();
                audioSrc = URL.createObjectURL(file);
                f.audioUrl = audioSrc;
            } catch (e) {
                if (metaEl) metaEl.textContent = 'Re-open folder to play audio';
                return;
            }
        }
        if (!audioSrc) {
            if (metaEl) metaEl.textContent = 'No audio source available';
            return;
        }

        _audioEl.src = audioSrc;
        _audioEl.load();

        const progress = $('audio-progress');
        const timeCurrent = $('audio-time-current');
        const timeDuration = $('audio-time-duration');
        const playBtn = $('btn-audio-playpause');
        const fwdBtn = $('btn-audio-forward');
        const bwdBtn = $('btn-audio-backward');
        const volSlider = $('audio-volume');
        const volIcon = $('audio-volume-icon');
        const playIcon = $('audio-playpause-icon');

        // Reset UI
        if (progress) progress.value = 0;
        if (timeCurrent) timeCurrent.textContent = '0:00';
        if (timeDuration) timeDuration.textContent = '0:00';
        if (playIcon) { playIcon.classList.add('fi-ui-play'); playIcon.classList.remove('fi-ui-pause'); }

        // Duration loaded
        _audioEl.onloadedmetadata = () => {
            if (timeDuration) timeDuration.textContent = formatTimeShort(_audioEl.duration);
            // Show file info
            const ext = f.name.split('.').pop().toUpperCase();
            const sizeInfo = _audioEl.duration ? formatTimeShort(_audioEl.duration) : '';
            if (metaEl && !metaEl.dataset.hasMeta) {
                metaEl.textContent = ext + ' • ' + sizeInfo;
            }
        };

        // Progress update loop
        function updateProgress() {
            if (_audioEl && !_audioEl.paused) {
                const pct = (_audioEl.currentTime / _audioEl.duration) * 100 || 0;
                if (progress) progress.value = pct;
                if (timeCurrent) timeCurrent.textContent = formatTimeShort(_audioEl.currentTime);
                _audioRafId = requestAnimationFrame(updateProgress);
            }
        }

        // Play/Pause
        _audioEl.onplay = () => {
            if (playIcon) { playIcon.classList.remove('fi-ui-play'); playIcon.classList.add('fi-ui-pause'); }
            if (iconEl) iconEl.classList.add('playing');
            _audioRafId = requestAnimationFrame(updateProgress);
        };
        _audioEl.onpause = () => {
            if (playIcon) { playIcon.classList.add('fi-ui-play'); playIcon.classList.remove('fi-ui-pause'); }
            if (iconEl) iconEl.classList.remove('playing');
            cancelAnimationFrame(_audioRafId);
        };
        _audioEl.onended = () => {
            if (playIcon) { playIcon.classList.add('fi-ui-play'); playIcon.classList.remove('fi-ui-pause'); }
            if (iconEl) iconEl.classList.remove('playing');
            if (progress) progress.value = 0;
            if (timeCurrent) timeCurrent.textContent = '0:00';
            cancelAnimationFrame(_audioRafId);
        };

        // Button handlers
        if (playBtn) {
            playBtn.onclick = () => {
                if (_audioEl.paused) _audioEl.play();
                else _audioEl.pause();
            };
        }
        if (fwdBtn) {
            fwdBtn.onclick = () => {
                _audioEl.currentTime = Math.min(_audioEl.duration, _audioEl.currentTime + 10);
            };
        }
        if (bwdBtn) {
            bwdBtn.onclick = () => {
                _audioEl.currentTime = Math.max(0, _audioEl.currentTime - 10);
            };
        }

        // Seek
        if (progress) {
            progress.oninput = () => {
                if (_audioEl.duration) {
                    _audioEl.currentTime = (progress.value / 100) * _audioEl.duration;
                    if (timeCurrent) timeCurrent.textContent = formatTimeShort(_audioEl.currentTime);
                }
            };
        }

        if (volSlider) {
            volSlider.value = (_audioEl.volume * 100);
            volSlider.oninput = () => {
                _audioEl.volume = volSlider.value / 100;
                updateVolIcon();
            };
        }
        function updateVolIcon() {
            if (!volIcon) return;
            const ic = volIcon.querySelector('.fi-ui');
            if (!ic) return;
            const muted = _audioEl.muted || _audioEl.volume === 0;
            ic.classList.toggle('fi-ui-mute', muted);
            ic.classList.toggle('fi-ui-unmute', !muted);
        }
        if (volIcon) {
            volIcon.onclick = () => {
                _audioEl.muted = !_audioEl.muted;
                updateVolIcon();
            };
        }

        // Try to read ID3 metadata for mp3 files
        if (f.name.toLowerCase().endsWith('.mp3') && isValidHandle(f.fileHandle)) {
            try {
                const file = await f.fileHandle.getFile();
                const meta = await readID3(file);
                if (meta && metaEl) {
                    const parts = [];
                    if (meta.title) parts.push(meta.title);
                    if (meta.artist) parts.push(meta.artist);
                    if (meta.album) parts.push(meta.album);
                    if (parts.length > 0) {
                        metaEl.textContent = parts.join(' • ');
                        metaEl.dataset.hasMeta = '1';
                    }
                }
            } catch (e) { /* silent */ }
        }
    }

    function stopAudioPlayer() {
        if (_audioEl) {
            _audioEl.pause();
            _audioEl.removeAttribute('src');
            _audioEl.load();
        }
        cancelAnimationFrame(_audioRafId);
    }

    // Basic ID3v2 tag reader for mp3 files
    async function readID3(file) {
        try {
            const buf = await file.slice(0, 4096).arrayBuffer();
            const view = new DataView(buf);
            // Check for ID3v2 header
            if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
                return null; // No ID3v2 tag
            }
            const majorVer = view.getUint8(3);
            const headerSize = (view.getUint8(6) & 0x7f) << 21 |
                               (view.getUint8(7) & 0x7f) << 14 |
                               (view.getUint8(8) & 0x7f) << 7 |
                               (view.getUint8(9) & 0x7f);
            const meta = {};
            let pos = 10;
            const end = Math.min(10 + headerSize, buf.byteLength);
            const decoder = new TextDecoder('utf-8');

            while (pos + 10 < end) {
                const frameId = String.fromCharCode(view.getUint8(pos), view.getUint8(pos+1),
                    view.getUint8(pos+2), majorVer >= 3 ? view.getUint8(pos+3) : 0);
                if (frameId[0] === '\0') break;
                let frameSize;
                if (majorVer >= 3) {
                    frameSize = view.getUint32(pos + 4);
                    pos += 10; // 4 id + 4 size + 2 flags
                } else {
                    frameSize = (view.getUint8(pos+3) << 16) | (view.getUint8(pos+4) << 8) | view.getUint8(pos+5);
                    pos += 6;
                }
                if (frameSize <= 0 || pos + frameSize > end) break;
                const tag = frameId.substring(0, majorVer >= 3 ? 4 : 3);
                if (['TIT2','TIT','TPE1','TPE','TALB','TAL'].includes(tag)) {
                    const encoding = view.getUint8(pos);
                    let text = '';
                    if (encoding === 0 || encoding === 3) {
                        text = decoder.decode(new Uint8Array(buf, pos + 1, frameSize - 1)).replace(/\0/g, '');
                    } else if (encoding === 1 || encoding === 2) {
                        // UTF-16
                        const u16 = new Uint16Array(buf, pos + 1, Math.floor((frameSize - 1) / 2));
                        text = String.fromCharCode(...u16).replace(/\0/g, '').replace(/^\ufeff/, '');
                    }
                    if (tag === 'TIT2' || tag === 'TIT') meta.title = text;
                    else if (tag === 'TPE1' || tag === 'TPE') meta.artist = text;
                    else if (tag === 'TALB' || tag === 'TAL') meta.album = text;
                }
                pos += frameSize;
            }
            return (meta.title || meta.artist || meta.album) ? meta : null;
        } catch (e) { return null; }
    }

    // ===== VIDEO PLAYER =====
    let _videoEl = null;
    let _videoRafId = 0;
    let _videoSkipRegions = [];
    let _videoSkipEnabled = true;
    let _videoSkipToast = null;
    let _videoControlsTimer = 0;
    let _ffmpegLoaded = false;
    let _ffmpegInstance = null;

    function srtToVtt(srtText) {
        let vtt = 'WEBVTT\n\n';
        srtText = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const blocks = srtText.trim().split(/\n\n+/);
        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length < 2) continue;
            let tsIdx = lines.findIndex(l => l.includes('-->'));
            if (tsIdx < 0) continue;
            const ts = lines[tsIdx].replace(/,/g, '.');
            const text = lines.slice(tsIdx + 1).join('\n');
            vtt += ts + '\n' + text + '\n\n';
        }
        return vtt;
    }

    function parsePBF(text) {
        const regions = [];
        const lines = text.replace(/\r\n/g, '\n').split('\n');
        let inSkip = false;
        for (const line of lines) {
            if (line.trim() === '[PlaySkip]') { inSkip = true; continue; }
            if (line.trim().startsWith('[') && inSkip) break;
            if (!inSkip) continue;
            const m = line.match(/^\d+=(\d+)\*(\d+)\*(\d+)/);
            if (m) {
                const enabled = parseInt(m[1], 10);
                const startMs = parseInt(m[2], 10);
                const durationMs = parseInt(m[3], 10);
                if (enabled && durationMs > 0) {
                    regions.push({ start: startMs / 1000, end: (startMs + durationMs) / 1000 });
                }
            }
        }
        return regions;
    }

    function renderSkipMarkers(duration) {
        const container = $('video-skip-markers');
        if (!container) return;
        container.innerHTML = '';
        if (!duration || !_videoSkipRegions.length) return;
        for (const r of _videoSkipRegions) {
            const left = (r.start / duration) * 100;
            const width = ((r.end - r.start) / duration) * 100;
            const marker = document.createElement('div');
            marker.className = 'video-skip-marker';
            marker.style.left = left + '%';
            marker.style.width = Math.max(width, 0.2) + '%';
            container.appendChild(marker);
        }
    }

    function showSkipToast() {
        const toast = $('video-skip-toast');
        if (!toast) return;
        toast.classList.remove('hidden');
        clearTimeout(_videoSkipToast);
        _videoSkipToast = setTimeout(() => toast.classList.add('hidden'), 1500);
    }

    function showVideoControls() {
        const wrapper = $('video-player-wrapper');
        if (wrapper) wrapper.classList.add('controls-visible');
        clearTimeout(_videoControlsTimer);
        _videoControlsTimer = setTimeout(() => {
            if (wrapper && _videoEl && !_videoEl.paused) wrapper.classList.remove('controls-visible');
        }, 3000);
    }

    async function findCompanionFiles(f) {
        const baseName = f.name.replace(/\.[^.]+$/, '');
        const subtitles = [];
        let pbfContent = null;

        // 1. Search in currently open editor tabs
        for (const tab of files) {
            if (tab.id === f.id) continue;
            const n = tab.name.toLowerCase();
            const fb = tab.name.replace(/\.[^.]+$/, '');
            if (fb.toLowerCase() !== baseName.toLowerCase()) continue;
            if (n.endsWith('.srt') || n.endsWith('.vtt')) {
                let content = tab.content;
                if (!content && isValidHandle(tab.fileHandle)) {
                    try { const data = await CZFS.readFile(tab.fileHandle); content = data.content; } catch (e) {}
                }
                if (content) subtitles.push({ name: tab.name, content, ext: n.split('.').pop() });
            }
            if (n.endsWith('.pbf')) {
                let content = tab.content;
                if (!content && isValidHandle(tab.fileHandle)) {
                    try { const data = await CZFS.readFile(tab.fileHandle); content = data.content; } catch (e) {}
                }
                if (content) pbfContent = content;
            }
        }

        // 2. Search in the video file's parent directory (most likely location)
        const dirHandle = f.parentHandle || CZFS.getDirectoryHandle();
        if (dirHandle) {
            try {
                for await (const entry of dirHandle.values()) {
                    if (entry.kind !== 'file') continue;
                    const n = entry.name.toLowerCase();
                    const fb = entry.name.replace(/\.[^.]+$/, '');
                    if (fb.toLowerCase() !== baseName.toLowerCase()) continue;
                    if (n.endsWith('.srt') || n.endsWith('.vtt')) {
                        if (!subtitles.find(s => s.name.toLowerCase() === n)) {
                            try {
                                const file = await entry.getFile();
                                const content = await file.text();
                                subtitles.push({ name: entry.name, content, ext: n.split('.').pop() });
                            } catch (e) {}
                        }
                    }
                    if (n.endsWith('.pbf') && !pbfContent) {
                        try { const file = await entry.getFile(); pbfContent = await file.text(); } catch (e) {}
                    }
                }
            } catch (e) {}
        }
        return { subtitles, pbfContent };
    }

    async function showVideoPlayer(f) {
        const panel = $('video-player-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        toolbarRight.classList.remove('hidden');
        editorFooter.classList.remove('hidden');
        _videoEl = $('video-element');
        if (!_videoEl) return;
        _videoSkipRegions = [];
        const transcodeBanner = $('video-transcode-banner');
        if (transcodeBanner) transcodeBanner.classList.add('hidden');
        let videoSrc = '';
        if (f.videoUrl) {
            // Reuse existing blob URL — no need to recreate
            videoSrc = f.videoUrl;
        } else if (isValidHandle(f.fileHandle)) {
            try {
                const file = await f.fileHandle.getFile();
                videoSrc = URL.createObjectURL(file);
                f.videoUrl = videoSrc;
            } catch (e) { console.warn('[CZUI] Video file handle error:', e); }
        }
        if (!videoSrc) {
            // No source yet — wait for folder restoration before showing error
            const controls = $('video-controls');
            if (controls) controls.style.display = 'none';
            setTimeout(async () => {
                // Re-check after folder may have restored the fileHandle
                if (f.videoUrl) return; // source found in the meantime
                if (isValidHandle(f.fileHandle)) {
                    try {
                        const file = await f.fileHandle.getFile();
                        f.videoUrl = URL.createObjectURL(file);
                        showVideoPlayer(f);
                    } catch (e) {}
                    return;
                }
                // Truly no source — show message
                if (transcodeBanner) transcodeBanner.classList.remove('hidden');
                const msg = $('video-transcode-msg');
                if (msg) msg.textContent = 'Re-open folder to play this video.';
            }, 1500);
            return;
        }
        // Ensure controls are visible for valid sources
        const controls = $('video-controls');
        if (controls) controls.style.display = '';
        // If same video is already loaded, just show the panel — skip re-init
        if (_videoEl.src === videoSrc && !_videoEl.error) {
            // Update time display to reflect current position
            const td = $('video-time-display');
            if (td && _videoEl.duration) td.textContent = formatTime(_videoEl.currentTime) + ' / ' + formatTime(_videoEl.duration);
            return;
        }
        _videoEl.src = videoSrc;
        _videoEl.load();
        while (_videoEl.querySelector('track')) _videoEl.querySelector('track').remove();
        const progressFilled = $('video-progress-filled');
        const progressBuffered = $('video-progress-buffered');
        const timeDisplay = $('video-time-display');
        const playIcon = $('video-playpause-icon');
        const fwdBtn = $('btn-video-forward');
        const bwdBtn = $('btn-video-backward');
        const volSlider = $('video-volume');
        const muteBtn = $('btn-video-mute');
        const muteIcon = $('video-mute-icon');
        const fullscreenBtn = $('btn-video-fullscreen');
        const subtitleBtn = $('btn-video-subtitle');
        const skipToggle = $('btn-video-skip-toggle');
        const wrapper = $('video-player-wrapper');
        const playBtn = $('btn-video-playpause');
        if (progressFilled) progressFilled.style.width = '0%';
        if (timeDisplay) timeDisplay.textContent = '00:00:00 / 00:00:00';
        if (playIcon) { playIcon.classList.add('fi-ui-play'); playIcon.classList.remove('fi-ui-pause'); }
        _videoEl.onerror = () => {
            if (transcodeBanner) transcodeBanner.classList.remove('hidden');
            const msg = $('video-transcode-msg');
            if (msg) msg.textContent = f.name.split('.').pop().toUpperCase() + ' format is not supported by your browser.';
        };
        _videoEl.onloadedmetadata = () => {
            if (timeDisplay) timeDisplay.textContent = '00:00:00 / ' + formatTime(_videoEl.duration);
            renderSkipMarkers(_videoEl.duration);
            // Restore saved playback position
            if (f.videoTime && f.videoTime > 0 && f.videoTime < _videoEl.duration) {
                _videoEl.currentTime = f.videoTime;
                const pct = (f.videoTime / _videoEl.duration) * 100;
                if (progressFilled) progressFilled.style.width = pct + '%';
                const st = $('video-seek-thumb');
                if (st) st.style.left = pct + '%';
                if (timeDisplay) timeDisplay.textContent = formatTime(f.videoTime) + ' / ' + formatTime(_videoEl.duration);
            }
        };
        
        function updateVideoProgress() {
            if (_videoEl && !_videoEl.paused) {
                const pct = (_videoEl.currentTime / _videoEl.duration) * 100 || 0;
                if (progressFilled) progressFilled.style.width = pct + '%';
                const st = $('video-seek-thumb');
                if (st) st.style.left = pct + '%';
                if (timeDisplay) timeDisplay.textContent = formatTime(_videoEl.currentTime) + ' / ' + formatTime(_videoEl.duration);
                // Periodically save position (every ~5s of playback)
                if (Math.floor(_videoEl.currentTime) % 5 === 0) f.videoTime = _videoEl.currentTime;
                if (progressBuffered && _videoEl.buffered.length > 0) {
                    progressBuffered.style.width = ((_videoEl.buffered.end(_videoEl.buffered.length - 1) / _videoEl.duration) * 100) + '%';
                }
                if (_videoSkipEnabled && _videoSkipRegions.length) {
                    const ct = _videoEl.currentTime;
                    for (const r of _videoSkipRegions) {
                        if (ct >= r.start && ct < r.end) { _videoEl.currentTime = r.end; showSkipToast(); break; }
                    }
                }
                _videoRafId = requestAnimationFrame(updateVideoProgress);
            }
        }
        _videoEl.onplay = () => { if (playIcon) { playIcon.classList.remove('fi-ui-play'); playIcon.classList.add('fi-ui-pause'); } _videoRafId = requestAnimationFrame(updateVideoProgress); };
        _videoEl.onpause = () => { if (playIcon) { playIcon.classList.add('fi-ui-play'); playIcon.classList.remove('fi-ui-pause'); } cancelAnimationFrame(_videoRafId); f.videoTime = _videoEl.currentTime; };
        _videoEl.onended = () => { if (playIcon) { playIcon.classList.add('fi-ui-play'); playIcon.classList.remove('fi-ui-pause'); } cancelAnimationFrame(_videoRafId); f.videoTime = 0; };
        if (playBtn) playBtn.onclick = () => { if (_videoEl.paused) _videoEl.play(); else _videoEl.pause(); };
        _videoEl.onclick = () => { if (_videoEl.paused) _videoEl.play(); else _videoEl.pause(); showVideoControls(); };
        _videoEl.ondblclick = () => { if (wrapper) { if (document.fullscreenElement) document.exitFullscreen(); else wrapper.requestFullscreen?.(); } };
        if (fwdBtn) fwdBtn.onclick = () => { _videoEl.currentTime = Math.min(_videoEl.duration, _videoEl.currentTime + 10); f.videoTime = _videoEl.currentTime; };
        if (bwdBtn) bwdBtn.onclick = () => { _videoEl.currentTime = Math.max(0, _videoEl.currentTime - 10); f.videoTime = _videoEl.currentTime; };

        // --- Div-based progress seeking (no range input = perfect tooltip sync) ---
        const progressTrack = $('video-progress-track');
        const timeTooltip = $('video-time-tooltip');
        const seekThumb = $('video-seek-thumb');
        let _isSeeking = false;

        function getSeekPct(e) {
            if (!progressTrack) return 0;
            const rect = progressTrack.getBoundingClientRect();
            return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        }

        function seekTo(pct) {
            if (!_videoEl || !_videoEl.duration) return;
            _videoEl.currentTime = pct * _videoEl.duration;
            if (progressFilled) progressFilled.style.width = (pct * 100) + '%';
            if (seekThumb) seekThumb.style.left = (pct * 100) + '%';
            if (timeDisplay) timeDisplay.textContent = formatTime(_videoEl.currentTime) + ' / ' + formatTime(_videoEl.duration);
            f.videoTime = _videoEl.currentTime;
        }

        if (progressTrack) {
            // Click to seek
            progressTrack.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                _isSeeking = true;
                seekTo(getSeekPct(e));
                e.preventDefault();
            });

            // Drag to seek
            document.addEventListener('mousemove', (e) => {
                if (!_isSeeking) return;
                seekTo(getSeekPct(e));
            });

            document.addEventListener('mouseup', () => {
                _isSeeking = false;
            });

            // Tooltip + hover preview bar on hover
            const hoverBar = $('video-progress-hover');
            progressTrack.addEventListener('mousemove', (e) => {
                if (!_videoEl || !_videoEl.duration || !timeTooltip) return;
                const rect = progressTrack.getBoundingClientRect();
                const rawX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                const pct = rawX / rect.width;
                const hoverTime = pct * _videoEl.duration;
                timeTooltip.textContent = formatTime(hoverTime);
                const tooltipW = timeTooltip.offsetWidth || 60;
                const leftPx = Math.max(tooltipW / 2, Math.min(rawX, rect.width - tooltipW / 2));
                timeTooltip.style.left = leftPx + 'px';
                // Hover preview bar follows cursor
                if (hoverBar) hoverBar.style.width = (pct * 100) + '%';
            });

            progressTrack.addEventListener('mouseleave', () => {
                if (timeTooltip) timeTooltip.style.left = '-9999px';
                if (hoverBar) hoverBar.style.width = '0';
            });
        }
        if (volSlider) {
            volSlider.value = (_videoEl.volume * 100);
            volSlider.oninput = () => {
                _videoEl.volume = volSlider.value / 100;
                _videoEl.muted = false;
                updateVideoMuteIcon();
            };
        }
        function updateVideoMuteIcon() {
            if (!muteIcon) return;
            const muted = _videoEl.muted || _videoEl.volume === 0;
            muteIcon.classList.toggle('fi-ui-mute', muted);
            muteIcon.classList.toggle('fi-ui-unmute', !muted);
        }
        if (muteBtn) {
            muteBtn.onclick = () => { _videoEl.muted = !_videoEl.muted; updateVideoMuteIcon(); };
        }
        if (fullscreenBtn) {
            fullscreenBtn.onclick = () => {
                if (wrapper) { if (document.fullscreenElement) document.exitFullscreen(); else wrapper.requestFullscreen?.(); }
            };
        }
        if (wrapper) wrapper.onmousemove = showVideoControls;
        panel.onkeydown = (e) => {
            if (!_videoEl) return;
            if (e.key === ' ' || e.key === 'k') { e.preventDefault(); if (_videoEl.paused) _videoEl.play(); else _videoEl.pause(); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); _videoEl.currentTime = Math.min(_videoEl.duration, _videoEl.currentTime + 5); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); _videoEl.currentTime = Math.max(0, _videoEl.currentTime - 5); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); _videoEl.volume = Math.min(1, _videoEl.volume + 0.1); if (volSlider) volSlider.value = _videoEl.volume * 100; }
            else if (e.key === 'ArrowDown') { e.preventDefault(); _videoEl.volume = Math.max(0, _videoEl.volume - 0.1); if (volSlider) volSlider.value = _videoEl.volume * 100; }
            else if (e.key === 'f') { if (wrapper) { if (document.fullscreenElement) document.exitFullscreen(); else wrapper.requestFullscreen?.(); } }
            else if (e.key === 'm') { _videoEl.muted = !_videoEl.muted; updateVideoMuteIcon(); }
        };
        panel.tabIndex = 0;

        // --- Toggle toast helper ---
        let _toggleToastTimer = 0;
        function showToggleToast(text) {
            const toast = $('video-toggle-toast');
            if (!toast) return;
            toast.textContent = text;
            toast.classList.add('show');
            clearTimeout(_toggleToastTimer);
            _toggleToastTimer = setTimeout(() => toast.classList.remove('show'), 1200);
        }

        // --- Skip toggle with toast ---
        if (skipToggle) {
            _videoSkipEnabled = true;
            skipToggle.classList.add('active');
            skipToggle.onclick = () => {
                _videoSkipEnabled = !_videoSkipEnabled;
                skipToggle.classList.toggle('active', _videoSkipEnabled);
                skipToggle.classList.toggle('inactive', !_videoSkipEnabled);
                showToggleToast(_videoSkipEnabled ? 'Auto-Skip ON' : 'Auto-Skip OFF');
            };
        }

        const companions = await findCompanionFiles(f);
        console.log('[CZUI] Video companions found:', { subtitles: companions.subtitles.length, hasPBF: !!companions.pbfContent });
        if (companions.pbfContent) {
            _videoSkipRegions = parsePBF(companions.pbfContent);
            console.log('[CZUI] PBF skip regions:', _videoSkipRegions.length);
            if (_videoEl.duration) renderSkipMarkers(_videoEl.duration);
            if (skipToggle && _videoSkipRegions.length > 0) skipToggle.title = `Auto-Skip (${_videoSkipRegions.length} regions)`;
        }

        // --- Subtitles ---
        let _subActive = -1; // -1 = off
        const popover = $('video-subtitle-popover');
        const subList = $('video-sub-list');
        const fontSizeSlider = $('video-sub-fontsize');
        const fontSizeVal = $('video-sub-fontsize-val');
        const posSlider = $('video-sub-position');
        const posVal = $('video-sub-position-val');
        const subOverlay = $('video-subtitle-overlay');
        let _subFontSize = 100;
        let _subPosition = 90; // 90 = near bottom

        // Cue change handler — renders subtitle text in our custom overlay
        function onCueChange() {
            if (!subOverlay) return;
            let html = '';
            for (let i = 0; i < _videoEl.textTracks.length; i++) {
                const track = _videoEl.textTracks[i];
                if (track.mode !== 'hidden') continue;
                if (!track.activeCues) continue;
                for (let j = 0; j < track.activeCues.length; j++) {
                    const cue = track.activeCues[j];
                    html += (html ? '<br>' : '') + cue.text;
                }
            }
            subOverlay.innerHTML = html;
        }

        // Build track list
        const trackValueEl = $('vsp-track-value');
        const panels = popover ? popover.querySelector('.vsp-panels') : null;
        const trackBtn = $('vsp-track-btn');
        const backBtn = $('vsp-back');

        function updateTrackValue(name) {
            if (trackValueEl) trackValueEl.textContent = name;
        }

        let listHtml = '<div class="video-sub-item active" data-idx="-1"><span class="sub-check">✓</span><span class="sub-name">Off</span></div>';
        if (companions.subtitles.length > 0) {
            for (const sub of companions.subtitles) {
                let vttContent = sub.content;
                if (sub.ext === 'srt') vttContent = srtToVtt(sub.content);
                else if (sub.ext !== 'vtt') continue;
                const blob = new Blob([vttContent], { type: 'text/vtt' });
                const url = URL.createObjectURL(blob);
                const track = document.createElement('track');
                track.kind = 'subtitles'; track.label = sub.name; track.srclang = 'und'; track.src = url;
                _videoEl.appendChild(track);
                console.log('[CZUI] Subtitle track added:', sub.name, sub.ext);
            }
            companions.subtitles.forEach((s, i) => {
                listHtml += `<div class="video-sub-item" data-idx="${i}"><span class="sub-check"></span><span class="sub-name">${s.name}</span></div>`;
            });
            // Auto-enable first subtitle (hidden mode = get cue events, custom render)
            if (_videoEl.textTracks.length > 0) {
                _videoEl.textTracks[0].mode = 'hidden';
                _videoEl.textTracks[0].addEventListener('cuechange', onCueChange);
                _subActive = 0;
                listHtml = '<div class="video-sub-item" data-idx="-1"><span class="sub-check"></span><span class="sub-name">Off</span></div>';
                companions.subtitles.forEach((s, i) => {
                    listHtml += `<div class="video-sub-item${i === 0 ? ' active' : ''}" data-idx="${i}"><span class="sub-check">${i === 0 ? '✓' : ''}</span><span class="sub-name">${s.name}</span></div>`;
                });
                updateTrackValue(companions.subtitles[0].name);
            }
        }
        if (subList) subList.innerHTML = listHtml;

        // CC button active state
        if (subtitleBtn) {
            subtitleBtn.classList.toggle('active', _subActive >= 0);
            subtitleBtn.classList.toggle('inactive', _subActive < 0);
        }

        // Subtitle button toggle popover — always reset to main panel
        if (subtitleBtn && popover) {
            subtitleBtn.onclick = (e) => {
                e.stopPropagation();
                popover.classList.toggle('hidden');
                if (panels) panels.classList.remove('show-tracks');
            };
        }

        // Panel navigation
        if (trackBtn && panels) {
            trackBtn.onclick = (e) => { e.stopPropagation(); panels.classList.add('show-tracks'); };
        }
        if (backBtn && panels) {
            backBtn.onclick = (e) => { e.stopPropagation(); panels.classList.remove('show-tracks'); };
        }

        // Track selection
        if (subList) {
            subList.onclick = (e) => {
                const item = e.target.closest('.video-sub-item');
                if (!item) return;
                const idx = parseInt(item.dataset.idx, 10);
                // Disable all tracks and remove listeners
                for (let i = 0; i < _videoEl.textTracks.length; i++) {
                    _videoEl.textTracks[i].removeEventListener('cuechange', onCueChange);
                    _videoEl.textTracks[i].mode = 'disabled';
                }
                // Enable selected track in hidden mode
                if (idx >= 0 && idx < _videoEl.textTracks.length) {
                    _videoEl.textTracks[idx].mode = 'hidden';
                    _videoEl.textTracks[idx].addEventListener('cuechange', onCueChange);
                }
                _subActive = idx;
                if (subOverlay) subOverlay.innerHTML = '';
                subList.querySelectorAll('.video-sub-item').forEach(el => { el.classList.remove('active'); el.querySelector('.sub-check').textContent = ''; });
                item.classList.add('active'); item.querySelector('.sub-check').textContent = '✓';
                subtitleBtn.classList.toggle('active', idx >= 0);
                subtitleBtn.classList.toggle('inactive', idx < 0);
                const trackName = idx >= 0 ? companions.subtitles[idx].name : 'Off';
                updateTrackValue(trackName);
                showToggleToast(idx >= 0 ? '🅂 ' + trackName : '🅂 Subtitles OFF');
                // Slide back to main panel after selection
                if (panels) panels.classList.remove('show-tracks');
            };
        }

        // Font size slider — directly modifies our overlay div
        if (fontSizeSlider) {
            fontSizeSlider.oninput = () => {
                _subFontSize = parseInt(fontSizeSlider.value, 10);
                if (fontSizeVal) fontSizeVal.textContent = _subFontSize + '%';
                if (subOverlay) subOverlay.style.fontSize = Math.round(22 * _subFontSize / 100) + 'px';
            };
        }

        // Vertical position slider — moves our overlay div up/down
        if (posSlider) {
            posSlider.oninput = () => {
                _subPosition = parseInt(posSlider.value, 10);
                if (posVal) posVal.textContent = _subPosition + '%';
                // Convert: 0=top (bottom:90%), 100=bottom (bottom:2%)
                const bottomPct = Math.max(2, 90 - (_subPosition * 0.88));
                if (subOverlay) subOverlay.style.bottom = bottomPct + '%';
            };
        }

        // Close popover on outside click
        document.addEventListener('click', (e) => {
            if (popover && !popover.contains(e.target) && e.target !== subtitleBtn) popover.classList.add('hidden');
        });

        const transcodeBtn = $('btn-video-transcode');
        if (transcodeBtn) transcodeBtn.onclick = async () => { await transcodeVideo(f); };
    }

    async function transcodeVideo(f) {
        const progressEl = $('video-transcode-progress'), barEl = $('video-transcode-bar'), pctEl = $('video-transcode-pct'), btn = $('btn-video-transcode'), banner = $('video-transcode-banner');
        if (progressEl) progressEl.classList.remove('hidden');
        if (btn) btn.disabled = true;
        try {
            if (!_ffmpegLoaded) {
                if (pctEl) pctEl.textContent = 'Loading FFmpeg...';
                const { FFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
                const { toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');
                _ffmpegInstance = new FFmpeg();
                const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
                await _ffmpegInstance.load({ coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'), wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm') });
                _ffmpegLoaded = true;
            }
            _ffmpegInstance.on('progress', ({ progress }) => { const pct = Math.round(progress * 100); if (barEl) barEl.style.width = pct + '%'; if (pctEl) pctEl.textContent = pct + '%'; });
            if (pctEl) pctEl.textContent = 'Reading file...';
            let fileData;
            if (isValidHandle(f.fileHandle)) { const file = await f.fileHandle.getFile(); fileData = new Uint8Array(await file.arrayBuffer()); }
            else if (f.videoUrl) { const resp = await fetch(f.videoUrl); fileData = new Uint8Array(await resp.arrayBuffer()); }
            if (!fileData) throw new Error('No video data');
            const ext = f.name.split('.').pop().toLowerCase();
            await _ffmpegInstance.writeFile('input.' + ext, fileData);
            if (pctEl) pctEl.textContent = 'Transcoding...';
            await _ffmpegInstance.exec(['-i', 'input.' + ext, '-c:v', 'libx264', '-preset', 'fast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', 'output.mp4']);
            const data = await _ffmpegInstance.readFile('output.mp4');
            const blob = new Blob([data.buffer], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            _videoEl.src = url; _videoEl.load(); f.videoUrl = url;
            if (banner) banner.classList.add('hidden');
            await _ffmpegInstance.deleteFile('input.' + ext);
            await _ffmpegInstance.deleteFile('output.mp4');
        } catch (e) {
            console.error('[CZUI] FFmpeg transcode failed:', e);
            if (pctEl) pctEl.textContent = 'Error: ' + e.message;
        } finally { if (btn) btn.disabled = false; }
    }

    function stopVideoPlayer() {
        if (_videoEl) {
            _videoEl.pause(); _videoEl.removeAttribute('src'); _videoEl.load();
            while (_videoEl.querySelector('track')) _videoEl.querySelector('track').remove();
        }
        cancelAnimationFrame(_videoRafId);
        clearTimeout(_videoControlsTimer);
        _videoSkipRegions = [];
        const overlay = $('video-subtitle-overlay');
        if (overlay) { overlay.innerHTML = ''; overlay.style.cssText = ''; }
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
            f.language = CZEngine.detectByFilename(f.name) || (extM ? (CZEngine.detectByExtension(extM[1].toLowerCase()) || 'plaintext') : 'plaintext');
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
            if (btn) { btn.innerHTML = '<span class="fi fi-ui fi-ui-preview" style="margin-right:3px"></span> Preview ✓'; btn.classList.add('active'); }
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
            if (btn) { btn.innerHTML = '<span class="fi fi-ui fi-ui-preview" style="margin-right:3px"></span> Preview'; btn.classList.remove('active'); }
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
        // Exit full-width mode if active
        const container = $('preview-pane')?.parentElement;
        if (container) container.classList.remove('preview-fullwidth');
        const fwBtn = $('btn-preview-fullwidth');
        if (fwBtn) {
            fwBtn.classList.remove('active');
            const icon = fwBtn.querySelector('.fi-ui');
            if (icon) { icon.classList.remove('fi-ui-screen-normal'); icon.classList.add('fi-ui-screen-full'); }
        }
        if (previewOpen) togglePreview();
    }

    function togglePreviewFullWidth() {
        if (!previewOpen) return;
        const pane = $('preview-pane');
        const container = pane?.parentElement;
        const btn = $('btn-preview-fullwidth');
        if (!container) return;

        const isFullWidth = container.classList.toggle('preview-fullwidth');
        if (btn) {
            btn.classList.toggle('active', isFullWidth);
            const icon = btn.querySelector('.fi-ui');
            if (icon) {
                icon.classList.toggle('fi-ui-screen-full', !isFullWidth);
                icon.classList.toggle('fi-ui-screen-normal', isFullWidth);
            }
        }
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
            loadLottieAnimation(f.content, f._lottieData);
            f._lottieData = null; // consumed — avoid stale data on next edit
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
        } else if (isCsvFile(f.name)) {
            content.className = 'preview-content csv-preview';
            if (title) title.textContent = 'CSV Preview';
            const rows = parseCsv(f.content, f.name);
            content.innerHTML = renderCsvTable(rows);
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

    function quickHash(s) {
        const len = s.length;
        let h = len;
        // Sample ~1000 chars evenly distributed instead of iterating every char
        const step = Math.max(1, Math.floor(len / 1000));
        for (let i = 0; i < len; i += step) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        return h;
    }

    function loadLottieAnimation(jsonContent, cachedData) {
        const container = document.getElementById('lottie-container');
        if (!container) return;

        // Skip if content hasn't changed
        const hash = quickHash(jsonContent);
        if (hash === lottieLastHash && lottieAnim) return;
        lottieLastHash = hash;

        // Destroy previous animation
        if (lottieAnim) {
            try { lottieAnim.destroy(); } catch (e) {}
            lottieAnim = null;
        }

        function initLottie() {
            try {
                const animData = cachedData || JSON.parse(jsonContent);

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
        // Stop any playing media before closing
        stopVideoPlayer();
        stopAudioPlayer();
        // Revoke blob URLs to free memory
        for (const f of files) {
            if (f.fileHandle) {
                if (f.videoUrl) { try { URL.revokeObjectURL(f.videoUrl); } catch(e){} f.videoUrl = null; }
                if (f.audioUrl) { try { URL.revokeObjectURL(f.audioUrl); } catch(e){} f.audioUrl = null; }
                if (f.imageUrl) { try { URL.revokeObjectURL(f.imageUrl); } catch(e){} f.imageUrl = null; }
            }
        }
        // Close all files that have a fileHandle from this folder
        files = files.filter(f => !f.fileHandle);
        if (files.length === 0) activeFileId = null;
        else if (!files.find(f => f.id === activeFileId)) {
            activeFileId = files[0].id;
        }
        saveData();
        // Clean up sticky scroll
        if (stickyScrollCleanup) { stickyScrollCleanup(); stickyScrollCleanup = null; }
        // Reset sidebar — rescue sidebar-actions before clearing tree
        if (sidebarActions && sidebarActions.parentNode) {
            sidebarActions.parentNode.removeChild(sidebarActions);
        }
        sidebarTree.innerHTML = '';
        sidebarEmpty.style.display = 'flex';
        sidebarTree.appendChild(sidebarEmpty);
        // Clear persisted folder and folder state
        CZFS.clearFolder();
        localStorage.removeItem('cz_expanded_folders');
        localStorage.removeItem('cz_tree_html');
        localStorage.removeItem('cz_root_collapsed');
        // Hide sidebar action buttons and return to sidebar-tree-area
        if (sidebarActions) {
            sidebarActions.classList.add('hidden');
            const treeArea = sidebarTree.parentElement;
            if (treeArea) treeArea.appendChild(sidebarActions);
        }
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
            row.innerHTML = `<span class="recent-icon"><span class="fi fi-folder"></span></span><span class="recent-name">${CZEngine.escapeHTML(item.name)}</span><span class="recent-remove" title="Remove">✕</span>`;

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
    }

    // ===== DYNAMIC LANGUAGE PICKER =====
    // Builds lang picker + hidden select from CZEngine registry
    function buildLangPicker() {
        const registry = CZEngine.getRegistry();
        if (!registry || registry.length === 0) return;

        // Build lang picker dropdown
        const picker = $('lang-picker');
        if (picker) {
            // Clear existing lang items (keep non-lang items if any)
            picker.querySelectorAll('.lang-picker-item[data-lang]').forEach(el => el.remove());
            // Add Plain Text first
            const ptEl = document.createElement('div');
            ptEl.className = 'lang-picker-item';
            ptEl.dataset.lang = 'plaintext';
            ptEl.textContent = 'Plain Text';
            picker.appendChild(ptEl);
            // Add registry languages
            for (const lang of registry) {
                const el = document.createElement('div');
                el.className = 'lang-picker-item';
                el.dataset.lang = lang.id;
                el.textContent = lang.name;
                picker.appendChild(el);
            }
        }

        // Build hidden select
        if (langSelector) {
            langSelector.innerHTML = '';
            const ptOpt = document.createElement('option');
            ptOpt.value = 'plaintext';
            ptOpt.textContent = 'Plain Text';
            langSelector.appendChild(ptOpt);
            for (const lang of registry) {
                const opt = document.createElement('option');
                opt.value = lang.id;
                opt.textContent = lang.name;
                langSelector.appendChild(opt);
            }
        }
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



    // Cache tree HTML excluding sidebar-actions to avoid duplicate on preload
    function cacheTreeHTML() {
        try {
            // Temporarily detach sidebar-actions so it's not serialized
            const parent = sidebarActions?.parentNode;
            const next = sidebarActions?.nextSibling;
            if (sidebarActions && parent) parent.removeChild(sidebarActions);
            localStorage.setItem('cz_tree_html', sidebarTree.innerHTML);
            // Re-attach
            if (sidebarActions && parent) parent.insertBefore(sidebarActions, next);
        } catch (e) { /* quota */ }
    }

    // ===== STICKY SCROLL (VS Code-style tree sticky headers) =====
    // Creates an overlay container that mirrors parent folder headers as the user
    // scrolls through deeply nested tree content. CSS position:sticky can't be used
    // because .tree-folder-children has overflow:hidden which breaks sticky context.
    let stickyScrollCleanup = null; // dispose previous listener

    function setupStickyScroll() {
        // Clean up previous listeners
        if (stickyScrollCleanup) { stickyScrollCleanup(); stickyScrollCleanup = null; }

        const treeArea = sidebarTree.parentElement; // .sidebar-tree-area
        if (!treeArea) return;

        // Create or reuse the overlay container
        let stickyContainer = treeArea.querySelector('.sticky-scroll-container');
        if (!stickyContainer) {
            stickyContainer = document.createElement('div');
            stickyContainer.className = 'sticky-scroll-container';
            treeArea.insertBefore(stickyContainer, sidebarTree);
        }
        stickyContainer.innerHTML = '';

        let rafPending = false;
        // Cache previous sticky path to avoid unnecessary DOM rebuilds
        let prevStickyKey = '';
        // Suppress a specific folder from becoming sticky after collapse-from-sticky
        let suppressStickyEl = null;

        function updateStickyScroll() {
            rafPending = false;

            const rootHeader = sidebarTree.querySelector('.tree-root-folder');
            const rootChildren = sidebarTree.querySelector('.tree-root-children');
            if (!rootHeader || !rootChildren || rootChildren.classList.contains('collapsed')) {
                if (stickyContainer.childElementCount > 0) stickyContainer.innerHTML = '';
                prevStickyKey = '';
                return;
            }

            const rootHeaderHeight = rootHeader.offsetHeight;
            stickyContainer.style.top = rootHeaderHeight + 'px';

            // Keep sticky container behind the scrollbar thumb
            const scrollbarWidth = sidebarTree.offsetWidth - sidebarTree.clientWidth;
            stickyContainer.style.right = scrollbarWidth + 'px';

            const treeRect = sidebarTree.getBoundingClientRect();
            // Effective top where sticky items begin (below root header)
            let stickyZoneTop = treeRect.top + rootHeaderHeight;

            const stickyItems = [];

            // Walk tree to find ancestor folders that should be sticky
            function findStickyFolders(container) {
                for (const child of container.children) {
                    if (!child.classList.contains('tree-folder')) continue;

                    const folderItem = child.querySelector(':scope > .tree-item');
                    const folderChildren = child.querySelector(':scope > .tree-folder-children');
                    if (!folderItem || !folderChildren || folderChildren.classList.contains('collapsed')) continue;
                    // Skip folder suppressed after collapse-from-sticky click
                    if (folderItem === suppressStickyEl) continue;

                    const itemRect = folderItem.getBoundingClientRect();
                    // Use the CHILDREN container bottom — not the whole folder —
                    // so the sticky stays until all child files have fully scrolled past
                    const childrenRect = folderChildren.getBoundingClientRect();
                    const itemHeight = itemRect.height;

                    // Folder header has scrolled above sticky zone (with 2px threshold
                    // to prevent re-sticking immediately when expanded at top) AND
                    // children bottom is still below the sticky zone (any child still visible)
                    if (itemRect.top < stickyZoneTop - 2 && childrenRect.bottom > stickyZoneTop) {
                        stickyItems.push({
                            element: folderItem,
                            height: itemHeight
                        });
                        stickyZoneTop += itemHeight;
                        // Recurse — only one folder per depth level can be sticky
                        findStickyFolders(folderChildren);
                        return;
                    }
                }
            }

            findStickyFolders(rootChildren);

            // Build key from folder names + depth for uniqueness
            const key = stickyItems.map((s, i) => i + ':' + (s.element.dataset.name || '')).join('/');

            if (stickyItems.length === 0) {
                if (prevStickyKey !== '') { stickyContainer.innerHTML = ''; prevStickyKey = ''; }
                return;
            }

            // Rebuild DOM only when sticky path changes
            if (key !== prevStickyKey) {
                prevStickyKey = key;
                const frag = document.createDocumentFragment();
                stickyItems.forEach((item, idx) => {
                    const div = document.createElement('div');
                    div.className = 'sticky-scroll-item';
                    div.style.paddingLeft = item.element.style.paddingLeft;
                    div.innerHTML = item.element.innerHTML;

                    // VS Code behavior:
                    // 1st click → scroll folder header to top (below root header + parent stickies)
                    // 2nd click (already at top) → collapse the folder
                    const origEl = item.element;
                    div.addEventListener('click', (e) => {
                        e.stopPropagation();

                        // Calculate where the header should sit: below root header + all parent sticky items above this one
                        const rh = sidebarTree.querySelector('.tree-root-folder');
                        let offset = rh ? rh.offsetHeight : 0;
                        for (let p = 0; p < idx; p++) offset += stickyItems[p].height;

                        // Where the header currently is relative to scroll content
                        const tRect = sidebarTree.getBoundingClientRect();
                        const headerPos = origEl.getBoundingClientRect().top - tRect.top + sidebarTree.scrollTop;
                        const targetScroll = headerPos - offset;

                        // If already scrolled to show this folder at top (within 2px tolerance) → collapse it
                        if (Math.abs(sidebarTree.scrollTop - targetScroll) < 2) {
                            // Suppress this folder from re-sticking until user scrolls
                            suppressStickyEl = origEl;
                            origEl.click(); // triggers the folder toggle handler (collapse)
                            // After collapse, content shrinks and browser may clamp scrollTop,
                            // pushing the header above the sticky zone. Reposition so the
                            // header stays visible at top.
                            const tRect2 = sidebarTree.getBoundingClientRect();
                            const newHeaderPos = origEl.getBoundingClientRect().top - tRect2.top + sidebarTree.scrollTop;
                            sidebarTree.scrollTop = newHeaderPos - (rh ? rh.offsetHeight : 0);
                        } else {
                            // Scroll so folder header sits right below root header + parent stickies
                            sidebarTree.scrollTop = targetScroll;
                        }
                    });
                    frag.appendChild(div);
                });
                stickyContainer.replaceChildren(frag);
            }
        }

        function scheduleUpdate() {
            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(updateStickyScroll);
            }
        }

        // Listen for scroll — clear suppression on genuine user scroll
        function onScroll() {
            suppressStickyEl = null;
            scheduleUpdate();
        }
        sidebarTree.addEventListener('scroll', onScroll, { passive: true });

        // Watch for folder expand/collapse class changes
        const observer = new MutationObserver(scheduleUpdate);
        observer.observe(sidebarTree, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });

        // Initial update
        scheduleUpdate();

        // Store cleanup function
        stickyScrollCleanup = () => {
            sidebarTree.removeEventListener('scroll', onScroll);
            observer.disconnect();
            stickyContainer.innerHTML = '';
            prevStickyKey = '';
        };
    }

    function renderSidebar(tree, folderName) {

        sidebarEmpty.style.display = 'none';

        if (!tree || tree.length === 0) {
            delete sidebarTree.dataset.preloaded;
            // Rescue sidebar-actions before clearing
            if (sidebarActions && sidebarActions.parentNode) {
                sidebarActions.parentNode.removeChild(sidebarActions);
            }
            sidebarTree.innerHTML = '';
            if (!CZFS.getDirectoryHandle()) {
                sidebarEmpty.style.display = 'flex';
                sidebarTree.appendChild(sidebarEmpty);
                if (sidebarActions) {
                    sidebarActions.classList.add('hidden');
                    const treeArea = sidebarTree.parentElement;
                    if (treeArea) treeArea.appendChild(sidebarActions);
                }
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
            cacheTreeHTML();
            setupStickyScroll();
            return;
        }

        // Build new tree in a fragment to avoid flash
        const frag = document.createDocumentFragment();
        const rootExpanded = localStorage.getItem('cz_root_collapsed') !== 'true';

        // Render folder name header
        if (folderName) {
            const header = document.createElement('div');
            header.className = 'tree-item tree-root-folder';
            header.style.fontWeight = '600';
            header.style.paddingLeft = '8px';
            const arrowClass = rootExpanded ? 'tree-icon folder-arrow expanded' : 'tree-icon folder-arrow';
            header.innerHTML = `<span class="${arrowClass}"></span>${folderIconHTML(rootExpanded, folderName)}<span class="tree-name">${CZEngine.escapeHTML(folderName)}</span>`;
            header.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                sidebarContextTarget = { handle: CZFS.getDirectoryHandle(), parentHandle: null, name: folderName, kind: 'root' };
                showSidebarContextMenu(e.pageX, e.pageY);
            };
            // Click to collapse/expand root
            header.onclick = (e) => {
                e.stopPropagation();
                // Don't toggle when clicking sidebar action buttons
                if (e.target.closest('.sidebar-actions')) return;
                const childrenDiv = sidebarTree.querySelector('.tree-root-children');
                const isExpanded = !childrenDiv.classList.contains('collapsed');
                childrenDiv.classList.toggle('collapsed', isExpanded);
                const arrowEl = header.querySelector('.folder-arrow');
                if (arrowEl) arrowEl.classList.toggle('expanded', !isExpanded);
                // Swap folder icon
                const iconEl = header.querySelector('.fi');
                if (iconEl) iconEl.className = getFolderIconClass(folderName, !isExpanded);
                localStorage.setItem('cz_root_collapsed', isExpanded ? 'true' : 'false');
                cacheTreeHTML();
            };
            // Append sidebar-actions inside root folder for inline VS Code-style layout
            if (sidebarActions) header.appendChild(sidebarActions);
            frag.appendChild(header);
        }

        // Wrap tree nodes in a collapsible container
        const rootChildrenDiv = document.createElement('div');
        rootChildrenDiv.className = 'tree-folder-children tree-root-children' + (rootExpanded ? '' : ' collapsed');
        renderTreeNodes(tree, rootChildrenDiv, 1, CZFS.getDirectoryHandle());
        frag.appendChild(rootChildrenDiv);

        // Atomic replace — no empty-frame flash between clear and insert
        sidebarTree.replaceChildren(frag);

        highlightActiveInTree();
        // Cache tree HTML for instant pre-render on next page load
        cacheTreeHTML();
        setupStickyScroll();
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
            // Click to collapse/expand root
            rootHeader.onclick = (e) => {
                e.stopPropagation();
                // Don't toggle when clicking sidebar action buttons
                if (e.target.closest('.sidebar-actions')) return;
                const childrenDiv = sidebarTree.querySelector('.tree-root-children');
                const isExpanded = !childrenDiv.classList.contains('collapsed');
                childrenDiv.classList.toggle('collapsed', isExpanded);
                const arrowEl = rootHeader.querySelector('.folder-arrow');
                if (arrowEl) arrowEl.classList.toggle('expanded', !isExpanded);
                const iconEl = rootHeader.querySelector('.fi');
                if (iconEl) iconEl.className = getFolderIconClass(folderName, !isExpanded);
                localStorage.setItem('cz_root_collapsed', isExpanded ? 'true' : 'false');
                cacheTreeHTML();
            };
        }
        // Walk tree data from tree-root-children container
        const rootChildren = container.querySelector('.tree-root-children') || container;
        attachNodeHandlers(treeData, rootChildren, 1, parentHandle);
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
                // Mirror compact folder logic from renderTreeNodes
                let currentNode = node;
                const compactChain = [node];
                while (
                    currentNode.children &&
                    currentNode.children.length === 1 &&
                    currentNode.children[0].kind === 'directory'
                ) {
                    currentNode = currentNode.children[0];
                    compactChain.push(currentNode);
                }
                const effectiveNode = currentNode;

                const folderDiv = folderDivs[di++];
                if (!folderDiv) return;
                const item = folderDiv.querySelector(':scope > .tree-item');
                const childrenDiv = folderDiv.querySelector(':scope > .tree-folder-children');
                if (item) {
                    // Sync expand/collapse DOM state with restored node.expanded
                    const arrowEl = item.querySelector('.folder-arrow');
                    if (arrowEl) arrowEl.classList.toggle('expanded', !!effectiveNode.expanded);
                    if (childrenDiv) childrenDiv.classList.toggle('collapsed', !effectiveNode.expanded);

                    item.onclick = (e) => {
                        e.stopPropagation();
                        const newState = !effectiveNode.expanded;
                        compactChain.forEach(n => n.expanded = newState);
                        const arrowEl = item.querySelector('.folder-arrow');
                        if (arrowEl) arrowEl.classList.toggle('expanded', newState);
                        if (childrenDiv) childrenDiv.classList.toggle('collapsed', !newState);
                        const oldIcon = item.querySelector('.fi');
                        if (oldIcon) oldIcon.className = getFolderIconClass(node.name, newState);
                        const tree = CZFS.getCurrentTree();
                        if (tree) saveExpandedPaths(tree, CZFS.getDirectoryHandle()?.name || '');
                        cacheTreeHTML();
                    };
                    item.oncontextmenu = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        sidebarContextTarget = { handle: effectiveNode.handle, parentHandle, name: effectiveNode.name, kind: 'directory' };
                        showSidebarContextMenu(e.pageX, e.pageY);
                    };
                }
                // Recurse into children of the effective (last) node in the compact chain
                if (childrenDiv && effectiveNode.children && effectiveNode.children.length > 0) {
                    attachNodeHandlers(effectiveNode.children, childrenDiv, depth + 1, effectiveNode.handle);
                }
            } else {
                const item = fileDivs[fi++];
                if (!item) return;
                item.onclick = (e) => {
                    e.stopPropagation();
                    sidebarTree.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                };
                item.ondblclick = async (e) => {
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
                // Compact folders: merge single-child folder chains (VS Code style)
                let displayName = node.name;
                let currentNode = node;
                const compactChain = [node]; // track all nodes in the chain
                while (
                    currentNode.children &&
                    currentNode.children.length === 1 &&
                    currentNode.children[0].kind === 'directory'
                ) {
                    currentNode = currentNode.children[0];
                    compactChain.push(currentNode);
                    displayName += '/' + currentNode.name;
                }
                // currentNode is the final folder in the chain
                const effectiveNode = currentNode;

                const folderDiv = document.createElement('div');
                folderDiv.className = 'tree-folder';

                const item = document.createElement('div');
                item.className = 'tree-item';
                item.style.paddingLeft = (8 + depth * 16) + 'px';
                item.dataset.name = effectiveNode.name;
                item.dataset.kind = 'directory';

                const arrowClass = effectiveNode.expanded ? 'tree-icon folder-arrow expanded' : 'tree-icon folder-arrow';
                item.innerHTML = `<span class="${arrowClass}"></span>${folderIconHTML(effectiveNode.expanded, node.name)}<span class="tree-name">${CZEngine.escapeHTML(displayName)}</span>`;

                item.onclick = (e) => {
                    e.stopPropagation();
                    // Toggle all nodes in compact chain together
                    const newState = !effectiveNode.expanded;
                    compactChain.forEach(n => n.expanded = newState);
                    const arrowEl = item.querySelector('.folder-arrow');
                    arrowEl.classList.toggle('expanded', newState);
                    childrenDiv.classList.toggle('collapsed', !newState);
                    const oldIcon = item.querySelector('.fi');
                    if (oldIcon) {
                        oldIcon.className = getFolderIconClass(node.name, newState);
                    }
                    const tree = CZFS.getCurrentTree();
                    if (tree) saveExpandedPaths(tree, CZFS.getDirectoryHandle()?.name || '');
                    cacheTreeHTML();
                };

                item.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    sidebarContextTarget = { handle: effectiveNode.handle, parentHandle, name: effectiveNode.name, kind: 'directory' };
                    showSidebarContextMenu(e.pageX, e.pageY);
                };

                folderDiv.appendChild(item);

                const childrenDiv = document.createElement('div');
                childrenDiv.className = 'tree-folder-children' + (effectiveNode.expanded ? '' : ' collapsed');
                if (effectiveNode.children && effectiveNode.children.length > 0) {
                    renderTreeNodes(effectiveNode.children, childrenDiv, depth + 1, effectiveNode.handle);
                }
                folderDiv.appendChild(childrenDiv);
                container.appendChild(folderDiv);
            } else {
                const item = document.createElement('div');
                item.className = 'tree-item';
                item.style.paddingLeft = (8 + depth * 16 + 16) + 'px';
                item.dataset.name = node.name;
                item.dataset.kind = 'file';

                item.innerHTML = `${fileIconHTML(node.name)}<span class="tree-name">${CZEngine.escapeHTML(node.name)}</span>`;

                item.onclick = (e) => {
                    e.stopPropagation();
                    sidebarTree.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                };
                item.ondblclick = async (e) => {
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
                // Folders: no "close-folder", "duplicate" (duplicate is for files only)
                if (['close-folder', 'duplicate'].includes(action)) show = false;
            } else if (kind === 'root') {
                // Root folder: no "rename", "delete", "duplicate"
                if (['rename', 'delete', 'duplicate'].includes(action)) show = false;
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
        // Compute folderPath (relative path from project root) for accurate matching
        let folderPath = null;
        try {
            const rootHandle = CZFS.getDirectoryHandle();
            if (rootHandle && fileHandle) {
                const segments = await rootHandle.resolve(fileHandle);
                if (segments) folderPath = segments.join('/');
            }
        } catch { /* resolve() not supported or handle mismatch */ }

        // Check if already open — match by handle identity, folderPath, or name (fallback)
        const existing = files.find(f => {
            // Exact handle identity (same session, same object)
            if (isValidHandle(f.fileHandle) && f.fileHandle === fileHandle) return true;
            // Match by folderPath (handles same-name files in different directories)
            if (folderPath && f.folderPath) return f.folderPath === folderPath;
            // Fallback for legacy files without folderPath: match by name
            if (!f.folderPath && f.fromFolder && f.name === fileName) return true;
            if (!f.folderPath && !isValidHandle(f.fileHandle) && f.name === fileName) return true;
            return false;
        });
        if (existing) {
            // Re-attach fresh handles and path
            if (fileHandle) existing.fileHandle = fileHandle;
            if (parentHandle) existing.parentHandle = parentHandle;
            if (folderPath) existing.folderPath = folderPath;
            switchFile(existing.id);
            return;
        }

        try {
            // Check if it's a binary file (images, fonts, archives, video, etc.)
            if (isBinaryFile(fileName)) {
                const isImg = isImageFile(fileName);
                const isAud = isAudioFile(fileName);
                const isVid = isVideoFile(fileName);
                const nf = {
                    id: 'file_' + Math.random().toString(36).substr(2, 9),
                    name: fileName,
                    language: isImg ? 'image' : (isAud ? 'audio' : (isVid ? 'video' : 'binary')),
                    content: '',
                    isPinned: false,
                    encoding: 'binary',
                    eol: 'LF',
                    fileHandle: fileHandle,
                    parentHandle: parentHandle,
                    folderPath: folderPath,
                    isBinary: !isImg && !isAud && !isVid,
                    isImage: isImg,
                    isAudio: isAud,
                    isVideo: isVid,
                    fromFolder: true
                };
                // For images, create a blob URL for the viewer
                if (isImg) {
                    const file = await fileHandle.getFile();
                    nf.imageUrl = URL.createObjectURL(file);
                }
                // For audio, create a blob URL for the player
                if (isAud) {
                    const file = await fileHandle.getFile();
                    nf.audioUrl = URL.createObjectURL(file);
                }
                // For video, create a blob URL for the player
                if (isVid) {
                    const file = await fileHandle.getFile();
                    nf.videoUrl = URL.createObjectURL(file);
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
            let lang = CZEngine.detectByFilename(fileName) || 'plaintext';
            if (lang === 'plaintext' && extM) { lang = CZEngine.detectByExtension(extM[1].toLowerCase()) || CZEngine.detectLanguage(data.content); }
            else if (lang === 'plaintext') { lang = CZEngine.detectLanguage(data.content); }

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
                folderPath: folderPath,
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
        // Find matching tree item by handle, then folderPath, then name (last resort)
        let matched = false;
        sidebarTree.querySelectorAll('.tree-item[data-kind="file"]').forEach(el => {
            if (matched) return;
            if (activeFile.fileHandle && el._fileHandle === activeFile.fileHandle) {
                el.classList.add('active');
                matched = true;
            }
        });
        if (!matched) {
            // Fallback: match by name (only when handle identity fails, e.g. after refresh before reattach)
            sidebarTree.querySelectorAll('.tree-item[data-kind="file"]').forEach(el => {
                if (el.dataset.name === activeFile.name) {
                    el.classList.add('active');
                }
            });
        }
    }

    // Re-attach fileHandles to open tabs after folder restore (browser refresh)
    function reattachFileHandles() {
        const tree = CZFS.getCurrentTree();
        if (!tree) return;
        function walkTree(nodes, parentDirHandle, pathPrefix) {
            nodes.forEach(n => {
                const currentPath = pathPrefix ? pathPrefix + '/' + n.name : n.name;
                if (n.kind === 'file') {
                    const openFile = files.find(f => {
                        if (isValidHandle(f.fileHandle)) return false; // already attached
                        // Match by folderPath (unique across same-name files in different dirs)
                        if (f.folderPath) return f.folderPath === currentPath;
                        // Legacy fallback: match by name (only if no other file has this name)
                        return f.name === n.name;
                    });
                    if (openFile) {
                        openFile.fileHandle = n.handle;
                        openFile.parentHandle = parentDirHandle;
                        openFile.folderPath = currentPath;
                        openFile.fromFolder = true;
                    }
                } else if (n.kind === 'directory' && n.children) {
                    walkTree(n.children, n.handle, currentPath);
                }
            });
        }
        walkTree(tree, CZFS.getDirectoryHandle(), '');
        // Refresh active tab if it's an image/binary that now has a handle
        const active = getActiveFile();
        if (active && (active.isImage || active.isBinary || active.isAudio || active.isVideo) && isValidHandle(active.fileHandle)) {
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
        // Keep root expanded
        localStorage.removeItem('cz_root_collapsed');
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
                    // Match by handle identity (always valid during same session from sidebar context)
                    const openFile = files.find(f =>
                        f.fileHandle === target.handle
                    );
                    if (openFile) {
                        openFile.name = newName.trim();
                        openFile.fileHandle = result;
                        openFile.parentHandle = parentHandle;
                        // Update folderPath to reflect new name
                        if (openFile.folderPath) {
                            const pathParts = openFile.folderPath.split('/');
                            pathParts[pathParts.length - 1] = newName.trim();
                            openFile.folderPath = pathParts.join('/');
                        }
                        const ext = newName.split('.').pop().toLowerCase();
                        const detected = CZEngine.detectByFilename(newName) || CZEngine.detectByExtension(ext);
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
        } else if (action === 'duplicate') {
            if (target.kind !== 'file') return;
            await duplicateFileOnDisk(target.handle, target.name, parentHandle);
        }
    }

    // Generate duplicate name: "file(1).ext", "file(2).ext", etc.
    function generateDuplicateName(originalName) {
        const dotIdx = originalName.lastIndexOf('.');
        const baseName = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
        const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';
        const stripped = baseName.replace(/\(\d+\)$/, '').trimEnd();
        return `${stripped}(1)${ext}`;
    }

    // Find next available duplicate name by checking existence
    async function findAvailableName(parentHandle, originalName) {
        const dotIdx = originalName.lastIndexOf('.');
        const baseName = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
        const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';
        const stripped = baseName.replace(/\(\d+\)$/, '').trimEnd();
        let counter = 1;
        while (true) {
            const candidate = `${stripped}(${counter})${ext}`;
            try {
                await parentHandle.getFileHandle(candidate);
                counter++; // exists, try next
            } catch {
                return candidate; // doesn't exist
            }
        }
    }

    // Duplicate file on disk with prompt
    async function duplicateFileOnDisk(sourceHandle, sourceName, parentHandle) {
        if (!parentHandle) return;
        const autoName = await findAvailableName(parentHandle, sourceName);
        const newName = await openPrompt(
            CZi18n.t('prompt_duplicate_title') || 'Duplicate File',
            autoName,
            { validateFilename: true }
        );
        if (!newName || !newName.trim()) return;
        const trimmed = newName.trim();
        const err = validateFileName(trimmed);
        if (err) { openAlert(CZi18n.t('alert_title'), CZi18n.t(err)); return; }
        // Check if file exists
        try {
            await parentHandle.getFileHandle(trimmed);
            openAlert(CZi18n.t('alert_title'), CZi18n.t('alert_file_exists') || `File '${trimmed}' already exists.`);
            return;
        } catch { /* doesn't exist — good */ }
        // Read source content
        try {
            const srcFile = await sourceHandle.getFile();
            const content = await srcFile.text();
            // Create new file and write content
            const newHandle = await parentHandle.getFileHandle(trimmed, { create: true });
            const writable = await newHandle.createWritable();
            await writable.write(content);
            await writable.close();
            // Refresh tree and open new file
            await refreshSidebar();
            await openFileFromTree(newHandle, trimmed, parentHandle);
        } catch (e) {
            openAlert(CZi18n.t('alert_title'), 'Failed to duplicate: ' + e.message);
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

        // Handle video files — open in video player
        if (isVideoFile(name)) {
            const url = URL.createObjectURL(fileObj);
            const nf = {
                id: 'file_' + Math.random().toString(36).substr(2, 9),
                name, language: 'video', content: '', isPinned: false,
                encoding: 'binary', eol: 'LF', isVideo: true, videoUrl: url
            };
            if (files.length === 1 && files[0].name.startsWith('Untitled') && !files[0].content && !files[0].isPinned) {
                files[0] = { ...nf, id: files[0].id }; activeFileId = files[0].id;
            } else { files.push(nf); activeFileId = nf.id; }
            saveData(); switchFile(activeFileId);
            return;
        }

        // Handle audio files — open in audio player
        if (isAudioFile(name)) {
            const reader = new FileReader();
            reader.onload = () => {
                const url = reader.result;
                const nf = {
                    id: 'file_' + Math.random().toString(36).substr(2, 9),
                    name, language: 'audio', content: '', isPinned: false,
                    encoding: 'binary', eol: 'LF', isAudio: true, audioUrl: url
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
                let lang = CZEngine.detectByFilename(name) || 'plaintext';
                if (lang === 'plaintext' && extM) { lang = CZEngine.detectByExtension(extM[1].toLowerCase()) || CZEngine.detectLanguage(content); }
                else if (lang === 'plaintext') { lang = CZEngine.detectLanguage(content); }
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

        const isBin = f.isImage || f.isBinary || f.isAudio || f.isVideo;

        if (isBin) {
            // Binary mode: show file info instead of code stats
            editorFooter.classList.add('footer-binary');
            const type = f.isImage ? 'Image' : (f.isAudio ? 'Audio' : (f.isVideo ? 'Video' : 'Binary'));
            $('stat-length').textContent = f.name;
            $('stat-lines').textContent = '';
            $('stat-cursor').textContent = '';
            // Right side: show type as non-clickable label, hide EOL/encoding
            $('stat-eol').textContent = '';
            $('stat-encoding').textContent = '';
            $('stat-lang').textContent = type;
            // Hide irrelevant dividers in binary mode
            const leftDividers = editorFooter.querySelectorAll('.footer-left .divider');
            leftDividers.forEach((d, i) => { if (i > 0) d.style.display = 'none'; });
            const rightDividers = editorFooter.querySelectorAll('.footer-right .divider');
            rightDividers.forEach(d => d.style.display = 'none');
            // Async: get file size and update footer
            if (isValidHandle(f.fileHandle)) {
                f.fileHandle.getFile().then(file => {
                    // Only update if still the active file
                    if (getActiveFile() === f) {
                        $('stat-lines').textContent = formatFileSize(file.size);
                    }
                }).catch(() => {});
            }
        } else {
            // Text mode: show normal code stats
            editorFooter.classList.remove('footer-binary');
            // Restore dividers
            editorFooter.querySelectorAll('.divider').forEach(d => d.style.display = '');
            // Use EditorView for cursor info (avoids expensive text.split on large files)
            if (editorView) {
                const info = editorView.getCursorInfo();
                const m = editorView.model;
                $('stat-length').textContent = CZi18n.t('stat_length', m.getTotalLength());
                $('stat-lines').textContent = CZi18n.t('stat_lines', m.getLineCount());
                $('stat-cursor').textContent = `Ln ${info.line}, Col ${info.col}`;
                // Keep cursor position on file object always up-to-date
                f.cursorLine = info.line - 1;
                f.cursorCol = info.col - 1;
                f.scrollTop = editorView.getScrollTop();
            }
            langSelector.value = f.language;
            $('stat-lang').textContent = langSelector.options[langSelector.selectedIndex]?.text || f.language;
            $('stat-encoding').textContent = f.encoding || 'UTF-8';
            $('stat-eol').textContent = f.eol || 'LF';
        }
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
    let _cursorSaveTimer = 0;
    function initVirtualEditor() {
        if (!editorContainer) return;
        editorView = new EditorView.View(editorContainer);
        // Update footer on every cursor move + debounce-save to localStorage
        editorView.onCursorChange(() => {
            updateFootbar();
            // Debounce: persist cursor state every 500ms of cursor activity
            clearTimeout(_cursorSaveTimer);
            _cursorSaveTimer = setTimeout(() => saveData(), 500);
        });
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
        else if (action === 'duplicate') {
            // Duplicate from tab — need file handle + parent handle
            if (tf && tf.fileHandle && tf.parentHandle) {
                await duplicateFileOnDisk(tf.fileHandle, tf.name, tf.parentHandle);
            } else if (tf) {
                // Non-folder file (imported): duplicate as in-memory tab
                const dupName = generateDuplicateName(tf.name);
                const newName = await openPrompt(CZi18n.t('prompt_duplicate_title') || 'Duplicate File', dupName, { validateFilename: true });
                if (!newName || !newName.trim()) return;
                const nf = { id: Date.now().toString(), name: newName.trim(), content: tf.content, language: tf.language, dirty: false };
                files.push(nf);
                switchFile(nf.id);
            }
        }
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
        toggleSidebar, isSidebarOpen, restoreSidebarState, removePreloadStyles, setTheme, buildLangPicker,
        renderSidebar, refreshSidebar, collapseAllFolders, closeFolder,
        openFileFromTree, highlightActiveInTree, renderRecentFolders, reattachFileHandles,
        executeSidebarAction, openExplorerSettings, applyExplorerSettings,
        // Image / SVG / Binary
        // Preview
        isPreviewableFile, togglePreview, updatePreview, closePreview, setupPreviewResize, setPreviewZoom, togglePreviewFullWidth,
        openBinaryAsCode, openBinaryExternal,
        // Icons
        getFileIcons, setFileIcons, getFileIconClass, fileIconHTML, folderIconHTML, getFolderIconClass,
        get targetContextTabId() { return targetContextTabId; },
        set targetContextTabId(v) { targetContextTabId = v; },
        get lastBracketKey() { return lastBracketKey; },
        set lastBracketKey(v) { lastBracketKey = v; },
        get sidebarContextTarget() { return sidebarContextTarget; },
        $, tabContextMenu, sidebarContextMenu, settingsPopup, fontConfigModal,
        explorerSettingsModal, editingArea, langSelector, dropOverlay
    };
})();