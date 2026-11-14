const SUBJECTS = [
  {id:'all', name:'Все предметы'},
  {id:'vocab', name:'Лексика / словарь'},
  {id:'math', name:'Математика (1–6 кл.)'},
  {id:'algebra', name:'Алгебра'},
  {id:'geometry', name:'Геометрия'},
  {id:'physics', name:'Физика'},
  {id:'chemistry', name:'Химия'},
  {id:'biology', name:'Биология / Табииёт'},
  {id:'history_uz', name:'История Узбекистана'},
  {id:'world_history', name:'Всемирная история'},
  {id:'geography', name:'География'},
  {id:'literature', name:'Литература / Адабиёт'},
  {id:'uzbek_lang', name:'Oʻzbek tili'},
  {id:'russian', name:'Русский язык'},
  {id:'english', name:'English'},
  {id:'informatics', name:'Информатика'},
  {id:'other', name:'Другое'}
];

const LANGS = [
  {id:'uz', name:"Oʻzbekcha"},
  {id:'ru', name:'Русский'},
  {id:'en', name:'English'}
];

const STOP_RAW = ('и в на с по для не что это как а но или из к о от до за при про так же бы ли уже только ещё еще его её их мы вы они он она оно я ты этот эта эти тот та те весь вся все быть был была было есть будет можно нужно также если когда чтобы который которая которые the a an of to in is are was were be been being have has had do does did will would could should may might must can this that these those i you he she it we they what which who when where why how not no or and but if then than so for with from by at on as about into over after before its their our your va bilan uchun bu shu ham yoki lekin agar qachon nima qanday kim qayerda nega ning ga da dan ni hamda esa edi ekan bor yoq men sen u biz siz ular yana faqat juda kop oz har barcha endi unda shunday').split(/\s+/);

const CYR = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'j',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'x',ц:'ts',ч:'ch',ш:'sh',щ:'sh',ъ:'',ь:'',э:'e',ю:'yu',я:'ya',ў:'o',ғ:'g',қ:'q',ҳ:'h',ы:'i'};
const DB_NAME = 'uzb9ai_v2';
let dbp = null, deferredPrompt = null, cardOffset = 0, dictOffset = 0;
const CARD_PAGE = 16, DICT_PAGE = 20;
let lastCardItems = [], lastDictItems = [];

function $(id){ return document.getElementById(id); }
function showLoad(on, text){
  const el = $('overlay');
  el.textContent = text || 'Обработка…';
  el.classList.toggle('on', !!on);
}
function subName(id){ return (SUBJECTS.find(s=>s.id===id)||{}).name || id; }
function langName(id){ return (LANGS.find(s=>s.id===id)||{}).name || id; }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function fold(s){
  s = String(s||'').toLowerCase();
  s = s.replace(/[ʻʼ'`´‘’]/g, "'");
  s = s.replace(/[oў]'+/g, 'o').replace(/[gғ]'+/g, 'g');
  s = s.replace(/ў/g,'o').replace(/ғ/g,'g').replace(/қ/g,'q').replace(/ҳ/g,'h');
  let out = '';
  for (const ch of s) out += CYR[ch] !== undefined ? CYR[ch] : ch;
  return out.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOP = new Set();
STOP_RAW.forEach(w => { STOP.add(w); STOP.add(fold(w)); });

function stemRu(w){ return w.replace(/(ami|yami|yah|ah|ov|ev|ey|oy|iy|yy|aya|oe|ye|ie|am|yam|om|em|i|y|a|o|u|e)$/,''); }
function stemUz(w){
  if (w.length < 5) return w;
  const suf = ['larning','laridan','lariga','larini','larida','larni','larga','lardan','larda','lari','lar','ning','niki','moqchi','moqda','yotgan','ganlar','moq','ydi','edi','dir','gan','kan','qan','ish','ush','dan','cha','dek','day','miz','ngiz','ga','da','ni'];
  for (const x of suf) if (w.endsWith(x) && w.length - x.length >= 3) return w.slice(0, -x.length);
  return w;
}
function stemEn(w){
  if (w.length < 5) return w;
  if (w.endsWith('ational') && w.length>9) return w.slice(0,-7)+'ate';
  if (w.endsWith('tion') && w.length>6) return w.slice(0,-3);
  if (w.endsWith('ness') && w.length>6) return w.slice(0,-4);
  if (w.endsWith('ment') && w.length>6) return w.slice(0,-4);
  if (w.endsWith('able') && w.length>6) return w.slice(0,-4);
  if (w.endsWith('ful') && w.length>6) return w.slice(0,-3);
  if (w.endsWith('ous') && w.length>6) return w.slice(0,-3);
  if (w.endsWith('ing') && w.length>6) return w.slice(0,-3);
  if (w.endsWith('ied')) return w.slice(0,-3)+'y';
  if (w.endsWith('ies') && w.length>5) return w.slice(0,-3)+'y';
  if (w.endsWith('ed') && w.length>5) return w.slice(0,-2);
  if (w.endsWith('ly') && w.length>5) return w.slice(0,-2);
  if (w.endsWith('es') && w.length>5) return w.slice(0,-2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length>4) return w.slice(0,-1);
  return w;
}
function variants(w){
  const f = fold(w);
  const set = new Set([w, f, stemRu(f), stemUz(f), stemEn(f)]);
  if (f.length >= 5) set.add(f.slice(0, Math.max(4, f.length-2)));
  return [...set].filter(x => x && x.length > 1);
}
function tokenList(text){
  return fold(text).split(/\s+/).filter(w => (w.length > 1 && !STOP.has(w)) || /^\d+$/.test(w));
}
function tokenSet(text){
  const set = new Set();
  tokenList(text).forEach(w => variants(w).forEach(v => set.add(v)));
  return set;
}
function startsMatch(a, b){
  if (!a || !b) return false;
  const x = a.length >= b.length ? a : b;
  const y = a.length >= b.length ? b : a;
  return y.length >= 4 && x.startsWith(y);
}

function fillSelects(){
  const subOpts = SUBJECTS.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  const subNoAll = SUBJECTS.filter(s=>s.id!=='all').map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  const langOpts = LANGS.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  $('subject').innerHTML = subNoAll;
  $('filterSubject').innerHTML = subOpts;
  $('chatSubject').innerHTML = subOpts;
  $('cardSubject').innerHTML = subOpts;
  $('dictSubject').innerHTML = subNoAll;
  $('dictSubject').value = 'vocab';
  $('dictLang').innerHTML = langOpts;
  $('dictFilterLang').innerHTML = `<option value="all">Все языки</option>` + langOpts;
  $('dictFilterSubject').innerHTML = subOpts;
}

function openDB(){
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('books')) {
        const os = db.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
        os.createIndex('subject', 'subject');
      }
      if (!db.objectStoreNames.contains('dicts')) {
        const os = db.createObjectStore('dicts', { keyPath: 'id', autoIncrement: true });
        os.createIndex('lang', 'lang');
        os.createIndex('wordNorm', 'wordNorm');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function storeGetAll(name, fbKey){
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const q = db.transaction(name,'readonly').objectStore(name).getAll();
      q.onsuccess = () => resolve(q.result || []);
      q.onerror = () => reject(q.error);
    });
  } catch(e) { return JSON.parse(localStorage.getItem(fbKey) || '[]'); }
}
async function storeAdd(name, obj, fbKey){
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const q = db.transaction(name,'readwrite').objectStore(name).add(obj);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  } catch(e) {
    const all = JSON.parse(localStorage.getItem(fbKey) || '[]');
    obj.id = Date.now() + Math.random();
    all.push(obj);
    localStorage.setItem(fbKey, JSON.stringify(all));
  }
}
async function storeDelete(name, id, fbKey){
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const q = db.transaction(name,'readwrite').objectStore(name).delete(Number(id) || id);
      q.onsuccess = resolve; q.onerror = reject;
    });
  } catch(e) {
    const all = JSON.parse(localStorage.getItem(fbKey) || '[]').filter(b => b.id != id);
    localStorage.setItem(fbKey, JSON.stringify(all));
  }
}
async function storeImport(name, list, merge, fbKey, mapFn){
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(name,'readwrite');
      const os = tx.objectStore(name);
      if (!merge) os.clear();
      list.forEach(b => os.add(mapFn(b)));
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } catch(e) {
    let all = merge ? JSON.parse(localStorage.getItem(fbKey) || '[]') : [];
    list.forEach(b => all.push({ id: Date.now()+Math.random(), ...mapFn(b) }));
    localStorage.setItem(fbKey, JSON.stringify(all));
  }
}

const getBooks = () => storeGetAll('books', 'uzb9books_fb');
const getDicts = () => storeGetAll('dicts', 'uzb9dicts_fb');
const saveBook = b => storeAdd('books', b, 'uzb9books_fb');
const saveDict = d => storeAdd('dicts', d, 'uzb9dicts_fb');

async function deleteBook(id){
  if (!confirm('Удалить учебник?')) return;
  await storeDelete('books', id, 'uzb9books_fb');
  renderBooks(); fillCardBooks();
}
async function deleteDict(id){
  if (!confirm('Удалить словарную статью?')) return;
  await storeDelete('dicts', id, 'uzb9dicts_fb');
  renderDicts(true);
}

/* === РАЗБИВКА НА КАРТОЧКИ С СОХРАНЕНИЕМ АБЗАЦЕВ И ТАБЛИЦ === */
function splitIntoCards(content){
  const raw = (content||'').replace(/\r\n/g,'\n').trim();
  if (!raw) return [];
  let blocks = raw.split(/(?=\n\s*(?:§+|параграф|глава|bob|mavzu|mavzusi|unit|chapter|paragraph)\s*[\d.IVXLCivxlc]+)/i);
  if (blocks.length < 3) blocks = raw.split(/\n\s*\n+/);
  const out = [];
  for (let b of blocks) {
    // Убираем лишние пробелы, но сохраняем переносы строк \n для таблиц и списков
    b = b.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (b.length < 40) continue;
    if (b.length > 1200) {
      const parts = b.split(/(?<=[.!?])\s+(?=[А-ЯA-Z0-9§\[])/);
      let buf = '';
      for (const s of parts) {
        const isTableLine = s.includes('|') && buf.includes('|');
        if (!isTableLine && (buf + ' ' + s).length > 950 && buf.length > 120) {
          out.push(buf.trim());
          buf = s;
        } else {
          buf += (buf ? ' ' : '') + s;
        }
      }
      if (buf.trim().length > 40) out.push(buf.trim());
    } else {
      out.push(b);
    }
  }
  return out;
}

function cardTitle(text){
  const clean = (text||'')
    .replace(/^\s*---+\s*/gm, '')
    .replace(/\[\s*(?:Рисунок|Рис\.|Rasm|Таблица|Chizma)[^\]]*\]/gi, '')
    .trim();
  // Если начинается с §, берём номер параграфа и заголовок темы (включая формулу)
  const m = clean.match(/^((?:§+\s*[\d.]+|параграф\s*[\d.]+|глава\s*[\d.]+|bob\s*[\d.]+|mavzu\s*[\d.]+|unit\s*[\d.]+|chapter\s*[\d.]+)\s*(?:[А-ЯA-ZЁЎҚҒҲ0-9$:+=^_\-\s]{2,55})?)/i);
  if (m) {
    // Отсекаем случайное первое слово следующего предложения с маленькой буквы
    const titlePart = m[1].replace(/\s+[А-ЯЁA-Z][а-яёa-z]+$/, '').trim();
    return titlePart.slice(0, 85);
  }
  const firstLine = clean.split(/\n+/)[0].trim();
  const firstSent = firstLine.split(/(?<=[.!?])\s+/)[0];
  return firstSent.slice(0, 75) + (firstSent.length > 75 ? '…' : '');
}

function scoreText(query, text, extra){
  const qn = fold(query), cn = fold(text);
  const qw = tokenList(query);
  const cset = tokenSet(text);
  if (!qw.length) return cn.includes(qn) ? 1 : 0;
  let score = 0, hits = 0;
  qw.forEach(w => {
    const vs = variants(w);
    let ok = vs.some(v => cset.has(v));
    if (!ok) ok = [...cset].some(t => startsMatch(t, w) || vs.some(v => startsMatch(t, v)));
    if (ok) { score += 3; hits++; }
    if (cn.includes(w)) score += 1;
  });
  if (qn.length > 5 && cn.includes(qn.slice(0, 48))) score += 10;
  if (extra && extra.exactWord && fold(extra.exactWord) === qn) score += 14;
  if (hits === 0 && score < 2) return 0;
  score *= (0.35 + hits / qw.length);
  return score;
}

function scoreChunk(query, chunk, book){
  let s = scoreText(query, chunk, {});
  const qn = fold(query);
  if (/(что такое|nima|what is|mean|формул|определен|называет|теорем|defin)/.test(qn) && /(this is|is a|это |называет|формул|=|demak|hisoblanadi)/.test(fold(chunk))) s += 6;
  if (book.subject && qn.includes(fold(subName(book.subject)).split(' ')[0])) s += 2;
  s *= 120 / (80 + Math.log((chunk||'').length + 1) * 10);
  return s;
}

async function searchBooks(query, subject){
  const books = await getBooks();
  const pool = subject && subject !== 'all' ? books.filter(b => b.subject === subject) : books;
  const scored = [];
  pool.forEach(book => {
    splitIntoCards(book.content).forEach(ch => {
      const s = scoreChunk(query, ch, book);
      if (s > 0.35) scored.push({ score:s, text: ch.slice(0, 850), book: book.name, subject: book.subject });
    });
  });
  scored.sort((a,b)=>b.score-a.score);
  const seen = new Set(), uniq = [];
  for (const x of scored) {
    const key = x.text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key); uniq.push(x);
    if (uniq.length >= 4) break;
  }
  return { hits: uniq, totalBooks: pool.length, allBooks: books.length };
}

async function searchDicts(query, subject){
  const dicts = await getDicts();
  const qn = fold(query);
  const short = tokenList(query).length <= 4;
  const scored = [];
  dicts.forEach(d => {
    const blob = [d.word, d.translation, d.definition, d.example].join(' ');
    let s = scoreText(query, blob, { exactWord: d.word });
    if (fold(d.word) === qn) s += 16;
    if (fold(d.translation).split(' ').includes(qn)) s += 10;
    if (d.subject === subject) s += 3;
    if (!short) s *= 0.85;
    if (s > 0.8) scored.push({ score:s, d });
  });
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0, 5).map(x => x.d);
}

function formatDict(d){
  let t = `📗 ${d.word}  (${langName(d.lang)}`;
  if (d.subject) t += ' · ' + subName(d.subject);
  t += ')\n';
  if (d.translation) t += 'Перевод: ' + d.translation + '\n';
  if (d.definition) t += 'Определение: ' + d.definition + '\n';
  if (d.example) t += 'Пример: ' + d.example + '\n';
  return t.trim();
}

function smartAnswer(query, bookRes, dictHits){
  const looksDict = /(перевод|translate|meaning|what is|nima demak|nima|что значит|что такое|soz|so'z|word)/i.test(query) || tokenList(query).length <= 3;
  if (!bookRes.allBooks && !(dictHits||[]).length) return 'Добавьте учебники или слова во вкладках «Книги» и «Словарь». Я ищу в вашей базе.';
  let out = '';
  if (dictHits && dictHits.length) out += 'Словарь:\n\n' + dictHits.map(formatDict).join('\n\n') + '\n\n';
  if (!bookRes.hits.length) {
    if (out) return out + 'В учебниках близких фрагментов нет.';
    return 'В выбранных материалах не нашлось.\nПопробуйте другой язык запроса (uz/ru/en), «Все предметы» или включите ✨ Учитель Gemini.';
  }
  out += (looksDict && dictHits && dictHits.length) ? 'Из учебников (дополнительно):\n\n' : 'По учебникам:\n\n';
  const by = {};
  bookRes.hits.forEach(h => {
    const k = h.book + ' · ' + subName(h.subject);
    if (!by[k]) by[k] = [];
    by[k].push(h.text);
  });
  Object.keys(by).forEach(k => {
    out += '📘 ' + k + '\n';
    by[k].forEach(t => { out += t + (t.length>=850?'…':'') + '\n\n'; });
  });
  const first = bookRes.hits[0].text;
  const brief = first.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  out += 'Кратко: ' + brief + (brief.length < first.length ? '…' : '');
  out += '\n\nЭто выдержки из вашей базы.';
  return out;
}

/* === КРАСИВОЕ ОФОРМЛЕНИЕ ФОРМУЛ, ТАБЛИЦ, ПРАВИЛ И РИСУНКОВ === */
(function injectMathStyles(){
  const old = document.getElementById('schoolMathStyles');
  if (old) old.remove();
  const st = document.createElement('style');
  st.id = 'schoolMathStyles';
  st.textContent = `
    .msg, .pcard .body, .pcard .ttl, .dcard { line-height: 1.6; }
    .pcard .body { white-space: normal; }
    .msg sup, .pcard sup, .dcard sup { font-size: 0.72em; vertical-align: super; line-height: 0; font-weight: 700; }
    .msg sub, .pcard sub, .dcard sub { font-size: 0.72em; vertical-align: sub; line-height: 0; font-weight: 700; }
    .ai-h { font-weight: 800; color: var(--green); font-size: 1.04em; margin: 8px 0 4px; }
    .ai-hr { border: 0; border-top: 1px dashed var(--line); margin: 8px 0; }
    .math-block {
      background: var(--card); border-left: 3px solid var(--green);
      padding: 8px 12px; margin: 8px 0; border-radius: 8px;
      font-weight: 700; overflow-x: auto; text-align: center;
    }
    .math-inline {
      font-family: 'Cambria Math', 'Times New Roman', serif;
      font-weight: 700; font-size: 1.04em; padding: 0 2px; white-space: nowrap;
    }
    .rule-box {
      background: rgba(46, 125, 50, 0.12);
      border-left: 4px solid var(--green);
      padding: 8px 12px; margin: 8px 0; border-radius: 8px;
      font-weight: 500;
    }
    .fig-badge {
      display: inline-block; background: var(--card); border: 1px solid var(--line);
      padding: 4px 10px; margin: 6px 0; border-radius: 8px; font-size: 0.88em; opacity: 0.9;
    }
    .table-wrap { overflow-x: auto; margin: 8px 0; }
    .school-table {
      border-collapse: collapse; width: 100%; font-size: 0.92em;
      background: var(--card); border-radius: 8px; overflow: hidden;
    }
    .school-table th, .school-table td {
      border: 1px solid var(--line); padding: 5px 8px; text-align: center;
    }
    .school-table tr:first-child { background: rgba(46, 125, 50, 0.15); font-weight: 700; }
    .step-item { margin-top: 5px; }
    .msg code, .pcard code { background: var(--card); padding: 1px 5px; border-radius: 5px; font-size: 0.9em; }
  `;
  document.head.appendChild(st);
})();

function convertLatexMath(s){
  return s
    // Дроби и корни
    .replace(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\[([^{}\]]+)\]\{([^{}]+)\}/g, '<sup>$1</sup>√($2)')
    .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
    .replace(/\\sqrt\s*([a-zA-Z0-9]+)/g, '√$1')
    // Стрелки и логика
    .replace(/\\(?:implies|Rightarrow|Longrightarrow)/g, ' ⇒ ')
    .replace(/\\(?:iff|Leftrightarrow|Longleftrightarrow)/g, ' ⇔ ')
    .replace(/\\(?:rightarrows|rightleftarrows|leftrightarrow)/g, ' ⇄ ')
    .replace(/\\(?:to|rightarrow|longrightarrow)/g, ' → ')
    .replace(/\\uparrow/g, '↑').replace(/\\downarrow/g, '↓')
    // Знаки сравнения и множества
    .replace(/\\infty/g, '∞')
    .replace(/\\(?:le|leq|leqslant)/g, ' ≤ ')
    .replace(/\\(?:ge|geq|geqslant)/g, ' ≥ ')
    .replace(/\\(?:ne|neq)/g, ' ≠ ')
    .replace(/\\approx/g, ' ≈ ')
    .replace(/\\pm/g, ' ± ')
    .replace(/\\cdot/g, '·')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\notin/g, ' ∉ ').replace(/\\in\b/g, ' ∈ ')
    .replace(/\\cup/g, ' ∪ ').replace(/\\cap/g, ' ∩ ')
    .replace(/\\(?:emptyset|varnothing)/g, '∅')
    // Геометрия и греческие буквы
    .replace(/\\triangle/g, '△').replace(/\\angle/g, '∠')
    .replace(/\\perp/g, '⊥').replace(/\\parallel/g, '∥')
    .replace(/\^\\circ|\\circ/g, '°')
    .replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β').replace(/\\gamma/g, 'γ')
    .replace(/\\Delta/g, 'Δ').replace(/\\delta/g, 'δ')
    .replace(/\\pi\b/g, 'π').replace(/\\rho/g, 'ρ').replace(/\\lambda/g, 'λ')
    .replace(/\\mu/g, 'μ').replace(/\\Omega/g, 'Ω').replace(/\\omega/g, 'ω')
    .replace(/\\(?:phi|varphi)/g, 'φ')
    // Очистка служебных тегов и отступов LaTeX (\quad, \qquad и т.д.)
    .replace(/\\(?:text|mathrm|mathbf|mathit)\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:left|right)([()[\]|])/g, '$1')
    .replace(/\\(?:quad|qquad)/g, '   ')
    .replace(/\\[,;!]/g, ' ');
}

function renderMarkdownTables(s){
  // 1. Отделяем начало таблицы от текста после двоеточия или точки
  s = s.replace(/([:.])\s+(\|[^\n]+\|)/g, '$1\n$2');
  // 2. Разделяем склеенные в одну строку ряды таблицы "| |"
  s = s.replace(/\|\s+\|(?=\s*(?::?-+:?|\$|[a-zA-Zа-яА-Я0-9\-]))/g, '|\n|');
  // 3. Отделяем обычный текст после последней ячейки таблицы
  s = s.replace(/^(\s*\|(?:[^|\n]+\|)+)\s+([^|\n]+)$/gm, '$1\n$2');

  return s.replace(/((?:^\s*\|[^\n]+\|\s*(?:\n|$)){2,})/gm, block => {
    const rows = block.trim().split('\n').map(r => r.trim()).filter(Boolean);
    const htmlRows = [];
    for (const r of rows) {
      const cells = r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
      htmlRows.push('<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>');
    }
    if (!htmlRows.length) return block;
    return `<div class="table-wrap"><table class="school-table">${htmlRows.join('')}</table></div>`;
  });
}

function formatSchoolText(raw){
  let s = escapeHtml(raw || '');

  // 1. Убираем висячие "---" в конце карточек
  s = s.replace(/\s*---+\s*$/gm, '');

  // 2. Переводим команды LaTeX в красивые символы
  s = convertLatexMath(s);
  s = convertLatexMath(s);

  // 3. Собираем таблицы из "| x | -4 | -3 |..."
  s = renderMarkdownTables(s);

  // 4. Блочные формулы $$...$$ и \[...\]
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => `<div class="math-block">${m.trim()}</div>`);
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `<div class="math-block">${m.trim()}</div>`);

  // 5. Строчные формулы $...$ и \(...\)
  s = s.replace(/\$([^\n$]+?)\$/g, (_, m) => `<span class="math-inline">${m.replace(/-/g, '−').trim()}</span>`);
  s = s.replace(/\\\(([^\n]+?)\\\)/g, (_, m) => `<span class="math-inline">${m.replace(/-/g, '−').trim()}</span>`);

  // 6. Верхние и нижние индексы: x^{2}, x^2, x_{1}, x_1, 10^{-5}
  s = s.replace(/\^\{([^{}\n]+)\}/g, '<sup>$1</sup>');
  s = s.replace(/_\{([^{}\n]+)\}/g, '<sub>$1</sub>');
  s = s.replace(/\^([+\-]?\d+|[a-zA-Z])/g, '<sup>$1</sup>');
  s = s.replace(/([a-zA-Zа-яА-Я0-9)])_(\d+|[a-zA-Z])/g, '$1<sub>$2</sub>');

  // 7. Химические формулы (H2O, H2SO4, CO2, Ca(OH)2, Fe2O3, C6H12O6)
  s = s.replace(/\b((?:[A-Z][a-z]?|\([A-Za-z0-9]+\))\d+)+([A-Z][a-z]?)?\b/g, match =>
    match.replace(/([A-Z][a-z]?|\))(\d+)/g, '$1<sub>$2</sub>')
  );

  // 8. Римские цифры для веков по истории (xiv век -> XIV век)
  s = s.replace(/\b([ivxlcdm]{1,7})(\s*(?:[–\-]\s*[ivxlcdm]{1,7})?\s*(?:в\.|вв\.|век|asr|century))/gi,
    (_, rom, tail) => rom.toUpperCase() + tail
  );

  // 9. Подписи к рисункам [Рисунок 1: ...] и определения в [квадратных скобках]
  s = s.replace(/\[\s*((?:Рисунок|Рис\.|Rasm|Таблица|Chizma)[^\]]*)\]/gi, '<div class="fig-badge">🖼️ $1</div>');
  s = s.replace(/\[([^\[\]]{20,})\]/g, '<div class="rule-box">📌 $1</div>');

  // 10. Пункты списков 1) 2) 3) с новой строки
  s = s.replace(/([.!?])\s+(\d+\)\s+)/g, '$1<div class="step-item"><b>$2</b></div>');

  // 11. Markdown: заголовки, линии, жирный, курсив, код, переносы строк
  s = s.replace(/^\s*---+\s*$/gm, '<hr class="ai-hr">');
  s = s.replace(/^#{1,4}\s+(.+)$/gm, '<div class="ai-h">$1</div>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\n/g, '<br>');

  return s;
}

function addMsg(role, text){
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.innerHTML = formatSchoolText(text);
  $('messages').appendChild(d);
  $('messages').scrollTop = 1e9;
}

/* === GEMINI API: АВТОВЫБОР МОДЕЛИ + ФОТО ЗАДАЧ И СКАН СТРАНИЦ === */
const DEFAULT_MODELS = [
  'gemini-3.0-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-latest'
];

let pendingChatImage = null;

function setupPhotoUI(){
  const chatbar = document.querySelector('.chatbar');
  if (chatbar && !$('chatPhotoBtn')) {
    const prev = document.createElement('div');
    prev.id = 'chatPhotoPreview';
    prev.style.cssText = 'display:none;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);padding:6px 10px;border-radius:10px;margin-bottom:6px;font-size:0.85rem;';
    chatbar.parentNode.insertBefore(prev, chatbar);

    const inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'chatPhotoInput';
    inp.accept = 'image/*';
    inp.hidden = true;
    inp.onchange = e => e.target.files[0] && attachChatPhoto(e.target.files[0]);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'chatPhotoBtn';
    btn.className = 'ghost icon';
    btn.title = 'Сфотографировать задачу или страницу';
    btn.textContent = '📷';
    btn.onclick = () => inp.click();

    chatbar.insertBefore(btn, chatbar.firstChild);
    chatbar.appendChild(inp);
  }

  const bookContent = $('bookContent');
  if (bookContent && !$('ocrPhotoBtn')) {
    const wrap = document.createElement('div');
    wrap.className = 'row';
    wrap.style.marginTop = '6px';

    const ocrInp = document.createElement('input');
    ocrInp.type = 'file';
    ocrInp.id = 'ocrPhotoInput';
    ocrInp.accept = 'image/*';
    ocrInp.multiple = true;
    ocrInp.hidden = true;
    ocrInp.onchange = e => ocrPagesToBook(e.target.files);

    const ocrBtn = document.createElement('button');
    ocrBtn.type = 'button';
    ocrBtn.id = 'ocrPhotoBtn';
    ocrBtn.className = 'ghost';
    ocrBtn.textContent = '📷 Скан страниц с фото (через Gemini)';
    ocrBtn.onclick = () => ocrInp.click();

    wrap.appendChild(ocrBtn);
    wrap.appendChild(ocrInp);
    bookContent.parentNode.insertBefore(wrap, bookContent.nextSibling);
  }
}

function compressImageFile(file, maxSide = 1400, quality = 0.82){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать фото'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Повреждённое изображение'));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSide || h > maxSide) {
          if (w > h) { h = Math.round(h * maxSide / w); w = maxSide; }
          else { w = Math.round(w * maxSide / h); h = maxSide; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({
          base64: dataUrl.split(',')[1],
          mimeType: 'image/jpeg',
          dataUrl,
          name: file.name || 'photo.jpg'
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function attachChatPhoto(file){
  try {
    showLoad(true, 'Обрабатываю фото…');
    pendingChatImage = await compressImageFile(file);
    const prev = $('chatPhotoPreview');
    if (prev) {
      prev.style.display = 'flex';
      prev.innerHTML = `
        <img src="${pendingChatImage.dataUrl}" style="height:44px;width:44px;object-fit:cover;border-radius:6px">
        <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📷 Фото прикреплено (нажмите ➤ или допишите вопрос)</div>
        <button type="button" class="danger" style="padding:4px 8px;font-size:12px" onclick="clearChatPhoto()">×</button>
      `;
    }
    $('userInput').focus();
  } catch(e) {
    alert(e.message || e);
  }
  showLoad(false);
  if ($('chatPhotoInput')) $('chatPhotoInput').value = '';
}

function clearChatPhoto(){
  pendingChatImage = null;
  const prev = $('chatPhotoPreview');
  if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; }
}

async function ocrPagesToBook(fileList){
  const files = [...(fileList || [])];
  if (!files.length) return;
  const key = (localStorage.getItem('uzb_gemini_key') || ($('geminiKey') && $('geminiKey').value) || '').trim();
  if (!key) {
    switchTab('chat');
    return alert('Для распознавания текста с фото сначала введите бесплатный ключ Gemini во вкладке «Чат» → Настройки Gemini API.');
  }
  let added = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      showLoad(true, `Распознаю страницу ${i + 1} из ${files.length}…`);
      const img = await compressImageFile(files[i], 1600, 0.85);
      const res = await askGemini(
        'Извлеки ВЕСЬ текст с этого фото страницы учебника без сокращений. Сохраняй заголовки, номера параграфов (§), задачи и формулы. Не пиши вступлений — выведи только распознанный текст страницы.',
        { hits: [] }, [], img
      );
      if (res && res.text) {
        $('bookContent').value += ($('bookContent').value ? '\n\n' : '') + res.text.trim();
        if (!$('bookName').value.trim()) {
          $('bookName').value = files[i].name.replace(/\.[^.]+$/, '');
        }
        added++;
      }
    } catch (e) {
      alert('Ошибка распознавания: ' + (e.message || e));
      break;
    }
  }
  showLoad(false);
  if ($('ocrPhotoInput')) $('ocrPhotoInput').value = '';
  if (added) alert(`Готово! Распознано страниц: ${added}.\nПроверьте текст в поле и нажмите «Добавить».`);
}

function getDeadModels(){
  try { return new Set(JSON.parse(localStorage.getItem('uzb_dead_models') || '[]')); }
  catch(e) { return new Set(); }
}
function markModelDead(m){
  const dead = getDeadModels();
  dead.add(m);
  localStorage.setItem('uzb_dead_models', JSON.stringify([...dead]));
}

function saveGeminiKey(){
  const k = $('geminiKey').value.trim();
  localStorage.setItem('uzb_gemini_key', k);
  localStorage.removeItem('uzb_dead_models');
  localStorage.removeItem('uzb_last_good_model');
  if (k) {
    loadGeminiModels(true);
  } else {
    alert('Ключ удалён.');
  }
}

function getSelectedModel(){
  if (!$('geminiModel')) return 'auto';
  const sel = $('geminiModel').value;
  if (sel === 'custom') {
    return (($('geminiCustomModel') && $('geminiCustomModel').value) || 'auto').trim().replace(/^models\//, '');
  }
  return sel.trim().replace(/^models\//, '');
}

function onModelChange(){
  if (!$('geminiModel')) return;
  const val = $('geminiModel').value;
  localStorage.setItem('uzb_gemini_model', val);
  if ($('geminiCustomModel')) {
    $('geminiCustomModel').style.display = val === 'custom' ? 'block' : 'none';
  }
}

function populateModelSelect(models){
  if (!$('geminiModel')) return;
  const dead = getDeadModels();
  const clean = (models || DEFAULT_MODELS).filter(m => m && !dead.has(m));
  const saved = localStorage.getItem('uzb_gemini_model') || 'auto';
  const lastGood = localStorage.getItem('uzb_last_good_model');

  $('geminiModel').innerHTML =
    `<option value="auto">⚡ Автовыбор рабочей модели${lastGood ? ' (' + escapeHtml(lastGood) + ')' : ''}</option>` +
    clean.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('') +
    `<option value="custom">✍️ Ввести название модели вручную…</option>`;

  if (saved === 'auto' || saved === 'custom' || clean.includes(saved)) {
    $('geminiModel').value = saved;
  } else {
    $('geminiModel').value = 'auto';
  }
  onModelChange();
}

async function fetchModelsFromGoogle(key){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok) return [];
    const models = (data.models || [])
      .filter(m => {
        const name = (m.name || '').toLowerCase();
        const methods = m.supportedGenerationMethods || [];
        if (!methods.includes('generateContent') || !name.includes('gemini')) return false;
        if (/(tts|image|imagen|embedding|aqa|audio|robotics|computer-use|veo|learnlm)/.test(name)) return false;
        return true;
      })
      .map(m => m.name.replace(/^models\//, ''));

    models.sort((a, b) => {
      const rank = s => {
        let r = 0;
        if (s.includes('3.0-flash') || s.includes('3-flash')) r += 100;
        else if (s.includes('2.5-flash-lite')) r += 90;
        else if (s.includes('flash')) r += 70;
        else if (s.includes('pro')) r += 30;
        if (s.includes('exp')) r -= 20;
        return r;
      };
      return rank(b) - rank(a);
    });

    if (models.length) localStorage.setItem('uzb_gemini_model_list', JSON.stringify(models));
    return models;
  } catch(e) {
    clearTimeout(timer);
    return [];
  }
}

async function loadGeminiModels(silent){
  const key = (localStorage.getItem('uzb_gemini_key') || ($('geminiKey') && $('geminiKey').value) || '').trim();
  if (!key) return alert('Сначала введите API-ключ!');
  showLoad(true, 'Ищу доступные модели Google…');
  const models = await fetchModelsFromGoogle(key);
  showLoad(false);
  if (models.length) {
    localStorage.setItem('uzb_gemini_model', 'auto');
    populateModelSelect(models);
    if (!silent) alert('Найдено моделей: ' + models.length + '\nВключён «⚡ Автовыбор рабочей модели».');
  } else if (!silent) {
    alert('Не удалось получить список моделей. Проверьте ключ или интернет.');
  }
}

async function callSingleModel(model, key, systemInstruction, prompt, imageObj){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const userParts = [{ text: prompt }];
    if (imageObj && imageObj.base64) {
      userParts.push({
        inline_data: { mime_type: imageObj.mimeType || 'image/jpeg', data: imageObj.base64 }
      });
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 }
      })
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || null;
  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Превышено время ожидания ответа');
    throw e;
  }
}

async function askGemini(query, bookRes, dictHits, imageObj){
  const key = (localStorage.getItem('uzb_gemini_key') || ($('geminiKey') && $('geminiKey').value) || '').trim();
  if (!key) return null;

  const mode = $('geminiMode') ? $('geminiMode').value : 'tutor';
  const grade = $('studentGrade') ? $('studentGrade').value : 'универсальный (1–11 класс)';

  const ctxBooks = (bookRes.hits || []).map((h, i) =>
    `[Учебник ${i+1}: ${h.book} (${subName(h.subject)})]\n${h.text}`
  ).join('\n\n');
  const ctxDict = (dictHits || []).map(d =>
    `[Словарь: ${d.word} (${langName(d.lang)})] Перевод: ${d.translation}. ${d.definition} Пример: ${d.example}`
  ).join('\n');

  const systemInstruction = mode === 'strict'
    ? `Ты школьный ИИ-помощник для учащихся в Узбекистане (уровень ученика: ${grade}). Отвечай на основе приведённых фрагментов учебников, словаря и прикреплённого фото. Объясняй понятно для возраста ученика (${grade}). Отвечай на языке вопроса (русский, узбекский или английский).`
    : `Ты добрый, понятный и опытный школьный учитель в Узбекистане (программа 1–11 классов). Сейчас тебе задаёт вопрос ученик уровня: ${grade}.
Правила:
1. Если прикреплено фото страницы учебника, тетради или задачи — внимательно прочитай текст и формулы на фото, реши задание по шагам и объясни тему.
2. Опирайся на фрагменты учебников и словаря из базы ученика (если они найдены).
3. Объясняй простыми словами и по шагам, адаптируя сложность под ${grade}.
4. Отвечай на языке вопроса ученика (русский, oʻzbek tili или English).
5. Оформляй формулы читаемо: используй символы ², ³, √, ⇒, ≤, ≥, ≠, ∞, π, индексы в химии (H₂SO₄, CO₂) и верхний регистр для римских цифр веков (XIV век).`;

  const prompt = `Контекст из базы ученика:\n${ctxDict ? ctxDict + '\n\n' : ''}${ctxBooks || 'Точных цитат в загруженных книгах не найдено.'}\n\nВопрос/задание ученика (${grade}): ${query}`;

  const chosen = getSelectedModel();
  const dead = getDeadModels();
  let queue = [];

  if (chosen !== 'auto') {
    queue.push(chosen);
  } else {
    const lastGood = localStorage.getItem('uzb_last_good_model');
    if (lastGood && !dead.has(lastGood)) queue.push(lastGood);

    let cachedList = [];
    try { cachedList = JSON.parse(localStorage.getItem('uzb_gemini_model_list') || '[]'); } catch(e){}
    if (!cachedList.length) cachedList = await fetchModelsFromGoogle(key);

    [...cachedList, ...DEFAULT_MODELS].forEach(m => {
      if (m && !dead.has(m) && !queue.includes(m)) queue.push(m);
    });
  }

  let lastError = 'Не удалось подобрать модель';
  for (let i = 0; i < queue.length; i++) {
    const m = queue[i];
    showLoad(true, imageObj ? `Анализирую фото (${m})…` : `Спрашиваю ${m}…`);
    try {
      const text = await callSingleModel(m, key, systemInstruction, prompt, imageObj);
      if (text) {
        localStorage.setItem('uzb_last_good_model', m);
        populateModelSelect(JSON.parse(localStorage.getItem('uzb_gemini_model_list') || 'null'));
        return { text, model: m };
      }
    } catch (err) {
      const msg = String(err.message || err);
      lastError = `[${m}] ${msg}`;

      const suggested = msg.match(/models\/(gemini-[a-zA-Z0-9.\-_]+)/i);
      if (suggested && suggested[1]) {
        const rec = suggested[1];
        if (!queue.includes(rec)) queue.splice(i + 1, 0, rec);
      }

      if (/no longer available|not found|not supported|404/i.test(msg)) {
        markModelDead(m);
        continue;
      }
      if (/API_KEY_INVALID|key not valid/i.test(msg)) {
        throw new Error('Неверный API-ключ Gemini. Проверьте ключ в настройках.');
      }
    }
  }
  throw new Error(lastError);
}

async function sendMessage(){
  const rawQ = $('userInput').value.trim();
  const imgObj = pendingChatImage;
  if (!rawQ && !imgObj) return;

  const q = rawQ || 'Прочитай задание на фото и разбери решение по шагам (если это страница учебника — кратко объясни тему).';
  $('userInput').value = '';
  clearChatPhoto();

  addMsg('user', rawQ || '📷 Фото задания');
  if (imgObj) {
    const lastUserMsg = $('messages').lastElementChild;
    if (lastUserMsg) {
      lastUserMsg.innerHTML = `<img src="${imgObj.dataUrl}" style="max-width:210px;max-height:210px;border-radius:10px;display:block;margin-bottom:6px;margin-left:auto">` + lastUserMsg.innerHTML;
    }
  }

  showLoad(true, imgObj ? 'Читаю фото…' : 'Ищу в базе и формирую ответ…');
  try {
    const sub = $('chatSubject').value;
    const bookRes = rawQ ? await searchBooks(rawQ, sub) : { hits: [], totalBooks: 0, allBooks: (await getBooks()).length };
    const dictHits = (rawQ && $('useDict').checked) ? await searchDicts(rawQ, sub) : [];

    let answered = false;
    if ((imgObj || ($('useGemini') && $('useGemini').checked)) && navigator.onLine) {
      try {
        const res = await askGemini(q, bookRes, dictHits, imgObj);
        if (res && res.text) {
          const srcNames = [...new Set(bookRes.hits.map(h => h.book))];
          const footer = srcNames.length ? `\n\n📚 Источники из базы: ${srcNames.join(', ')}` : '';
          addMsg('ai', `✨ Учитель (${res.model}):\n\n` + res.text.trim() + footer);
          answered = true;
        }
      } catch (ge) {
        addMsg('ai', '⚠️ Gemini недоступен (' + (ge.message || ge) + ').' + (imgObj ? '' : ' Показываю офлайн-ответ из вашей базы:'));
      }
    }
    if (!answered && !imgObj) addMsg('ai', smartAnswer(q, bookRes, dictHits));
    else if (!answered && imgObj) addMsg('ai', 'Для анализа фото нужен интернет и сохранённый API-ключ Gemini в настройках чата.');
  } catch(e) {
    addMsg('ai', 'Ошибка: ' + (e.message||e));
  }
  showLoad(false);
}

function dictObj(o){
  const word = (o.word||'').trim();
  return {
    word, wordNorm: fold(word), lang: o.lang || 'uz',
    translation: (o.translation||'').trim(), definition: (o.definition||'').trim(),
    example: (o.example||'').trim(), subject: o.subject || 'vocab', added: Date.now()
  };
}
function dictKey(d){ return (d.lang || '') + '|' + (d.wordNorm || fold(d.word)); }

async function addBookObj(name, subject, content){
  content = (content||'').trim();
  name = (name||'Без названия').trim();
  if (content.length < 20) throw new Error('Слишком мало текста: ' + name);
  await saveBook({ name, subject: subject || 'other', content, added: Date.now() });
}
async function addFromForm(){
  try {
    showLoad(true);
    await addBookObj($('bookName').value, $('subject').value, $('bookContent').value);
    $('bookName').value = ''; $('bookContent').value = '';
    await renderBooks(); await fillCardBooks();
    addMsg('ai', 'Учебник добавлен.');
  } catch(e) { alert(e.message||e); }
  showLoad(false);
}
async function addDictFromForm(){
  const word = $('dictWord').value.trim();
  if (word.length < 1) return alert('Введите слово');
  await saveDict(dictObj({
    word, lang: $('dictLang').value, translation: $('dictTr').value,
    definition: $('dictDef').value, example: $('dictEx').value, subject: $('dictSubject').value
  }));
  $('dictWord').value = $('dictTr').value = $('dictDef').value = $('dictEx').value = '';
  renderDicts(true);
}
function parseDictLines(text, lang, subject){
  const out = [];
  text.split(/\n+/).forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split(/\s*(?:—+|–+|-+|=+|\||\t)+\s*/).map(x => x.trim()).filter(Boolean);
    if (!parts.length || parts[0].length < 1) return;
    out.push(dictObj({ word: parts[0], translation: parts.slice(1).join(' · '), lang, subject }));
  });
  return out;
}
async function addDictBulk(){
  const arr = parseDictLines($('dictBulk').value, $('dictLang').value, $('dictSubject').value);
  if (!arr.length) return alert('Нет строк вида: word — перевод');
  showLoad(true);
  for (const d of arr) await saveDict(d);
  $('dictBulk').value = '';
  await renderDicts(true);
  showLoad(false);
  addMsg('ai', 'В словарь добавлено: ' + arr.length);
}
async function extractPdf(file){
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF-библиотека не загрузилась.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  const max = Math.min(pdf.numPages, 400);
  for (let i=1;i<=max;i++){
    const page = await pdf.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map(it => it.str).join(' ') + '\n\n';
  }
  if (text.replace(/\s/g,'').length < 40) throw new Error('В PDF почти нет текста (это скан). Используйте кнопку «📷 Скан страниц с фото»!');
  return text;
}
async function importPayload(data, mergeAsk){
  const books = Array.isArray(data) ? (data[0] && data[0].content != null ? data : []) : (data.books || []);
  const dicts = Array.isArray(data) ? (data[0] && data[0].word != null && data[0].content == null ? data : []) : (data.dicts || []);
  if (!books.length && !dicts.length) throw new Error('Пустой JSON');
  const merge = mergeAsk ? confirm('Объединить с текущей базой? ОК — добавить, Отмена — заменить.') : true;
  if (books.length) await storeImport('books', books, merge, 'uzb9books_fb', b => ({ name: b.name, subject: b.subject || 'other', content: b.content || '', added: Date.now() }));
  if (dicts.length) await storeImport('dicts', dicts, merge, 'uzb9dicts_fb', d => dictObj(d));
  return { books: books.length, dicts: dicts.length };
}
async function handleFiles(fileList, asDict){
  const files = [...fileList];
  if (!files.length) return;
  showLoad(true, 'Читаю файлы…');
  let okB = 0, okD = 0, err = [];
  for (const f of files) {
    try {
      const ext = (f.name.split('.').pop()||'').toLowerCase();
      if (ext === 'json' || f.type.includes('json')) {
        const r = await importPayload(JSON.parse(await f.text()), true);
        okB += r.books; okD += r.dicts; continue;
      }
      const txt = (ext === 'pdf' || f.type === 'application/pdf') ? await extractPdf(f) : await f.text();
      if (asDict) {
        const arr = parseDictLines(txt, $('dictLang').value, $('dictSubject').value);
        for (const d of arr) await saveDict(d);
        okD += arr.length;
      } else {
        await addBookObj(f.name.replace(/\.[^.]+$/, ''), $('subject').value, txt);
        okB++;
      }
    } catch(e) { err.push(f.name + ': ' + (e.message||e)); }
  }
  await renderBooks(); await fillCardBooks(); await renderDicts(true);
  showLoad(false);
  addMsg('ai', `Загружено: учебников ${okB}, словарных статей ${okD}` + (err.length ? '\nОшибки:\n' + err.join('\n') : ''));
}
async function exportAll(){
  const books = await getBooks(), dicts = await getDicts();
  downloadJSON({
    app:'uzb-school-ai', country:'UZ',
    books: books.map(({name,subject,content})=>({name,subject,content})),
    dicts: dicts.map(({word,lang,translation,definition,example,subject})=>({word,lang,translation,definition,example,subject}))
  }, 'baza-maktab.json');
}
async function exportDicts(){
  const dicts = await getDicts();
  downloadJSON({
    app:'uzb-school-dict',
    dicts: dicts.map(({word,lang,translation,definition,example,subject})=>({word,lang,translation,definition,example,subject}))
  }, 'slovar-maktab.json');
}
function downloadJSON(obj, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'}));
  a.download = name; a.click();
}
async function importJSONFile(file){
  showLoad(true);
  try {
    const r = await importPayload(JSON.parse(await file.text()), true);
    await renderBooks(); await fillCardBooks(); await renderDicts(true);
    addMsg('ai', `Импорт: книг ${r.books}, слов ${r.dicts}`);
  } catch(e) { alert('Импорт не удался: ' + (e.message||e)); }
  showLoad(false);
  $('importJSON').value = '';
}
async function loadDictsFromGitHub(){
  const raw = ($('dictUrl').value || './dicts.json').trim();
  if (!raw) return alert('Укажите URL dicts.json');
  if (location.protocol === 'file:') return alert('Откройте приложение через GitHub Pages (https).');
  showLoad(true, 'Загружаю словарь с GitHub…');
  try {
    const url = raw + (raw.includes('?') ? '&' : '?') + 't=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data.dicts || []);
    if (!arr.length) throw new Error('В JSON нет статей.');
    const merge = confirm('Статей в файле: ' + arr.length + '.\nОК — добавить к словарю\nОтмена — заменить словарь.');
    const existing = await getDicts();
    const have = new Set(existing.map(dictKey));
    const mapped = arr.map(d => dictObj(d));
    const toAdd = merge ? mapped.filter(d => !have.has(dictKey(d))) : mapped;
    if (!merge) await storeImport('dicts', toAdd, false, 'uzb9dicts_fb', d => dictObj(d));
    else for (const d of toAdd) await saveDict(d);
    await renderDicts(true);
    addMsg('ai', 'Словарь с GitHub загружен! Новых слов: ' + toAdd.length);
    switchTab('dict');
  } catch (e) {
    alert('Ошибка загрузки словаря:\n' + (e.message || e));
  }
  showLoad(false);
}

/* === ПОДСВЕТКА ПОИСКА ПОВЕРХ КРАСИВЫХ ФОРМУЛ И ТАБЛИЦ === */
function highlight(text, q){
  let html = formatSchoolText(text);
  const words = fold(q).split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return html;
  words.forEach(w => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(<[^>]+>)|(${escaped})`, 'gi');
    html = html.replace(re, (m, tag, hit) => tag ? tag : `<mark>${hit}</mark>`);
  });
  return html;
}

async function renderBooks(){
  const books = await getBooks();
  const f = $('filterSubject').value;
  const list = f==='all' ? books : books.filter(b => b.subject===f);
  const bytes = books.reduce((s,b)=>s+(b.content||'').length,0);
  const paras = list.reduce((s,b)=>s+splitIntoCards(b.content).length,0);
  $('stats').textContent = `Книг: ${books.length} · показано: ${list.length} · параграфов: ${paras} · ~${Math.round(bytes/1024)} КБ`;
  $('bookList').innerHTML = list.map(b => `<div class="book"><div><b>${escapeHtml(b.name)}</b><small>${escapeHtml(subName(b.subject))} · ${splitIntoCards(b.content).length} карт. · ${Math.round((b.content||'').length/1000)} тыс. симв.</small></div><button class="danger" type="button" onclick="deleteBook('${b.id}')">×</button></div>`).join('') || '<p class="note">Пока пусто — добавьте учебники любого класса.</p>';
}
async function fillCardBooks(){
  const books = await getBooks();
  const sub = $('cardSubject').value;
  const list = sub==='all' ? books : books.filter(b => b.subject===sub);
  $('cardBook').innerHTML = `<option value="all">Все учебники</option>` + list.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  await renderCards(true);
}
async function collectCards(){
  const books = await getBooks();
  const sub = $('cardSubject').value, bid = $('cardBook').value, q = $('cardQuery').value;
  const qw = tokenList(q), items = [];
  books.forEach(b => {
    if (sub !== 'all' && b.subject !== sub) return;
    if (bid !== 'all' && String(b.id) !== String(bid)) return;
    splitIntoCards(b.content).forEach((text, i) => {
      if (q && scoreText(q, text, {}) <= 0 && !qw.some(w => fold(text).includes(w))) return;
      items.push({ text, i, book: b.name, subject: b.subject, id: b.id });
    });
  });
  return items;
}
async function renderCards(reset){
  if (reset) { cardOffset = 0; $('cardList').innerHTML = ''; }
  lastCardItems = await collectCards();
  const slice = lastCardItems.slice(cardOffset, cardOffset + CARD_PAGE);
  $('cardStats').textContent = `Карточек: ${lastCardItems.length}` + (lastCardItems.length ? ` · показаны ${Math.min(cardOffset+slice.length, lastCardItems.length)}` : '');
  const q = $('cardQuery').value;
  $('cardList').insertAdjacentHTML('beforeend', slice.map((c, idx) =>
    `<article class="pcard">
      <div class="meta"><span class="badge">${escapeHtml(subName(c.subject))}</span><span>${escapeHtml(c.book)} · ${c.i+1}</span></div>
      <div class="ttl">${formatSchoolText(cardTitle(c.text))}</div>
      <div class="body">${highlight(c.text, q)}</div>
      <div class="actions"><button class="ghost" type="button" onclick="toggleCard(this)">Ещё</button><button type="button" onclick="askAbout(${cardOffset+idx})">Спросить</button></div>
    </article>`
  ).join('') || (reset ? '<p class="note">Нет параграфов.</p>' : ''));
  cardOffset += slice.length;
  $('moreCardsBtn').style.display = cardOffset < lastCardItems.length ? 'inline-block' : 'none';
}
function toggleCard(btn){
  const card = btn.closest('.pcard');
  card.classList.toggle('open');
  btn.textContent = card.classList.contains('open') ? 'Свернуть' : 'Ещё';
}
function askAbout(idx){
  const c = lastCardItems[idx];
  if (!c) return;
  switchTab('chat');
  $('chatSubject').value = c.subject || 'all';
  $('userInput').value = 'Объясни этот параграф из «' + c.book + '»: ' + c.text.slice(0, 220);
  $('userInput').focus();
}
async function collectDicts(){
  const dicts = await getDicts();
  const lang = $('dictFilterLang').value, sub = $('dictFilterSubject').value, q = $('dictQuery').value.trim();
  return dicts.filter(d => {
    if (lang !== 'all' && d.lang !== lang) return false;
    if (sub !== 'all' && d.subject !== sub) return false;
    if (!q) return true;
    return scoreText(q, [d.word, d.translation, d.definition, d.example].join(' '), { exactWord: d.word }) > 0.2 || fold(d.word).includes(fold(q));
  }).sort((a,b) => fold(a.word).localeCompare(fold(b.word)));
}
async function renderDicts(reset){
  if (reset) { dictOffset = 0; $('dictList').innerHTML = ''; }
  lastDictItems = await collectDicts();
  const slice = lastDictItems.slice(dictOffset, dictOffset + DICT_PAGE);
  $('dictStats').textContent = `Статей: ${lastDictItems.length}` + (lastDictItems.length ? ` · показаны ${Math.min(dictOffset+slice.length, lastDictItems.length)}` : '');
  const q = $('dictQuery').value;
  $('dictList').insertAdjacentHTML('beforeend', slice.map(d => `<article class="dcard"><div class="meta"><span class="badge">${escapeHtml(langName(d.lang))}</span><span>${escapeHtml(subName(d.subject))}</span></div><div class="ttl">${highlight(d.word, q)}</div>${d.translation ? `<div>${highlight(d.translation, q)}</div>` : ''}${d.definition ? `<div class="note">${highlight(d.definition, q)}</div>` : ''}${d.example ? `<div class="note">Пример: ${highlight(d.example, q)}</div>` : ''}<div class="actions"><button type="button" onclick="askWord('${String(d.id).replace(/'/g,'')}')">В чат</button><button class="danger" type="button" onclick="deleteDict('${d.id}')">×</button></div></article>`).join('') || (reset ? '<p class="note">Словарь пуст. Нажмите «Загрузить с GitHub».</p>' : ''));
  dictOffset += slice.length;
  $('moreDictBtn').style.display = dictOffset < lastDictItems.length ? 'inline-block' : 'none';
}
async function askWord(id){
  const dicts = await getDicts();
  const d = dicts.find(x => String(x.id) === String(id));
  if (!d) return;
  switchTab('chat');
  $('userInput').value = `Что означает «${d.word}»? Nima demak?`;
  $('userInput').focus();
}
function switchTab(which){
  $('tabLibBtn').classList.toggle('on', which==='lib');
  $('tabDictBtn').classList.toggle('on', which==='dict');
  $('tabCardsBtn').classList.toggle('on', which==='cards');
  $('tabChatBtn').classList.toggle('on', which==='chat');
  $('libPanel').classList.toggle('on', which==='lib');
  $('dictPanel').classList.toggle('on', which==='dict');
  $('cardsPanel').classList.toggle('on', which==='cards');
  $('chatPanel').classList.toggle('on', which==='chat');
  if (which==='cards') renderCards(true);
  if (which==='dict') renderDicts(true);
}
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('uzb9theme', t);
  $('themeBtn').textContent = t === 'dark' ? '☀️' : '🌙';
  $('themeColor').setAttribute('content', t === 'dark' ? '#0f1611' : '#e8f5e9');
}
function initTheme(){
  const saved = localStorage.getItem('uzb9theme');
  applyTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
function setupPWA(){
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredPrompt = e;
    $('installBtn').style.display = 'inline-block';
  });
  $('installBtn').onclick = async () => {
    if (!deferredPrompt) return alert('Откройте сайт через GitHub Pages (https) → Меню браузера → Добавить на главный экран.');
    deferredPrompt.prompt(); deferredPrompt = null;
  };
}

initTheme();
fillSelects();
setupPWA();
setupPhotoUI();
renderBooks();
fillCardBooks();
renderDicts(true);

if ($('geminiKey')) $('geminiKey').value = localStorage.getItem('uzb_gemini_key') || '';
if ($('studentGrade')) {
  if (localStorage.getItem('uzb_grade')) $('studentGrade').value = localStorage.getItem('uzb_grade');
  $('studentGrade').onchange = function(){ localStorage.setItem('uzb_grade', this.value); };
}

try {
  const savedList = JSON.parse(localStorage.getItem('uzb_gemini_model_list') || 'null');
  populateModelSelect(savedList);
} catch(e){ populateModelSelect(null); }
if ($('geminiCustomModel')) $('geminiCustomModel').value = localStorage.getItem('uzb_gemini_custom_model') || '';

addMsg('ai', 'Salom! Hello! Здравствуйте!\nЯ универсальный школьный помощник (1–11 класс).\n1) Загрузите словарь с GitHub и свои учебники (можно сканировать страницы кнопкой 📷).\n2) Выберите свой класс во вкладке «Чат».\n3) Пишите вопросы или нажимайте 📷, чтобы сфотографировать задачу!');

$('tabLibBtn').onclick = () => switchTab('lib');
$('tabDictBtn').onclick = () => switchTab('dict');
$('tabCardsBtn').onclick = () => switchTab('cards');
$('tabChatBtn').onclick = () => switchTab('chat');
$('filterSubject').onchange = renderBooks;
$('cardSubject').onchange = fillCardBooks;
$('cardBook').onchange = () => renderCards(true);
$('cardQuery').addEventListener('input', () => { clearTimeout(window._ct); window._ct = setTimeout(() => renderCards(true), 250); });
$('moreCardsBtn').onclick = () => renderCards(false);
$('dictFilterLang').onchange = () => renderDicts(true);
$('dictFilterSubject').onchange = () => renderDicts(true);
$('dictQuery').addEventListener('input', () => { clearTimeout(window._dt); window._dt = setTimeout(() => renderDicts(true), 250); });
$('moreDictBtn').onclick = () => renderDicts(false);
$('files').onchange = e => handleFiles(e.target.files, false);
$('dictFiles').onchange = e => handleFiles(e.target.files, true);
$('importJSON').onchange = e => e.target.files[0] && importJSONFile(e.target.files[0]);
$('userInput').addEventListener('keypress', e => { if (e.key==='Enter') sendMessage(); });
$('themeBtn').onclick = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');