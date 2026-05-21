// CZEditor Cache — IndexedDB-based storage for large data
// Replaces localStorage for file content cache to avoid 5MB quota limit
const CZCache = (() => {
    'use strict';

    const DB_NAME = 'czeditor_cache';
    const DB_VERSION = 1;
    const STORE_NAME = 'cache';

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function set(key, value) {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.put(value, key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
                tx.oncomplete = () => db.close();
            });
        } catch (e) {
            console.warn('[CZCache] set failed:', e.message);
        }
    }

    async function get(key) {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
                tx.oncomplete = () => db.close();
            });
        } catch (e) {
            console.warn('[CZCache] get failed:', e.message);
            return undefined;
        }
    }

    async function remove(key) {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.delete(key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
                tx.oncomplete = () => db.close();
            });
        } catch (e) {
            console.warn('[CZCache] remove failed:', e.message);
        }
    }

    return { set, get, remove };
})();
