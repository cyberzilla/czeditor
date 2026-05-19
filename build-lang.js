/**
 * CZEditor Language Registry Builder
 * 
 * Scans lang/ folder, reads each .json config, and generates registry.json automatically.
 * 
 * Usage: node build-lang.js
 * 
 * After adding a new lang/*.json file, just run this script.
 * It will also bump the SW version so the new language is cached.
 */
const fs = require('fs');
const path = require('path');

const LANG_DIR = path.join(__dirname, 'lang');
const REGISTRY_FILE = path.join(LANG_DIR, 'registry.json');
const SW_FILE = path.join(__dirname, 'sw.js');

// 1. Scan lang and build registry
const registry = [];
const files = fs.readdirSync(LANG_DIR).filter(f => f.endsWith('.json') && f !== 'registry.json');

for (const file of files) {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(LANG_DIR, file), 'utf8'));
        if (!cfg.id || !cfg.name) {
            console.warn(`  ⚠ Skipping ${file}: missing id or name`);
            continue;
        }
        const entry = { id: cfg.id, name: cfg.name, extensions: cfg.extensions || [] };
        if (cfg.filenames && cfg.filenames.length) entry.filenames = cfg.filenames;
        registry.push(entry);
    } catch (e) {
        console.warn(`  ⚠ Skipping ${file}: ${e.message}`);
    }
}

registry.sort((a, b) => a.name.localeCompare(b.name));

// 2. Check for extension conflicts
const extMap = {};
let conflicts = 0;
for (const lang of registry) {
    for (const ext of lang.extensions) {
        if (extMap[ext]) {
            console.warn(`  ⚠ Extension conflict: .${ext} → ${extMap[ext]} vs ${lang.id}`);
            conflicts++;
        }
        extMap[ext] = lang.id;
    }
}

// 3. Write registry.json
const lines = ['['];
registry.forEach((r, i) => {
    lines.push('  ' + JSON.stringify(r) + (i < registry.length - 1 ? ',' : ''));
});
lines.push(']');
lines.push('');
fs.writeFileSync(REGISTRY_FILE, lines.join('\n'));

// 4. Auto-bump SW version
let sw = fs.readFileSync(SW_FILE, 'utf8');
const versionMatch = sw.match(/czeditor-v(\d+)\.(\d+)\.(\d+)/);
if (versionMatch) {
    const [, major, minor, patch] = versionMatch;
    const newVersion = `czeditor-v${major}.${minor}.${parseInt(patch) + 1}`;
    sw = sw.replace(versionMatch[0], newVersion);
    fs.writeFileSync(SW_FILE, sw);
    console.log(`  ✓ SW version bumped to ${newVersion}`);
}

// 5. Summary
console.log(`  ✓ registry.json updated: ${registry.length} languages`);
console.log(`  Languages: ${registry.map(r => r.id).join(', ')}`);
if (conflicts) console.warn(`  ⚠ ${conflicts} extension conflict(s) found`);
else console.log('  ✓ No extension conflicts');
