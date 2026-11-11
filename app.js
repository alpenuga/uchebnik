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

function splitIntoCards(content){
  const raw = (content||'').replace(/\r\n/g,'\n').trim();
  if (!raw) return [];
  let blocks = raw.split(/(?=\n(?:§+|параграф|глава|bob|mavzu|mavzusi|unit|chapter|paragraph)\s*[\d.IVXLCivxlc]+)/i);
  if (blocks.length < 3) blocks = raw.split(/\n\s*\n+/);
  const out = [];
  for (let b of blocks) {
    b = b.replace(/\s+/g,' ').trim();
    if (b.length < 50) continue;
    if (b.length > 900) {
      const sentences = b.split(/(?<=[.!?])\s+/);
      let buf = '';
      for (const s of sentences) {
        if ((buf + ' ' + s).length > 720 && buf.length > 80) { out.push(buf.trim()); buf = s; }
        else buf += (buf ? ' ' : '') + s;
      }
      if (buf.trim().length > 50) out.push(buf.trim());
    } else out.push(b);
  }
  return out;
}
function cardTitle(text){
  const m = text.match(/^(§+\s*[\d.]+|параграф\s*[\d.]+|глава\s*[\d.]+|bob\s*[\d.]+|mavzu\s*[\d.]+|unit\s*[\d.]+|chapter\s*[\d.]+)[^\s]*/i);
  return m ? m[0].slice(0, 80) : text.slice(0, 70) + (text.length > 70 ? '…' : '');
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
      if (s > 0.35) scored.push({ score:s, text: ch.slice(0, 750), book: book.name, subject: book.subject });
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
    by[k].forEach(t => { out += t + (t.length>=750?'…':'') + '\n\n'; });
  });
  const first = bookRes.hits[0].text;
  const brief = first.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  out += 'Кратко: ' + brief + (brief.length < first.length ? '…' : '');
  out += '\n\nЭто выдержки из вашей базы.';
  return out;
}

function addMsg(role, text){
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.textContent = text;
  $('messages').appendChild(d);
  $('messages').scrollTop = 1e9;
}

function saveGeminiKey(){
  const k = $('geminiKey').value.trim();
  localStorage.setItem('uzb_gemini_key', k);
  alert(k ? 'Ключ сохранён! Теперь можете нажать «🔄 Список», чтобы загрузить доступные модели.' : 'Ключ удалён.');
}

function getSelectedModel(){
  const sel = $('geminiModel') ? $('geminiModel').value : 'gemini-3.8-flash';
  let m = sel === 'custom'
    ? (($('geminiCustomModel') && $('geminiCustomModel').value) || 'gemini-3.8-flash')
    : sel;
  return m.trim().replace(/^models\//, '');
}

function onModelChange(){
  if (!$('geminiModel')) return;
  const val = $('geminiModel').value;
  localStorage.setItem('uzb_gemini_model', val);
  if ($('geminiCustomModel')) {
    $('geminiCustomModel').style.display = val === 'custom' ? 'block' : 'none';
  }
}

async function loadGeminiModels(){
  const key = (localStorage.getItem('uzb_gemini_key') || ($('geminiKey') && $('geminiKey').value) || '').trim();
  if (!key) return alert('Сначала введите и сохраните API-ключ!');
  showLoad(true, 'Запрашиваю доступные модели у Google…');
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || ('HTTP ' + res.status));
    const models = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && m.name.includes('gemini'))
      .map(m => m.name.replace(/^models\//, ''));
    if (!models.length) throw new Error('Не найдено доступных моделей generateContent.');
    localStorage.setItem('uzb_gemini_model_list', JSON.stringify(models));
    populateModelSelect(models);
    alert('Загружено доступных моделей: ' + models.length + '\nВыберите нужную в списке.');
  } catch (e) {
    alert('Ошибка получения списка моделей:\n' + (e.message || e));
  }
  showLoad(false);
}

function populateModelSelect(models){
  if (!$('geminiModel') || !Array.isArray(models) || !models.length) return;
  const saved = localStorage.getItem('uzb_gemini_model') || models[0];
  $('geminiModel').innerHTML = models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')
    + `<option value="custom">✍️ Ввести название модели вручную…</option>`;
  if (models.includes(saved) || saved === 'custom') $('geminiModel').value = saved;
  onModelChange();
}

async function askGemini(query, bookRes, dictHits){
  const key = (localStorage.getItem('uzb_gemini_key') || ($('geminiKey') && $('geminiKey').value) || '').trim();
  if (!key) return null;

  const model = getSelectedModel();
  const mode = $('geminiMode') ? $('geminiMode').value : 'tutor';
  const grade = $('studentGrade') ? $('studentGrade').value : 'универсальный (1–11 класс)';

  const ctxBooks = (bookRes.hits || []).map((h, i) =>
    `[Учебник ${i+1}: ${h.book} (${subName(h.subject)})]\n${h.text}`
  ).join('\n\n');
  const ctxDict = (dictHits || []).map(d =>
    `[Словарь: ${d.word} (${langName(d.lang)})] Перевод: ${d.translation}. ${d.definition} Пример: ${d.example}`
  ).join('\n');

  const systemInstruction = mode === 'strict'
    ? `Ты школьный ИИ-помощник для учащихся в Узбекистане (уровень ученика: ${grade}). Отвечай ТОЛЬКО на основе приведённых фрагментов учебников и словаря. Объясняй понятно для возраста ученика (${grade}). Если ответа в фрагментах нет — прямо скажи об этом. Отвечай на языке вопроса (русский, узбекский или английский).`
    : `Ты добрый, понятный и опытный школьный учитель в Узбекистане (программа 1–11 классов). Сейчас тебе задаёт вопрос ученик уровня: ${grade}.
Правила:
1. В первую очередь опирайся на приведённые фрагменты учебников и словаря из базы ученика (указывай источник).
2. Объясняй простыми словами и по шагам, адаптируя сложность под ${grade}.
3. Если фрагментов из базы нет или их мало — дай правильное объяснение или решение по школьной программе Узбекистана для уровня «${grade}» и пометь, что это решение от ИИ-учителя.
4. Отвечай на языке вопроса ученика (русский, oʻzbek tili или English).`;

  const prompt = `Контекст из базы ученика:\n${ctxDict ? ctxDict + '\n\n' : ''}${ctxBooks || 'Точных цитат в загруженных книгах не найдено.'}\n\nВопрос ученика (${grade}): ${query}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1200 }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`[${model}] ` + (data.error?.message || ('HTTP ' + res.status)));
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || null;
}

async function sendMessage(){
  const q = $('userInput').value.trim();
  if (!q) return;
  $('userInput').value = '';
  addMsg('user', q);
  showLoad(true, 'Ищу в базе и формирую ответ…');
  try {
    const sub = $('chatSubject').value;
    const bookRes = await searchBooks(q, sub);
    const dictHits = $('useDict').checked ? await searchDicts(q, sub) : [];

    let answered = false;
    if ($('useGemini') && $('useGemini').checked && navigator.onLine) {
      try {
        const aiText = await askGemini(q, bookRes, dictHits);
        if (aiText) {
          const srcNames = [...new Set(bookRes.hits.map(h => h.book))];
          const footer = srcNames.length ? `\n\n📚 Источники из базы: ${srcNames.join(', ')}` : '';
          addMsg('ai', '✨ Учитель (Gemini):\n\n' + aiText.trim() + footer);
          answered = true;
        }
      } catch (ge) {
        addMsg('ai', '⚠️ Gemini недоступен (' + (ge.message || ge) + '). Показываю офлайн-ответ из вашей базы:');
      }
    }
    if (!answered) addMsg('ai', smartAnswer(q, bookRes, dictHits));
  } catch(e) {
    addMsg('ai', 'Ошибка поиска: ' + (e.message||e));
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
  const max = Math.min(pdf.numPages, 120);
  for (let i=1;i<=max;i++){
    const page = await pdf.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map(it => it.str).join(' ') + '\n\n';
  }
  if (text.replace(/\s/g,'').length < 40) throw new Error('В PDF почти нет текста (возможно скан).');
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
function highlight(text, q){
  let html = escapeHtml(text);
  fold(q).split(/\s+/).filter(w => w.length > 2).forEach(w => {
    const re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
    html = html.replace(re, '<mark>$1</mark>');
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
  $('cardList').insertAdjacentHTML('beforeend', slice.map((c, idx) => `<article class="pcard"><div class="meta"><span class="badge">${escapeHtml(subName(c.subject))}</span><span>${escapeHtml(c.book)} · ${c.i+1}</span></div><div class="ttl">${escapeHtml(cardTitle(c.text))}</div><div class="body">${highlight(c.text, q)}</div><div class="actions"><button class="ghost" type="button" onclick="toggleCard(this)">Ещё</button><button type="button" onclick="askAbout(${cardOffset+idx})">Спросить</button></div></article>`).join('') || (reset ? '<p class="note">Нет параграфов.</p>' : ''));
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
  if (savedList) populateModelSelect(savedList);
} catch(e){}
if ($('geminiCustomModel')) $('geminiCustomModel').value = localStorage.getItem('uzb_gemini_custom_model') || '';
if ($('geminiModel') && localStorage.getItem('uzb_gemini_model')) {
  $('geminiModel').value = localStorage.getItem('uzb_gemini_model');
  onModelChange();
}

addMsg('ai', 'Salom! Hello! Здравствуйте!\nЯ универсальный школьный помощник (1–11 класс).\n1) Загрузите словарь с GitHub и свои учебники.\n2) Выберите свой класс во вкладке «Чат».\n3) Для объяснений от ИИ-учителя добавьте бесплатный ключ Gemini в настройках чата.');

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
