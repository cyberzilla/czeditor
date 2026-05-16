// CZEditor v2.0 — Main Init & Event Binding
(function () {
    'use strict';

    async function initApp() {
        // Initialize i18n first
        await CZi18n.init();
        const savedFiles = localStorage.getItem('cz_files');
        const savedActiveId = localStorage.getItem('cz_active_id');
        const savedFontWeight = localStorage.getItem('cz_font_weight') || "400";
        const savedFontSize = localStorage.getItem('cz_font_size') || "13";

        document.getElementById('font-weight-select').value = savedFontWeight;
        document.getElementById('font-size-input').value = savedFontSize;
        CZUI.applyFontSettings();

        if (savedFiles) {
            let files = JSON.parse(savedFiles);
            // Filter out entries that truly can't be restored
            files = files.filter(f => f.content !== undefined || f.isImage || f.isBinary);
            if (files.length > 0) {
                files.forEach(f => { if (f.isPinned === undefined) f.isPinned = false; });
                CZUI.setFiles(files);
                CZUI.setActiveId(savedActiveId || files[0].id);
                CZUI.switchFile(CZUI.getActiveId(), { instant: true });
                // Preload language configs
                files.forEach(f => CZEngine.loadLanguage(f.language));
            }
        }
        CZUI.renderTabs();
        CZUI.setupTabDragging();
        CZUI.checkEmptyState();
        CZUI.restoreSidebarState();
        bindEvents();

        // Restore last folder from IndexedDB
        if (CZFS.isSupported()) {
            CZFS.restoreLastFolder().then(result => {
                if (result) {
                    if (result.needsPermission) {
                        // Show a "click to re-grant permission" in sidebar
                        CZUI.renderSidebar([], null);
                        const container = document.getElementById('sidebar-tree');
                        const banner = document.createElement('div');
                        banner.className = 'sidebar-empty';
                        banner.style.display = 'flex';
                        banner.innerHTML = `<p>${CZEngine.escapeHTML(result.name)}</p>
                            <button class="sidebar-open-btn" id="btn-regrant">${CZi18n.t('btn_regrant_permission') || '🔓 Grant Access'}</button>`;
                        container.innerHTML = '';
                        container.appendChild(banner);
                        document.getElementById('btn-regrant').onclick = async () => {
                            const r = await CZFS.requestPermission(result.handle);
                            if (r) {
                                CZUI.renderSidebar(r.tree, r.name);
                                if (!CZUI.isSidebarOpen()) CZUI.toggleSidebar();
                            }
                        };
                    } else if (result.tree) {
                        CZUI.renderSidebar(result.tree, result.name);
                        // Re-highlight active file and re-attach handles
                        CZUI.highlightActiveInTree();
                        CZUI.reattachFileHandles();
                    }
                } else {
                    // No stored folder — show recent folders
                    CZUI.renderRecentFolders();
                }
                CZUI.removePreloadStyles();
            }).catch(() => {
                CZUI.renderRecentFolders();
                CZUI.removePreloadStyles();
            });
        } else {
            CZUI.removePreloadStyles();
        }
    }

    function bindEvents() {
        const ta = CZUI.getEditingArea();

        // Editor events
        ta.addEventListener('input', CZFeatures.onInput);
        ta.addEventListener('keydown', CZFeatures.handleKeydown);

        // Use selectionchange for INSTANT cursor tracking (fires during keydown, not after keyup)
        document.addEventListener('selectionchange', () => {
            if (document.activeElement !== ta) return;
            // Update footbar and active line immediately
            CZUI.updateFootbar();
            CZUI.updateActiveLine();
            // Bracket matching (slightly deferred to avoid perf hit on rapid navigation)
            cancelAnimationFrame(bindEvents._bracketRAF);
            bindEvents._bracketRAF = requestAnimationFrame(() => {
                CZFeatures.handleCursorMove();
            });
        });

        ta.addEventListener('scroll', () => {
            CZUI.syncScroll();
            CZUI.updateActiveLine();
        });

        // Recalculate scroll-past-end padding on window resize
        window.addEventListener('resize', () => CZUI.updateScrollPastEnd());

        // Header buttons
        document.getElementById('btn-new-file').onclick = () => CZUI.createNewFile();
        document.getElementById('btn-open-file').onclick = () => document.getElementById('file-input').click();
        document.getElementById('file-input').onchange = e => {
            Array.from(e.target.files).forEach(f => CZUI.processImportedFile(f));
            e.target.value = '';
        };
        document.getElementById('btn-settings').onclick = () => CZUI.settingsPopup.classList.toggle('hidden');
        document.getElementById('btn-toggle-sidebar').onclick = () => CZUI.toggleSidebar();
        document.getElementById('btn-sidebar-reopen').onclick = () => CZUI.toggleSidebar();

        // Sidebar buttons
        document.getElementById('btn-open-folder').onclick = async () => {
            if (!CZFS.isSupported()) {
                CZUI.openAlert(CZi18n.t('alert_title'), CZi18n.t('fs_not_supported') || 'File System Access API is not supported in this browser. Use Chrome or Edge.');
                return;
            }
            try {
                const result = await CZFS.openFolder();
                if (result) {
                    CZUI.renderSidebar(result.tree, result.name);
                    if (CZUI.isSidebarOpen() === false) CZUI.toggleSidebar();
                }
            } catch (e) {
                CZUI.openAlert(CZi18n.t('alert_title'), 'Failed to open folder: ' + e.message);
            }
        };
        document.getElementById('btn-new-fs-file').onclick = () => {
            if (CZFS.getDirectoryHandle()) {
                CZUI.executeSidebarAction('new-file');
            }
        };
        document.getElementById('btn-new-fs-folder').onclick = () => {
            if (CZFS.getDirectoryHandle()) {
                CZUI.executeSidebarAction('new-folder');
            }
        };
        document.getElementById('btn-refresh-tree').onclick = async () => {
            await CZUI.refreshSidebar();
        };
        document.getElementById('btn-collapse-all').onclick = () => {
            CZUI.collapseAllFolders();
        };

        // Sidebar context menu
        document.querySelectorAll('#sidebar-context-menu .context-menu-item').forEach(el => {
            el.onclick = () => CZUI.executeSidebarAction(el.dataset.action);
        });

        // Explorer settings modal
        document.getElementById('close-explorer-settings').onclick = () => CZUI.explorerSettingsModal.classList.add('hidden');
        document.getElementById('btn-explorer-settings-cancel').onclick = () => CZUI.explorerSettingsModal.classList.add('hidden');
        document.getElementById('btn-explorer-settings-ok').onclick = () => CZUI.applyExplorerSettings();

        // Settings menu items
        document.getElementById('menu-font-config').onclick = () => {
            CZUI.fontConfigModal.classList.remove('hidden');
            CZUI.settingsPopup.classList.add('hidden');
        };
        document.getElementById('menu-shortcuts').onclick = () => {
            document.getElementById('shortcuts-modal').classList.remove('hidden');
            CZUI.settingsPopup.classList.add('hidden');
        };
        document.getElementById('menu-language').onclick = () => {
            const list = document.getElementById('language-list');
            const langs = CZi18n.getAvailableLanguages();
            const current = CZi18n.getCurrentLang();
            list.innerHTML = langs.map(l => 
                `<div class="lang-picker-item${l.code === current ? ' active' : ''}" data-ui-lang="${l.code}">${l.name}</div>`
            ).join('');
            list.querySelectorAll('.lang-picker-item').forEach(el => {
                el.onclick = async () => {
                    await CZi18n.loadLanguage(el.dataset.uiLang);
                    document.getElementById('language-modal').classList.add('hidden');
                };
            });
            document.getElementById('language-modal').classList.remove('hidden');
            CZUI.settingsPopup.classList.add('hidden');
        };
        document.getElementById('close-language').onclick = () => document.getElementById('language-modal').classList.add('hidden');

        // Theme selector
        const themeSelector = document.getElementById('theme-selector');
        if (themeSelector) {
            themeSelector.value = localStorage.getItem('cz_theme') || 'dark';
            themeSelector.onchange = () => CZUI.setTheme(themeSelector.value);
        }

        // Font config
        document.getElementById('font-weight-select').onchange = () => CZUI.applyFontSettings();
        document.getElementById('font-size-input').oninput = () => CZUI.applyFontSettings();
        document.getElementById('close-font-config').onclick = () => CZUI.fontConfigModal.classList.add('hidden');

        // Dialog buttons
        document.getElementById('close-prompt').onclick = () => CZUI.closePrompt(null);
        document.getElementById('btn-prompt-cancel').onclick = () => CZUI.closePrompt(null);
        document.getElementById('btn-prompt-ok').onclick = () => CZUI.closePrompt(document.getElementById('prompt-input').value);
        document.getElementById('prompt-input').onkeydown = e => { if (e.key === 'Enter') CZUI.closePrompt(document.getElementById('prompt-input').value); };

        document.getElementById('close-confirm').onclick = () => CZUI.closeConfirm(false);
        document.getElementById('btn-confirm-cancel').onclick = () => CZUI.closeConfirm(false);
        document.getElementById('btn-confirm-ok').onclick = () => CZUI.closeConfirm(true);

        document.getElementById('close-alert').onclick = () => CZUI.closeAlert();
        document.getElementById('btn-alert-ok').onclick = () => CZUI.closeAlert();

        // Preview panel controls
        document.getElementById('btn-preview-toggle').onclick = () => CZUI.togglePreview();
        document.getElementById('btn-preview-close').onclick = () => CZUI.closePreview();
        document.getElementById('btn-preview-zoom-in').onclick = () => CZUI.setPreviewZoom(parseInt(document.getElementById('preview-zoom-level').textContent) + 25);
        document.getElementById('btn-preview-zoom-out').onclick = () => CZUI.setPreviewZoom(parseInt(document.getElementById('preview-zoom-level').textContent) - 25);
        document.getElementById('btn-preview-zoom-reset').onclick = () => CZUI.setPreviewZoom(100);
        CZUI.setupPreviewResize();

        document.getElementById('close-shortcuts').onclick = () => document.getElementById('shortcuts-modal').classList.add('hidden');

        // Tab context menu
        CZUI.tabContextMenu.parentElement.addEventListener('contextmenu', e => e.preventDefault());
        document.getElementById('tabs-container').addEventListener('contextmenu', e => {
            const tab = e.target.closest('.tab');
            if (tab) {
                e.preventDefault();
                CZUI.targetContextTabId = tab.dataset.id;
                const f = CZUI.getFiles().find(x => x.id === tab.dataset.id);
                // Update pin/unpin label
                const pinItem = document.getElementById('ctx-pin-item');
                if (pinItem && f) {
                    pinItem.textContent = f.isPinned
                        ? CZi18n.t('ctx_unpin')
                        : CZi18n.t('ctx_pin');
                }
                // Show reload only for project files (has fileHandle)
                const reloadItem = document.getElementById('ctx-reload-item');
                if (reloadItem) {
                    reloadItem.style.display = (f && f.fileHandle) ? '' : 'none';
                    reloadItem.textContent = CZi18n.t('ctx_reload');
                }
                CZUI.tabContextMenu.style.left = e.pageX + 'px';
                CZUI.tabContextMenu.style.top = e.pageY + 'px';
                CZUI.tabContextMenu.classList.remove('hidden');
            }
        });
        document.querySelectorAll('#tab-context-menu .context-menu-item').forEach(el => {
            el.onclick = () => CZUI.executeMenuAction(el.dataset.action);
        });

        // Footer language picker dropdown
        const langPicker = document.getElementById('lang-picker');
        document.getElementById('stat-lang').onclick = (e) => {
            e.stopPropagation();
            if (!CZUI.getActiveFile()) return;
            // Close other pickers
            document.getElementById('eol-picker').classList.add('hidden');
            document.getElementById('encoding-picker').classList.add('hidden');
            const isHidden = langPicker.classList.contains('hidden');
            langPicker.classList.toggle('hidden');
            if (isHidden) {
                // Highlight current language
                const f = CZUI.getActiveFile();
                langPicker.querySelectorAll('.lang-picker-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.lang === f.language);
                });
            }
        };
        langPicker.querySelectorAll('.lang-picker-item').forEach(el => {
            el.onclick = (ev) => {
                ev.stopPropagation();
                const f = CZUI.getActiveFile();
                if (!f) return;
                f.language = el.dataset.lang;
                CZUI.langSelector.value = f.language;
                langPicker.classList.add('hidden');
                CZEngine.loadLanguage(f.language).then(() => {
                    CZUI.updateEditorVisuals();
                    CZUI.updateFootbar();
                    CZUI.saveData();
                });
            };
        });

        // Footer EOL picker dropdown
        const eolPicker = document.getElementById('eol-picker');
        document.getElementById('stat-eol').onclick = (e) => {
            e.stopPropagation();
            if (!CZUI.getActiveFile()) return;
            closeAllPickers();
            eolPicker.classList.toggle('hidden');
            if (!eolPicker.classList.contains('hidden')) {
                const f = CZUI.getActiveFile();
                eolPicker.querySelectorAll('.lang-picker-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.eol === (f.eol || 'LF'));
                });
            }
        };
        eolPicker.querySelectorAll('.lang-picker-item').forEach(el => {
            el.onclick = (ev) => {
                ev.stopPropagation();
                const f = CZUI.getActiveFile();
                if (!f) return;
                f.eol = el.dataset.eol;
                eolPicker.classList.add('hidden');
                CZUI.updateFootbar();
                CZUI.saveData();
            };
        });

        // Footer encoding picker dropdown
        const encPicker = document.getElementById('encoding-picker');
        document.getElementById('stat-encoding').onclick = (e) => {
            e.stopPropagation();
            if (!CZUI.getActiveFile()) return;
            closeAllPickers();
            encPicker.classList.toggle('hidden');
            if (!encPicker.classList.contains('hidden')) {
                const f = CZUI.getActiveFile();
                encPicker.querySelectorAll('.lang-picker-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.enc === (f.encoding || 'UTF-8'));
                });
            }
        };
        encPicker.querySelectorAll('.lang-picker-item').forEach(el => {
            el.onclick = (ev) => {
                ev.stopPropagation();
                const f = CZUI.getActiveFile();
                if (!f) return;
                f.encoding = el.dataset.enc;
                encPicker.classList.add('hidden');
                CZUI.updateFootbar();
                CZUI.saveData();
            };
        });

        // Helper to close all pickers
        function closeAllPickers() {
            langPicker.classList.add('hidden');
            eolPicker.classList.add('hidden');
            encPicker.classList.add('hidden');
        }

        // Command palette input
        document.getElementById('command-palette-input').addEventListener('input', e => {
            CZFeatures.renderCommandPalette(e.target.value);
        });
        document.getElementById('command-palette-input').addEventListener('keydown', e => {
            if (e.key === 'Escape') CZFeatures.toggleCommandPalette();
        });

        // Global listeners
        document.addEventListener('click', e => {
            if (!e.target.closest('#settings-popup') && !e.target.closest('.settings-btn'))
                CZUI.settingsPopup.classList.add('hidden');
            if (!e.target.closest('#tab-context-menu'))
                CZUI.tabContextMenu.classList.add('hidden');
            if (!e.target.closest('#sidebar-context-menu'))
                CZUI.sidebarContextMenu.classList.add('hidden');
            if (!e.target.closest('.autocomplete-popup') && !e.target.closest('#editing'))
                CZFeatures.hideAutocomplete();
            if (!e.target.closest('.lang-picker-wrapper'))
                closeAllPickers();
        });

        // ===== GLOBAL SHORTCUT INTERCEPTOR =====
        // Uses window-level capture phase — fires BEFORE document and browser defaults
        window.addEventListener('keydown', e => {
            const ctrl = e.ctrlKey || e.metaKey;
            const shift = e.shiftKey;
            const key = e.key.toLowerCase();

            // Escape: close modals/popups
            if (e.key === 'Escape') {
                const modals = ['custom-prompt-modal', 'custom-confirm-modal', 'custom-alert-modal', 'font-config-modal', 'shortcuts-modal', 'command-palette', 'explorer-settings-modal'];
                let closed = false;
                modals.forEach(id => {
                    const el = document.getElementById(id);
                    if (!el.classList.contains('hidden')) { el.classList.add('hidden'); closed = true; }
                });
                if (CZFeatures.acVisible) { CZFeatures.hideAutocomplete(); closed = true; }
                if (closed) { e.preventDefault(); e.stopImmediatePropagation(); }
                return;
            }

            // All Ctrl+ shortcuts — intercept browser defaults
            if (ctrl) {
                const intercepted = ['n', 's', 'd', 'p', 'l', 'f', 'h', '/', ']', '[', 'b'];
                const interceptedShift = ['k', 'd', 'v'];

                if (shift && interceptedShift.includes(key)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    // Ctrl+Shift+V: Toggle preview panel (only for previewable files)
                    if (key === 'v') { const af = CZUI.getActiveFile(); if (af && CZUI.isPreviewableFile(af)) CZUI.togglePreview(); return; }
                    // Delegate to features handler if editor is active
                    if (CZUI.getActiveId()) {
                        CZUI.getEditingArea().focus();
                        CZFeatures.handleKeydown(e);
                    }
                    return;
                }

                if (!shift && intercepted.includes(key)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();

                    // Ctrl+N: always works (new file)
                    if (key === 'n') { CZUI.createNewFile(); return; }

                    // Ctrl+P: always works (command palette)
                    if (key === 'p') { CZFeatures.toggleCommandPalette(); return; }

                    // Ctrl+B: toggle sidebar
                    if (key === 'b') { CZUI.toggleSidebar(); return; }

                    // Other shortcuts need active file + focus on textarea
                    if (CZUI.getActiveId()) {
                        CZUI.getEditingArea().focus();
                        CZFeatures.handleKeydown(e);
                    }
                    return;
                }
            }

            // Alt+Arrow: move line (intercept browser focus navigation)
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (CZUI.getActiveId()) {
                    CZUI.getEditingArea().focus();
                    CZFeatures.handleKeydown(e);
                }
                return;
            }
        }, true); // <-- capture phase = fires before any other handler

        // File drag & drop
        document.body.addEventListener('dragover', e => {
            if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); CZUI.dropOverlay.classList.add('active'); }
        });
        document.body.addEventListener('dragleave', e => {
            if (e.relatedTarget === null) CZUI.dropOverlay.classList.remove('active');
        });
        document.body.addEventListener('drop', e => {
            if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault(); CZUI.dropOverlay.classList.remove('active');
                Array.from(e.dataTransfer.files).forEach(f => CZUI.processImportedFile(f));
            }
        });

        // ===== PWA: Manifest Loader =====
        function applyManifest(m) {
            const shortName = m.short_name || 'CZEditor';
            const version = m.version || '2.0.0';
            const fullName = m.name || shortName;
            const description = m.description || '';

            // Update document title
            const titleEl = document.getElementById('app-title');
            if (titleEl) titleEl.textContent = fullName;
            document.title = fullName;

            // Update welcome screen logo
            const logo = document.getElementById('app-logo');
            if (logo) {
                const highlight = shortName.substring(0, 2).toLowerCase();
                const rest = shortName.substring(2).toLowerCase();
                logo.innerHTML = `<span class="cz-highlight">${highlight}</span>${rest}`;
            }

            // Update version
            const ver = document.getElementById('app-version');
            if (ver) ver.textContent = `v${version}`;

            // Update description
            const desc = document.getElementById('app-description');
            if (desc && description) desc.textContent = description;
        }

        fetch('manifest.json', { cache: 'no-store' }).then(r => r.json()).then(applyManifest)
            .catch(() => applyManifest({ short_name: 'CZEditor', version: '2.0.0', name: 'CZEditor - Modern Code Editor' }));

        // ===== PWA: Service Worker + Install Prompt =====
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => { });
        }

        let deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', e => {
            e.preventDefault();
            deferredPrompt = e;
            const btn = document.getElementById('pwa-install-btn');
            if (btn) btn.classList.remove('hidden');
        });
        document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const result = await deferredPrompt.userChoice;
            if (result.outcome === 'accepted') {
                document.getElementById('pwa-install-btn').classList.add('hidden');
            }
            deferredPrompt = null;
        });
        window.addEventListener('appinstalled', () => {
            document.getElementById('pwa-install-btn')?.classList.add('hidden');
            deferredPrompt = null;
        });
    }

    window.addEventListener('DOMContentLoaded', initApp);
})();
