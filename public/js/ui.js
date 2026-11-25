import { icon } from './icons.js';
import { haptic, selectionHaptic } from './tg.js';

// ---------- Шаблоны с экранированием ----------
const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => map[c]);

function part(v) {
  if (v && v.__raw) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

/** Тегированный шаблон: экранирует значения, raw() и вложенные html`` вставляются как есть. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return raw(out);
}
export const raw = (value) => ({ __raw: true, value: String(value), toString() { return this.value; } });
export const render = (el, tpl) => {
  el.innerHTML = tpl && tpl.__raw ? tpl.value : String(tpl ?? '');
};

/** Делегирование кликов по [data-action]. Возвращает функцию отписки. */
export function delegate(root, handlers) {
  const fn = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const h = handlers[el.dataset.action];
    if (h) {
      e.preventDefault();
      h(el, e);
    }
  };
  root.addEventListener('click', fn);
  return () => root.removeEventListener('click', fn);
}

// ---------- Форматирование ----------
const MONTHS = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

export function fmtDate(d, { weekday = false } = {}) {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  const today = todayStr();
  let s = `${day} ${MONTHS[m - 1]}`;
  if (y !== Number(today.slice(0, 4))) s += ` ${y}`;
  if (d.slice(0, 10) === today) return 'Сегодня';
  if (d.slice(0, 10) === addDaysStr(today, -1)) return 'Вчера';
  if (weekday) s += ', ' + WEEKDAYS_FULL[(dt.getUTCDay() + 6) % 7];
  return s;
}
export const monthName = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_NOM[m - 1]} ${y}`;
};
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDaysStr(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (b === 1 && a !== 11) return one;
  if (b >= 2 && b <= 4 && (a < 12 || a > 14)) return few;
  return many;
}
export const fmt = (v, d = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(Number(v || 0));
export const pct = (v) => fmt(v, 1).replace('.', ',') + '%';

export const UNIT = { g: 'г', ml: 'мл', pcs: 'шт' };
/** Количество с единицами: граммы → кг при больших значениях. */
export function qty(v, unit) {
  const n = Number(v || 0);
  if (unit === 'pcs') return `${fmt(n, n < 10 ? 1 : 0)} шт`;
  if (n >= 1000) return `${fmt(n / 1000, 2)} ${unit === 'ml' ? 'л' : 'кг'}`;
  return `${fmt(n)} ${UNIT[unit] || 'г'}`;
}

// ---------- Тост ----------
let toastEl = null;
let toastTimer = null;
export function toast(message, kind = '') {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  toastEl.className = 'toast ' + kind;
  toastEl.textContent = message;
  requestAnimationFrame(() => toastEl.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}
export const toastError = (e) => toast(e?.message || String(e), 'error');

// ---------- Шторка ----------
const sheetStack = [];
export function openSheet({ title, body, onMount, onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const el = document.createElement('div');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `<div class="grabber"></div>
    <div class="sheet-head"><h3>${esc(title || '')}</h3></div>
    <div class="sheet-body"></div>`;
  const bodyEl = el.querySelector('.sheet-body');
  render(bodyEl, body);
  document.body.append(backdrop, el);
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    el.classList.add('open');
  });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.classList.remove('open');
    el.classList.remove('open');
    setTimeout(() => {
      backdrop.remove();
      el.remove();
    }, 260);
    sheetStack.splice(sheetStack.indexOf(close), 1);
    onClose?.();
  };
  sheetStack.push(close);
  backdrop.addEventListener('click', close);

  // Свайп вниз по захвату закрывает шторку.
  let startY = null;
  const head = el.querySelector('.grabber');
  const headBar = el.querySelector('.sheet-head');
  for (const h of [head, headBar]) {
    h.addEventListener('touchstart', (e) => (startY = e.touches[0].clientY), { passive: true });
    h.addEventListener('touchmove', (e) => {
      if (startY == null) return;
      const dy = Math.max(0, e.touches[0].clientY - startY);
      el.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    h.addEventListener('touchend', (e) => {
      const dy = (e.changedTouches[0]?.clientY ?? 0) - (startY ?? 0);
      el.style.transform = '';
      startY = null;
      if (dy > 80) close();
    });
  }
  const api = { el, body: bodyEl, close, setBody: (tpl) => render(bodyEl, tpl) };
  onMount?.(api);
  return api;
}
export const closeAllSheets = () => [...sheetStack].forEach((c) => c());
export const hasOpenSheet = () => sheetStack.length > 0;

// ---------- Общие элементы ----------
export function skeleton(rows = 3, { hero = true } = {}) {
  return html`<div class="card">${hero ? raw('<div class="skeleton sk-hero"></div>') : ''}${raw(
    Array.from({ length: rows }, (_, i) => `<div class="skeleton sk-line" style="width:${90 - i * 12}%"></div>`).join('')
  )}</div>`;
}

export function empty({ iconName = 'sparkle', text, action, label, cls = '' }) {
  return html`<div class="empty">
    <div class="icon-chip ${cls}">${icon(iconName)}</div>
    <p>${text}</p>
    ${action ? html`<button class="btn" data-action="${action}">${label}</button>` : ''}
  </div>`;
}

export function errorCard(err, action = 'retry') {
  return html`<div class="card empty">
    <p>${err?.message || 'Не удалось загрузить данные'}</p>
    <button class="btn secondary" data-action="${action}">Повторить</button>
  </div>`;
}

export function sectionTitle(text, actionHtml = '') {
  return html`<div class="section-title"><span>${text}</span>${actionHtml}</div>`;
}

export function listRow({ title, subtitle, trail, iconName, iconCls = '', action, data = {}, chevron = !!action, cls = '' }) {
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return html`<div class="list-row ${iconName ? '' : 'no-icon'} ${cls}" ${action ? raw(`data-action="${esc(action)}" role="button" tabindex="0"`) : ''}${raw(attrs)}>
    ${iconName ? html`<div class="icon-chip ${iconCls}">${icon(iconName)}</div>` : ''}
    <div class="body"><div class="title">${title}</div>${subtitle ? html`<div class="subtitle">${subtitle}</div>` : ''}</div>
    ${trail != null || chevron ? html`<div class="trail">${trail ?? ''}${chevron ? icon('chevron', 'chev') : ''}</div>` : ''}
  </div>`;
}

export function segmented(name, options, value) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const w = 100 / options.length;
  return html`<div class="segmented" data-seg="${name}">
    <span class="indicator" style="width:calc(${w}% - 2px);transform:translateX(calc(${idx * 100}% + ${idx * 2 / options.length}px))"></span>
    ${options.map((o) => html`<button type="button" data-seg-btn data-value="${o.value}" aria-pressed="${o.value === value}">${o.label}</button>`)}
  </div>`;
}

export function chips(name, options, value, { multi = false, wrap = false, small = false, cls = '' } = {}) {
  const sel = multi ? new Set((value || []).map(String)) : new Set([String(value ?? '')]);
  return html`<div class="chips ${wrap ? 'wrap' : ''} ${cls}" data-chips="${name}" data-name="${name}" data-multi="${multi ? 1 : 0}" data-value="${multi ? [...sel].join(',') : value ?? ''}">
    ${options.map((o) => html`<button type="button" class="chip ${small ? 'small' : ''} ${sel.has(String(o.value)) ? 'on' : ''}" data-chip data-value="${o.value ?? ''}">${o.label}</button>`)}
  </div>`;
}

export function stepper(name, value, { min = 0, max = 999, step = 1 } = {}) {
  return html`<div class="stepper" data-stepper data-name="${name}" data-value="${value}" data-min="${min}" data-max="${max}" data-step="${step}">
    <button type="button" data-step-dir="-1" aria-label="Меньше">−</button>
    <span class="val">${String(value).replace('.', ',')}</span>
    <button type="button" data-step-dir="1" aria-label="Больше">+</button>
  </div>`;
}

export function toggle(name, checked, attrs = '') {
  return html`<label class="toggle"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${raw(attrs)} /><span></span></label>`;
}

// Глобальная обработка чипов, степперов и сегментов.
document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]');
  if (chip) {
    const box = chip.closest('[data-chips]');
    if (!box) return;
    const multi = box.dataset.multi === '1';
    if (multi) {
      chip.classList.toggle('on');
      box.dataset.value = [...box.querySelectorAll('[data-chip].on')].map((c) => c.dataset.value).join(',');
    } else {
      if (box.dataset.toggleable === '1' && chip.classList.contains('on')) {
        chip.classList.remove('on');
        box.dataset.value = '';
      } else {
        box.querySelectorAll('[data-chip]').forEach((c) => c.classList.toggle('on', c === chip));
        box.dataset.value = chip.dataset.value;
      }
    }
    selectionHaptic();
    box.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { name: box.dataset.name, value: box.dataset.value } }));
    return;
  }
  const stepBtn = e.target.closest('[data-step-dir]');
  if (stepBtn) {
    const st = stepBtn.closest('[data-stepper]');
    const d = st.dataset;
    const step = Number(d.step);
    let v = Number(d.value) + Number(stepBtn.dataset.stepDir) * step;
    v = Math.min(Number(d.max), Math.max(Number(d.min), Math.round(v * 100) / 100));
    d.value = v;
    st.querySelector('.val').textContent = String(v).replace('.', ',');
    haptic('light');
    st.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { name: d.name, value: v } }));
    return;
  }
  const seg = e.target.closest('[data-seg-btn]');
  if (seg) {
    const box = seg.closest('[data-seg]');
    const btns = [...box.querySelectorAll('[data-seg-btn]')];
    const idx = btns.indexOf(seg);
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b === seg)));
    box.querySelector('.indicator').style.transform = `translateX(calc(${idx * 100}% + ${(idx * 2) / btns.length}px))`;
    selectionHaptic();
    box.dispatchEvent(new CustomEvent('segchange', { bubbles: true, detail: { name: box.dataset.seg, value: seg.dataset.value } }));
  }
});

// ---------- Формы ----------
/**
 * Поле: { name, label, type: text|number|money|date|time|select|chips|multichips|toggle|textarea|stepper,
 *         options, min, max, step, placeholder, hint, inputmode }
 */
export function formFields(fields, values = {}) {
  return html`<div class="form">${fields.filter(Boolean).map((f) => field(f, values[f.name]))}</div>`;
}

function field(f, v) {
  const id = 'f_' + f.name;
  const hint = f.hint ? html`<div class="hint">${f.hint}</div>` : '';
  const lbl = html`<span class="lbl">${f.label}</span>`;
  switch (f.type) {
    case 'toggle':
      return html`<label class="field inline">${lbl}${toggle(f.name, !!v)}</label>`;
    case 'stepper':
      return html`<div class="field inline">${lbl}${stepper(f.name, v ?? f.min ?? 0, f)}</div>${hint}`;
    case 'chips':
    case 'multichips':
      return html`<div class="field"><span class="lbl">${f.label}</span>${chips(f.name, f.options, v, { multi: f.type === 'multichips', wrap: true, small: f.small })}${hint}</div>`;
    case 'select':
      return html`<label class="field" for="${id}">${lbl}<select id="${id}" name="${f.name}">
        ${f.options.map((o) => html`<option value="${o.value ?? ''}" ${String(o.value ?? '') === String(v ?? '') ? 'selected' : ''}>${o.label}</option>`)}
      </select>${hint}</label>`;
    case 'textarea':
      return html`<label class="field" for="${id}">${lbl}<textarea id="${id}" name="${f.name}" placeholder="${f.placeholder || ''}">${v ?? ''}</textarea>${hint}</label>`;
    case 'money':
      return html`<label class="field" for="${id}">${lbl}<input id="${id}" name="${f.name}" inputmode="decimal" autocomplete="off" placeholder="${f.placeholder || '0 ₽'}" value="${v == null ? '' : String(Number(v) / 100).replace('.', ',')}" />${hint}</label>`;
    case 'number':
      return html`<label class="field" for="${id}">${lbl}<input id="${id}" name="${f.name}" inputmode="${f.inputmode || 'decimal'}" autocomplete="off" placeholder="${f.placeholder || ''}" value="${v == null ? '' : String(v).replace('.', ',')}" />${hint}</label>`;
    case 'date':
    case 'time':
      return html`<label class="field" for="${id}">${lbl}<input id="${id}" type="${f.type}" name="${f.name}" value="${v ?? ''}" />${hint}</label>`;
    case 'custom':
      return f.html;
    default:
      return html`<label class="field" for="${id}">${lbl}<input id="${id}" name="${f.name}" autocomplete="off" placeholder="${f.placeholder || ''}" value="${v ?? ''}" maxlength="${f.max || 100}" />${hint}</label>`;
  }
}

const toNum = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/\s| /g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export function readFields(root, fields) {
  const out = {};
  for (const f of fields.filter(Boolean)) {
    if (f.type === 'custom') continue;
    if (['chips', 'multichips', 'stepper'].includes(f.type)) {
      const el = root.querySelector(`[data-name="${f.name}"]`);
      const v = el?.dataset.value ?? '';
      if (f.type === 'stepper') out[f.name] = Number(v);
      else if (f.type === 'multichips') out[f.name] = v ? v.split(',').map((x) => (f.numeric ? Number(x) : x)) : [];
      else out[f.name] = v === '' ? null : f.numeric ? Number(v) : v;
      continue;
    }
    const el = root.querySelector(`[name="${f.name}"]`);
    if (!el) continue;
    if (f.type === 'toggle') out[f.name] = el.checked;
    else if (f.type === 'money') {
      const n = toNum(el.value);
      out[f.name] = n == null ? null : Number.isNaN(n) ? NaN : Math.round(n * 100);
    } else if (f.type === 'number') out[f.name] = toNum(el.value);
    else if (f.type === 'select') out[f.name] = el.value === '' ? null : f.numeric ? Number(el.value) : el.value;
    else {
      const s = el.value.trim();
      out[f.name] = s === '' ? null : s;
    }
  }
  for (const f of fields.filter(Boolean)) {
    const v = out[f.name];
    if (typeof v === 'number' && Number.isNaN(v)) throw new Error(`Поле «${f.label}»: введите число`);
    if (f.required && (v == null || v === '' || (Array.isArray(v) && !v.length))) throw new Error(`Заполните поле «${f.label}»`);
  }
  return out;
}

/** Шторка с формой. onSubmit(values) → Promise; при ошибке данные формы сохраняются. */
export function formSheet({ title, fields, values = {}, submitText = 'Сохранить', onSubmit, onDelete, deleteText = 'Удалить', extra, onMount }) {
  return openSheet({
    title,
    body: html`${extra || ''}${formFields(fields, values)}
      <div class="sheet-actions">
        <button class="btn block" data-submit>${submitText}</button>
        ${onDelete ? html`<button class="btn block danger" data-delete>${deleteText}</button>` : ''}
      </div>`,
    onMount: (s) => {
      const submit = s.el.querySelector('[data-submit]');
      submit.addEventListener('click', async () => {
        let vals;
        try {
          vals = readFields(s.el, fields);
        } catch (e) {
          toastError(e);
          return;
        }
        submit.disabled = true;
        try {
          await onSubmit(vals, s);
          s.close();
        } catch (e) {
          toastError(e);
        } finally {
          submit.disabled = false;
        }
      });
      s.el.querySelector('[data-delete]')?.addEventListener('click', async () => {
        try {
          const ok = await onDelete(s);
          if (ok !== false) s.close();
        } catch (e) {
          toastError(e);
        }
      });
      onMount?.(s);
    }
  });
}

// ---------- Графики (SVG) ----------
export function ring(value, target, { size = 64, stroke = 7 } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = target > 0 ? Math.min(1, value / target) : 0;
  const over = target > 0 && value > target * 1.05;
  return raw(`<svg class="ring" viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px" role="img" aria-label="${Math.round(p * 100)}%">
    <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--c-food)"/><stop offset="1" stop-color="var(--ok)"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${over ? 'var(--warn)' : 'url(#rg)'}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="54%" text-anchor="middle" font-size="${size / 4.2}" font-weight="700" fill="var(--text)">${Math.round(p * 100)}%</text>
  </svg>`);
}

export function sparkline(values, { color = 'var(--accent)' } = {}) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return raw('');
  const w = 300;
  const h = 56;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * (w - 8) + 4, h - 6 - ((v - min) / span) * (h - 12)]);
  const last = xy[xy.length - 1];
  return raw(`<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" points="${xy.map((p) => p.join(',')).join(' ')}"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="${color}"/>
  </svg>`);
}

/** Горизонтальная полоса из сегментов [{value, color}] */
export function stackBar(segments, total) {
  const sum = total ?? segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (sum <= 0) return html`<div class="bar thick"></div>`;
  return html`<div class="bar thick">${segments
    .filter((s) => s.value > 0)
    .map((s) => raw(`<span style="width:${(s.value / sum) * 100}%;background:${s.color}"></span>`))}</div>`;
}

export function progressBar(p, color = 'var(--accent)') {
  const w = Math.max(0, Math.min(100, p));
  return raw(`<div class="bar"><span style="width:${w}%;background:${color}"></span></div>`);
}

export function priceChange(pctVal) {
  if (pctVal == null) return html`<span class="badge">—</span>`;
  if (Math.abs(pctVal) < 0.05) return html`<span class="badge">0%</span>`;
  const up = pctVal > 0;
  return html`<span class="badge ${up ? 'bad' : 'ok'}">${up ? '▲' : '▼'} ${fmt(Math.abs(pctVal), 1)}%</span>`;
}

export const TIER_LABEL = { cheap: 'Дёшево', middle: 'Средний', top: 'Премиум' };
export const tierBadge = (tier) => html`<span class="badge tier-badge tier-${tier}">${TIER_LABEL[tier] || tier}</span>`;

/** Загружает данные, показывая скелетон; при ошибке — карточку с повтором. */
export async function load(root, loader, draw, { skeletonRows = 3 } = {}) {
  render(root, skeleton(skeletonRows));
  const run = async () => {
    try {
      const data = await loader();
      await draw(data);
    } catch (e) {
      console.error(e);
      render(root, errorCard(e, 'retry-load'));
      root.querySelector('[data-action="retry-load"]')?.addEventListener('click', () => {
        render(root, skeleton(skeletonRows));
        run();
      });
    }
  };
  await run();
}
