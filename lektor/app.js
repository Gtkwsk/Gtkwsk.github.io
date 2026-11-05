/* Lektor dwujęzyczny — app.js
   Wklejony tekst → czyszczenie → zdania → tłumaczenie (Anthropic API, klucz w przeglądarce)
   → czytnik: dwa panele, Web Speech API, zdanie oryginału / zdanie polskie na zmianę. */
'use strict';

const APP_VERSION = '1.0.0';
const LS_KEY = 'lektor.settings';
const API_BASE = 'https://api.anthropic.com';

/* ---------- Ustawienia ---------- */
const DEFAULTS = {
  apiKey: '', model: 'claude-sonnet-5-5', conc: 3, chunk: 30, rateIn: null, rateOut: null, theme: 'auto',
  order: 'src-tgt', textMode: 'both', rateSrc: 0.9, rateTgt: 1.0, pauseMid: 0.6, pauseEnd: 1.0, fontSize: 18,
  keepalive: false, wakelock: false, voices: {}
};
let S = loadSettings();
function loadSettings() {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw)); } catch (e) {}
  return Object.assign({}, DEFAULTS);
}
function saveSettings() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} }
function priceFor(model) {
  const m = (model || '').toLowerCase();
  const auto = m.includes('haiku') ? [1, 5] : m.includes('opus') ? [15, 75] : [3, 15];
  return [S.rateIn ?? auto[0], S.rateOut ?? auto[1]];
}

/* ---------- Narzędzia ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const sleep = (ms, signal) => new Promise((res, rej) => {
  if (ms <= 0) return res();
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('abort'); e.name = 'AbortError'; rej(e); }, { once: true });
});
const fmtInt = n => (n || 0).toLocaleString('pl-PL');
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
let toastTimer = null;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const LANG_EN = { es: 'Spanish', en: 'English', de: 'German', fr: 'French', it: 'Italian', pt: 'Portuguese', la: 'Latin', ru: 'Russian', uk: 'Ukrainian', cs: 'Czech', nl: 'Dutch', el: 'Greek', pl: 'Polish', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', hu: 'Hungarian', ro: 'Romanian', sk: 'Slovak', hr: 'Croatian', tr: 'Turkish', he: 'Hebrew', ca: 'Catalan' };
const LANG_BCP = { es: 'es-ES', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', pl: 'pl-PL', ru: 'ru-RU', uk: 'uk-UA', cs: 'cs-CZ', nl: 'nl-NL', el: 'el-GR', la: 'it-IT', sv: 'sv-SE', da: 'da-DK', fi: 'fi-FI', hu: 'hu-HU', ro: 'ro-RO', sk: 'sk-SK', hr: 'hr-HR', tr: 'tr-TR', he: 'he-IL', ca: 'ca-ES', no: 'nb-NO' };
let displayNames = null;
try { displayNames = new Intl.DisplayNames(['pl'], { type: 'language' }); } catch (e) {}
function langNamePl(code) {
  if (!code || code === 'auto') return 'nieznany';
  try { const n = displayNames && displayNames.of(code); if (n && n !== code) return n; } catch (e) {}
  return LANG_EN[code] || code;
}
function langNameEn(code) { return LANG_EN[code] || code; }
function bcp(code) { return LANG_BCP[code] || code || 'en-GB'; }

/* ---------- Rozpoznawanie języka (bez API) ---------- */
const STOP = {
  es: 'el la de que y en los las por con una para como del se su es no al lo más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros',
  en: 'the and of to in is that it for with as was on be this by are not or from at an which but have had has they their were you we his her she he will one all would there what so if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us',
  de: 'der die und das ist nicht ein eine mit auf den sich des dem zu von er es ich auch an als wie im für aus nur noch werden wird bei oder wenn sind einer über so man aber durch nach kann vor zum zur hat hatte sein seine ihre ihr wir ihm ihn dieser diese dieses alle mehr',
  fr: 'le la les et des est une un dans que qui pour pas sur ce il au du ne se son sa ses par plus avec ou mais nous vous ils elle comme tout aussi cette ces leur été être sont fait sans même où',
  it: 'il di che la e un una per non con del della sono gli le si da nel alla come più ma anche nella questo questa suo sua essere ha hanno era dei delle quello quella se lo al dal',
  pt: 'o a de que e do da em um uma para com não os as se por mais dos das no na ao à seu sua como ou ele ela mas foi são pelo pela isso esse essa este esta também já quando muito',
  la: 'et in est non ad ut cum quod sed qui quae enim autem esse sunt de per ex atque etiam hoc aut si vel quia omnia deus dei ergo tamen nihil ita sic nec neque ab pro quam',
  nl: 'de het een en van is dat in op te niet zijn met voor er aan ook als maar om dan nog bij uit naar heeft wordt door hij zij ze we je ik over dit deze',
  pl: 'i w nie się na z do to że jest o jak co a ale po od za tak przez jego jej tego tym są być ma już tylko dla czy przy może nad bardzo jeszcze który która które',
  cs: 'a v se na je že to s z do jak ale jsem pro jako o k od by už také tak ještě podle když který která které byl byla bylo',
  hu: 'a az és hogy nem is egy meg de csak ez volt már még ha vagy mint el ki át amely aki ezt azt',
  ro: 'și de în la cu pe un o este că nu se din sunt pentru ca mai care dar al ale lui ei fi sau',
  sv: 'och att det i en som är av på för med till inte den har de om ett var han hon så men kan sig',
  tr: 've bir bu da de için ile ne gibi daha çok ama en her ya o ki mi var yok olan olarak',
};
const STOP_SETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]));
function guessLang(text) {
  const sample = text.slice(0, 20000);
  if (/[Ͱ-Ͽ]/.test(sample)) return 'el';
  if (/[֐-׿]/.test(sample)) return 'he';
  if (/[Ѐ-ӿ]/.test(sample)) return /[іїєґ]/i.test(sample) ? 'uk' : 'ru';
  const words = sample.toLowerCase().match(/[a-zà-ÿąćęłńóśźżß]+/g) || [];
  if (words.length < 5) return 'en';
  const scores = {};
  for (const [code, set] of Object.entries(STOP_SETS)) scores[code] = 0;
  for (const w of words) for (const [code, set] of Object.entries(STOP_SETS)) if (set.has(w)) scores[code]++;
  if (/[¿¡]/.test(sample)) scores.es += Math.ceil(words.length / 100);
  if (/ß/.test(sample)) scores.de += Math.ceil(words.length / 100);
  let best = 'en', bestScore = -1;
  for (const [code, sc] of Object.entries(scores)) if (sc > bestScore) { best = code; bestScore = sc; }
  return best;
}

/* ---------- IndexedDB ---------- */
let _db = null;
function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open('lektor', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('texts')) d.createObjectStore('texts', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('trans')) { const s = d.createObjectStore('trans', { keyPath: 'key' }); s.createIndex('p', 'p'); }
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return openDb().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transakcja przerwana'));
  }));
}
const dbGet = (store, key) => tx(store, 'readonly', s => s.get(key));
const dbPut = (store, val) => tx(store, 'readwrite', s => s.put(val));
const dbDel = (store, key) => tx(store, 'readwrite', s => s.delete(key));
const dbAll = store => tx(store, 'readonly', s => s.getAll());
const dbIndexAll = (store, idx, val) => tx(store, 'readonly', s => s.index(idx).getAll(val));
async function dbDelByIndex(store, idx, val) {
  const keys = await tx(store, 'readonly', s => s.index(idx).getAllKeys(val));
  if (!keys || !keys.length) return;
  await tx(store, 'readwrite', s => { keys.forEach(k => s.delete(k)); return null; });
}

/* ---------- Przetwarzanie tekstu ---------- */
const SENT_END = /[.!?…][»”"'’)\]]*$/;
const UPPER_START = /^[«“"„¿¡(\[A-ZÀ-ÝĄĆĘŁŃÓŚŹŻΑ-ΩА-Я0-9]/;
const JOIN_WORDS = new Set('de la el los las y a en que del al con por para un una e o u sin sobre entre the of and to in or for with an von und der die das zu im et le les des du à da di che il'.split(' '));

function cleanText(raw, mode = 'auto') {
  let t = String(raw || '').replace(/\r\n?/g, '\n').replace(/­/g, '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  let lines = t.split('\n').map(l => l.trim());
  lines = lines.filter(l => !/^\d{1,4}$/.test(l) && !/^[ivxlcdm]{1,7}$/i.test(l) && !/^[-–—_·•.]{1,3}$/.test(l));
  const nonEmpty = lines.filter(Boolean);
  if (!nonEmpty.length) return [];
  if (mode === 'auto') {
    const ends = nonEmpty.filter(l => SENT_END.test(l)).length;
    mode = (nonEmpty.length > 6 && ends / nonEmpty.length < 0.55) ? 'wrapped' : 'lines';
  }
  const paras = [];
  if (mode === 'lines') { for (const l of lines) if (l) paras.push(l); return paras; }
  const lens = nonEmpty.map(l => l.length).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)] || 60;
  let cur = '';
  const flush = () => { const c = cur.trim(); if (c) paras.push(c); cur = ''; };
  const isHeading = (l, next) => {
    if (SENT_END.test(l)) return false;
    if (l.length > median * 0.8) return false;
    const letters = l.replace(/[^a-zà-ÿąćęłńóśźżA-ZÀ-ÝĄĆĘŁŃÓŚŹŻ]/g, '');
    if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
    const lastWord = (l.match(/[a-zà-ÿąćęłńóśźż]+$/i) || [''])[0].toLowerCase();
    if (JOIN_WORDS.has(lastWord) || /[,;:–—-]$/.test(l)) return false;
    return !next || UPPER_START.test(next);
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) { if (SENT_END.test(cur.trim())) flush(); continue; }
    const next = lines[i + 1];
    if (isHeading(l, next)) { flush(); paras.push(l); continue; }
    if (!cur) cur = l;
    else if (/-$/.test(cur) && /^[a-zà-ÿąćęłńóśźż]/.test(l)) cur = cur.slice(0, -1) + l;
    else cur += ' ' + l;
    if (next && SENT_END.test(l) && l.length < median * 0.7 && UPPER_START.test(next)) flush();
  }
  flush();
  return paras;
}

function splitSentences(text, lang) {
  let parts = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const seg = new Intl.Segmenter(bcp(lang) || 'en', { granularity: 'sentence' });
      for (const s of seg.segment(text)) parts.push(s.segment.trim());
    } catch (e) { parts = []; }
  }
  if (!parts.length) parts = text.split(/(?<=[.!?…][»”"')\]]?)\s+(?=[«“"„¿¡(\[A-ZÀ-ÝĄĆĘŁŃÓŚŹŻ0-9])/);
  const out = [];
  for (let p of parts) {
    p = p.trim(); if (!p) continue;
    const prev = out[out.length - 1];
    const tiny = p.length < 3 || (/^[»”"'’)\]]+/.test(p) && p.length < 8);
    const lowerCont = /^[a-zà-ÿąćęłńóśźż]/.test(p) && prev && !SENT_END.test(prev);
    if (prev && (tiny || lowerCont)) out[out.length - 1] = prev + ' ' + p; else out.push(p);
  }
  // Bardzo długie zdania dzielimy na pół przy średniku/dwukropku (lepiej dla lektora i tłumacza).
  const final = [];
  for (const s of out) {
    if (s.length <= 900) { final.push(s); continue; }
    const mid = Math.floor(s.length / 2);
    let cut = -1;
    for (const sep of ['; ', ': ', ', ']) { const a = s.lastIndexOf(sep, mid + 200); if (a > 100) { cut = a + sep.length - 1; break; } }
    if (cut > 0) { final.push(s.slice(0, cut).trim()); final.push(s.slice(cut).trim()); } else final.push(s);
  }
  return final;
}

function buildSentences(paras, lang) {
  const sentences = [];
  paras.forEach((para, pi) => {
    const ss = splitSentences(para, lang);
    const heading = ss.length === 1 && para.length < 90 && !SENT_END.test(para);
    for (const s of ss) sentences.push({ s, p: pi, h: heading ? 1 : 0, t: null });
  });
  return sentences;
}
function makeChunks(sentences, maxN) {
  const maxChars = 3000; const chunks = []; let from = 0, chars = 0;
  for (let i = 0; i < sentences.length; i++) {
    const L = sentences[i].s.length;
    if (i > from && (chars + L > maxChars || i - from >= maxN)) { chunks.push([from, i]); from = i; chars = 0; }
    chars += L;
  }
  if (from < sentences.length) chunks.push([from, sentences.length]);
  return chunks;
}
function countDone(data) { let n = 0; for (const s of data.sentences) if (s.t != null) n++; return n; }

/* ---------- Projekty ---------- */
const LOADED = new Map();
async function listProjects() { const all = await dbAll('projects'); return all.sort((a, b) => (b.updated || 0) - (a.updated || 0)); }
async function saveProject(p) { p.updated = Date.now(); await dbPut('projects', p); }
async function loadProject(id) {
  if (LOADED.has(id)) return LOADED.get(id);
  const proj = await dbGet('projects', id); if (!proj) return null;
  const text = await dbGet('texts', id); if (!text) return null;
  const trans = await dbIndexAll('trans', 'p', id);
  const sentences = text.sentences.map(s => ({ s: s.s, p: s.p, h: s.h || 0, t: null }));
  const data = { proj, sentences, chunks: text.chunks, doneChunks: new Set() };
  for (const tr of trans || []) {
    if (tr.c < data.chunks.length && tr.t && tr.t.length === tr.to - tr.from) {
      for (let k = 0; k < tr.t.length; k++) sentences[tr.from + k].t = tr.t[k];
      data.doneChunks.add(tr.c);
    }
  }
  LOADED.set(id, data);
  return data;
}
async function createProject({ title, lang, ctx, mode, text, sentences, autoLang }) {
  const id = uid();
  if (!sentences) { const paras = cleanText(text, mode); sentences = buildSentences(paras, lang); }
  const chunks = makeChunks(sentences, S.chunk);
  const proj = { id, title: title || 'Bez tytułu', lang, autoLang: !!autoLang, ctx: ctx || '', created: Date.now(), updated: Date.now(), n: sentences.length, done: 0, pos: 0, tokIn: 0, tokOut: 0, model: '' };
  await dbPut('texts', { id, sentences: sentences.map(s => ({ s: s.s, p: s.p, h: s.h || 0 })), chunks });
  // Zdania już przetłumaczone (import) zapisujemy jako gotowe fragmenty.
  let done = 0;
  for (let c = 0; c < chunks.length; c++) {
    const [from, to] = chunks[c];
    const t = sentences.slice(from, to).map(s => s.t);
    if (t.every(x => typeof x === 'string')) { await dbPut('trans', { key: `${id}:${c}`, p: id, c, from, to, t }); done += t.length; }
  }
  proj.done = done;
  await dbPut('projects', proj);
  return proj;
}
async function deleteProject(id) {
  const job = JOBS.get(id); if (job) job.stop();
  LOADED.delete(id); JOBS.delete(id);
  await dbDelByIndex('trans', 'p', id);
  await dbDel('texts', id);
  await dbDel('projects', id);
}

/* ---------- Anthropic API ---------- */
function apiHeaders() {
  return { 'content-type': 'application/json', 'x-api-key': S.apiKey.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
}
function humanizeApiError(status, msg) {
  const m = String(msg || '');
  if (status === 401) return 'Klucz API odrzucony (401). Sprawdź klucz w ustawieniach.';
  if (status === 403) return 'Brak uprawnień (403): ' + m;
  if (status === 404) return 'Model nie został znaleziony (404). Sprawdź nazwę modelu w ustawieniach.';
  if (status === 400 && /credit|balance|billing/i.test(m)) return 'Konto Anthropic bez środków — doładuj w zakładce Billing. (' + m + ')';
  if (status === 400) return 'Błąd zapytania (400): ' + m;
  if (status === 413) return 'Zbyt duży fragment (413). Zmniejsz liczbę zdań w fragmencie w ustawieniach.';
  return `Błąd API (${status}): ${m}`;
}
async function callMessages(body, signal) {
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (signal && signal.aborted) { const e = new Error('abort'); e.name = 'AbortError'; throw e; }
    try {
      const r = await fetch(API_BASE + '/v1/messages', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body), signal });
      if (r.ok) return await r.json();
      const text = await r.text();
      let msg = text; try { msg = JSON.parse(text).error?.message || text; } catch (e) {}
      if (r.status === 429 || r.status === 529 || r.status >= 500) {
        const ra = Number(r.headers.get('retry-after'));
        lastErr = new Error(humanizeApiError(r.status, msg));
        await sleep(ra > 0 ? ra * 1000 : Math.min(40000, 1500 * 2 ** attempt + Math.random() * 1000), signal);
        continue;
      }
      const e = new Error(humanizeApiError(r.status, msg)); e.status = r.status; e.fatal = true; throw e;
    } catch (e) {
      if (e.name === 'AbortError' || e.fatal) throw e;
      lastErr = new Error('Brak połączenia z API Anthropic (sieć?): ' + (e.message || e));
      await sleep(Math.min(30000, 2000 * 2 ** attempt), signal);
    }
  }
  throw lastErr || new Error('Nie udało się połączyć z API.');
}
async function listModels() {
  const r = await fetch(API_BASE + '/v1/models?limit=100', { headers: apiHeaders() });
  if (!r.ok) { let msg = await r.text(); try { msg = JSON.parse(msg).error?.message || msg; } catch (e) {} throw new Error(humanizeApiError(r.status, msg)); }
  const j = await r.json();
  return (j.data || []).map(m => m.id);
}
async function detectLangApi(sample, signal) {
  const res = await callMessages({
    model: S.model, max_tokens: 12,
    messages: [{ role: 'user', content: 'Identify the language of the text below. Reply with only its two-letter ISO 639-1 code (e.g. es, en, de, fr, it, pt, la, pl, ru).\n\n' + sample.slice(0, 1500) }]
  }, signal);
  const text = (res.content || []).map(c => c.text || '').join('').toLowerCase();
  const m = text.match(/\b[a-z]{2}\b/);
  return m ? m[0] : null;
}

function buildPrompt(srcName, tgtName, ctxNote, prev, items) {
  const n = items.length;
  let p = `Translate the following ${n} numbered sentences from ${srcName} into ${tgtName}.\n\nRules:\n`;
  p += `- Translate each numbered sentence separately and in order. Output exactly ${n} items: item k is the translation of sentence k. Never merge, split, skip or reorder sentences.\n`;
  p += `- Keep the meaning, register and tone of the original. Keep terminology consistent. Keep names, quotations and references (e.g. biblical citations) as they are.\n`;
  p += `- A heading, a fragment or a reference is translated as it is, without completing it.\n`;
  p += `- Use the typographic conventions of ${tgtName} (quotation marks, punctuation).\n- Do not add notes, explanations or anything else.\n`;
  if (ctxNote) p += `\nNote from the reader about this text: ${ctxNote}\n`;
  if (prev.length) p += `\nPreceding text, for context only (do not translate it): ${prev.join(' ')}\n`;
  p += `\nReply with only a JSON object of the form {"t": ["translation of 1", "translation of 2", ...]} containing exactly ${n} strings.\n\nSentences:\n`;
  items.forEach((s, i) => { p += `${i + 1}. ${s}\n`; });
  return p;
}
function parseTranslation(text, n) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) t = fence[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    const obj = JSON.parse(t.slice(a, b + 1));
    const arr = obj && obj.t;
    if (Array.isArray(arr) && arr.length === n && arr.every(x => typeof x === 'string')) return arr.map(x => x.trim());
  } catch (e) {}
  return null;
}
async function translateRange(job, from, to, signal, depth = 0) {
  const items = job.data.sentences.slice(from, to).map(x => x.s);
  const prev = job.data.sentences.slice(Math.max(0, from - 2), from).map(x => x.s);
  const srcName = langNameEn(job.proj.lang), tgtName = 'Polish';
  const body = {
    model: S.model, max_tokens: 8192,
    system: `You are a careful professional literary translator. You translate ${srcName} into ${tgtName} faithfully, naturally and consistently, and you follow output format instructions exactly.`,
    messages: [{ role: 'user', content: buildPrompt(srcName, tgtName, job.proj.ctx, prev, items) }]
  };
  const res = await callMessages(body, signal);
  job.addUsage(res.usage);
  const text = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const arr = res.stop_reason === 'max_tokens' ? null : parseTranslation(text, items.length);
  if (arr) return arr;
  if (items.length === 1) {
    let cleaned = text.trim();
    const m = cleaned.match(/\[\s*"([\s\S]*)"\s*\]/); if (m) cleaned = m[1];
    cleaned = cleaned.replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
    if (cleaned && cleaned.length < items[0].length * 4 + 200) return [cleaned];
    throw new Error('Nie udało się przetłumaczyć zdania: ' + items[0].slice(0, 60) + '…');
  }
  if (depth > 7) throw new Error('Model nie zachował liczby zdań mimo podziału fragmentu.');
  const mid = from + Math.ceil((to - from) / 2);
  const a = await translateRange(job, from, mid, signal, depth + 1);
  const b = await translateRange(job, mid, to, signal, depth + 1);
  return a.concat(b);
}

/* ---------- Zadania tłumaczenia ---------- */
const JOBS = new Map();
class Job {
  constructor(data) {
    this.id = data.proj.id; this.data = data; this.proj = data.proj;
    this.state = 'idle'; this.error = null; this.listeners = new Set(); this.ctl = null;
  }
  get total() { return this.data.chunks.length; }
  get done() { return this.data.doneChunks.size; }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit(chunk) { for (const f of this.listeners) { try { f(this, chunk); } catch (e) { console.error(e); } } }
  addUsage(u) {
    if (!u) return;
    this.proj.tokIn = (this.proj.tokIn || 0) + (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    this.proj.tokOut = (this.proj.tokOut || 0) + (u.output_tokens || 0);
    this.proj.model = S.model;
  }
  async start() {
    if (this.state === 'running') return;
    if (!S.apiKey.trim()) { this.error = 'Brak klucza API — wpisz go w ustawieniach.'; this.state = 'error'; this.emit(); return; }
    this.state = 'running'; this.error = null; this.ctl = new AbortController(); this.emit();
    try {
      if (this.proj.autoLang) {
        const sample = this.data.sentences.slice(0, 12).map(s => s.s).join(' ');
        const code = await detectLangApi(sample, this.ctl.signal);
        if (code) { this.proj.lang = code; this.proj.autoLang = false; await saveProject(this.proj); }
      }
      const queue = this.data.chunks.map((c, i) => i).filter(i => !this.data.doneChunks.has(i));
      const workers = Array.from({ length: Math.max(1, Math.min(S.conc | 0 || 1, queue.length || 1)) }, () => this.worker(queue));
      await Promise.all(workers);
    } catch (e) {
      if (e.name !== 'AbortError') this.error = e.message;
    }
    this.state = this.done === this.total ? 'done' : (this.error ? 'error' : 'idle');
    await saveProject(this.proj);
    this.emit();
  }
  async worker(queue) {
    const signal = this.ctl.signal;
    while (queue.length && !signal.aborted) {
      const i = queue.shift(); const [from, to] = this.data.chunks[i];
      try {
        const t = await translateRange(this, from, to, signal);
        if (signal.aborted) return;
        for (let k = 0; k < t.length; k++) this.data.sentences[from + k].t = t[k];
        this.data.doneChunks.add(i);
        await dbPut('trans', { key: `${this.id}:${i}`, p: this.id, c: i, from, to, t });
        this.proj.done = countDone(this.data);
        await saveProject(this.proj);
        this.emit(i);
      } catch (e) {
        if (e.name === 'AbortError') return;
        this.error = e.message;
        if (e.fatal) { this.ctl.abort(); }
        this.emit();
      }
    }
  }
  stop() { if (this.ctl) this.ctl.abort(); if (this.state === 'running') this.state = 'stopping'; this.emit(); }
}
function jobFor(data) { let j = JOBS.get(data.proj.id); if (!j) { j = new Job(data); JOBS.set(data.proj.id, j); } return j; }

/* ---------- Widoki i nawigacja ---------- */
const VIEWS = ['home', 'new', 'translate', 'reader', 'settings'];
let currentView = 'home';
function showView(name) {
  if (currentView === 'reader' && name !== 'reader') leaveReader();
  if (currentView === 'translate' && name !== 'translate') trWakeOff();
  for (const v of VIEWS) $('#view-' + v).hidden = v !== name;
  currentView = name;
  window.scrollTo(0, 0);
}
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'new') return openNew();
  if (h === 'settings') return openSettings();
  if (h.startsWith('read=')) return openReader(h.slice(5));
  if (h.startsWith('tr=')) return openTranslate(h.slice(3));
  return openHome();
}
function go(hash) { if (location.hash.slice(1) === hash) route(); else location.hash = hash; }
$$('[data-back]').forEach(b => b.addEventListener('click', () => { if (history.length > 1) history.back(); else go(''); }));

/* ---------- Biblioteka ---------- */
async function openHome() {
  showView('home');
  $('#key-warning').hidden = !!S.apiKey.trim();
  const list = $('#projects');
  const projects = await listProjects();
  if (!projects.length) { list.innerHTML = '<p class="empty">Brak tekstów. Dodaj pierwszy przyciskiem „Nowy tekst”.</p>'; return; }
  list.innerHTML = '';
  for (const p of projects) list.append(projectCard(p));
}
function projectCard(p) {
  const el = document.createElement('div'); el.className = 'card project'; el.dataset.id = p.id;
  const job = JOBS.get(p.id);
  const running = job && job.state === 'running';
  const done = p.done || 0, n = p.n || 0;
  el.innerHTML = `
    <div class="title">${escapeHtml(p.title)}</div>
    <div class="meta">
      <span class="badge">${escapeHtml(langNamePl(p.lang))}</span>
      <span>${fmtInt(n)} zdań</span>
      <span>przetłumaczone: ${pct(done, n)}%${running ? ' (tłumaczę…)' : ''}</span>
      <span>pozycja: ${n ? Math.round(100 * (p.pos || 0) / n) : 0}%</span>
    </div>
    <div class="progress"><i style="width:${pct(done, n)}%"></i></div>
    <div class="actions">
      <button class="btn primary" data-act="read">Czytaj</button>
      ${done < n ? `<button class="btn" data-act="translate">${done ? 'Dokończ tłumaczenie' : 'Tłumacz'}</button>` : ''}
      <button class="btn" data-act="export">Eksport</button>
      <button class="btn" data-act="txt" title="Tekst przeplatany (np. do ElevenReadera)">TXT</button>
      <button class="btn quiet danger" data-act="delete">Usuń</button>
    </div>`;
  el.addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'read') go('read=' + p.id);
    else if (act === 'translate') go('tr=' + p.id);
    else if (act === 'export') exportProject(p.id);
    else if (act === 'txt') exportInterleaved(p.id);
    else if (act === 'delete') {
      const actions = el.querySelector('.actions');
      actions.innerHTML = `<div class="confirm"><span>Usunąć „${escapeHtml(p.title)}” razem z tłumaczeniem?</span><button class="btn danger" data-act="delete-yes">Usuń</button><button class="btn" data-act="delete-no">Zostaw</button></div>`;
    }
    else if (act === 'delete-yes') { await deleteProject(p.id); toast('Usunięto'); openHome(); }
    else if (act === 'delete-no') { el.replaceWith(projectCard(p)); }
  });
  return el;
}
$('#btn-new').addEventListener('click', () => go('new'));
$('#btn-settings').addEventListener('click', () => go('settings'));
$('#btn-goto-key').addEventListener('click', () => go('settings'));

/* ---------- Nowy tekst ---------- */
let statsTimer = null;
function openNew() { showView('new'); updateNewStats(); }
function newParams() {
  const text = $('#new-text').value;
  const langSel = $('#new-lang').value;
  const mode = $('#new-mode').value;
  const autoLang = langSel === 'auto';
  const lang = autoLang ? guessLang(text) : langSel;
  return { text, lang, autoLang, mode, title: $('#new-title').value.trim(), ctx: $('#new-context').value.trim() };
}
function updateNewStats() {
  const { text, lang, autoLang, mode } = newParams();
  const el = $('#new-stats');
  if (!text.trim()) { el.textContent = 'Wklej tekst, a pokażę liczbę akapitów i zdań.'; return; }
  const paras = cleanText(text, mode);
  const sentences = buildSentences(paras, lang);
  el.textContent = `Akapitów: ${fmtInt(paras.length)} · zdań: ${fmtInt(sentences.length)} · znaków: ${fmtInt(text.length)} · język: ${langNamePl(lang)}${autoLang ? ' (rozpoznany)' : ''} · fragmentów do tłumaczenia: ${fmtInt(makeChunks(sentences, S.chunk).length)}`;
}
$('#new-text').addEventListener('input', () => { clearTimeout(statsTimer); statsTimer = setTimeout(updateNewStats, 400); });
$('#new-lang').addEventListener('change', updateNewStats);
$('#new-mode').addEventListener('change', updateNewStats);
async function createFromForm(translate) {
  const prm = newParams();
  if (!prm.text.trim()) { toast('Najpierw wklej tekst.'); return; }
  if (!prm.title) prm.title = prm.text.trim().split('\n')[0].slice(0, 60);
  const btns = [$('#btn-create-translate'), $('#btn-create-only')]; btns.forEach(b => b.disabled = true);
  try {
    const proj = await createProject(prm);
    $('#new-text').value = ''; $('#new-title').value = ''; $('#new-context').value = '';
    toast('Zapisano: ' + proj.title);
    if (translate) go('tr=' + proj.id); else go('');
  } catch (e) { toast('Błąd zapisu: ' + e.message); }
  finally { btns.forEach(b => b.disabled = false); }
}
$('#btn-create-translate').addEventListener('click', () => createFromForm(true));
$('#btn-create-only').addEventListener('click', () => createFromForm(false));
$('#import-file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j || !Array.isArray(j.sentences)) throw new Error('To nie jest plik projektu Lektora.');
    const sentences = j.sentences.map(s => ({ s: String(s.s || ''), p: s.p | 0, h: s.h ? 1 : 0, t: typeof s.t === 'string' ? s.t : null })).filter(s => s.s);
    const proj = await createProject({ title: (j.project && j.project.title) || f.name.replace(/\.json$/i, ''), lang: (j.project && j.project.lang && j.project.lang !== 'auto') ? j.project.lang : guessLang(sentences.map(s => s.s).join(' ')), ctx: j.project && j.project.ctx, sentences });
    if (j.project && j.project.pos) { proj.pos = Math.min(j.project.pos | 0, proj.n - 1); await saveProject(proj); }
    toast('Zaimportowano: ' + proj.title); go('');
  } catch (err) { toast('Import nieudany: ' + err.message); }
  e.target.value = '';
});

/* ---------- Tłumaczenie ---------- */
let trUnsub = null, trData = null;
async function openTranslate(id) {
  const data = await loadProject(id);
  if (!data) { toast('Nie ma takiego tekstu.'); go(''); return; }
  showView('translate');
  trData = data;
  const job = jobFor(data);
  if (trUnsub) trUnsub();
  trUnsub = job.on(() => renderTranslate(job));
  $('#tr-title').textContent = data.proj.title;
  renderTranslate(job);
}
function renderTranslate(job) {
  if (currentView !== 'translate' || !trData || job.id !== trData.proj.id) return;
  const p = job.proj, d = job.data;
  const done = countDone(d);
  $('#tr-bar').style.width = pct(done, d.sentences.length) + '%';
  $('#tr-sent').textContent = `${fmtInt(done)} / ${fmtInt(d.sentences.length)} (${pct(done, d.sentences.length)}%)`;
  $('#tr-chunks').textContent = `${fmtInt(job.done)} / ${fmtInt(job.total)}`;
  $('#tr-model').textContent = S.model + (p.autoLang ? ' · język: rozpoznam przy starcie' : ' · ' + langNamePl(p.lang) + ' → polski');
  $('#tr-tokens').textContent = `${fmtInt(p.tokIn)} wej. / ${fmtInt(p.tokOut)} wyj.`;
  const [ri, ro] = priceFor(p.model || S.model);
  const cost = (p.tokIn || 0) / 1e6 * ri + (p.tokOut || 0) / 1e6 * ro;
  $('#tr-cost').textContent = (p.tokIn || p.tokOut) ? `≈ ${cost.toFixed(2)} $` : '—';
  const st = $('#tr-status');
  if (job.state === 'running') st.textContent = `Tłumaczę… (${S.conc} równoległe zapytania). Można wyjść z tego ekranu, tłumaczenie trwa, dopóki strona jest otwarta.`;
  else if (job.state === 'stopping') st.textContent = 'Zatrzymuję…';
  else if (job.state === 'done' || done === d.sentences.length) st.textContent = 'Gotowe — wszystko przetłumaczone.';
  else if (!S.apiKey.trim()) st.textContent = 'Brak klucza API — wpisz go w ustawieniach, żeby tłumaczyć.';
  else st.textContent = done ? 'Przerwane. Kliknij Start, żeby dokończyć.' : 'Gotowe do startu.';
  $('#tr-error').hidden = !job.error; $('#tr-error').textContent = job.error || '';
  if (job.state === 'running') trWakeOn(); else trWakeOff();
  $('#btn-tr-start').hidden = job.state === 'running' || job.state === 'stopping' || done === d.sentences.length;
  $('#btn-tr-start').textContent = done ? 'Dokończ' : 'Start';
  $('#btn-tr-stop').hidden = job.state !== 'running';
}
let trWake = null;
async function trWakeOn() { if (trWake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return; try { trWake = await navigator.wakeLock.request('screen'); trWake.addEventListener('release', () => { trWake = null; }); } catch (e) {} }
function trWakeOff() { try { trWake && trWake.release(); } catch (e) {} trWake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && currentView === 'translate' && trData && jobFor(trData).state === 'running') trWakeOn(); });
$('#btn-tr-start').addEventListener('click', () => { if (!trData) return; if (!S.apiKey.trim()) { go('settings'); return; } jobFor(trData).start(); });
$('#btn-tr-stop').addEventListener('click', () => { if (trData) jobFor(trData).stop(); });
$('#btn-tr-read').addEventListener('click', () => { if (trData) go('read=' + trData.proj.id); });

/* ---------- Eksport ---------- */
function download(name, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function slug(s) { return (s || 'tekst').replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'tekst'; }
async function exportProject(id) {
  const d = await loadProject(id); if (!d) return;
  const out = { app: 'lektor', version: 1, project: { title: d.proj.title, lang: d.proj.lang, ctx: d.proj.ctx, pos: d.proj.pos }, sentences: d.sentences.map(s => ({ s: s.s, t: s.t, p: s.p, h: s.h })) };
  download(slug(d.proj.title) + '.json', JSON.stringify(out), 'application/json');
  toast('Plik projektu pobrany');
}
async function exportInterleaved(id) {
  const d = await loadProject(id); if (!d) return;
  const lines = [];
  for (const s of d.sentences) {
    const src = s.s, tgt = s.t || '';
    const seq = S.order === 'tgt-src' ? [tgt, src] : S.order === 'src-tgt-src' ? [src, tgt, src] : S.order === 'src' ? [src] : S.order === 'tgt' ? [tgt] : [src, tgt];
    lines.push(seq.filter(Boolean).join('\n'));
  }
  download(slug(d.proj.title) + '-przeplatany.txt', lines.join('\n\n') + '\n', 'text/plain;charset=utf-8');
  toast('Plik TXT pobrany (kolejność jak w ustawieniach odtwarzania)');
}

/* ---------- Głosy ---------- */
let VOICES = [];
function refreshVoices() { try { VOICES = speechSynthesis.getVoices() || []; } catch (e) { VOICES = []; } return VOICES; }
if ('speechSynthesis' in window) { refreshVoices(); speechSynthesis.addEventListener('voiceschanged', () => { refreshVoices(); if (currentView === 'settings') renderVoiceList(); }); }
function norm(l) { return String(l || '').toLowerCase().replace('_', '-'); }
function voicesFor(code) {
  const want = norm(bcp(code)); const pre = want.split('-')[0];
  return VOICES.filter(v => norm(v.lang).split('-')[0] === pre).sort((a, b) => {
    const score = v => (norm(v.lang) === want ? 4 : 0) + (v.localService ? 1 : 0) + (/natural|neural|premium|enhanced/i.test(v.name) ? 2 : 0) + (/google/i.test(v.name) ? 1 : 0);
    return score(b) - score(a);
  });
}
function voiceFor(code) {
  if (!VOICES.length) refreshVoices();
  const pref = S.voices[code];
  if (pref) { const v = VOICES.find(v => v.voiceURI === pref || v.name === pref); if (v) return v; }
  return voicesFor(code)[0] || null;
}
async function projectLangs() {
  const projects = await listProjects();
  const set = new Set(['pl']);
  for (const p of projects) if (p.lang && p.lang !== 'auto') set.add(p.lang);
  if (R.proj && R.proj.lang) set.add(R.proj.lang);
  return Array.from(set);
}
async function renderVoiceList() {
  refreshVoices();
  const list = $('#voice-list'); list.innerHTML = '';
  if (!('speechSynthesis' in window)) { list.innerHTML = '<p class="error">Ta przeglądarka nie obsługuje syntezy mowy. Użyj Chrome.</p>'; return; }
  const langs = await projectLangs();
  for (const code of langs) {
    const opts = voicesFor(code);
    const wrap = document.createElement('label'); wrap.className = 'field';
    const sel = document.createElement('select'); sel.id = 'voice-' + code;
    const auto = document.createElement('option'); auto.value = ''; auto.textContent = opts.length ? `Automatycznie (${opts[0].name})` : 'Brak głosu dla tego języka — dograj w systemie';
    sel.append(auto);
    for (const v of opts) { const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})`; sel.append(o); }
    sel.value = S.voices[code] && opts.some(v => v.voiceURI === S.voices[code]) ? S.voices[code] : '';
    sel.addEventListener('change', () => { if (sel.value) S.voices[code] = sel.value; else delete S.voices[code]; saveSettings(); });
    const span = document.createElement('span'); span.textContent = `Głos: ${langNamePl(code)}${opts.length ? '' : ' (brak)'}`;
    wrap.append(span, sel); list.append(wrap);
  }
  $('#voices-hint').textContent = VOICES.length ? `Dostępnych głosów w systemie: ${VOICES.length}.` : 'Lista głosów jest pusta — kliknij „Odśwież listę głosów” albo dograj głosy w ustawieniach telefonu.';
}
$('#btn-voices-refresh').addEventListener('click', () => { refreshVoices(); renderVoiceList(); toast('Odświeżono'); });
$('#btn-voices-test').addEventListener('click', async () => {
  const langs = await projectLangs();
  const samples = { pl: 'To jest próbka polskiego głosu.', es: 'Esta es una muestra de la voz en español.', en: 'This is a sample of the English voice.', de: 'Dies ist eine Probe der deutschen Stimme.', fr: 'Ceci est un exemple de la voix française.', it: 'Questo è un esempio della voce italiana.', pt: 'Esta é uma amostra da voz em português.', la: 'Haec est vox Latina.', ru: 'Это пример русского голоса.' };
  speechSynthesis.cancel();
  for (const code of langs) await speakOne(samples[code] || `Sample ${langNameEn(code)}`, code, 1.0, () => false);
});

/* ---------- Czytnik ---------- */
const R = { id: null, proj: null, data: null, idx: 0, playing: false, token: 0, utter: null, unsub: null, saveTimer: null };
const ORDER_LABEL = { 'src-tgt': 'oryg. → pol.', 'tgt-src': 'pol. → oryg.', 'src-tgt-src': 'oryg. → pol. → oryg.', 'src': 'tylko oryg.', 'tgt': 'tylko pol.' };
const TEXT_LABEL = { both: 'oba teksty', src: 'tylko oryginał', tgt: 'tylko polski', none: 'bez tekstu' };

async function openReader(id) {
  const data = await loadProject(id);
  if (!data) { toast('Nie ma takiego tekstu.'); go(''); return; }
  if (R.id !== id) { stopPlayback(); R.id = id; R.data = data; R.proj = data.proj; R.idx = Math.min(data.proj.pos || 0, data.sentences.length - 1); }
  showView('reader');
  $('#rd-title').textContent = data.proj.title;
  $('#tag-src').textContent = langNamePl(data.proj.lang);
  renderPane($('#pane-src-body'), 'src'); renderPane($('#pane-tgt-body'), 'tgt');
  applyTextMode(); applyFont(); updateChips();
  const job = jobFor(data);
  if (R.unsub) R.unsub();
  R.unsub = job.on((j, chunk) => {
    $('#rd-trchip').hidden = j.state !== 'running';
    if (typeof chunk === 'number') { const [from, to] = j.data.chunks[chunk]; for (let i = from; i < to; i++) updateTgtSpan(i); }
    if (j.error && j.state !== 'running') toast('Tłumaczenie: ' + j.error);
  });
  $('#rd-trchip').hidden = job.state !== 'running';
  setCurrent(R.idx, true);
  updatePlayUI();
}
function leaveReader() { stopPlayback(); savePos(true); }
function renderPane(body, which) {
  const frag = document.createDocumentFragment();
  let p = null, lastPar = -1;
  R.data.sentences.forEach((s, i) => {
    if (s.p !== lastPar) { p = document.createElement('p'); if (s.h) p.className = 'h'; frag.append(p); lastPar = s.p; }
    const sp = document.createElement('span'); sp.className = 's'; sp.dataset.i = i; sp.tabIndex = -1;
    if (which === 'src') sp.textContent = s.s;
    else { sp.textContent = s.t != null ? s.t : '…'; if (s.t == null) sp.classList.add('missing'); }
    p.append(sp, ' ');
  });
  body.replaceChildren(frag);
}
function updateTgtSpan(i) {
  const sp = $('#pane-tgt-body').querySelector(`.s[data-i="${i}"]`); if (!sp) return;
  const s = R.data.sentences[i]; sp.textContent = s.t != null ? s.t : '…'; sp.classList.toggle('missing', s.t == null);
}
function spansAt(i) { return $$(`.s[data-i="${i}"]`, $('#panes')); }
function setCurrent(i, center) {
  $$('.s.cur', $('#panes')).forEach(el => el.classList.remove('cur'));
  R.idx = i;
  for (const el of spansAt(i)) { el.classList.add('cur'); if (center !== false) scrollSentenceIntoView(el); }
  const n = R.data.sentences.length;
  $('#rd-counter').textContent = `${i + 1} / ${n}`;
  $('#rd-bar').style.width = pct(i + 1, n) + '%';
  $('#lo-counter').textContent = String(i + 1);
  $('#lo-info').textContent = `z ${fmtInt(n)} zdań · ${pct(i + 1, n)}%`;
  savePos();
}
function scrollSentenceIntoView(el) {
  const pane = el.closest('.pane'); if (!pane || pane.hidden) return;
  const r = el.getBoundingClientRect(), pr = pane.getBoundingClientRect();
  const target = pane.scrollTop + (r.top - pr.top) - pane.clientHeight * 0.35;
  pane.scrollTo({ top: Math.max(0, target), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function savePos(now) {
  clearTimeout(R.saveTimer);
  const doSave = () => { if (R.proj) { R.proj.pos = R.idx; saveProject(R.proj).catch(() => {}); } };
  if (now) doSave(); else R.saveTimer = setTimeout(doSave, 1500);
}
function setSpeaking(pane) {
  $('#pane-src').classList.toggle('speaking', pane === 'src');
  $('#pane-tgt').classList.toggle('speaking', pane === 'tgt');
}
function stepsFor(i) {
  const s = R.data.sentences[i]; if (!s) return [];
  const src = { lang: R.proj.lang, text: s.s, pane: 'src', rate: S.rateSrc };
  const tgt = s.t ? { lang: 'pl', text: s.t, pane: 'tgt', rate: S.rateTgt } : null;
  const seq = S.order === 'tgt-src' ? [tgt, src] : S.order === 'src-tgt-src' ? [src, tgt, src] : S.order === 'src' ? [src] : S.order === 'tgt' ? [tgt] : [src, tgt];
  return seq.filter(Boolean);
}
function ttsPieces(text) {
  const MAX = 180; if (text.length <= MAX) return [text];
  const out = []; let rest = text;
  while (rest.length > MAX) {
    let cut = -1;
    for (const sep of ['; ', ': ', ', ', ' – ', ' — ', ' ']) { const a = rest.lastIndexOf(sep, MAX); if (a > 40) { cut = a + sep.length; break; } }
    if (cut < 0) cut = MAX;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
function speakOne(text, lang, rate, cancelled) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window) || !text) { setTimeout(resolve, 300); return; }
    const u = new SpeechSynthesisUtterance(text);
    const v = voiceFor(lang);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = bcp(lang);
    u.rate = rate; u.pitch = 1; u.volume = 1;
    let done = false; const started = Date.now();
    const est = Math.max(3000, text.length * 95 / rate + 2500);
    const finish = () => { if (done) return; done = true; clearInterval(wd); resolve(); };
    u.onend = finish; u.onerror = finish;
    const wd = setInterval(() => {
      const el = Date.now() - started;
      if (cancelled()) { finish(); return; }
      if (el > est && !speechSynthesis.speaking && !speechSynthesis.pending) finish();
      else if (el > est * 2 + 20000) { try { speechSynthesis.cancel(); } catch (e) {} finish(); }
    }, 400);
    R.utter = u;
    try { speechSynthesis.speak(u); } catch (e) { finish(); }
  });
}
async function speakText(text, lang, rate, token) {
  for (const piece of ttsPieces(text)) {
    if (!R.playing || token !== R.token) return;
    await speakOne(piece, lang, rate, () => !R.playing || token !== R.token);
  }
}
async function playLoop() {
  const token = ++R.token;
  R.playing = true; updatePlayUI(); startKeepalive(); requestWake(); setMediaState('playing');
  const alive = () => R.playing && token === R.token;
  while (alive()) {
    const i = R.idx; const steps = stepsFor(i);
    setCurrent(i);
    for (let k = 0; k < steps.length; k++) {
      const st = steps[k];
      if (!alive()) return;
      setSpeaking(st.pane);
      await speakText(st.text, st.lang, st.rate, token);
      setSpeaking(null);
      if (!alive()) return;
      if (k < steps.length - 1) await sleep(S.pauseMid * 1000);
    }
    if (!alive()) return;
    await sleep(steps.length ? S.pauseEnd * 1000 : 40);
    if (!alive()) return;
    if (R.idx !== i) continue; // użytkownik przeskoczył w trakcie
    if (i + 1 < R.data.sentences.length) R.idx = i + 1;
    else { stopPlayback(); toast('Koniec tekstu.'); return; }
  }
}
function stopPlayback() {
  R.playing = false; R.token++;
  try { speechSynthesis.cancel(); } catch (e) {}
  setSpeaking(null); stopKeepalive(); releaseWake(); setMediaState('paused'); updatePlayUI();
}
function togglePlay() { if (R.playing) stopPlayback(); else if (R.data) playLoop(); }
function jumpTo(i, autoplay) {
  if (!R.data) return;
  i = Math.max(0, Math.min(i, R.data.sentences.length - 1));
  const wasPlaying = R.playing;
  if (wasPlaying || autoplay) { R.playing = false; R.token++; try { speechSynthesis.cancel(); } catch (e) {} }
  setCurrent(i);
  if (wasPlaying || autoplay) playLoop();
}
function updatePlayUI() {
  $('#ico-play').hidden = R.playing; $('#ico-pause').hidden = !R.playing;
  $('#btn-play').setAttribute('aria-label', R.playing ? 'Pauza' : 'Odtwarzaj');
}
function updateChips() { $('#btn-order').textContent = ORDER_LABEL[S.order] || S.order; $('#btn-text').textContent = TEXT_LABEL[S.textMode] || S.textMode; }
function applyTextMode() {
  const m = S.textMode;
  $('#panes').hidden = m === 'none'; $('#listen-only').hidden = m !== 'none';
  $('#pane-src').hidden = m === 'tgt' || m === 'none'; $('#pane-tgt').hidden = m === 'src' || m === 'none';
  if (m !== 'none' && R.data) setCurrent(R.idx);
}
function applyFont() { document.documentElement.style.setProperty('--read-size', (S.fontSize || 18) + 'px'); }

$('#btn-play').addEventListener('click', togglePlay);
$('#btn-prev').addEventListener('click', () => jumpTo(R.idx - 1));
$('#btn-next').addEventListener('click', () => jumpTo(R.idx + 1));
$('#btn-repeat').addEventListener('click', () => jumpTo(R.idx, true));
$('#panes').addEventListener('click', e => { const sp = e.target.closest('.s'); if (sp) jumpTo(Number(sp.dataset.i), true); });
document.addEventListener('keydown', e => {
  if (currentView !== 'reader' || e.target.matches('input,textarea,select')) return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight') jumpTo(R.idx + 1);
  else if (e.key === 'ArrowLeft') jumpTo(R.idx - 1);
  else if (e.key.toLowerCase() === 'r') jumpTo(R.idx, true);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && R.playing) requestWake(); });

/* Cicha ścieżka w tle + Media Session (ekran blokady) */
let keepAudio = null, keepUrl = null;
function silentWavUrl() {
  if (keepUrl) return keepUrl;
  const sr = 8000, n = sr * 2, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128 + (i % 97 === 0 ? 1 : 0));
  keepUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return keepUrl;
}
function startKeepalive() {
  if (!S.keepalive) return;
  try {
    if (!keepAudio) { keepAudio = new Audio(silentWavUrl()); keepAudio.loop = true; keepAudio.volume = 0.05; }
    keepAudio.play().catch(() => {});
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: R.proj ? R.proj.title : 'Lektor', artist: 'Lektor dwujęzyczny' });
      navigator.mediaSession.setActionHandler('play', () => { if (!R.playing && R.data) playLoop(); });
      navigator.mediaSession.setActionHandler('pause', () => stopPlayback());
      navigator.mediaSession.setActionHandler('nexttrack', () => jumpTo(R.idx + 1));
      navigator.mediaSession.setActionHandler('previoustrack', () => jumpTo(R.idx - 1));
    }
  } catch (e) {}
}
function stopKeepalive() { try { keepAudio && keepAudio.pause(); } catch (e) {} }
function setMediaState(st) { try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = st; } catch (e) {} }
let wakeLock = null;
async function requestWake() {
  if (!S.wakelock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
function releaseWake() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }

/* Arkusz ustawień odtwarzania */
function openSheet() {
  $$('#seg-order button').forEach(b => b.classList.toggle('active', b.dataset.v === S.order));
  $$('#seg-text button').forEach(b => b.classList.toggle('active', b.dataset.v === S.textMode));
  $('#rate-src').value = S.rateSrc; $('#rate-tgt').value = S.rateTgt; $('#pause-mid').value = S.pauseMid; $('#pause-end').value = S.pauseEnd; $('#font-size').value = S.fontSize;
  $('#opt-keepalive').checked = !!S.keepalive; $('#opt-wakelock').checked = !!S.wakelock;
  sheetOutputs();
  $('#sheet').hidden = false; $('#sheet-backdrop').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true; }
function sheetOutputs() {
  $('#out-rate-src').textContent = Number($('#rate-src').value).toFixed(2).replace(/0$/, '') + '×';
  $('#out-rate-tgt').textContent = Number($('#rate-tgt').value).toFixed(2).replace(/0$/, '') + '×';
  $('#out-pause-mid').textContent = Number($('#pause-mid').value).toFixed(1) + ' s';
  $('#out-pause-end').textContent = Number($('#pause-end').value).toFixed(1) + ' s';
  $('#out-font').textContent = $('#font-size').value + ' px';
}
$('#btn-order').addEventListener('click', openSheet);
$('#btn-text').addEventListener('click', openSheet);
$('#btn-playback').addEventListener('click', openSheet);
$('#btn-sheet-close').addEventListener('click', closeSheet);
$('#sheet-backdrop').addEventListener('click', closeSheet);
$('#btn-sheet-voices').addEventListener('click', () => { closeSheet(); go('settings'); setTimeout(() => $('#card-voices').scrollIntoView({ block: 'start' }), 50); });
$('#seg-order').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.order = b.dataset.v; saveSettings(); $$('#seg-order button').forEach(x => x.classList.toggle('active', x === b)); updateChips(); if (R.playing) jumpTo(R.idx, true); });
$('#seg-text').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.textMode = b.dataset.v; saveSettings(); $$('#seg-text button').forEach(x => x.classList.toggle('active', x === b)); updateChips(); applyTextMode(); });
for (const [id, key] of [['rate-src', 'rateSrc'], ['rate-tgt', 'rateTgt'], ['pause-mid', 'pauseMid'], ['pause-end', 'pauseEnd'], ['font-size', 'fontSize']]) {
  $('#' + id).addEventListener('input', e => { S[key] = Number(e.target.value); saveSettings(); sheetOutputs(); if (key === 'fontSize') applyFont(); });
}
$('#opt-keepalive').addEventListener('change', e => { S.keepalive = e.target.checked; saveSettings(); if (R.playing) { if (S.keepalive) startKeepalive(); else stopKeepalive(); } });
$('#opt-wakelock').addEventListener('change', e => { S.wakelock = e.target.checked; saveSettings(); if (R.playing) { if (S.wakelock) requestWake(); else releaseWake(); } });

/* ---------- Ustawienia ---------- */
function openSettings() {
  showView('settings');
  $('#set-key').value = S.apiKey; $('#key-status').textContent = '';
  const sel = $('#set-model');
  if (![...sel.options].some(o => o.value === S.model)) { const o = document.createElement('option'); o.value = S.model; o.textContent = S.model; sel.append(o); }
  sel.value = S.model;
  $('#set-conc').value = S.conc; $('#set-chunk').value = S.chunk;
  const [ri, ro] = priceFor(S.model); $('#set-rate-in').value = ri; $('#set-rate-out').value = ro;
  $('#set-theme').value = S.theme || 'auto';
  $('#about-version').textContent = `Wersja ${APP_VERSION}`;
  renderVoiceList();
}
$('#set-key').addEventListener('change', e => { S.apiKey = e.target.value.trim(); saveSettings(); $('#key-status').textContent = S.apiKey ? 'Zapisano klucz.' : 'Klucz usunięty.'; });
$('#btn-test-key').addEventListener('click', async () => {
  S.apiKey = $('#set-key').value.trim(); saveSettings();
  const st = $('#key-status');
  if (!S.apiKey) { st.textContent = 'Wpisz klucz.'; return; }
  st.textContent = 'Sprawdzam…';
  try {
    const ids = await listModels();
    const sel = $('#set-model'); const cur = S.model;
    const claude = ids.filter(i => /claude/i.test(i));
    if (claude.length) {
      sel.innerHTML = '';
      for (const id of claude) { const o = document.createElement('option'); o.value = id; o.textContent = id; sel.append(o); }
      if (!claude.includes(cur)) { const pick = claude.find(i => /sonnet/i.test(i)) || claude[0]; S.model = pick; saveSettings(); }
      sel.value = S.model;
    }
    st.innerHTML = `<span class="ok">Klucz działa.</span> Dostępne modele: ${claude.length}.`;
  } catch (e) { st.innerHTML = `<span class="error">${escapeHtml(e.message)}</span>`; }
});
$('#set-model').addEventListener('change', e => { S.model = e.target.value; S.rateIn = null; S.rateOut = null; saveSettings(); const [ri, ro] = priceFor(S.model); $('#set-rate-in').value = ri; $('#set-rate-out').value = ro; });
$('#set-conc').addEventListener('change', e => { S.conc = Math.max(1, Math.min(6, Number(e.target.value) || 3)); e.target.value = S.conc; saveSettings(); });
$('#set-chunk').addEventListener('change', e => { S.chunk = Math.max(5, Math.min(60, Number(e.target.value) || 30)); e.target.value = S.chunk; saveSettings(); });
$('#set-rate-in').addEventListener('change', e => { S.rateIn = Number(e.target.value) || 0; saveSettings(); });
$('#set-rate-out').addEventListener('change', e => { S.rateOut = Number(e.target.value) || 0; saveSettings(); });
$('#set-theme').addEventListener('change', e => { S.theme = e.target.value; saveSettings(); applyTheme(); });
function applyTheme() { const r = document.documentElement; if (S.theme === 'light' || S.theme === 'dark') r.dataset.theme = S.theme; else delete r.dataset.theme; }

/* ---------- Próbka ---------- */
const SAMPLE = {
  title: 'Próbka: Teología de los sexos (A. von Speyr)', lang: 'es', ctx: 'tekst teologiczny (Adrienne von Speyr), terminologia katolicka',
  items: [
    ['SEXO, IGLESIA, DIOS', 'PŁEĆ, KOŚCIÓŁ, BÓG', 0, 1],
    ['FUNDAMENTO TRINITARIO', 'FUNDAMENT TRYNITARNY', 1, 1],
    ['De la Trinidad a la Comunión de los Santos', 'Od Trójcy do Komunii Świętych', 2, 1],
    ['El Padre engendra solo una vez y para siempre: al Hijo.', 'Ojciec rodzi tylko raz i na zawsze: Syna.', 3, 0],
    ['Ni el Espíritu Santo ni la creación son «engendrados».', 'Ani Duch Święty, ani stworzenie nie są „zrodzeni”.', 3, 0],
    ['Y Cristo no engendra sino a la Iglesia, donándose eucarísticamente a ella una vez para siempre, con todo lo que Él es y tiene.', 'A Chrystus nie rodzi nikogo prócz Kościoła, oddając mu się eucharystycznie raz na zawsze, ze wszystkim, czym jest i co ma.', 3, 0],
    ['La creación del Padre acontece sin que las creaturas sean interrogadas.', 'Stworzenie przez Ojca dokonuje się bez pytania stworzeń o zgodę.', 3, 0],
    ['La eucaristía del Hijo, sin embargo, puede recibirla solo quien cree y consiente.', 'Eucharystię Syna może jednak przyjąć tylko ten, kto wierzy i się zgadza.', 3, 0],
    ['La eucaristía se procura a sí misma una respuesta.', 'Eucharystia sama sobie wyjednuje odpowiedź.', 3, 0],
    ['El Señor quiere recibir en el sacramento su propio sí confirmado.', 'Pan chce w sakramencie otrzymać potwierdzenie swojego własnego „tak”.', 3, 0],
    ['Ciertamente, la Iglesia es creada originariamente por el Hijo sin ser interrogada, pero, tan pronto existe, ella debe decir sí a su relación con el Señor.', 'Wprawdzie Kościół zostaje pierwotnie stworzony przez Syna bez pytania go o zgodę, ale gdy tylko istnieje, musi powiedzieć „tak” swojej relacji z Panem.', 3, 0],
    ['Y muy cerca del sí de la Iglesia a la entrega del Señor a ella está la vida de los consejos evangélicos: como abandono libre y voluntario al Señor que se abandona.', 'A bardzo blisko owego „tak” Kościoła wobec oddania się mu Pana stoi życie radami ewangelicznymi: jako wolne i dobrowolne zdanie się na Pana, który sam się oddaje.', 3, 0],
    ['En el origen paterno, no se le «pregunta» al Hijo, que eternamente procede del Padre, si quiere ser engendrado.', 'U ojcowskiego źródła Syn, który odwiecznie pochodzi od Ojca, nie jest „pytany”, czy chce być zrodzony.', 4, 0],
    ['Sin embargo, como Hijo generado, Él es desde toda la eternidad también el que responde al Padre.', 'Jednak jako Syn zrodzony jest On od całej wieczności także tym, który odpowiada Ojcu.', 4, 0],
    ['Y, en su sí y en las repercusiones infinitas de su sí, se sigue generando el eterno engendrar del Padre.', 'I w Jego „tak”, i w nieskończonych następstwach tego „tak”, wciąż rodzi się odwieczne rodzenie Ojca.', 4, 0],
    ['Y dado que el Hijo dice sí eternamente a la voluntad del Padre, dado que es y está eternamente en la obediencia al Padre, por eso el Padre se dirige al Hijo con la pregunta o solicitud acerca de los engendramientos que proceden de la generación eterna.', 'A ponieważ Syn odwiecznie mówi „tak” woli Ojca, ponieważ odwiecznie jest i trwa w posłuszeństwie Ojcu, dlatego Ojciec zwraca się do Syna z pytaniem czy prośbą o te zrodzenia, które wypływają z odwiecznego rodzenia.', 4, 0],
    ['El Espíritu Santo es quien provoca esta «pregunta».', 'To Duch Święty wywołuje owo „pytanie”.', 4, 0],
    ['Él es el testigo eterno, Él debe, por tanto, poder dar testimonio del eterno acuerdo del Padre y del Hijo.', 'On jest wiecznym świadkiem, musi więc móc dawać świadectwo o odwiecznej zgodzie Ojca i Syna.', 4, 0],
    ['En esta «pregunta» se encuentra el testimonio claro de que el Padre y el Hijo poseen una misma voluntad.', 'W tym „pytaniu” zawiera się jasne świadectwo, że Ojciec i Syn mają jedną i tę samą wolę.', 4, 0],
    ['Mientras el Hijo es generado por el Padre, el Espíritu procede de ambos.', 'Podczas gdy Syn jest rodzony przez Ojca, Duch pochodzi od obu.', 5, 0],
    ['No posteriormente.', 'Nie później.', 5, 0],
    ['Así como en un acto de amor conyugal puro no solo surge un niño, sino que, más allá de ello, surge algo espiritual para la familia, para la Iglesia, quizá conversiones, vocaciones, etc.', 'Tak jak w czystym akcie miłości małżeńskiej nie tylko powstaje dziecko, lecz ponadto rodzi się coś duchowego dla rodziny, dla Kościoła, może nawrócenia, powołania itd.', 5, 0],
    ['En la procesión del Espíritu se demuestra la fecundidad divina pura y simple.', 'W pochodzeniu Ducha ukazuje się Boża płodność po prostu.', 5, 0],
    ['Y la fecundidad espiritual de un matrimonio puro en el seno de la Iglesia tiene lugar en el plano de la Trinidad de Dios: en el amor auténtico, el ser-dos siempre es hecho volar por el aire en el «sin más» del amor.', 'A duchowa płodność czystego małżeństwa w łonie Kościoła dokonuje się na płaszczyźnie Trójcy Bożej: w prawdziwej miłości bycie-we-dwoje zostaje zawsze rozsadzone przez owo „po prostu” miłości.', 5, 0],
    ['También la desnudez de uno en favor del otro de los cónyuges descubre su amor mutuo a toda la Comunión de los Santos en el cielo: ante el amor «sin qué ni por qué» ellos no tienen nada que esconder, el misterio de su amor mutuo entra en el misterio del amor gratuito.', 'Także nagość jednego z małżonków wobec drugiego odsłania ich wzajemną miłość przed całą Komunią Świętych w niebie: wobec miłości „bez pytania o co i dlaczego” nie mają oni nic do ukrycia, tajemnica ich wzajemnej miłości wchodzi w tajemnicę miłości darmowej.', 5, 0],
    ['El amor conyugal debería tender hacia esa pureza, la cual participa del sí de la Iglesia y del sí de los votos.', 'Miłość małżeńska powinna dążyć ku tej czystości, która ma udział w „tak” Kościoła i w „tak” ślubów.', 5, 0],
    ['Ciertamente, los esposos (o los amigos), aun siendo dos, pueden recibir una gran alegría y, considerada humanamente, esta dicha puede tener un cierto carácter concluyente.', 'Wprawdzie małżonkowie (albo przyjaciele), choć jest ich dwoje, mogą otrzymać wielką radość, a po ludzku biorąc, to szczęście może mieć pewien charakter ostateczny.', 5, 0],
    ['Pero en Dios ellos no son meramente dos mitades que se complementan y se redondean recíprocamente.', 'Ale w Bogu nie są oni jedynie dwiema połówkami, które wzajemnie się uzupełniają i dopełniają.', 5, 0],
    ['Ellos constituyen juntos un espacio en el que Dios se vierte.', 'Razem tworzą przestrzeń, w którą wlewa się Bóg.', 5, 0],
    ['Su amor humano queda expuesto al amor de Dios, abierto a Él.', 'Ich ludzka miłość zostaje wystawiona na miłość Boga, otwarta na Niego.', 5, 0],
    ['Trinidad y generación', 'Trójca i rodzenie', 6, 1],
    ['La espera puede coincidir con el cumplimiento.', 'Oczekiwanie może zbiegać się ze spełnieniem.', 7, 0],
  ]
};
async function seedSample() {
  try {
    if (localStorage.getItem('lektor.seeded')) return;
    const projects = await listProjects();
    if (projects.length) { localStorage.setItem('lektor.seeded', '1'); return; }
    const sentences = SAMPLE.items.map(([s, t, p, h]) => ({ s, t, p, h }));
    await createProject({ title: SAMPLE.title, lang: SAMPLE.lang, ctx: SAMPLE.ctx, sentences });
    localStorage.setItem('lektor.seeded', '1');
  } catch (e) { console.warn('seed', e); }
}

/* ---------- Start ---------- */
async function init() {
  applyTheme(); applyFont();
  await seedSample();
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.addEventListener('beforeunload', e => {
    const running = [...JOBS.values()].some(j => j.state === 'running');
    if (running) { e.preventDefault(); e.returnValue = ''; }
  });
}
init();
