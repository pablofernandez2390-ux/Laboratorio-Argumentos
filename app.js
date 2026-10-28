/* Laboratorio de argumentos — interfaz. */
(function () {
  'use strict';
  const L = window.Logic, DB = window.DB;
  const APP_VERSION = '0.1.0';
  const TAB_ID = L.uid('tab');

  /* ---------- Utilidades ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
  const fmtTime = d => d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const slug = s => String(s || 'proyecto').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'proyecto';
  const today = () => new Date().toISOString().slice(0, 10);

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------- Estado ---------- */
  const S = {
    projects: [], project: null, view: 'list', tab: 'arbol',
    fichaId: null, composer: null, snap: null,
    filter: { q: '', status: '' },
    save: 'idle', savedAt: null, saveErr: '',
    dbOk: true, dbError: '', conflict: false,
    installEvt: null, installed: false, offlineReady: false, persisted: null, lastBackup: null,
    sections: { formulacion: true, condiciones: false, justificacion: false, estructura: true, ubicacion: true, historial: false },
    focusFicha: false
  };

  /* ---------- Guardado automático ---------- */
  let saveTimer = null, lastBroadcast = '';
  let channel = null;
  try { channel = ('BroadcastChannel' in window) ? new BroadcastChannel('laboratorio-argumentos') : null; } catch (e) { channel = null; }

  function markDirty() {
    if (!S.project) return;
    if (S.conflict) return;
    S.save = 'pending';
    updateSaveState();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }

  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    const P = S.project;
    if (!P || S.conflict) return Promise.resolve();
    if (!S.dbOk) { S.save = 'nodb'; updateSaveState(); return Promise.resolve(); }
    S.save = 'saving'; updateSaveState();
    return DB.put(P).then(() => {
      S.save = 'saved'; S.savedAt = new Date(); updateSaveState();
      if (channel && lastBroadcast !== P.updatedAt) {
        lastBroadcast = P.updatedAt;
        channel.postMessage({ type: 'saved', id: P.id, updatedAt: P.updatedAt, from: TAB_ID });
      }
      if (S.persisted === null) DB.persist().then(v => { S.persisted = !!v; });
    }).catch(err => {
      S.save = 'error'; S.saveErr = err && err.message ? err.message : 'error desconocido';
      updateSaveState();
      toast('No se pudo guardar: ' + S.saveErr);
    });
  }

  function flushSave() { if (saveTimer) return saveNow(); return Promise.resolve(); }

  function updateSaveState() {
    const el = $('#savestate');
    if (!el) return;
    const map = {
      idle: '', pending: 'Cambios sin guardar…', saving: 'Guardando…',
      saved: S.savedAt ? '✓ Guardado ' + fmtTime(S.savedAt) : '✓ Guardado',
      error: '⚠ No se pudo guardar', nodb: '⚠ Sin guardado'
    };
    el.textContent = map[S.save] || '';
  }

  if (channel) {
    channel.onmessage = ev => {
      const m = ev.data || {};
      if (m.from === TAB_ID || m.type !== 'saved') return;
      if (S.view === 'list') { reloadProjects().then(render); return; }
      if (S.project && m.id === S.project.id && m.updatedAt !== S.project.updatedAt) {
        if (S.save === 'pending' || saveTimer) { S.conflict = true; renderBanner(); }
        else { reloadCurrent().then(() => { toast('Se actualizó con los cambios hechos en otra ventana.'); }); }
      }
    };
  }

  async function reloadProjects() {
    if (!S.dbOk) return;
    try { S.projects = await DB.getAll(); if (S.project) S.project = S.projects.find(p => p.id === S.project.id) || S.project; } catch (e) { /* se conserva lo que hay */ }
  }
  async function reloadCurrent() {
    const id = S.project.id;
    const fresh = await DB.get(id);
    if (fresh) {
      const i = S.projects.findIndex(p => p.id === id);
      if (i >= 0) S.projects[i] = fresh; else S.projects.push(fresh);
      S.project = fresh;
      lastBroadcast = fresh.updatedAt;
    }
    S.conflict = false; S.save = 'saved';
    render();
  }

  /* ---------- Diálogos ---------- */
  function openDialog(opts) {
    return new Promise(resolve => {
      const d = $('#dlg');
      d.innerHTML = '<div class="dlg-inner"><h2 id="dlg-title">' + esc(opts.title) + '</h2><div class="dlg-content">' + (opts.body || '') + '</div><div class="dlg-actions"></div></div>';
      d.setAttribute('aria-labelledby', 'dlg-title');
      const bar = $('.dlg-actions', d);
      let done = false;
      const finish = v => {
        if (done) return; done = true;
        d.onclose = null; d.oncancel = null;
        try { d.close(); } catch (e) { d.removeAttribute('open'); }
        resolve(v);
      };
      (opts.actions || []).forEach(a => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn ' + (a.kind || ''); b.textContent = a.label;
        b.addEventListener('click', () => {
          const r = a.run ? a.run(d) : undefined;
          if (r === false) return;
          finish(r === undefined ? a.value : r);
        });
        bar.appendChild(b);
      });
      d.oncancel = e => { e.preventDefault(); finish(null); };
      d.onclose = () => finish(null);
      if (d.showModal) d.showModal(); else d.setAttribute('open', '');
      const first = $('input:not([type=hidden]), textarea, select', d);
      if (first && !opts.noFocus) first.focus();
      if (opts.onOpen) opts.onOpen(d, finish);
    });
  }

  function confirmDialog(message, o) {
    o = o || {};
    return openDialog({
      title: o.title || 'Confirmar', body: '<p>' + message + '</p>', noFocus: true,
      actions: [{ label: 'Cancelar', value: false }, { label: o.ok || 'Aceptar', kind: o.danger ? 'danger solid' : 'primary', value: true }]
    }).then(v => v === true);
  }

  function messageDialog(title, html) {
    return openDialog({ title, body: html, noFocus: true, actions: [{ label: 'Entendido', kind: 'primary', value: true }] });
  }

  function pickDialog(o) {
    // o: {title, intro, items:[{id,label}], searchLabel}
    const body = (o.intro ? '<p class="muted small">' + o.intro + '</p>' : '') +
      '<label class="field"><span class="lbl">' + esc(o.searchLabel || 'Buscar') + '</span><input type="search" id="pk-q"></label>' +
      '<div class="picklist" id="pk-list" role="radiogroup" aria-label="' + esc(o.title) + '"></div>';
    return openDialog({
      title: o.title, body, noFocus: false,
      actions: [
        { label: 'Cancelar', value: null },
        { label: 'Elegir', kind: 'primary', run: d => { const c = $('input[name=pk]:checked', d); if (!c) { toast('Elegí una opción de la lista.'); return false; } return c.value; } }
      ],
      onOpen: d => {
        const paint = () => {
          const q = $('#pk-q', d).value.trim().toLowerCase();
          const items = o.items.filter(i => !q || i.label.toLowerCase().includes(q));
          $('#pk-list', d).innerHTML = items.length ? items.map(i => '<label class="pick"><input type="radio" name="pk" value="' + esc(i.id) + '"><span>' + esc(i.label) + '</span></label>').join('') : '<p class="muted small" style="padding:.6rem">No hay enunciados que coincidan.</p>';
        };
        $('#pk-q', d).addEventListener('input', paint);
        paint();
      }
    });
  }

  function projectForm(initial, withThesis) {
    const st = L.PROJECT_STATUS.map(s => '<option' + (s === initial.status ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
    const body =
      '<label class="field"><span class="lbl">Título</span><input type="text" id="pf-title" value="' + esc(initial.title) + '" maxlength="200"></label>' +
      (withThesis ? '<label class="field"><span class="lbl">Tesis</span><span class="help">Lo que querés sostener o poner a prueba. Podés dejarla vacía y escribirla después.</span><textarea id="pf-thesis" class="stmt" rows="3"></textarea></label>' : '') +
      '<label class="field"><span class="lbl">Descripción</span><textarea id="pf-desc" rows="3">' + esc(initial.description) + '</textarea></label>' +
      '<label class="field"><span class="lbl">Tema</span><input type="text" id="pf-topic" value="' + esc(initial.topic) + '" maxlength="120"></label>' +
      '<label class="field"><span class="lbl">Estado de la investigación</span><select id="pf-status">' + st + '</select></label>';
    return openDialog({
      title: withThesis ? 'Nuevo proyecto' : 'Datos del proyecto', body,
      actions: [
        { label: 'Cancelar', value: null },
        {
          label: withThesis ? 'Crear proyecto' : 'Guardar', kind: 'primary', run: d => {
            const title = $('#pf-title', d).value.trim();
            if (!title) { toast('Escribí un título.'); $('#pf-title', d).focus(); return false; }
            return { title, description: $('#pf-desc', d).value, topic: $('#pf-topic', d).value.trim(), status: $('#pf-status', d).value, thesisText: withThesis ? $('#pf-thesis', d).value.trim() : '' };
          }
        }
      ]
    });
  }

  /* ---------- Ruteo ---------- */
  function parseHash() {
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 'p' && parts[1]) {
      if (parts[2] === 'formulas') return { view: 'project', id: parts[1], tab: 'formulas', sid: null };
      if (parts[2] === 'info') return { view: 'project', id: parts[1], tab: 'info', sid: null };
      if (parts[2] === 's' && parts[3]) return { view: 'project', id: parts[1], tab: 'arbol', sid: parts[3] };
      return { view: 'project', id: parts[1], tab: 'arbol', sid: null };
    }
    return { view: 'list' };
  }

  async function onRoute() {
    await flushSave();
    const r = parseHash();
    if (r.view === 'list') {
      S.project = null; S.view = 'list'; S.fichaId = null; S.composer = null; S.conflict = false;
      render(); return;
    }
    if (!S.project || S.project.id !== r.id) {
      const p = S.projects.find(x => x.id === r.id);
      if (!p) { toast('No encontré ese proyecto en este navegador.'); location.hash = '#/'; return; }
      S.project = p; S.composer = null; S.conflict = false; S.save = 'idle';
    }
    S.view = 'project'; S.tab = r.tab;
    const newFicha = r.sid && S.project.statements[r.sid] ? r.sid : null;
    if (newFicha !== S.fichaId) S.focusFicha = !!newFicha;
    S.fichaId = newFicha;
    render();
  }

  const go = path => { location.hash = path; };

  /* ---------- Render general ---------- */
  function render() {
    renderTopbar(); renderBanner();
    const m = $('#main');
    if (S.view === 'list') { renderList(m); return; }
    renderProjectView(m);
  }

  function renderTopbar() {
    const t = $('#topbar');
    const install = (S.installEvt && !S.installed) ? '<button class="btn primary" data-act="install">Instalar app</button>' : '';
    if (S.view === 'list') {
      t.innerHTML = '<h1>Laboratorio de argumentos</h1>' + install;
      document.title = 'Laboratorio de argumentos';
      return;
    }
    const P = S.project, id = P.id;
    const tab = (key, href, label) => '<a href="' + href + '"' + (S.tab === key ? ' aria-current="page"' : '') + '>' + label + '</a>';
    t.innerHTML =
      '<a class="btn" href="#/" aria-label="Volver a la lista de proyectos">← Proyectos</a>' +
      '<h1>' + esc(P.title) + '</h1><span class="savestate" id="savestate"></span>' + install +
      '<nav class="tabs" aria-label="Secciones del proyecto">' + tab('arbol', '#/p/' + id, 'Árbol') + tab('formulas', '#/p/' + id + '/formulas', 'Fórmulas') + tab('info', '#/p/' + id + '/info', 'Proyecto') + '</nav>';
    document.title = P.title + ' — Laboratorio de argumentos';
    updateSaveState();
  }

  function renderBanner() {
    const b = $('#banner');
    b.className = '';
    if (!S.dbOk) {
      b.className = 'err';
      b.innerHTML = '<strong>Esta ventana no puede guardar.</strong> ' + esc(S.dbError) + ' Lo que escribas se perderá al cerrar. Abrí la app desde su enlace web normal, o exportá un respaldo antes de salir.';
      return;
    }
    if (S.conflict) {
      b.innerHTML = '<span>Este proyecto cambió en otra ventana de la app.</span> <button class="btn sm" data-act="conflict-load">Cargar la versión guardada (descarta lo de esta ventana)</button> <button class="btn sm" data-act="conflict-keep">Conservar esta versión (sobrescribe)</button>';
      return;
    }
    b.innerHTML = '';
  }

  /* ---------- Lista de proyectos ---------- */
  function projectCardHTML(p) {
    const sm = L.summarize(p);
    const th = sm.thesis;
    const thesisState = th ? L.estadoById(th.estado) : null;
    return '<article class="card"><h2>' + esc(p.title) + '</h2>' +
      '<div class="meta"><span class="badge">' + esc(p.status) + '</span>' + (p.topic ? ' Tema: ' + esc(p.topic) + ' · ' : ' ') + 'Creado ' + fmtDate(p.createdAt) + ' · Modificado ' + fmtDate(p.updatedAt) + '</div>' +
      (p.description ? '<p class="desc">' + esc(clip(p.description, 200)) + '</p>' : '') +
      '<p class="small">' + sm.total + ' enunciado' + (sm.total === 1 ? '' : 's') +
      (thesisState ? ' · Tesis: ' + thesisState.icon + ' ' + esc(thesisState.label) : '') +
      ' · ' + sm.leaves + ' premisa' + (sm.leaves === 1 ? '' : 's') + ' base sin más sustento' +
      (sm.objections ? ' · ' + sm.objections + ' objeción' + (sm.objections === 1 ? '' : 'es') : '') +
      (sm.unplaced ? ' · ' + sm.unplaced + ' sin ubicar' : '') + '</p>' +
      '<div class="row"><a class="btn primary" href="#/p/' + esc(p.id) + '">Abrir</a>' +
      '<button class="btn sm" data-act="edit-project" data-id="' + esc(p.id) + '">Editar datos</button>' +
      '<button class="btn sm" data-act="dup-project" data-id="' + esc(p.id) + '">Duplicar</button>' +
      '<button class="btn sm" data-act="export-project" data-id="' + esc(p.id) + '">Exportar</button>' +
      '<button class="btn sm danger" data-act="del-project" data-id="' + esc(p.id) + '">Eliminar</button></div></article>';
  }

  function listCardsHTML() {
    const q = S.filter.q.trim().toLowerCase();
    const list = S.projects.filter(p =>
      (!S.filter.status || p.status === S.filter.status) &&
      (!q || (p.title + ' ' + p.description + ' ' + p.topic).toLowerCase().includes(q))
    ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!S.projects.length) {
      return '<div class="empty"><h2>Todavía no hay proyectos</h2><p>Un proyecto reúne una tesis, sus premisas y las objeciones que la ponen a prueba.</p><button class="btn primary" data-act="new-project">Crear el primer proyecto</button></div>';
    }
    if (!list.length) return '<div class="empty"><p>Ningún proyecto coincide con la búsqueda.</p></div>';
    return '<div class="cards">' + list.map(projectCardHTML).join('') + '</div>';
  }

  function renderList(m) {
    const ios = /iphone|ipad/i.test(navigator.userAgent) && !S.installed;
    const backup = S.lastBackup ? 'Último respaldo: ' + fmtDate(S.lastBackup) + '.' : (S.projects.length ? 'Todavía no descargaste ningún respaldo.' : '');
    m.innerHTML =
      '<div class="row" style="margin-bottom:.75rem"><button class="btn primary" data-act="new-project">＋ Nuevo proyecto</button>' +
      '<button class="btn" data-act="import">Importar…</button>' +
      '<button class="btn" data-act="export-all"' + (S.projects.length ? '' : ' disabled') + '>Respaldo de todo</button>' +
      '<input type="file" id="file-import" accept=".json,application/json" hidden></div>' +
      (S.projects.length ? '<p class="small ' + (S.lastBackup ? 'muted' : '') + '" style="' + (S.lastBackup ? '' : 'background:var(--warn-bg);color:var(--warn-ink);padding:.4rem .6rem;border-radius:6px') + '">Tus proyectos viven solo en este navegador. ' + esc(backup) + ' Descargá un respaldo cada tanto.</p>' : '') +
      '<div class="list-tools"><label class="sr" for="q">Buscar proyectos</label><input type="search" id="q" placeholder="Buscar por título, tema o descripción" value="' + esc(S.filter.q) + '">' +
      '<label class="sr" for="fs">Filtrar por estado</label><select id="fs"><option value="">Todos los estados</option>' + L.PROJECT_STATUS.map(s => '<option' + (S.filter.status === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>' +
      '<div id="cards">' + listCardsHTML() + '</div>' +
      '<div class="footnote"><p><strong>Sin conexión:</strong> ' + (S.offlineReady ? 'esta app ya quedó lista para usarse sin conexión. ' : 'cuando termine de cargar por primera vez podrás usarla sin conexión. ') + 'Todo (proyectos, árbol, fórmulas, importar y exportar) funciona sin internet; nada se envía a ningún servidor.</p>' +
      '<p><strong>Instalar:</strong> en Chrome aparece el botón «Instalar app» arriba (o menú ⋮ → «Instalar aplicación»).' + (ios ? ' En iPhone/iPad: Compartir → «Añadir a pantalla de inicio».' : '') + '</p>' +
      '<p>Versión ' + APP_VERSION + (S.persisted === true ? ' · Almacenamiento persistente concedido.' : (S.persisted === false ? ' · El navegador podría borrar los datos si le falta espacio: hacé respaldos.' : '')) + '</p></div>';
  }

  function refreshCards() {
    const c = $('#cards'); if (c) c.innerHTML = listCardsHTML();
  }

  /* ---------- Vista de proyecto ---------- */
  function renderProjectView(m) {
    if (S.tab === 'arbol') {
      m.innerHTML = '<div class="layout' + (S.fichaId ? ' with-ficha' : '') + '"><section id="tree" aria-label="Árbol de argumentos"></section><aside id="ficha" aria-label="Ficha del enunciado" tabindex="-1"></aside></div>';
      renderTree(); renderFicha();
    } else if (S.tab === 'formulas') {
      m.innerHTML = '<section id="formulas"></section>'; renderFormulas($('#formulas'));
    } else {
      m.innerHTML = '<section id="info"></section>'; renderInfo($('#info'));
    }
  }

  /* ----- Árbol ----- */
  function nodeHTML(id, depth) {
    const P = S.project, s = P.statements[id];
    if (!s || depth > 60) return '';
    const open = !!P.ui.expanded[id];
    const ty = L.typeById(s.type), es = L.estadoById(s.estado);
    const count = s.args.reduce((n, a) => n + a.premises.length, 0);
    const placeholder = s.type === 'tesis' ? 'Escribí la tesis (tocá «Ficha»)' : 'Sin texto todavía';
    return '<li class="node" data-id="' + id + '"><div class="node-row' + (S.fichaId === id ? ' selected' : '') + '">' +
      '<button class="twisty" data-act="toggle" data-id="' + id + '" aria-expanded="' + open + '" aria-label="' + (open ? 'Contraer' : 'Expandir') + ' ' + esc(s.sym) + '"><span aria-hidden="true">' + (open ? '▾' : '▸') + '</span></button>' +
      '<button class="node-main" data-act="toggle" data-id="' + id + '" aria-expanded="' + open + '">' +
      '<span class="top"><span class="sym">' + esc(s.sym) + '</span><span class="badge type">' + ty.icon + ' ' + esc(ty.label) + '</span>' + (s.estado !== 'no_evaluado' ? '<span class="badge">' + es.icon + ' ' + esc(es.label) + '</span>' : '') +
      (count ? '<span class="badge">' + count + ' premisa' + (count === 1 ? '' : 's') + '</span>' : '') + '</span>' +
      '<span class="txt' + (s.text ? '' : ' empty-txt') + '">' + esc(s.text || placeholder) + '</span></button>' +
      '<button class="btn sm node-ficha" data-act="ficha" data-id="' + id + '" aria-label="Abrir la ficha de ' + esc(s.sym) + '">Ficha</button></div>' +
      (open ? branchHTML(id, depth) : '') + '</li>';
  }

  const KIND_BADGE = { support: ['ok', 'A favor'], attack: ['bad', 'En contra'], question: ['', 'En duda'], necessary: ['', 'Condición'] };

  function composerHTML() {
    const c = S.composer;
    return '<li class="composer"><label class="sr" for="composer-ta">Texto del nuevo enunciado</label><textarea id="composer-ta" class="stmt" rows="2" placeholder="Escribí el enunciado. Enter agrega; Shift+Enter hace un salto de línea.">' + esc(c.draft) + '</textarea>' +
      '<div class="row" style="margin-top:.4rem"><button class="btn primary sm" data-act="composer-add">Agregar</button><button class="btn sm" data-act="composer-done">Listo</button></div></li>';
  }

  function branchHTML(id, depth) {
    const P = S.project, s = P.statements[id];
    const c = S.composer;
    let html = '<div class="branch">';
    s.args.forEach((a, i) => {
      const r = L.relById(a.rel), kb = KIND_BADGE[r.kind];
      const opts = L.RELS.map(x => '<option value="' + x.id + '"' + (x.id === a.rel ? ' selected' : '') + '>' + x.mark + ' ' + esc(x.label) + '</option>').join('');
      html += '<section class="arg ' + r.kind + '"><div class="arg-head"><span class="mark" aria-hidden="true">' + r.mark + '</span>' +
        '<label class="sr" for="rel-' + a.id + '">Relación del argumento ' + (i + 1) + '</label><select id="rel-' + a.id + '" data-act="rel" data-id="' + id + '" data-arg="' + a.id + '" title="' + esc(r.hint) + '">' + opts + '</select>' +
        '<span class="badge ' + kb[0] + '">' + kb[1] + '</span>' +
        (a.premises.length > 1 ? '<span class="small muted">las premisas valen en conjunto</span>' : '') + '</div><ul class="tree">';
      a.premises.forEach(pid => { html += nodeHTML(pid, depth + 1); });
      if (c && c.parentId === id && c.argId === a.id) html += composerHTML();
      html += '</ul>';
      if (!a.premises.length && !(c && c.parentId === id && c.argId === a.id)) html += '<p class="nopremise">Este argumento todavía no tiene enunciados.</p>';
      html += '<div class="branch-actions"><button class="btn sm" data-act="add-prem" data-id="' + id + '" data-arg="' + a.id + '" aria-label="Agregar una premisa a este argumento">＋ Premisa</button>' +
        '<button class="btn sm" data-act="link-existing" data-id="' + id + '" data-arg="' + a.id + '" aria-label="Vincular un enunciado existente a este argumento">Vincular…</button>' +
        '<button class="btn sm ghost" data-act="rm-arg" data-id="' + id + '" data-arg="' + a.id + '">Quitar argumento</button></div></section>';
    });
    if (!s.args.length) html += '<p class="nopremise">Sin premisas todavía. ¿Qué tendría que ser cierto para que esto se sostenga?</p>';
    html += '<div class="branch-actions">' +
      (s.args.length ? '<button class="btn sm" data-act="add-arg" data-id="' + id + '" data-rel="apoya">＋ Otro argumento (razón independiente)</button>' : '<button class="btn sm" data-act="add-arg" data-id="' + id + '" data-rel="apoya">＋ Premisa que lo apoya</button>') +
      '<button class="btn sm" data-act="add-arg" data-id="' + id + '" data-rel="contradice">＋ Objeción</button></div></div>';
    return html;
  }

  function renderTree() {
    const el = $('#tree'); if (!el) return;
    const P = S.project;
    const rootIds = L.roots(P);
    const th = rootIds.filter(id => P.statements[id].type === 'tesis');
    const alts = rootIds.filter(id => P.statements[id].type === 'conclusion_alternativa');
    const loose = rootIds.filter(id => !th.includes(id) && !alts.includes(id));
    const rc = S.composer && S.composer.root ? S.composer : null;
    const sec = (title, ids, extra, note) => (ids.length || extra) ? '<div class="tree-sec"><h2>' + title + '</h2>' + (note ? '<p class="muted small">' + note + '</p>' : '') + '<ul class="tree">' + ids.map(i => nodeHTML(i, 0)).join('') + (extra || '') + '</ul></div>' : '';
    el.innerHTML =
      '<div class="tree-tools"><button class="btn sm" data-act="expand-all">Expandir todo</button><button class="btn sm" data-act="collapse-all">Contraer todo</button>' +
      '<button class="btn sm" data-act="add-root" data-type="conclusion_alternativa">＋ Conclusión alternativa</button><button class="btn sm" data-act="add-root" data-type="otro">＋ Enunciado suelto</button></div>' +
      '<p class="muted small">Tocá un enunciado para abrir o cerrar sus premisas. «Ficha» abre sus detalles.</p>' +
      sec('Tesis', th, '') +
      sec('Conclusiones alternativas', alts, (rc && rc.type === 'conclusion_alternativa') ? composerHTML() : '') +
      sec('Sin ubicar', loose, (rc && rc.type === 'otro') ? composerHTML() : '', 'Enunciados que todavía no forman parte de ningún argumento. Abrí su ficha para ubicarlos.');
    if (S.composer) {
      const ta = $('#composer-ta', el);
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollIntoView({ block: 'nearest' }); }
    }
  }

  /* ----- Ficha ----- */
  function locationsHTML(st) {
    const P = S.project, idx = L.buildParentIndex(P), locs = idx.get(st.id) || [];
    let h = '';
    if (!locs.length) {
      h += '<p class="small muted">' + (st.type === 'tesis' || st.type === 'conclusion_alternativa' ? 'Es una conclusión: no depende de otro enunciado.' : 'Todavía no forma parte de ningún argumento.') + '</p>';
    }
    locs.forEach(l => {
      const par = P.statements[l.parentId], r = L.relById(l.rel);
      h += '<div class="loc"><span class="small"><strong>' + r.mark + ' ' + esc(r.label) + '</strong> a <span class="sym">' + esc(par.sym) + '</span> ' + esc(clip(par.text, 50)) + '</span>' +
        '<button class="btn sm" data-act="loc-up" data-parent="' + l.parentId + '" data-arg="' + l.argId + '" aria-label="Subir">↑</button>' +
        '<button class="btn sm" data-act="loc-down" data-parent="' + l.parentId + '" data-arg="' + l.argId + '" aria-label="Bajar">↓</button>' +
        '<button class="btn sm" data-act="loc-move" data-parent="' + l.parentId + '" data-arg="' + l.argId + '">Mover…</button>' +
        '<button class="btn sm" data-act="loc-remove" data-parent="' + l.parentId + '" data-arg="' + l.argId + '">Quitar de aquí</button></div>';
    });
    h += '<div class="row" style="margin-top:.5rem"><button class="btn sm" data-act="link-also">' + (locs.length ? 'Vincular también en otro lugar…' : 'Ubicar en un argumento…') + '</button></div>';
    if (st.atomicOf && P.statements[st.atomicOf]) h += '<p class="small muted">Afirmación atómica obtenida de <span class="sym">' + esc(P.statements[st.atomicOf].sym) + '</span> (' + esc(clip(P.statements[st.atomicOf].text, 60)) + ').</p>';
    return h;
  }

  function checksHTML(st) {
    const sig = L.formulationSignals(st.text), hint = {};
    sig.forEach(x => { if (!hint[x.check]) hint[x.check] = x.hint; });
    return L.CHECKS.map(c => '<label class="check"><input type="checkbox" data-check="' + c.id + '"' + (st.checks[c.id] ? ' checked' : '') + '><span>' + esc(c.label) + (hint[c.id] && !st.checks[c.id] ? '<span class="hint">Posible señal: ' + esc(hint[c.id]) + '</span>' : '') + '</span></label>').join('') +
      '<p class="small muted">Las señales son solo sugerencias por palabras. Marcá una casilla únicamente si coincide con tu lectura.</p>';
  }

  function validityHTML(id) {
    const P = S.project, s = P.statements[id];
    const reps = L.validityReports(P, id);
    if (!reps.length) return '';
    let h = '';
    reps.forEach(rp => {
      const idx = s.args.findIndex(a => a.id === rp.argId), a = s.args[idx];
      const label = 'Argumento ' + (idx + 1) + ' (' + esc(L.relById(a.rel).label) + '): ';
      if (rp.status === 'incompleto') h += '<div class="verdict neutral">' + label + 'para verificar su validez falta la formalización de ' + rp.missing.map(m => '<span class="sym">' + esc(m) + '</span>').join(', ') + '.</div>';
      else if (rp.result.error) h += '<div class="verdict neutral">' + label + 'hay un error en una fórmula: ' + esc(rp.result.error) + '</div>';
      else if (!rp.result.consistent) h += '<div class="verdict bad">' + label + '⚠ las premisas formalizadas son inconsistentes entre sí; el argumento solo sería válido de forma trivial.</div>';
      else if (rp.result.valid) h += '<div class="verdict ok">' + label + '✓ válido en su forma proposicional: si las premisas fueran verdaderas, la conclusión también lo sería. Esto no prueba que las premisas sean verdaderas.</div>';
      else h += '<div class="verdict bad">' + label + '✕ no es válido en su forma proposicional. Contraejemplo: ' + Object.keys(rp.result.counterexample).map(k => esc(k) + ' = ' + (rp.result.counterexample[k] ? 'V' : 'F')).join(', ') + '. Aun así podría ser un argumento inductivo razonable.</div>';
    });
    return h;
  }

  function structureHTML(st) {
    const P = S.project;
    const loc = L.localFormulas(P, st.id), ex = L.expandedFormula(P, st.id);
    let h = '<p class="small muted">Cómo se conectan los enunciados (estructura del argumento). ∧ y, ∨ o, → implica, ¬ no.</p>';
    if (!loc.length) h += '<p class="small muted">Todavía no hay premisas conectadas a este enunciado.</p>';
    loc.forEach(f => { h += '<div class="formula ' + f.kind + '">' + esc(f.text) + '</div>'; });
    if (ex && ex.text !== (loc.find(f => f.kind === 'support') || {}).text) h += '<p class="small" style="margin:.4rem 0 0">Desplegada hasta las premisas base (' + ex.leaves.map(esc).join(', ') + '):</p><div class="formula support">' + esc(ex.text) + '</div>';
    h += '<label class="field" style="margin-top:.7rem"><span class="lbl">Formalización de este enunciado (opcional)</span><span class="help">Escribí su forma lógica con tus propias letras, p. ej. <code>llueve -> mojado</code>. Se aceptan ~ ¬ ! para «no», &amp; ∧ para «y», | ∨ para «o», -&gt; → para «implica» y &lt;-&gt; ↔.</span><input type="text" data-f="formula" value="' + esc(st.formula) + '" autocomplete="off" autocapitalize="off" spellcheck="false"></label>';
    if (st.formula.trim()) {
      const an = L.analyzeFormula(st.formula);
      h += an.error ? '<div class="verdict bad">' + esc(an.error) + '</div>' : '<div class="verdict neutral">Se lee: <span class="finline">' + esc(an.normalized) + '</span> · ' + esc(an.kind) + '</div>';
    }
    h += validityHTML(st.id);
    return h;
  }

  function historyHTML(st) {
    if (!st.history.length) return '<p class="small muted">Todavía no hay cambios registrados. Se anotan solos los cambios de texto, tipo y estado.</p>';
    const names = { text: 'Texto', type: 'Tipo', estado: 'Estado', division: 'División' };
    return st.history.slice().reverse().map(h => {
      let from = h.from, to = h.to;
      if (h.field === 'type') { from = L.typeById(from).label; to = L.typeById(to).label; }
      if (h.field === 'estado') { from = L.estadoById(from).label; to = L.estadoById(to).label; }
      return '<div class="hist"><div class="when">' + esc(new Date(h.at).toLocaleString('es')) + ' · ' + esc(names[h.field] || h.field) + '</div><div class="chg">' +
        (h.field === 'division' ? esc(to) : (from ? '«' + esc(clip(from, 160)) + '» → ' : '') + '«' + esc(clip(to, 160)) + '»') + '</div>' +
        '<label class="sr" for="hw-' + h.id + '">Justificación del cambio</label><input type="text" id="hw-' + h.id + '" data-hwhy="' + h.id + '" placeholder="¿Por qué cambió? (opcional)" value="' + esc(h.why) + '"></div>';
    }).join('');
  }

  function renderFicha() {
    const el = $('#ficha'); if (!el) return;
    const P = S.project, st = S.fichaId ? P.statements[S.fichaId] : null;
    if (!st) { el.innerHTML = ''; S.snap = null; return; }
    S.snap = { text: st.text, type: st.type, estado: st.estado };
    const typeOpts = L.TYPES.map(t => '<option value="' + t.id + '"' + (t.id === st.type ? ' selected' : '') + '>' + t.icon + ' ' + esc(t.label) + '</option>').join('');
    const estOpts = L.ESTADOS.map(e => '<option value="' + e.id + '"' + (e.id === st.estado ? ' selected' : '') + '>' + e.icon + ' ' + esc(e.label) + '</option>').join('');
    const det = (key, title, inner) => '<details class="sec" data-sec="' + key + '"' + (S.sections[key] ? ' open' : '') + '><summary>' + title + '</summary>' + inner + '</details>';
    const ta = (f, label, help, rows) => '<label class="field"><span class="lbl">' + label + '</span>' + (help ? '<span class="help">' + help + '</span>' : '') + '<textarea data-f="' + f + '" rows="' + (rows || 3) + '">' + esc(st[f]) + '</textarea></label>';
    el.innerHTML =
      '<div class="ficha-head"><h2><span class="sym">' + esc(st.sym) + '</span> Ficha del enunciado</h2><button class="btn sm" data-act="close-ficha">Cerrar</button></div>' +
      '<label class="field"><span class="lbl">Tipo</span><select data-f="type">' + typeOpts + '</select></label>' +
      '<label class="field"><span class="lbl">Enunciado (formulación vigente)</span><textarea class="stmt" data-f="text" rows="4">' + esc(st.text) + '</textarea></label>' +
      '<div id="f-orig">' + origHTML(st) + '</div>' +
      det('formulacion', 'Evaluar la formulación', '<div id="f-checks">' + checksHTML(st) + '</div>' + ta('checksNote', 'Notas sobre la formulación', '', 2) + '<div class="row"><button class="btn sm" data-act="split">Dividir en afirmaciones atómicas…</button></div><p class="small muted">El texto nunca se reescribe solo: al dividir, el enunciado original se conserva y queda relacionado con las partes.</p>') +
      det('condiciones', 'Alcance, definiciones y supuestos',
        ta('scope', 'Alcance y condiciones de aplicación', '') + ta('definitions', 'Definiciones de los términos importantes', '') + ta('assumptionsExplicit', 'Supuestos explícitos', '', 2) + ta('assumptionsImplicit', 'Supuestos implícitos', '', 2)) +
      det('justificacion', 'Qué lo justificaría o lo debilitaría',
        ta('needed', 'Qué tendría que ser cierto para que esté justificado', '') + ta('refuters', 'Qué observaciones lo debilitarían o refutarían', '') + ta('missing', 'Qué información todavía falta', '')) +
      '<details class="sec" open><summary>Estado epistemológico</summary><label class="field"><span class="lbl">Estado</span><select data-f="estado">' + estOpts + '</select></label>' + ta('estadoWhy', 'Justificación del estado', 'Por qué lo ubicás así.', 2) + '</details>' +
      det('estructura', 'Fórmulas y estructura lógica', '<div id="f-struct">' + structureHTML(st) + '</div>') +
      det('ubicacion', 'Dónde aparece', '<div id="f-loc">' + locationsHTML(st) + '</div>') +
      det('historial', 'Historial de cambios', '<div id="f-hist">' + historyHTML(st) + '</div>' + ta('notes', 'Notas', '', 3)) +
      '<div class="row" style="margin-top:1rem"><button class="btn danger" data-act="delete-stmt">Eliminar enunciado…</button></div>';
    if (S.focusFicha) { S.focusFicha = false; el.scrollTop = 0; el.focus(); }
  }

  function origHTML(st) {
    return (st.original && st.original !== st.text) ? '<p class="small muted" style="margin-bottom:.1rem">Formulación original (fija):</p><blockquote class="orig">' + esc(st.original) + '</blockquote>' : '';
  }

  /* ----- Fórmulas ----- */
  function toAscii(s) { return s.replace(/¬/g, '~').replace(/∧/g, '&').replace(/∨/g, '|').replace(/↔/g, '<->').replace(/→/g, '->'); }

  function formulasText(ascii) {
    const P = S.project;
    const lines = ['Proyecto: ' + P.title, '', 'Simbolización:'];
    P.order.forEach(id => { const s = P.statements[id]; lines.push(s.sym + ': ' + s.text); });
    lines.push('', 'Fórmulas estructurales:');
    P.order.forEach(id => {
      const s = P.statements[id];
      L.localFormulas(P, id).forEach(f => lines.push(f.text));
      const ex = L.expandedFormula(P, id);
      if (ex) lines.push('  desplegada: ' + ex.text);
      if (s.formula.trim()) { const an = L.analyzeFormula(s.formula); lines.push('  ' + s.sym + ' (forma interna): ' + (an.error ? s.formula : an.normalized)); }
    });
    const t = lines.join('\n');
    return ascii ? toAscii(t) : t;
  }

  function renderFormulas(el) {
    const P = S.project;
    const ths = P.order.map(id => P.statements[id]).filter(s => s.type === 'tesis');
    let h = '<p class="muted">Estas fórmulas muestran <strong>cómo se conectan los enunciados</strong> (la estructura del argumento), con una letra para cada uno. La forma lógica interna de cada frase la escribís vos en su ficha («Formalización»): la app no puede deducirla del texto.</p>' +
      '<div class="row" style="margin-bottom:1rem"><button class="btn sm" data-act="copy-formulas" data-mode="unicode">Copiar (símbolos)</button><button class="btn sm" data-act="copy-formulas" data-mode="ascii">Copiar (solo teclado)</button></div>';
    h += '<h2>Tesis</h2>';
    if (!ths.length) h += '<p class="muted">Este proyecto no tiene un enunciado de tipo tesis.</p>';
    ths.forEach(t => {
      const ex = L.expandedFormula(P, t.id);
      h += '<div class="fcard"><h3><span class="sym">' + esc(t.sym) + '</span> ' + esc(clip(t.text, 140) || 'Sin texto todavía') + '</h3>' +
        (ex ? '<p class="small muted">Desplegada hasta las premisas base (' + ex.leaves.map(esc).join(', ') + '):</p><div class="formula support">' + esc(ex.text) + '</div>' : '<p class="muted">La tesis todavía no tiene premisas que la apoyen.</p>') + '</div>';
    });
    h += '<h2 style="margin-top:1.25rem">Simbolización</h2><table class="sym"><thead><tr><th>Letra</th><th>Tipo</th><th>Enunciado</th></tr></thead><tbody>' +
      P.order.map(id => { const s = P.statements[id]; return '<tr><td><span class="sym">' + esc(s.sym) + '</span></td><td>' + esc(L.typeById(s.type).label) + '</td><td>' + esc(s.text || '—') + '</td></tr>'; }).join('') + '</tbody></table>';
    h += '<h2 style="margin-top:1.25rem">Fórmula por enunciado</h2>';
    let any = false;
    P.order.forEach(id => {
      const s = P.statements[id], loc = L.localFormulas(P, id), ex = L.expandedFormula(P, id);
      if (!loc.length && !s.formula.trim()) return;
      any = true;
      h += '<div class="fcard"><h3><span class="sym">' + esc(s.sym) + '</span> ' + esc(clip(s.text, 100) || 'Sin texto todavía') + '</h3>' +
        loc.map(f => '<div class="formula ' + f.kind + '">' + esc(f.text) + '</div>').join('');
      if (ex && ex.text !== (loc.find(f => f.kind === 'support') || {}).text) h += '<p class="small muted" style="margin:.3rem 0 0">Desplegada:</p><div class="formula support">' + esc(ex.text) + '</div>';
      if (s.formula.trim()) {
        const an = L.analyzeFormula(s.formula);
        h += an.error ? '<div class="verdict bad">Forma interna con error: ' + esc(an.error) + '</div>' : '<div class="verdict neutral">Forma interna: <span class="finline">' + esc(an.normalized) + '</span> · ' + esc(an.kind) + '</div>';
      }
      h += validityHTML(id) + '<p style="margin:.4rem 0 0"><a href="#/p/' + esc(P.id) + '/s/' + id + '">Abrir ficha</a></p></div>';
    });
    if (!any) h += '<p class="muted">Cuando conectes premisas en el árbol, sus fórmulas aparecerán acá.</p>';
    el.innerHTML = h;
  }

  /* ----- Proyecto (datos y exportación) ----- */
  function renderInfo(el) {
    const P = S.project, sm = L.summarize(P);
    const st = L.PROJECT_STATUS.map(s => '<option' + (s === P.status ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
    const estRows = L.ESTADOS.map(e => '<tr><td>' + e.icon + ' ' + esc(e.label) + '</td><td>' + (sm.byEstado[e.id] || 0) + '</td></tr>').join('');
    el.innerHTML =
      '<div class="card" style="margin-bottom:1rem"><h2>Datos del proyecto</h2>' +
      '<label class="field"><span class="lbl">Título</span><input type="text" data-p="title" value="' + esc(P.title) + '" maxlength="200"></label>' +
      '<label class="field"><span class="lbl">Descripción</span><textarea data-p="description" rows="3">' + esc(P.description) + '</textarea></label>' +
      '<label class="field"><span class="lbl">Tema</span><input type="text" data-p="topic" value="' + esc(P.topic) + '" maxlength="120"></label>' +
      '<label class="field"><span class="lbl">Estado de la investigación</span><select data-p="status">' + st + '</select></label>' +
      '<p class="small muted">Creado ' + fmtDate(P.createdAt) + ' · Modificado ' + fmtDate(P.updatedAt) + ' · Identificador ' + esc(P.id) + '</p></div>' +
      '<div class="card" style="margin-bottom:1rem"><h2>Resumen</h2><p>' + sm.total + ' enunciados · ' + sm.leaves + ' premisas base sin más sustento · ' + sm.objections + ' objeciones · ' + sm.unplaced + ' sin ubicar.</p>' +
      '<table class="sym"><thead><tr><th>Estado epistemológico</th><th>Enunciados</th></tr></thead><tbody>' + estRows + '</tbody></table>' +
      '<p class="small muted">Por ahora el resumen cuenta enunciados por el estado que vos les asignaste. Las evidencias y su balance se agregarán en la siguiente etapa.</p></div>' +
      '<div class="card"><h2>Exportar y borrar</h2><p class="small muted">El archivo JSON guarda el proyecto completo (enunciados, relaciones, fórmulas, historial) con su versión de esquema, y se puede volver a importar.</p>' +
      '<div class="row"><button class="btn primary" data-act="export-project" data-id="' + esc(P.id) + '">Exportar este proyecto (JSON)</button><button class="btn" data-act="dup-project" data-id="' + esc(P.id) + '">Duplicar</button><button class="btn danger" data-act="del-project" data-id="' + esc(P.id) + '">Eliminar proyecto…</button></div></div>';
  }

  /* ---------- Operaciones ---------- */
  function expandAncestors(id) {
    const P = S.project, idx = L.buildParentIndex(P);
    const stack = [id], seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      for (const l of (idx.get(cur) || [])) { if (!seen.has(l.parentId)) { seen.add(l.parentId); P.ui.expanded[l.parentId] = true; stack.push(l.parentId); } }
    }
  }

  function openComposer(parentId, argId, created) {
    S.composer = { parentId, argId, created: !!created, draft: '' };
    S.project.ui.expanded[parentId] = true;
    renderTree();
  }

  function closeComposer() {
    const c = S.composer; if (!c) return;
    if (c.created && !c.root) {
      const a = L.findArg(S.project, c.parentId, c.argId);
      if (a && !a.premises.length) { L.removeArgument(S.project, c.parentId, c.argId); markDirty(); }
    }
    S.composer = null; renderTree();
  }

  function composerAdd() {
    const c = S.composer; if (!c) return;
    const P = S.project;
    const text = (c.draft || '').trim();
    if (!text) { const ta = $('#composer-ta'); if (ta) ta.focus(); return; }
    if (c.root) L.addStatement(P, c.type, text);
    else { L.addPremise(P, c.parentId, c.argId, text); c.created = false; P.ui.expanded[c.parentId] = true; }
    c.draft = '';
    markDirty(); renderTree();
  }

  async function chooseArgTarget(targetId) {
    const P = S.project, t = P.statements[targetId];
    const opts = t.args.map((a, i) => '<option value="arg:' + a.id + '">Argumento ' + (i + 1) + ' — ' + esc(L.relById(a.rel).label) + ' (' + a.premises.length + ' premisa' + (a.premises.length === 1 ? '' : 's') + ')</option>').join('') +
      L.RELS.map(r => '<option value="new:' + r.id + '">Nuevo argumento — ' + esc(r.label) + '</option>').join('');
    return openDialog({
      title: 'Ubicar bajo «' + t.sym + '»', noFocus: false,
      body: '<p class="small muted">' + esc(clip(t.text, 120)) + '</p><label class="field"><span class="lbl">¿En qué argumento?</span><select id="at-sel">' + opts + '</select></label>',
      actions: [{ label: 'Cancelar', value: null }, { label: 'Aceptar', kind: 'primary', run: d => $('#at-sel', d).value }]
    });
  }

  async function placeStatement(childId, from) {
    // from: {parentId,argId} para mover; null para vincular además
    const P = S.project;
    const desc = L.descendants(P, childId);
    const items = P.order.filter(id => id !== childId && !desc.has(id)).map(id => ({ id, label: P.statements[id].sym + ' — ' + (clip(P.statements[id].text, 80) || 'Sin texto') }));
    if (!items.length) { toast('No hay otro enunciado donde ubicarlo.'); return; }
    const target = await pickDialog({ title: from ? 'Mover a…' : 'Ubicar bajo…', intro: 'Elegí el enunciado que ese argumento justifica o cuestiona.', items });
    if (!target) return;
    const choice = await chooseArgTarget(target);
    if (!choice) return;
    let argId, createdArg = null;
    if (choice.startsWith('new:')) { createdArg = L.addArgument(P, target, choice.slice(4)); argId = createdArg.id; }
    else argId = choice.slice(4);
    const res = from ? L.movePremise(P, childId, from, { parentId: target, argId }) : L.linkPremise(P, target, argId, childId);
    if (!res.ok) { if (createdArg) L.removeArgument(P, target, createdArg.id); toast(res.error); return; }
    P.ui.expanded[target] = true;
    markDirty(); renderTree(); refreshFicha();
    toast(from ? 'Enunciado movido.' : 'Enunciado vinculado.');
  }

  function refreshFicha() {
    const st = S.fichaId && S.project.statements[S.fichaId];
    if (!st) return;
    const set = (id, html) => { const e = $('#' + id); if (e) e.innerHTML = html; };
    set('f-loc', locationsHTML(st)); set('f-struct', structureHTML(st)); set('f-hist', historyHTML(st)); set('f-checks', checksHTML(st)); set('f-orig', origHTML(st));
  }

  async function linkExisting(parentId, argId) {
    const P = S.project, a = L.findArg(P, parentId, argId);
    const items = P.order.filter(id => id !== parentId && !a.premises.includes(id) && !L.wouldCreateCycle(P, parentId, id)).map(id => ({ id, label: P.statements[id].sym + ' — ' + (clip(P.statements[id].text, 80) || 'Sin texto') }));
    if (!items.length) { toast('No hay enunciados disponibles para vincular aquí.'); return; }
    const pick = await pickDialog({ title: 'Vincular enunciado existente', intro: 'Un mismo enunciado puede sostener más de una conclusión. No se duplica: se reutiliza.', items });
    if (!pick) return;
    const r = L.linkPremise(P, parentId, argId, pick);
    if (!r.ok) { toast(r.error); return; }
    P.ui.expanded[parentId] = true;
    markDirty(); renderTree();
  }

  async function deleteStatementFlow(id) {
    const P = S.project, s = P.statements[id];
    const withDesc = L.deletionPlan(P, id, true).size - 1;
    const warn = s.type === 'tesis' ? '<p><strong>Es la tesis del proyecto.</strong></p>' : '';
    const choice = await openDialog({
      title: 'Eliminar «' + s.sym + '»', noFocus: true,
      body: warn + '<p>«' + esc(clip(s.text, 120) || 'Sin texto') + '»</p><p>Se borra de este navegador y no se puede deshacer.' + (withDesc ? ' Tiene ' + withDesc + ' subpremisa' + (withDesc === 1 ? '' : 's') + ' que solo cuelgan de él.' : '') + '</p>',
      actions: [{ label: 'Cancelar', value: null }, { label: 'Eliminar solo este', kind: 'danger', value: 'one' }].concat(withDesc ? [{ label: 'Eliminar con sus ' + withDesc + ' subpremisa' + (withDesc === 1 ? '' : 's'), kind: 'danger solid', value: 'all' }] : [])
    });
    if (!choice) return;
    const gone = L.deleteStatement(P, id, choice === 'all');
    S.composer = null;
    markDirty();
    toast(gone.length + ' enunciado' + (gone.length === 1 ? ' eliminado' : 's eliminados') + '.');
    if (gone.includes(S.fichaId)) go('#/p/' + P.id); else { renderTree(); refreshFicha(); }
  }

  async function splitFlow(id) {
    const P = S.project, s = P.statements[id];
    const lines = await openDialog({
      title: 'Dividir en afirmaciones atómicas',
      body: '<p class="small muted">Original: «' + esc(clip(s.text, 160)) + '»</p><label class="field"><span class="lbl">Una afirmación por línea (mínimo dos)</span><span class="help">Escribí cada parte tal como la entendés. El original no se modifica.</span><textarea id="sp-ta" rows="5"></textarea></label>',
      actions: [{ label: 'Cancelar', value: null }, { label: 'Dividir', kind: 'primary', run: d => { const v = $('#sp-ta', d).value.split('\n').map(x => x.trim()).filter(Boolean); if (v.length < 2) { toast('Escribí al menos dos afirmaciones, una por línea.'); return false; } return v; } }]
    });
    if (!lines) return;
    L.splitStatement(P, id, lines);
    markDirty(); renderTree(); refreshFicha();
    toast('Dividido en ' + lines.length + ' afirmaciones; quedaron como premisas de «' + s.sym + '».');
  }

  /* ---------- Proyectos: crear, editar, duplicar, borrar ---------- */
  async function newProject() {
    const v = await projectForm({ title: '', description: '', topic: '', status: L.PROJECT_STATUS[0] }, true);
    if (!v) return;
    const P = L.createProject(v);
    const th = P.statements[P.order[0]];
    P.ui.expanded[th.id] = true;
    S.projects.push(P);
    S.project = P; S.save = 'pending';
    await saveNow();
    go('#/p/' + P.id);
  }

  async function editProject(id) {
    const P = S.projects.find(p => p.id === id); if (!P) return;
    const v = await projectForm(P, false);
    if (!v) return;
    Object.assign(P, { title: v.title, description: v.description, topic: v.topic, status: v.status });
    L.touch(P);
    const keep = S.project; S.project = P; await saveNow(); S.project = keep;
    render();
  }

  async function dupProject(id) {
    const P = S.projects.find(p => p.id === id); if (!P) return;
    const copy = L.duplicateProject(P);
    S.projects.push(copy);
    try { if (S.dbOk) await DB.put(copy); toast('Proyecto duplicado.'); } catch (e) { toast('No se pudo guardar la copia: ' + e.message); }
    if (S.view === 'list') render();
  }

  async function delProject(id) {
    const P = S.projects.find(p => p.id === id); if (!P) return;
    const ok = await confirmDialog('¿Eliminar el proyecto «' + esc(P.title) + '»? Se borra de este navegador y no se puede deshacer. Si no descargaste un respaldo, perderás todo su contenido.', { title: 'Eliminar proyecto', ok: 'Eliminar proyecto', danger: true });
    if (!ok) return;
    try { if (S.dbOk) await DB.remove(id); } catch (e) { toast('No se pudo eliminar: ' + e.message); return; }
    S.projects = S.projects.filter(p => p.id !== id);
    if (S.project && S.project.id === id) { S.project = null; clearTimeout(saveTimer); saveTimer = null; go('#/'); } else render();
    toast('Proyecto eliminado.');
  }

  /* ---------- Exportar / importar ---------- */
  async function exportProjects(list, name, isBackup) {
    const env = L.exportEnvelope(list, APP_VERSION);
    download(name, JSON.stringify(env, null, 2));
    if (isBackup) { S.lastBackup = L.nowISO(); try { if (S.dbOk) await DB.setMeta('lastBackupAt', S.lastBackup); } catch (e) { /* no crítico */ } if (S.view === 'list') render(); }
    toast('Archivo descargado. Revisá tu carpeta de descargas.');
  }

  async function importFile(file) {
    if (!file) return;
    let text;
    try { text = await file.text(); } catch (e) { await messageDialog('No se pudo leer el archivo', '<p>' + esc(e.message) + '</p>'); return; }
    let json;
    try { json = JSON.parse(text); } catch (e) { await messageDialog('El archivo no es un JSON válido', '<p>' + esc(e.message) + '</p><p>Importá un archivo exportado desde esta app.</p>'); return; }
    const v = L.validateImport(json);
    if (!v.ok) { await messageDialog('No se pudo importar', '<p>El archivo tiene problemas y no se importó nada:</p><ul class="errs">' + v.errors.slice(0, 12).map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>' + (v.errors.length > 12 ? '<p class="small muted">… y ' + (v.errors.length - 12) + ' más.</p>' : '')); return; }
    let list = v.projects;
    const clashes = list.filter(p => S.projects.some(x => x.id === p.id));
    if (clashes.length) {
      const choice = await openDialog({
        title: 'Ya existen proyectos con el mismo identificador', noFocus: true,
        body: '<p>Estos proyectos ya están en este navegador:</p><ul class="errs">' + clashes.map(p => '<li>' + esc(p.title) + '</li>').join('') + '</ul><p>¿Qué querés hacer con ellos?</p>',
        actions: [{ label: 'Cancelar', value: null }, { label: 'Importar como copias', value: 'copy' }, { label: 'Reemplazar los existentes', kind: 'danger', value: 'replace' }]
      });
      if (!choice) return;
      if (choice === 'copy') list = list.map(p => clashes.includes(p) ? Object.assign(L.duplicateProject(p), { title: p.title + ' (importado)' }) : p);
    }
    try {
      if (S.dbOk) await DB.putMany(list);
    } catch (e) { await messageDialog('No se pudo guardar lo importado', '<p>' + esc(e.message) + '</p>'); return; }
    S.projects = S.projects.filter(x => !list.some(p => p.id === x.id)).concat(list);
    render();
    toast('Se importaron ' + list.length + ' proyecto' + (list.length === 1 ? '' : 's') + '.');
    if (v.warnings.length) await messageDialog('Avisos de la importación', '<ul class="errs">' + v.warnings.slice(0, 12).map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>');
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy')); } catch (e) { reject(e); } finally { ta.remove(); }
    });
  }

  /* ---------- Eventos ---------- */
  async function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t || t.tagName === 'SELECT') return;
    const act = t.dataset.act, id = t.dataset.id, P = S.project;
    try {
      switch (act) {
        case 'new-project': return newProject();
        case 'edit-project': return editProject(id);
        case 'dup-project': return dupProject(id);
        case 'del-project': return delProject(id);
        case 'export-project': { const p = S.projects.find(x => x.id === id); if (p) exportProjects([p], 'laboratorio-' + slug(p.title) + '-' + today() + '.json', false); return; }
        case 'export-all': return exportProjects(S.projects, 'laboratorio-respaldo-' + today() + '.json', true);
        case 'import': { const f = $('#file-import'); f.value = ''; f.onchange = () => importFile(f.files[0]); f.click(); return; }
        case 'install': { const ev = S.installEvt; if (!ev) return; ev.prompt(); try { await ev.userChoice; } catch (x) { /* nada */ } S.installEvt = null; renderTopbar(); return; }
        case 'conflict-load': return reloadCurrent();
        case 'conflict-keep': S.conflict = false; renderBanner(); markDirty(); return;
        case 'toggle': P.ui.expanded[id] = !P.ui.expanded[id]; markDirty(); renderTree(); return;
        case 'expand-all': P.order.forEach(i => { if (P.statements[i].args.length) P.ui.expanded[i] = true; }); markDirty(); renderTree(); return;
        case 'collapse-all': P.ui.expanded = {}; markDirty(); renderTree(); return;
        case 'ficha': go('#/p/' + P.id + '/s/' + id); return;
        case 'close-ficha': go('#/p/' + P.id); return;
        case 'add-arg': { const a = L.addArgument(P, id, t.dataset.rel); markDirty(); openComposer(id, a.id, true); return; }
        case 'add-prem': openComposer(id, t.dataset.arg, false); return;
        case 'link-existing': return linkExisting(id, t.dataset.arg);
        case 'rm-arg': {
          const a = L.findArg(P, id, t.dataset.arg);
          if (a.premises.length && !(await confirmDialog('Se quita este argumento. Sus ' + a.premises.length + ' enunciado' + (a.premises.length === 1 ? '' : 's') + ' no se borra' + (a.premises.length === 1 ? '' : 'n') + ': quedan sueltos o en otros argumentos donde ya aparezcan.', { title: 'Quitar argumento', ok: 'Quitar argumento', danger: true }))) return;
          L.removeArgument(P, id, t.dataset.arg); markDirty(); renderTree(); refreshFicha(); return;
        }
        case 'composer-add': composerAdd(); return;
        case 'composer-done': closeComposer(); return;
        case 'add-root': S.composer = { root: true, type: t.dataset.type, draft: '' }; renderTree(); return;
        case 'loc-up': case 'loc-down': { L.reorderPremise(P, t.dataset.parent, t.dataset.arg, S.fichaId, act === 'loc-up' ? -1 : 1); markDirty(); renderTree(); return; }
        case 'loc-move': return placeStatement(S.fichaId, { parentId: t.dataset.parent, argId: t.dataset.arg });
        case 'loc-remove': L.unlinkPremise(P, t.dataset.parent, t.dataset.arg, S.fichaId); markDirty(); renderTree(); refreshFicha(); toast('Quitado de ese argumento. El enunciado sigue en el proyecto.'); return;
        case 'link-also': return placeStatement(S.fichaId, null);
        case 'split': return splitFlow(S.fichaId);
        case 'delete-stmt': return deleteStatementFlow(S.fichaId);
        case 'copy-formulas': try { await copyText(formulasText(t.dataset.mode === 'ascii')); toast('Fórmulas copiadas.'); } catch (x) { toast('No se pudo copiar. Seleccioná el texto a mano.'); } return;
      }
    } catch (err) { console.error(err); toast('Ocurrió un error: ' + err.message); }
  }

  function onInput(e) {
    const t = e.target, P = S.project;
    if (t.id === 'q') { S.filter.q = t.value; refreshCards(); return; }
    if (t.id === 'composer-ta') { if (S.composer) S.composer.draft = t.value; return; }
    if (!P) return;
    if (t.dataset.p) { P[t.dataset.p] = t.value; L.touch(P); markDirty(); if (t.dataset.p === 'title') { const h = $('#topbar h1'); if (h) h.textContent = t.value; } return; }
    if (t.dataset.f && S.fichaId) {
      const st = P.statements[S.fichaId]; if (!st) return;
      if (['type', 'estado'].includes(t.dataset.f)) return;
      st[t.dataset.f] = t.value; st.updatedAt = L.nowISO(); L.touch(P); markDirty();
      if (t.dataset.f === 'text') $$('.node[data-id="' + st.id + '"] > .node-row .txt').forEach(x => { x.textContent = t.value || 'Sin texto todavía'; x.classList.toggle('empty-txt', !t.value); });
    }
    if (t.dataset.hwhy && S.fichaId) {
      const h = P.statements[S.fichaId].history.find(x => x.id === t.dataset.hwhy);
      if (h) { h.why = t.value; L.touch(P); markDirty(); }
    }
  }

  function onChange(e) {
    const t = e.target, P = S.project;
    if (t.id === 'fs') { S.filter.status = t.value; refreshCards(); return; }
    if (t.dataset.act === 'rel' && P) { L.setArgRel(P, t.dataset.id, t.dataset.arg, t.value); markDirty(); renderTree(); refreshFicha(); return; }
    if (!P) return;
    if (t.dataset.p) { L.touch(P); markDirty(); if (t.dataset.p === 'status' || t.dataset.p === 'title') renderTopbar(); return; }
    if (t.dataset.check && S.fichaId) { P.statements[S.fichaId].checks[t.dataset.check] = t.checked; if (!t.checked) delete P.statements[S.fichaId].checks[t.dataset.check]; L.touch(P); markDirty(); refreshChecksOnly(); return; }
    if (t.dataset.f && S.fichaId) {
      const st = P.statements[S.fichaId]; if (!st) return;
      const f = t.dataset.f;
      if (f === 'type' || f === 'estado') st[f] = t.value;
      if (['text', 'type', 'estado'].includes(f) && S.snap && S.snap[f] !== st[f]) {
        if (!(f === 'text' && !S.snap.text)) L.pushHistory(st, f, S.snap[f], st[f], '');
        S.snap[f] = st[f];
        if (f === 'text' && st.original == null && st.text.trim()) st.original = st.text;
        L.touch(P); markDirty();
        renderTree(); refreshFicha();
        return;
      }
      if (f === 'text') { if (st.original == null && st.text.trim()) st.original = st.text; refreshChecksOnly(); }
      if (f === 'formula') { const e2 = $('#f-struct'); if (e2) e2.innerHTML = structureHTML(st); }
    }
  }

  function refreshChecksOnly() {
    const st = S.project.statements[S.fichaId]; if (!st) return;
    const c = $('#f-checks'); if (c) c.innerHTML = checksHTML(st);
    const o = $('#f-orig'); if (o) o.innerHTML = origHTML(st);
  }

  function onKeydown(e) {
    if (e.target.id === 'composer-ta') {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); composerAdd(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeComposer(); }
      return;
    }
    if (e.key === 'Escape' && S.view === 'project' && S.fichaId && !$('#dlg').open) go('#/p/' + S.project.id);
  }

  /* ---------- Arranque ---------- */
  async function init() {
    renderTopbar();
    try {
      await DB.available();
      S.projects = await DB.getAll();
      S.lastBackup = (await DB.getMeta('lastBackupAt')) || null;
      DB.persist().then(v => { S.persisted = !!v; });
    } catch (err) {
      S.dbOk = false; S.dbError = err && err.message ? err.message : 'No hay almacenamiento local disponible.';
    }
    S.installed = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || !!navigator.standalone;
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('toggle', e => { const d = e.target; if (d && d.dataset && d.dataset.sec) S.sections[d.dataset.sec] = d.open; }, true);
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('pagehide', () => { flushSave(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; renderTopbar(); });
    window.addEventListener('appinstalled', () => { S.installed = true; S.installEvt = null; renderTopbar(); toast('App instalada.'); });
    window.addEventListener('error', () => { toast('Ocurrió un error inesperado. Tus datos guardados no se tocaron.'); });
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo sin conexión */ });
      navigator.serviceWorker.ready.then(() => { S.offlineReady = true; if (S.view === 'list') render(); });
    }
    onRoute();
  }

  init();
})();
