/* Laboratorio de argumentos — lógica pura (sin DOM, sin almacenamiento).
   Se usa tanto en el navegador (window.Logic) como en las pruebas de Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const FORMAT = 'laboratorio-argumentos';
  const MAX_ATOMS = 12;

  /* ---------- Catálogos ---------- */
  const TYPES = [
    { id: 'tesis', label: 'Tesis', icon: '◆' },
    { id: 'premisa', label: 'Premisa', icon: '●' },
    { id: 'subpremisa', label: 'Subpremisa', icon: '○' },
    { id: 'conclusion_intermedia', label: 'Conclusión intermedia', icon: '◐' },
    { id: 'objecion', label: 'Objeción', icon: '⚠' },
    { id: 'conclusion_alternativa', label: 'Conclusión alternativa', icon: '◇' },
    { id: 'otro', label: 'Otro', icon: '·' }
  ];

  // kind: support (P → C), necessary (C → P), attack (O → ¬C), question (sin fórmula)
  const RELS = [
    { id: 'apoya', label: 'Apoya', kind: 'support', mark: '+', hint: 'Las premisas, juntas, apoyan la conclusión.' },
    { id: 'deriva', label: 'Se deriva de', kind: 'support', mark: '⊢', hint: 'La conclusión se deriva de estas premisas.' },
    { id: 'depende', label: 'Depende de', kind: 'necessary', mark: '↤', hint: 'La conclusión solo se sostiene si esto es cierto.' },
    { id: 'requiere', label: 'Requiere demostrar', kind: 'necessary', mark: '?', hint: 'Hay que demostrar esto para sostener la conclusión.' },
    { id: 'contradice', label: 'Contradice', kind: 'attack', mark: '✕', hint: 'Si esto es cierto, la conclusión es falsa.' },
    { id: 'cuestiona', label: 'Cuestiona', kind: 'question', mark: '!', hint: 'Pone en duda la conclusión sin contradecirla.' }
  ];

  const ESTADOS = [
    { id: 'no_evaluado', label: 'No evaluado', icon: '◌' },
    { id: 'pendiente', label: 'Pendiente', icon: '◔' },
    { id: 'insuficiente', label: 'Evidencia insuficiente', icon: '◑' },
    { id: 'respaldado', label: 'Provisionalmente respaldado', icon: '✓' },
    { id: 'cuestionado', label: 'Seriamente cuestionado', icon: '⚑' },
    { id: 'rechazado', label: 'Rechazado por mí', icon: '✕' }
  ];

  const PROJECT_STATUS = [
    'Explorando', 'En desarrollo', 'En revisión crítica',
    'Mantenida provisionalmente', 'Reformulada', 'Rechazada', 'Archivada'
  ];

  const CHECKS = [
    { id: 'ambiguedad', label: 'Ambigüedad' },
    { id: 'vaguedad', label: 'Vaguedad' },
    { id: 'sin_definir', label: 'Términos no definidos' },
    { id: 'generalizacion', label: 'Generalización excesiva' },
    { id: 'compuesta', label: 'Afirmación compuesta' },
    { id: 'absolutos', label: 'Cuantificadores absolutos' },
    { id: 'polisemia', label: 'Concepto con varias interpretaciones' }
  ];

  const typeById = id => TYPES.find(t => t.id === id) || TYPES[TYPES.length - 1];
  const relById = id => RELS.find(r => r.id === id);
  const estadoById = id => ESTADOS.find(e => e.id === id) || ESTADOS[0];

  /* ---------- Utilidades ---------- */
  function uid(prefix) {
    let s = '';
    const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    if (c) {
      const a = new Uint8Array(6);
      c.getRandomValues(a);
      s = Array.from(a, b => b.toString(36).padStart(2, '0')).join('');
    } else {
      s = Math.random().toString(36).slice(2, 14);
    }
    return prefix + '_' + Date.now().toString(36) + s;
  }
  const nowISO = () => new Date().toISOString();
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- Creación de proyectos y enunciados ---------- */
  function blankStatement(id, type, text, sym) {
    const t = nowISO();
    return {
      id, sym, type, text: text || '', original: text ? text : null,
      args: [],
      scope: '', definitions: '', assumptionsExplicit: '', assumptionsImplicit: '',
      needed: '', refuters: '', missing: '',
      estado: 'no_evaluado', estadoWhy: '', notes: '',
      formula: '',
      checks: {}, checksNote: '',
      atomicOf: null,
      history: [],
      createdAt: t, updatedAt: t
    };
  }

  function createProject(opts) {
    opts = opts || {};
    const t = nowISO();
    const p = {
      id: uid('p'),
      title: (opts.title || '').trim() || 'Proyecto sin título',
      description: opts.description || '',
      topic: opts.topic || '',
      status: opts.status || PROJECT_STATUS[0],
      createdAt: t, updatedAt: t,
      statements: {}, order: [],
      ui: { expanded: {} }
    };
    addStatement(p, 'tesis', opts.thesisText || '');
    return p;
  }

  function usedSyms(project) {
    return new Set(Object.values(project.statements).map(s => s.sym));
  }

  function nextSym(project, type) {
    const used = usedSyms(project);
    if (type === 'tesis' && !used.has('C')) return 'C';
    if (type === 'tesis' || type === 'conclusion_alternativa') {
      let i = 1; while (used.has('C' + i)) i++;
      return 'C' + i;
    }
    const letters = 'pqrstuvwxyz'.split('');
    for (let n = 0; ; n++) {
      for (const l of letters) {
        const c = n === 0 ? l : l + n;
        if (!used.has(c)) return c;
      }
    }
  }

  function addStatement(project, type, text) {
    const id = uid('s');
    const st = blankStatement(id, type, text, nextSym(project, type));
    project.statements[id] = st;
    project.order.push(id);
    touch(project);
    return st;
  }

  function touch(project) { project.updatedAt = nowISO(); }

  function pushHistory(stmt, field, from, to, why) {
    stmt.history.push({ id: uid('h'), at: nowISO(), field, from: from == null ? '' : String(from), to: to == null ? '' : String(to), why: why || '' });
    stmt.updatedAt = nowISO();
  }

  /* ---------- Estructura del árbol ---------- */
  function buildParentIndex(project) {
    const idx = new Map();
    for (const s of Object.values(project.statements)) {
      for (const a of s.args) {
        for (const pid of a.premises) {
          if (!idx.has(pid)) idx.set(pid, []);
          idx.get(pid).push({ parentId: s.id, argId: a.id, rel: a.rel });
        }
      }
    }
    return idx;
  }

  function descendants(project, id) {
    const out = new Set();
    const stack = [id];
    while (stack.length) {
      const s = project.statements[stack.pop()];
      if (!s) continue;
      for (const a of s.args) for (const pid of a.premises) {
        if (!out.has(pid)) { out.add(pid); stack.push(pid); }
      }
    }
    return out;
  }

  function wouldCreateCycle(project, parentId, childId) {
    if (parentId === childId) return true;
    return descendants(project, childId).has(parentId);
  }

  function roots(project) {
    const idx = buildParentIndex(project);
    return project.order.filter(id => project.statements[id] && !idx.has(id));
  }

  function findArg(project, parentId, argId) {
    const s = project.statements[parentId];
    return s ? s.args.find(a => a.id === argId) : null;
  }

  function autoType(project, parentId, rel) {
    const r = relById(rel);
    if (r && (r.kind === 'attack' || r.kind === 'question')) return 'objecion';
    const parent = project.statements[parentId];
    if (parent && parent.type === 'tesis') return 'premisa';
    return 'subpremisa';
  }

  function addArgument(project, parentId, rel) {
    const s = project.statements[parentId];
    if (!s) return null;
    const arg = { id: uid('a'), rel: rel || 'apoya', premises: [], note: '', split: false };
    s.args.push(arg);
    touch(project);
    return arg;
  }

  function addPremise(project, parentId, argId, text, type) {
    const arg = findArg(project, parentId, argId);
    if (!arg) return null;
    const st = addStatement(project, type || autoType(project, parentId, arg.rel), text);
    arg.premises.push(st.id);
    touch(project);
    return st;
  }

  function linkPremise(project, parentId, argId, childId) {
    const arg = findArg(project, parentId, argId);
    if (!arg || !project.statements[childId]) return { ok: false, error: 'No se encontró el argumento o el enunciado.' };
    if (arg.premises.includes(childId)) return { ok: false, error: 'Ese enunciado ya está en este argumento.' };
    if (wouldCreateCycle(project, parentId, childId)) {
      return { ok: false, error: 'No se puede: crearía un círculo (el enunciado quedaría justificándose a sí mismo).' };
    }
    arg.premises.push(childId);
    touch(project);
    return { ok: true };
  }

  function unlinkPremise(project, parentId, argId, childId) {
    const arg = findArg(project, parentId, argId);
    if (!arg) return false;
    const i = arg.premises.indexOf(childId);
    if (i < 0) return false;
    arg.premises.splice(i, 1);
    touch(project);
    return true;
  }

  function movePremise(project, childId, from, to) {
    // from: {parentId,argId}; to: {parentId,argId}
    if (from.parentId === to.parentId && from.argId === to.argId) return { ok: true };
    unlinkPremise(project, from.parentId, from.argId, childId);
    const r = linkPremise(project, to.parentId, to.argId, childId);
    if (!r.ok) {
      const fa = findArg(project, from.parentId, from.argId);
      if (fa && !fa.premises.includes(childId)) fa.premises.push(childId);
    }
    return r;
  }

  function reorderPremise(project, parentId, argId, childId, delta) {
    const arg = findArg(project, parentId, argId);
    if (!arg) return false;
    const i = arg.premises.indexOf(childId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= arg.premises.length) return false;
    [arg.premises[i], arg.premises[j]] = [arg.premises[j], arg.premises[i]];
    touch(project);
    return true;
  }

  function removeArgument(project, parentId, argId) {
    const s = project.statements[parentId];
    if (!s) return false;
    const i = s.args.findIndex(a => a.id === argId);
    if (i < 0) return false;
    s.args.splice(i, 1);
    touch(project);
    return true;
  }

  function setArgRel(project, parentId, argId, rel) {
    const a = findArg(project, parentId, argId);
    if (!a || !relById(rel)) return false;
    a.rel = rel;
    touch(project);
    return true;
  }

  /* Elimina un enunciado. Con withDescendants también borra las subpremisas
     que solo cuelgan de lo eliminado (las compartidas con otras ramas se conservan). */
  function deletionPlan(project, id, withDescendants) {
    const del = new Set([id]);
    if (withDescendants) {
      let changed = true;
      const idx = buildParentIndex(project);
      while (changed) {
        changed = false;
        for (const d of Array.from(del)) {
          for (const cid of descendants(project, d)) {
            if (del.has(cid)) continue;
            const parents = idx.get(cid) || [];
            if (parents.length && parents.every(p => del.has(p.parentId))) { del.add(cid); changed = true; }
          }
        }
      }
    }
    return del;
  }

  function deleteStatement(project, id, withDescendants) {
    const del = deletionPlan(project, id, withDescendants);
    for (const s of Object.values(project.statements)) {
      if (del.has(s.id)) continue;
      for (const a of s.args) a.premises = a.premises.filter(pid => !del.has(pid));
      if (s.atomicOf && del.has(s.atomicOf)) s.atomicOf = null;
    }
    for (const d of del) delete project.statements[d];
    project.order = project.order.filter(x => !del.has(x));
    for (const d of del) delete project.ui.expanded[d];
    touch(project);
    return Array.from(del);
  }

  function splitStatement(project, id, texts) {
    const s = project.statements[id];
    const clean = texts.map(t => t.trim()).filter(Boolean);
    if (!s || clean.length < 2) return null;
    const arg = { id: uid('a'), rel: 'deriva', premises: [], note: 'División en afirmaciones atómicas', split: true };
    for (const t of clean) {
      const st = addStatement(project, 'subpremisa', t);
      st.atomicOf = id;
      arg.premises.push(st.id);
    }
    s.args.push(arg);
    pushHistory(s, 'division', '', 'Dividida en ' + clean.length + ' afirmaciones: ' + clean.join(' | '), '');
    project.ui.expanded[id] = true;
    touch(project);
    return arg;
  }

  /* ---------- Fórmulas estructurales ---------- */
  const supportArgs = (s) => s.args.filter(a => { const r = relById(a.rel); return r && r.kind === 'support' && a.premises.length; });

  function symsOf(project, arg) {
    return arg.premises.filter(pid => project.statements[pid]).map(pid => project.statements[pid].sym);
  }
  const conj = syms => syms.join(' ∧ ');
  const grp = syms => syms.length > 1 ? '(' + conj(syms) + ')' : syms[0];

  function localFormulas(project, id) {
    const s = project.statements[id];
    const out = [];
    const sup = supportArgs(s);
    if (sup.length) {
      let ante;
      if (sup.length === 1) ante = conj(symsOf(project, sup[0]));
      else ante = '(' + sup.map(a => grp(symsOf(project, a))).join(' ∨ ') + ')';
      out.push({ kind: 'support', text: ante + ' → ' + s.sym });
    }
    for (const a of s.args) {
      const r = relById(a.rel);
      const syms = symsOf(project, a);
      if (!r || !syms.length) continue;
      if (r.kind === 'necessary') out.push({ kind: 'necessary', text: s.sym + ' → ' + grp(syms) });
      else if (r.kind === 'attack') out.push({ kind: 'attack', text: grp(syms) + ' → ¬' + s.sym });
      else if (r.kind === 'question') out.push({ kind: 'question', text: conj(syms) + ' cuestiona ' + s.sym + ' (no se expresa como implicación)' });
    }
    return out;
  }

  function expandNode(project, id, seen) {
    const s = project.statements[id];
    const sup = supportArgs(s);
    if (!sup.length || seen.has(id)) return { str: s.sym, kind: 'atom', leaves: [s.sym] };
    const seen2 = new Set(seen); seen2.add(id);
    const exprs = sup.map(a => {
      const items = a.premises.filter(pid => project.statements[pid]).map(pid => expandNode(project, pid, seen2));
      const strs = items.map(it => it.kind === 'disj' ? '(' + it.str + ')' : it.str);
      return {
        str: strs.join(' ∧ '),
        kind: items.length === 1 ? items[0].kind : 'conj',
        leaves: items.flatMap(it => it.leaves)
      };
    });
    const leaves = Array.from(new Set(exprs.flatMap(e => e.leaves)));
    if (exprs.length === 1) return { str: exprs[0].str, kind: exprs[0].kind, leaves };
    return {
      str: exprs.map(e => (e.kind === 'conj' || e.kind === 'disj') ? '(' + e.str + ')' : e.str).join(' ∨ '),
      kind: 'disj', leaves
    };
  }

  function expandedFormula(project, id) {
    const s = project.statements[id];
    if (!supportArgs(s).length) return null;
    const e = expandNode(project, id, new Set());
    const ante = e.kind === 'disj' ? '(' + e.str + ')' : e.str;
    return { text: ante + ' → ' + s.sym, leaves: e.leaves };
  }

  /* ---------- Fórmulas internas (parser proposicional) ---------- */
  function tokenize(src) {
    const toks = [];
    let i = 0;
    const rules = [
      [/^(<=>|<->|↔)/, 'iff'],
      [/^(=>|->|→|⇒)/, 'imp'],
      [/^(&&|&|∧|\^)/, 'and'],
      [/^(\|\||\||∨)/, 'or'],
      [/^(~|!|¬)/, 'not'],
      [/^\(/, 'lp'],
      [/^\)/, 'rp'],
      [/^[\p{L}_][\p{L}\p{N}_]*/u, 'var']
    ];
    while (i < src.length) {
      if (/\s/.test(src[i])) { i++; continue; }
      const rest = src.slice(i);
      let m = null, type = null;
      for (const [re, t] of rules) { m = re.exec(rest); if (m) { type = t; break; } }
      if (!m) return { error: 'Símbolo no reconocido «' + src[i] + '» en la posición ' + (i + 1) + '.' };
      toks.push({ t: type, v: m[0], pos: i });
      i += m[0].length;
    }
    return { toks };
  }

  function parseFormula(src) {
    const tk = tokenize(src || '');
    if (tk.error) return { error: tk.error };
    const toks = tk.toks;
    if (!toks.length) return { error: 'La fórmula está vacía.' };
    let p = 0;
    const peek = () => toks[p];
    const err = msg => { throw new Error(msg); };
    function parseIff() {
      let l = parseImp();
      while (peek() && peek().t === 'iff') { p++; l = { t: 'iff', a: l, b: parseImp() }; }
      return l;
    }
    function parseImp() {
      const l = parseOr();
      if (peek() && peek().t === 'imp') { p++; return { t: 'imp', a: l, b: parseImp() }; }
      return l;
    }
    function parseOr() {
      let l = parseAnd();
      while (peek() && peek().t === 'or') { p++; l = { t: 'or', a: l, b: parseAnd() }; }
      return l;
    }
    function parseAnd() {
      let l = parseNot();
      while (peek() && peek().t === 'and') { p++; l = { t: 'and', a: l, b: parseNot() }; }
      return l;
    }
    function parseNot() {
      const k = peek();
      if (!k) err('La fórmula termina antes de tiempo.');
      if (k.t === 'not') { p++; return { t: 'not', a: parseNot() }; }
      if (k.t === 'var') { p++; return { t: 'var', n: k.v }; }
      if (k.t === 'lp') {
        p++;
        const e = parseIff();
        if (!peek() || peek().t !== 'rp') err('Falta cerrar un paréntesis.');
        p++;
        return e;
      }
      err('Se esperaba una proposición o «(» y apareció «' + k.v + '» (posición ' + (k.pos + 1) + ').');
    }
    try {
      const ast = parseIff();
      if (p < toks.length) err('Sobra «' + toks[p].v + '» (posición ' + (toks[p].pos + 1) + ').');
      return { ast };
    } catch (e) {
      return { error: e.message };
    }
  }

  const PREC = { iff: 1, imp: 2, or: 3, and: 4, not: 5, var: 6 };
  function fmt(n) {
    if (n.t === 'var') return n.n;
    if (n.t === 'not') return '¬' + (PREC[n.a.t] < PREC.not ? '(' + fmt(n.a) + ')' : fmt(n.a));
    const sym = { and: ' ∧ ', or: ' ∨ ', imp: ' → ', iff: ' ↔ ' }[n.t];
    const wrap = (c, side) => {
      const cp = PREC[c.t];
      let needs = cp < PREC[n.t];
      if (cp === PREC[n.t]) {
        if (n.t === 'imp') needs = side === 'a';
        else if (n.t === 'iff') needs = true;
        else needs = false;
      }
      return needs ? '(' + fmt(c) + ')' : fmt(c);
    };
    return wrap(n.a, 'a') + sym + wrap(n.b, 'b');
  }

  function evalAst(n, env) {
    switch (n.t) {
      case 'var': return !!env[n.n];
      case 'not': return !evalAst(n.a, env);
      case 'and': return evalAst(n.a, env) && evalAst(n.b, env);
      case 'or': return evalAst(n.a, env) || evalAst(n.b, env);
      case 'imp': return !evalAst(n.a, env) || evalAst(n.b, env);
      case 'iff': return evalAst(n.a, env) === evalAst(n.b, env);
    }
    return false;
  }

  function atomsOf(n, set) {
    set = set || new Set();
    if (n.t === 'var') set.add(n.n);
    else { atomsOf(n.a, set); if (n.b) atomsOf(n.b, set); }
    return set;
  }

  function* assignments(atoms) {
    const k = atoms.length;
    for (let i = 0; i < (1 << k); i++) {
      const env = {};
      atoms.forEach((a, j) => { env[a] = !!((i >> (k - 1 - j)) & 1); });
      yield env;
    }
  }

  function analyzeFormula(src) {
    const r = parseFormula(src);
    if (r.error) return { error: r.error };
    const atoms = Array.from(atomsOf(r.ast)).sort();
    if (atoms.length > MAX_ATOMS) return { error: 'Demasiadas proposiciones distintas (máximo ' + MAX_ATOMS + ').' };
    let t = 0, f = 0;
    for (const env of assignments(atoms)) { if (evalAst(r.ast, env)) t++; else f++; }
    return {
      normalized: fmt(r.ast), atoms,
      kind: f === 0 ? 'tautología' : (t === 0 ? 'contradicción' : 'contingente')
    };
  }

  function checkArgument(premiseSrcs, conclusionSrc) {
    const asts = [];
    for (let i = 0; i < premiseSrcs.length; i++) {
      const r = parseFormula(premiseSrcs[i]);
      if (r.error) return { error: 'Premisa ' + (i + 1) + ': ' + r.error };
      asts.push(r.ast);
    }
    const c = parseFormula(conclusionSrc);
    if (c.error) return { error: 'Conclusión: ' + c.error };
    const all = new Set();
    asts.forEach(a => atomsOf(a, all));
    atomsOf(c.ast, all);
    const atoms = Array.from(all).sort();
    if (atoms.length > MAX_ATOMS) return { error: 'Demasiadas proposiciones distintas (máximo ' + MAX_ATOMS + ').' };
    let consistent = false, counterexample = null;
    for (const env of assignments(atoms)) {
      if (asts.every(a => evalAst(a, env))) {
        consistent = true;
        if (!evalAst(c.ast, env)) { counterexample = env; break; }
      }
    }
    return { valid: !counterexample, consistent, counterexample, atoms };
  }

  /* Verificación de validez de cada argumento de apoyo que tenga todas las formalizaciones */
  function validityReports(project, id) {
    const s = project.statements[id];
    const reports = [];
    for (const a of s.args) {
      const r = relById(a.rel);
      if (!r || r.kind !== 'support' || !a.premises.length) continue;
      const prems = a.premises.map(pid => project.statements[pid]).filter(Boolean);
      const missing = [s, ...prems].filter(x => !(x.formula || '').trim());
      if (missing.length) {
        reports.push({ argId: a.id, status: 'incompleto', missing: missing.map(x => x.sym) });
        continue;
      }
      const res = checkArgument(prems.map(x => x.formula), s.formula);
      reports.push({ argId: a.id, status: res.error ? 'error' : 'ok', result: res });
    }
    return reports;
  }

  /* ---------- Señales de formulación (solo sugerencias; el usuario decide) ---------- */
  function formulationSignals(text) {
    const out = [];
    const L = '(?<![\\p{L}])', R = '(?![\\p{L}])';
    const find = (words) => {
      const m = new RegExp(L + '(' + words + ')' + R, 'iu').exec(text || '');
      return m ? m[1] : null;
    };
    let w;
    if ((w = find('todos|todas|todo|toda|nadie|nunca|siempre|jamás|ningún|ninguna|ninguno|absolutamente|necesariamente|cada'))) {
      out.push({ check: 'absolutos', hint: 'Aparece «' + w + '».' });
      out.push({ check: 'generalizacion', hint: 'Aparece «' + w + '», que suele generalizar.' });
    }
    if ((w = find('y|e|o|u|pero|aunque|ni|mientras que|sino'))) out.push({ check: 'compuesta', hint: 'Aparece «' + w + '»: puede unir más de una afirmación.' });
    if ((w = find('muchos|muchas|pocos|pocas|algunos|algunas|bastante|grande|pequeño|a menudo|frecuentemente|generalmente|normalmente|la mayoría'))) out.push({ check: 'vaguedad', hint: 'Aparece «' + w + '», un término poco preciso.' });
    return out;
  }

  /* ---------- Resumen y validación ---------- */
  function summarize(project) {
    const ids = Object.keys(project.statements);
    const idx = buildParentIndex(project);
    const byEstado = {};
    let leaves = 0, objections = 0, unplaced = 0;
    for (const id of ids) {
      const s = project.statements[id];
      byEstado[s.estado] = (byEstado[s.estado] || 0) + 1;
      if (idx.has(id) && !supportArgs(s).length) leaves++;
      if (s.type === 'objecion') objections++;
      if (!idx.has(id) && s.type !== 'tesis' && s.type !== 'conclusion_alternativa') unplaced++;
    }
    const thesis = ids.map(i => project.statements[i]).find(s => s.type === 'tesis') || null;
    return { total: ids.length, byEstado, leaves, objections, unplaced, thesis };
  }

  function normalizeStatement(raw, key, errors, warnings, path) {
    const strField = (k, def) => {
      const v = raw[k];
      if (v == null) return def;
      if (typeof v !== 'string') { warnings.push(path + ': el campo «' + k + '» no era texto; se dejó vacío.'); return def; }
      return v;
    };
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push(path + ': no es un enunciado válido.'); return null;
    }
    if (raw.id !== key) errors.push(path + ': el identificador interno («' + raw.id + '») no coincide con su clave («' + key + '»).');
    let type = raw.type;
    if (!TYPES.some(t => t.id === type)) { warnings.push(path + ': tipo desconocido «' + type + '»; se usó «otro».'); type = 'otro'; }
    let estado = raw.estado;
    if (!ESTADOS.some(e => e.id === estado)) { if (estado != null) warnings.push(path + ': estado desconocido «' + estado + '»; se usó «no evaluado».'); estado = 'no_evaluado'; }
    const st = blankStatement(key, type, '', strField('sym', ''));
    st.text = strField('text', '');
    st.original = raw.original == null ? (st.text || null) : strField('original', null);
    for (const k of ['scope', 'definitions', 'assumptionsExplicit', 'assumptionsImplicit', 'needed', 'refuters', 'missing', 'estadoWhy', 'notes', 'formula', 'checksNote']) st[k] = strField(k, '');
    st.estado = estado;
    st.atomicOf = typeof raw.atomicOf === 'string' ? raw.atomicOf : null;
    st.createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : st.createdAt;
    st.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : st.updatedAt;
    if (raw.checks && typeof raw.checks === 'object') {
      for (const c of CHECKS) if (raw.checks[c.id]) st.checks[c.id] = true;
    }
    if (raw.args != null && !Array.isArray(raw.args)) { errors.push(path + ': «args» debe ser una lista.'); }
    else {
      for (const [i, a] of (raw.args || []).entries()) {
        const ap = path + ', argumento ' + (i + 1);
        if (typeof a !== 'object' || a === null) { errors.push(ap + ': no es válido.'); continue; }
        if (!relById(a.rel)) { errors.push(ap + ': relación desconocida «' + a.rel + '».'); continue; }
        if (!Array.isArray(a.premises) || a.premises.some(x => typeof x !== 'string')) { errors.push(ap + ': «premises» debe ser una lista de identificadores.'); continue; }
        st.args.push({ id: typeof a.id === 'string' ? a.id : uid('a'), rel: a.rel, premises: a.premises.slice(), note: typeof a.note === 'string' ? a.note : '', split: !!a.split });
      }
    }
    if (Array.isArray(raw.history)) {
      for (const h of raw.history) {
        if (h && typeof h === 'object') st.history.push({ id: typeof h.id === 'string' ? h.id : uid('h'), at: String(h.at || ''), field: String(h.field || ''), from: String(h.from == null ? '' : h.from), to: String(h.to == null ? '' : h.to), why: String(h.why || '') });
      }
    }
    return st;
  }

  function normalizeProject(raw, idx, errors, warnings) {
    const path = 'Proyecto ' + (idx + 1);
    if (typeof raw !== 'object' || raw === null) { errors.push(path + ': no es un proyecto válido.'); return null; }
    if (typeof raw.id !== 'string' || !raw.id) errors.push(path + ': falta el identificador.');
    if (typeof raw.title !== 'string') errors.push(path + ': falta el título.');
    if (typeof raw.statements !== 'object' || raw.statements === null || Array.isArray(raw.statements)) {
      errors.push(path + ': falta la lista de enunciados.'); return null;
    }
    const label = path + ' («' + (raw.title || '') + '»)';
    const p = {
      id: raw.id, title: raw.title || 'Proyecto sin título',
      description: typeof raw.description === 'string' ? raw.description : '',
      topic: typeof raw.topic === 'string' ? raw.topic : '',
      status: typeof raw.status === 'string' ? raw.status : PROJECT_STATUS[0],
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowISO(),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowISO(),
      statements: {}, order: [], ui: { expanded: {} }
    };
    const keys = Object.keys(raw.statements);
    if (keys.length > 20000) { errors.push(label + ': demasiados enunciados.'); return null; }
    for (const k of keys) {
      const st = normalizeStatement(raw.statements[k], k, errors, warnings, label + ', enunciado ' + k);
      if (st) p.statements[k] = st;
    }
    const order = Array.isArray(raw.order) ? raw.order.filter(x => typeof x === 'string' && p.statements[x]) : [];
    for (const k of keys) if (p.statements[k] && !order.includes(k)) order.push(k);
    p.order = Array.from(new Set(order));
    if (raw.ui && raw.ui.expanded && typeof raw.ui.expanded === 'object') {
      for (const k of Object.keys(raw.ui.expanded)) if (p.statements[k] && raw.ui.expanded[k]) p.ui.expanded[k] = true;
    }
    // referencias
    for (const s of Object.values(p.statements)) {
      for (const a of s.args) {
        for (const pid of a.premises) {
          if (!p.statements[pid]) errors.push(label + ': el enunciado ' + s.id + ' apunta a una premisa inexistente (' + pid + ').');
        }
      }
      if (s.atomicOf && !p.statements[s.atomicOf]) s.atomicOf = null;
    }
    if (!errors.length) {
      // ciclos
      for (const s of Object.values(p.statements)) {
        if (descendants(p, s.id).has(s.id)) { errors.push(label + ': hay un círculo en el argumento que pasa por el enunciado ' + s.id + '.'); break; }
      }
      // símbolos
      const seen = new Set();
      let fixed = 0;
      for (const id of p.order) {
        const s = p.statements[id];
        if (!s.sym || seen.has(s.sym)) { s.sym = ''; }
        else seen.add(s.sym);
      }
      for (const id of p.order) {
        const s = p.statements[id];
        if (!s.sym) { s.sym = nextSym(p, s.type); seen.add(s.sym); fixed++; }
      }
      if (fixed) warnings.push(label + ': se reasignaron ' + fixed + ' símbolo(s) repetido(s) o ausentes.');
    }
    return p;
  }

  function validateImport(json) {
    const errors = [], warnings = [];
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return { ok: false, errors: ['El archivo no contiene un objeto JSON válido.'], warnings, projects: [] };
    }
    if (json.format !== FORMAT) {
      return { ok: false, errors: ['El archivo no parece ser de Laboratorio de argumentos (falta la marca «' + FORMAT + '»).'], warnings, projects: [] };
    }
    if (typeof json.schemaVersion !== 'number') {
      return { ok: false, errors: ['El archivo no indica su versión de esquema.'], warnings, projects: [] };
    }
    if (json.schemaVersion > SCHEMA_VERSION) {
      return { ok: false, errors: ['El archivo fue creado con una versión más nueva del esquema (' + json.schemaVersion + '). Esta app entiende hasta la ' + SCHEMA_VERSION + '. Actualizá la app y probá de nuevo.'], warnings, projects: [] };
    }
    let list;
    if (json.kind === 'project' && json.project) list = [json.project];
    else if (json.kind === 'backup' && Array.isArray(json.projects)) list = json.projects;
    else return { ok: false, errors: ['El archivo no trae ningún proyecto («kind» debe ser «project» o «backup»).'], warnings, projects: [] };
    const projects = [];
    list.forEach((raw, i) => { const p = normalizeProject(raw, i, errors, warnings); if (p) projects.push(p); });
    return { ok: errors.length === 0, errors, warnings, projects: errors.length ? [] : projects };
  }

  function exportEnvelope(projects, appVersion) {
    const single = projects.length === 1;
    const env = { format: FORMAT, schemaVersion: SCHEMA_VERSION, appVersion: appVersion || '', exportedAt: nowISO(), kind: single ? 'project' : 'backup' };
    if (single) env.project = clone(projects[0]); else env.projects = clone(projects);
    return env;
  }

  function duplicateProject(project) {
    const copy = clone(project);
    const map = {};
    for (const id of Object.keys(copy.statements)) map[id] = uid('s');
    const newStatements = {};
    for (const [oldId, s] of Object.entries(copy.statements)) {
      s.id = map[oldId];
      s.args.forEach(a => { a.id = uid('a'); a.premises = a.premises.map(x => map[x]); });
      if (s.atomicOf) s.atomicOf = map[s.atomicOf] || null;
      newStatements[s.id] = s;
    }
    copy.statements = newStatements;
    copy.order = copy.order.map(x => map[x]);
    const ex = {};
    for (const k of Object.keys(copy.ui.expanded || {})) if (map[k]) ex[map[k]] = true;
    copy.ui = { expanded: ex };
    copy.id = uid('p');
    copy.title = copy.title + ' (copia)';
    copy.createdAt = copy.updatedAt = nowISO();
    return copy;
  }

  return {
    SCHEMA_VERSION, FORMAT, MAX_ATOMS,
    TYPES, RELS, ESTADOS, PROJECT_STATUS, CHECKS,
    typeById, relById, estadoById,
    uid, nowISO, clone,
    createProject, addStatement, touch, pushHistory,
    buildParentIndex, descendants, wouldCreateCycle, roots, findArg, autoType,
    addArgument, addPremise, linkPremise, unlinkPremise, movePremise, reorderPremise, removeArgument, setArgRel,
    deletionPlan, deleteStatement, splitStatement,
    localFormulas, expandedFormula, supportArgs,
    parseFormula, analyzeFormula, checkArgument, validityReports, fmt,
    formulationSignals, summarize, validateImport, exportEnvelope, duplicateProject
  };
});
