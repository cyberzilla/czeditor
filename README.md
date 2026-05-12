# CZEditor

A powerful, modern web-based code editor built with pure HTML, CSS, and JavaScript — no frameworks, no dependencies.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![PWA](https://img.shields.io/badge/PWA-ready-blueviolet)

---

## ✨ Features

### Editor Core
- **Syntax Highlighting** — Real-time tokenization for JavaScript, TypeScript, HTML, CSS, Python, PHP, JSON, and Markdown
- **Autocomplete** — Context-aware suggestions based on language keywords and document symbols
- **Emmet Expansion** — Tab-triggered Emmet abbreviations for HTML & CSS
- **Bracket Matching** — Visual highlight for matching `()`, `[]`, `{}`
- **Smart Indent** — Auto-indent on Enter, block indent/outdent support
- **Line Operations** — Duplicate, delete, move lines up/down
- **Comment Toggle** — Language-aware single-line comment toggling
- **Multi-file Tabs** — Open, switch, pin, rename, drag-reorder, and close files
- **Command Palette** — Quick access to all commands via `Ctrl+P`

### File Management
- **Drag & Drop** — Drop files directly into the editor
- **Encoding Support** — UTF-8, UTF-8 BOM, UTF-16 LE/BE BOM, ANSI detection and export
- **Line Endings** — LF (Unix), CRLF (Windows), CR (Classic Mac) — auto-detect and convert
- **Auto-save** — Changes persist in `localStorage` across sessions
- **Download** — Export files with correct encoding and line endings

### UI & Design
- **Dark Theme** — Premium Catppuccin-inspired dark theme
- **Maple Mono NF** — Bundled WOFF2 font with 8 weight variants + italic
- **Animated Welcome** — Gradient logo, staggered fade-up animations
- **Custom Scrollbars** — Themed scrollbars across all browsers
- **Responsive Footer** — Live cursor position, file stats, encoding, EOL, and language info

### Progressive Web App (PWA)
- **Installable** — Install as a standalone desktop app from the browser
- **Offline Ready** — Service Worker caches assets for offline use
- **Full Shortcuts** — Standalone mode enables all keyboard shortcuts (Ctrl+N, Ctrl+S, etc.)

### Internationalization (i18n)
- **Multi-language UI** — Switch between Bahasa Indonesia and English
- **Auto-detect** — Matches browser language on first visit
- **Easy to extend** — Add new languages by creating a JSON file

---

## 📁 Project Structure

```
czeditor/
├── index.html              # Main HTML with data-i18n attributes
├── style.css               # Full design system & animations
├── engine.js               # Syntax engine: tokenizer, language configs
├── editor-ui.js            # UI module: tabs, dialogs, footer, scroll sync
├── editor-features.js      # Features: autocomplete, emmet, shortcuts
├── script.js               # App initializer & event bindings
├── i18n.js                 # Internationalization module
├── manifest.json           # PWA manifest (app metadata & version)
├── sw.js                   # Service Worker for offline caching
├── icon-192.png            # App icon (192×192)
├── icon-512.png            # App icon (512×512)
├── font/                   # Maple Mono NF WOFF2 fonts
│   ├── MapleMono-Regular.ttf.woff2
│   ├── MapleMono-Bold.ttf.woff2
│   ├── MapleMono-Italic.ttf.woff2
│   └── ... (16 variants)
├── lang/                   # Syntax highlighting configs
│   ├── javascript.json
│   ├── html.json
│   └── ...
└── i18n/                   # UI translation files
    ├── id.json             # Bahasa Indonesia
    └── en.json             # English
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + N` | New File |
| `Ctrl + S` | Save / Download |
| `Ctrl + /` | Toggle Comment |
| `Ctrl + D` | Duplicate Line |
| `Ctrl + Shift + K` | Delete Line |
| `Alt + ↑/↓` | Move Line Up/Down |
| `Ctrl + ]` | Indent |
| `Ctrl + [` | Outdent |
| `Ctrl + L` | Select Line |
| `Ctrl + P` | Command Palette |
| `Tab` | Emmet Expand / Indent |
| `Escape` | Close Popup |

---

## 🚀 Getting Started

### Option 1: Static Server
Simply serve the project folder with any static HTTP server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .

# Using PHP
php -S localhost:8000

# Using Laragon, XAMPP, etc.
# Place in the web root directory
```

### Option 2: Install as PWA
1. Open the editor in Chrome or Edge
2. Click the **"📥 Install as Application"** button on the welcome screen
3. The editor runs as a standalone desktop app with full shortcut support

---

## 🌐 Adding a New Language

1. Copy `i18n/en.json` to `i18n/{code}.json`
2. Translate all string values
3. Update `getAvailableLanguages()` in `i18n.js`:

```javascript
function getAvailableLanguages() {
    return [
        { code: 'id', name: 'Bahasa Indonesia' },
        { code: 'en', name: 'English' },
        { code: 'ja', name: '日本語' }  // ← add new entry
    ];
}
```

4. Reload — the new language appears in ⚙️ Settings → 🌐 Language

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│                    index.html                     │
│              (Structure & data-i18n)              │
└──────────────┬───────────────────────────────────-┘
               │
    ┌──────────┼──────────┬──────────┬──────────┐
    ▼          ▼          ▼          ▼          ▼
 engine.js   i18n.js  editor-ui.js  editor-    script.js
 (Tokenizer) (i18n)   (UI/Tabs/    features   (Init &
              │        Dialogs)    (Keys/AC/   Events)
              │           │        Emmet)         │
              ▼           ▼           │            ▼
          i18n/*.json  style.css      └──────► manifest.json
                      (Design)                   sw.js
```

- **engine.js** — Zero-dependency syntax tokenizer with lazy-loaded language configs
- **editor-ui.js** — Tab management, file operations, scroll sync, status bar
- **editor-features.js** — Keyboard shortcuts, autocomplete, Emmet, auto-close brackets
- **i18n.js** — Translation loader with DOM binding and localStorage persistence
- **script.js** — Application entry point, event wiring, PWA registration

---

## 📝 Version History

### v2.0.0
- Complete rewrite with modular architecture
- WOFF2 font optimization (96% smaller than TTF)
- Multi-encoding & line ending support
- PWA with offline caching and standalone mode
- Internationalization system (id, en)
- Animated welcome screen with manifest-driven metadata
- Custom scrollbar theming for all browsers
- Command palette with translated commands

---

## 📄 License

MIT License — See [font/LICENSE.txt](font/LICENSE.txt) for Maple Mono NF font license.
