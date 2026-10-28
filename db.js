/* Laboratorio de argumentos — almacenamiento local (IndexedDB).
   Los datos viven solo en este navegador. */
(function (root) {
  'use strict';
  const DB_NAME = 'laboratorio-argumentos-db';
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('Este navegador no ofrece almacenamiento local (IndexedDB).')); return; }
      let req;
      try { req = root.indexedDB.open(DB_NAME, VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('No se pudo abrir el almacenamiento local.')); };
      req.onblocked = function () { reject(new Error('El almacenamiento está bloqueado por otra ventana. Cerrala y recargá.')); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }

  function run(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let req;
        try { req = fn(s); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(req && 'result' in req ? req.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('La operación de guardado fue cancelada.')); };
      });
    });
  }

  root.DB = {
    available: function () { return open().then(function () { return true; }); },
    getAll: function () { return run('projects', 'readonly', function (s) { return s.getAll(); }); },
    get: function (id) { return run('projects', 'readonly', function (s) { return s.get(id); }); },
    put: function (project) { return run('projects', 'readwrite', function (s) { return s.put(project); }); },
    putMany: function (projects) {
      return run('projects', 'readwrite', function (s) { let last; projects.forEach(function (p) { last = s.put(p); }); return last; });
    },
    remove: function (id) { return run('projects', 'readwrite', function (s) { return s.delete(id); }); },
    getMeta: function (key) { return run('meta', 'readonly', function (s) { return s.get(key); }).then(function (r) { return r ? r.value : undefined; }); },
    setMeta: function (key, value) { return run('meta', 'readwrite', function (s) { return s.put({ key: key, value: value }); }); },
    persist: function () {
      if (root.navigator && navigator.storage && navigator.storage.persist) {
        return navigator.storage.persisted().then(function (already) {
          return already ? true : navigator.storage.persist();
        }).catch(function () { return false; });
      }
      return Promise.resolve(false);
    }
  };
})(typeof self !== 'undefined' ? self : this);
