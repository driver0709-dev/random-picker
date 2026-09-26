'use strict';

const STORAGE_KEY = 'random-picker:v3';
const LEGACY_KEYS = ['random-picker:v2', 'random-picker:v1'];
const PROFILES = ['guy', 'girl', 'custom'];
const SEASONS = ['summer', 'winter'];

const $ = (sel) => document.querySelector(sel);

const el = {
  profileSwitch: $('#profileSwitch'),
  seasonSwitch: $('#seasonSwitch'),
  seasonNote: $('#seasonNote'),
  customCard: $('#customCard'),
  addForm: $('#addForm'),
  addInput: $('#addInput'),
  bulkInput: $('#bulkInput'),
  bulkAddBtn: $('#bulkAddBtn'),
  counter: $('#counter'),
  clearBtn: $('#clearBtn'),
  itemsList: $('#itemsList'),
  emptyItems: $('#emptyItems'),
  poolInfo: $('#poolInfo'),
  countSelect: $('#countSelect'),
  pickBtn: $('#pickBtn'),
  pickHint: $('#pickHint'),
  resultCard: $('#resultCard'),
  resultList: $('#resultList'),
  phrasesBlock: $('#phrasesBlock'),
  phrasesList: $('#phrasesList'),
  againBtn: $('#againBtn'),
  copyBtn: $('#copyBtn'),
  ageModal: $('#ageModal'),
  ageYesBtn: $('#ageYesBtn'),
  ageNoBtn: $('#ageNoBtn'),
  toast: $('#toast'),
};

/* ---------- Утилиты ---------- */

const normalize = (s) => String(s).trim().replace(/\s+/g, ' ');
const dedupKey = (s) => normalize(s).toLocaleLowerCase('ru').replace(/ё/g, 'е');

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
}

/* ---------- Случайность ---------- */

// Равномерное целое в [0, max) через crypto.getRandomValues без смещения по модулю.
function randomInt(max) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

// Частичная перетасовка Фишера–Йетса: первые n элементов — случайная выборка без повторов.
function pickRandom(items, n) {
  const a = items.slice();
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Случайная выборка n пунктов, в которой «ограниченных» (isLimited) не больше maxLimited:
// перетасовываем весь пул и берём пункты по порядку, пропуская лишние ограниченные.
function pickLimited(items, n, isLimited, maxLimited) {
  const result = [];
  let limited = 0;
  for (const it of pickRandom(items, items.length)) {
    if (result.length >= n) break;
    if (isLimited(it)) {
      if (limited >= maxLimited) continue;
      limited++;
    }
    result.push(it);
  }
  return result;
}

/* ---------- Состояние ---------- */

function defaultState() {
  return {
    profile: 'custom',
    season: 'summer', // 'winter' — только зоны спереди
    age: null, // null — не спрашивали, 'yes' / 'no' — ответ пользователя
    count: 1,
    custom: [],
  };
}

const cleanStrings = (arr) => (Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && normalize(x)).map(normalize) : []);

function load() {
  const s = defaultState();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (raw && typeof raw === 'object') {
      if (PROFILES.includes(raw.profile)) s.profile = raw.profile;
      if (SEASONS.includes(raw.season)) s.season = raw.season;
      if (raw.age === 'yes' || raw.age === 'no') s.age = raw.age;
      s.count = Math.max(1, Number(raw.count) || 1);
      s.custom = cleanStrings(raw.custom);
    } else {
      // Перенос из прошлых версий: свой список, N, профиль и ответ о возрасте.
      const v2 = JSON.parse(localStorage.getItem('random-picker:v2'));
      const v1 = JSON.parse(localStorage.getItem('random-picker:v1'));
      if (v2 && typeof v2 === 'object') {
        s.profile = { male: 'guy', female: 'girl' }[v2.profile] || 'custom';
        if (v2.age === 'yes' || v2.age === 'no') s.age = v2.age;
        s.count = Math.max(1, Number(v2.count) || 1);
        s.custom = cleanStrings(v2.custom);
      } else if (v1 && Array.isArray(v1.lists)) {
        const l = v1.lists.find((x) => x && x.id === v1.currentId) || v1.lists[0];
        if (l) s.custom = cleanStrings(l.items);
        s.count = Math.max(1, Number(v1.count) || 1);
      }
    }
  } catch (e) { /* повреждённые данные — начинаем с настроек по умолчанию */ }
  if (s.profile !== 'custom' && s.age !== 'yes') s.profile = 'custom';
  return s;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch (e) {
    toast('Не удалось сохранить данные на устройстве');
  }
}

const PHRASES_PER_ROUND = 2;
const MAX_PICK = 10; // больше 10 вариантов за раз выбрать нельзя
const MAX_INTIMATE = 2; // интимных зон в одном результате не больше этого числа

let state = load();
let lastResult = [];
let lastPhrases = [];

const adultAllowed = () => state.age === 'yes';

function buildPool() {
  if (state.profile === 'custom') return state.custom.slice();
  const src = state.profile === 'guy' ? window.PRESETS.GUY : window.PRESETS.GIRL;
  // Зимой задние зоны исключаются: помечаем их как уже «виденные».
  const seen = new Set(state.season === 'winter' ? (window.PRESETS.BACK || []).map(dedupKey) : []);
  const pool = [];
  for (const name of src) {
    const k = dedupKey(name);
    if (!seen.has(k)) {
      seen.add(k);
      pool.push(normalize(name));
    }
  }
  return pool;
}

// Фразы в нужном роде для профиля; в «Своем списке» фраз нет.
function phrasesFor(profile) {
  if (profile === 'custom') return [];
  return (window.PRESETS.PHRASES || [])
    .map((p) => (typeof p === 'string' ? p : p[profile]))
    .filter((p) => typeof p === 'string' && normalize(p))
    .map(normalize);
}

// Интимные зоны текущего профиля (ключи для сравнения); в «Своем списке» их нет.
function intimateKeys(profile) {
  const list = (window.PRESETS.INTIMATE || {})[profile] || [];
  return new Set(list.map(dedupKey));
}

/* ---------- Подтверждение возраста ---------- */

// Ответ «Да» запоминается навсегда; после «Нет» вопрос повторится при следующей попытке открыть режим 18+.
async function ensureAdult() {
  if (adultAllowed()) return true;
  const yes = await new Promise((resolve) => {
    const finish = (answer) => {
      el.ageModal.hidden = true;
      el.ageYesBtn.onclick = el.ageNoBtn.onclick = null;
      resolve(answer);
    };
    el.ageYesBtn.onclick = () => finish(true);
    el.ageNoBtn.onclick = () => finish(false);
    el.ageModal.hidden = false;
    el.ageNoBtn.focus();
  });
  state.age = yes ? 'yes' : 'no';
  save();
  if (!yes) toast('Режимы «Парень» и «Девушка» доступны только с 18 лет');
  return yes;
}

/* ---------- Отрисовка ---------- */

function renderProfile() {
  const adult = adultAllowed();
  for (const btn of el.profileSwitch.querySelectorAll('[data-profile]')) {
    const p = btn.dataset.profile;
    btn.setAttribute('aria-checked', String(p === state.profile));
    btn.classList.toggle('locked', !adult && p !== 'custom');
  }
  // Режим сезона имеет смысл только для стандартных списков.
  el.seasonSwitch.hidden = state.profile === 'custom';
  el.seasonNote.hidden = state.profile === 'custom' || state.season !== 'winter';
  for (const btn of el.seasonSwitch.querySelectorAll('[data-season]')) {
    btn.setAttribute('aria-checked', String(btn.dataset.season === state.season));
  }
}

function renderCustom() {
  el.customCard.hidden = state.profile !== 'custom';
  if (el.customCard.hidden) return;
  const items = state.custom;
  el.itemsList.replaceChildren(...items.map((text, i) => {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'item-text';
    input.value = text;
    input.dataset.index = i;
    input.maxLength = 200;
    input.enterKeyHint = 'done';
    input.setAttribute('aria-label', `Вариант ${i + 1}`);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'item-del';
    del.dataset.index = i;
    del.textContent = '×';
    del.setAttribute('aria-label', `Удалить «${text}»`);
    li.append(input, del);
    return li;
  }));
  el.emptyItems.hidden = items.length > 0;
  el.clearBtn.disabled = items.length === 0;
  el.counter.textContent = `Всего вариантов: ${items.length}`;
}

function renderCount(pool) {
  const total = pool.length;
  el.poolInfo.textContent = `В пуле: ${total} ${plural(total, 'вариант', 'варианта', 'вариантов')}`;
  if (total < 1) {
    const o = document.createElement('option');
    o.textContent = '—';
    el.countSelect.replaceChildren(o);
    el.countSelect.disabled = true;
  } else {
    const max = Math.min(total, MAX_PICK);
    const opts = [];
    for (let n = 1; n <= max; n++) {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      opts.push(o);
    }
    el.countSelect.replaceChildren(...opts);
    el.countSelect.disabled = false;
    // Сохранённое значение не трогаем, лишь ограничиваем доступным максимумом.
    el.countSelect.value = String(Math.min(state.count, max));
  }
  el.pickBtn.disabled = total < 1;
  el.pickHint.hidden = total >= 1;
}

function render() {
  renderProfile();
  renderCustom();
  renderCount(buildPool());
}

const toItems = (texts) => texts.map((t) => {
  const li = document.createElement('li');
  li.textContent = t;
  return li;
});

function showResult(result, phrases) {
  lastResult = result;
  lastPhrases = phrases;
  el.resultList.replaceChildren(...toItems(result));
  el.phrasesList.replaceChildren(...toItems(phrases));
  el.phrasesBlock.hidden = phrases.length === 0;
  el.resultCard.hidden = false;
  el.resultCard.classList.remove('flash');
  void el.resultCard.offsetWidth; // перезапуск анимации
  el.resultCard.classList.add('flash');
}

function hideResult() {
  lastResult = [];
  lastPhrases = [];
  el.resultCard.hidden = true;
}

/* ---------- Действия ---------- */

function doPick() {
  const pool = buildPool();
  if (!pool.length) return;
  const n = Math.min(Number(el.countSelect.value) || 1, pool.length, MAX_PICK);
  const phrases = phrasesFor(state.profile);
  const intimate = intimateKeys(state.profile);
  const zones = pickLimited(pool, n, (name) => intimate.has(dedupKey(name)), MAX_INTIMATE);
  showResult(zones, pickRandom(phrases, Math.min(PHRASES_PER_ROUND, phrases.length)));
  el.resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function copyResult() {
  if (!lastResult.length) return;
  let text = lastResult.map((t, i) => `${i + 1}. ${t}`).join('\n');
  if (lastPhrases.length) text += `\n\nСкажи:\n${lastPhrases.map((p) => `— ${p}`).join('\n')}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // Запасной вариант для http без secure context и старых браузеров.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) { toast('Не удалось скопировать'); return; }
  }
  toast('Результат скопирован');
}

async function selectProfile(profile) {
  if (profile === state.profile) return;
  if (profile !== 'custom' && !(await ensureAdult())) {
    render();
    return;
  }
  state.profile = profile;
  save();
  hideResult();
  render();
}

el.profileSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-profile]');
  if (btn) selectProfile(btn.dataset.profile);
});

el.seasonSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-season]');
  if (!btn || btn.dataset.season === state.season) return;
  state.season = btn.dataset.season;
  save();
  hideResult();
  render();
});

el.countSelect.addEventListener('change', () => {
  state.count = Number(el.countSelect.value) || 1;
  save();
});

el.pickBtn.addEventListener('click', doPick);
el.againBtn.addEventListener('click', doPick);
el.copyBtn.addEventListener('click', copyResult);

/* ---------- Свой список ---------- */

function addCustom(texts) {
  const seen = new Set(state.custom.map(dedupKey));
  let added = 0, empty = 0, dup = 0;
  for (const raw of texts) {
    const t = normalize(raw);
    if (!t) { empty++; continue; }
    const k = dedupKey(t);
    if (seen.has(k)) { dup++; continue; }
    seen.add(k);
    state.custom.push(t);
    added++;
  }
  if (added) save();
  render();
  return { added, empty, dup };
}

function reportBulk({ added, empty, dup }) {
  const parts = [`Добавлено: ${added}`];
  if (dup) parts.push(`${dup} ${plural(dup, 'дубликат пропущен', 'дубликата пропущено', 'дубликатов пропущено')}`);
  if (empty) parts.push(`${empty} ${plural(empty, 'пустая строка пропущена', 'пустые строки пропущены', 'пустых строк пропущено')}`);
  toast(parts.join(', '));
}

el.addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = normalize(el.addInput.value);
  if (!t) { toast('Введите текст варианта'); return; }
  const { added } = addCustom([t]);
  if (added) el.addInput.value = '';
  else toast('Такой вариант уже есть');
  el.addInput.focus();
});

el.bulkAddBtn.addEventListener('click', () => {
  const lines = el.bulkInput.value.split(/\r?\n/);
  // Хвостовой перевод строки — не «пустой вариант», не считаем его.
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) { toast('Введите варианты, каждый с новой строки'); return; }
  const res = addCustom(lines);
  reportBulk(res);
  if (res.added) el.bulkInput.value = '';
});

el.itemsList.addEventListener('click', (e) => {
  const btn = e.target.closest('.item-del');
  if (!btn) return;
  state.custom.splice(Number(btn.dataset.index), 1);
  save();
  render();
});

el.itemsList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('item-text')) e.target.blur();
});

el.itemsList.addEventListener('change', (e) => {
  const input = e.target;
  if (!input.classList.contains('item-text')) return;
  const items = state.custom;
  const i = Number(input.dataset.index);
  const t = normalize(input.value);
  if (!t) {
    input.value = items[i];
    toast('Вариант не может быть пустым. Чтобы удалить — нажмите ×');
    return;
  }
  const k = dedupKey(t);
  if (items.some((other, j) => j !== i && dedupKey(other) === k)) {
    input.value = items[i];
    toast('Такой вариант уже есть');
    return;
  }
  items[i] = t;
  input.value = t;
  save();
});

el.clearBtn.addEventListener('click', () => {
  if (!state.custom.length) return;
  if (!confirm(`Удалить все варианты (${state.custom.length}) из своего списка?`)) return;
  state.custom = [];
  save();
  hideResult();
  render();
});

/* ---------- Запуск ---------- */

render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
