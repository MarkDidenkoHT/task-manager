import { api, cached, invalidate, sp } from '../api.js';
import { icon } from '../icons.js';
import { m1, moneyHtml } from '../money.js';
import { go } from '../router.js';
import { header, headerHandlers, setFab } from '../shell.js';
import { canWrite, get } from '../store.js';
import { confirmDialog, notify, setMainButton } from '../tg.js';
import {
  addMonths, chips, delegate, empty, fmt, fmtDate, formSheet, html, listRow, load, monthName, openSheet, render,
  sectionTitle, stackBar, toast, toastError
} from '../ui.js';
import { openPurchaseSheet } from './purchase.js';

const TAX_MODES = [
  { value: 'ndfl_progressive', label: 'НДФЛ (прогрессивный)' },
  { value: 'flat', label: 'Фиксированная ставка' },
  { value: 'npd', label: 'Самозанятый (НПД)' },
  { value: 'none', label: 'Без налога' }
];
const PERIODS = [
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' }
];
const PERIOD_SHORT = { month: 'в мес.', quarter: 'в квартал', year: 'в год' };

const SEG = [
  { key: 'fixed', label: 'Обязательные', color: 'var(--c-money)' },
  { key: 'grocery', label: 'Продукты', color: 'var(--c-food)' },
  { key: 'pet', label: 'Питомцы', color: 'var(--c-pet)' },
  { key: 'other', label: 'Прочее', color: 'var(--warn)' },
  { key: 'left', label: 'Остаток', color: 'color-mix(in srgb, var(--text) 14%, transparent)' }
];

function quickActions(onSaved) {
  return [
    { label: 'Покупка', hint: 'Расход по категории', icon: 'receipt', cls: 'c-money', run: () => openPurchaseSheet({ onSaved }) },
    { label: 'Постоянный расход', hint: 'Аренда, связь, подписки', icon: 'calendar', cls: 'c-money', run: () => fixedSheet(null, onSaved) },
    { label: 'Доход', hint: 'Зарплата и налог', icon: 'coins', cls: 'c-money', run: () => incomeSheet(null, onSaved) }
  ];
}

export async function budget(root) {
  const off = delegate(root, { ...headerHandlers, go: (el) => go(el.dataset.to) });
  const draw = () =>
    load(root, async () => {
      const [s, plans] = await Promise.all([api(sp('/summary')), api(sp('/meal-plans'))]);
      return { s, active: plans.find((p) => p.status === 'active') };
    }, ({ s, active }) => {
      const fixedNoPets = s.fixed.total - s.fixed.pets;
      const parts = {
        fixed: fixedNoPets,
        grocery: s.spent.grocery,
        pet: s.spent.pet + s.fixed.pets,
        other: s.spent.other,
        left: Math.max(0, s.remaining)
      };
      render(
        root,
        html`${header()}
          <div class="card">
            <div class="stat"><div class="label">Свободно после обязательных</div><div class="hero ${s.free < 0 ? 'bad' : ''}">${moneyHtml(s.free)}</div></div>
            <div class="row between" style="margin-top:12px"><span class="muted">Осталось в этом месяце</span><b class="num ${s.remaining < 0 ? 'bad' : ''}">${m1(s.remaining)}</b></div>
            <div style="margin-top:12px">${stackBar(SEG.map((x) => ({ value: parts[x.key], color: x.color })), Math.max(s.income.net, s.fixed.total + s.spent.total))}</div>
            <div class="bar-legend">${SEG.filter((x) => parts[x.key] > 0).map((x) => html`<span><i style="background:${x.color}"></i>${x.label} ${m1(parts[x.key])}</span>`)}</div>
          </div>

          ${sectionTitle('Доход')}
          <div class="list">${listRow({
            title: html`<span class="num">${m1(s.income.net)}</span> <span class="muted small">чистыми в месяц</span>`,
            subtitle: s.income.sources.length ? `${m1(s.income.gross)} до налога · налог ${m1(s.income.tax)}` : 'Добавьте зарплату или другой доход',
            iconName: 'coins',
            iconCls: 'c-money',
            action: 'go',
            data: { to: '/budget/income' }
          })}</div>

          ${sectionTitle('Обязательные')}
          <div class="list">${listRow({
            title: html`<span class="num">${m1(s.fixed.total)}</span> <span class="muted small">в месяц</span>`,
            subtitle: s.fixed.count ? `${s.fixed.count} ${s.fixed.count === 1 ? 'платёж' : 'платежей'}, квартальные и годовые — в пересчёте на месяц` : 'Аренда, коммунальные, связь, подписки',
            iconName: 'calendar',
            iconCls: 'c-money',
            action: 'go',
            data: { to: '/budget/fixed' }
          })}</div>

          ${sectionTitle('Покупки', html`<button class="action" data-action="go" data-to="/budget/purchases">Все</button>`)}
          <div class="list">
            ${listRow({
              title: html`<span class="num">${m1(s.spent.total)}</span> <span class="muted small">за ${monthName(s.month).toLowerCase()}</span>`,
              iconName: 'receipt',
              iconCls: 'c-money',
              action: 'go',
              data: { to: '/budget/purchases' }
            })}
            ${s.by_category.slice(0, 5).map((c) =>
              listRow({ title: c.name, trail: html`<span class="num">${m1(c.total)}</span>`, action: 'go', data: { to: `/budget/purchases?cat=${c.category_id || ''}` } })
            )}
          </div>

          ${s.pets.length
            ? html`${sectionTitle('Питомцы')}<div class="list">${s.pets.map((p) =>
                listRow({
                  title: p.name,
                  subtitle: p.species || '',
                  iconName: 'pet',
                  iconCls: 'c-pet',
                  trail: html`<div style="text-align:right"><div class="num">${m1(p.spent_month + p.fixed_month)}</div><div class="caption">в этом месяце</div></div>`,
                  action: 'go',
                  data: { to: `/budget/purchases?pet=${p.id}` }
                })
              )}</div>`
            : ''}

          ${active
            ? html`${sectionTitle('Питание')}<div class="list">${listRow({
                title: 'План против факта',
                subtitle: 'Что куплено из активного плана',
                iconName: 'chart',
                iconCls: 'c-food',
                action: 'go',
                data: { to: `/food/plan/${active.id}/check` }
              })}</div>`
            : ''}
          <p class="caption" style="margin:16px">Курс: 1 $ = ${fmt(get('space')?.usd_rate, 2)} ₽ (меняется в настройках).</p>`
      );
    }, { skeletonRows: 6 });
  setFab(quickActions(draw));
  await draw();
  return { destroy: off };
}

// ---------- Доходы ----------
export function incomeSheet(row, onSaved) {
  const fields = [
    { name: 'name', label: 'Название', required: true, placeholder: 'Зарплата' },
    { name: 'gross_monthly_minor', label: 'В месяц до налога', type: 'money', required: true },
    { name: 'tax_mode', label: 'Налог', type: 'chips', small: true, options: TAX_MODES },
    { name: 'flat_rate', label: 'Ставка, %', type: 'number', hint: 'Для фиксированной ставки или НПД (4% с физлиц, 6% с юрлиц)' },
    { name: 'active', label: 'Учитывать', type: 'toggle' }
  ];
  formSheet({
    title: row ? 'Доход' : 'Новый доход',
    fields,
    values: row || { tax_mode: 'ndfl_progressive', active: true },
    onSubmit: async (v) => {
      const body = { ...v, flat_rate: v.tax_mode === 'flat' || v.tax_mode === 'npd' ? v.flat_rate : null };
      await api(row ? sp(`/income/${row.id}`) : sp('/income'), { method: row ? 'PATCH' : 'POST', body });
      notify('success');
      onSaved?.();
    },
    onDelete: row
      ? async () => {
          if (!(await confirmDialog('Удалить этот доход?'))) return false;
          await api(sp(`/income/${row.id}`), { method: 'DELETE' });
          onSaved?.();
        }
      : null
  });
}

export async function income(root) {
  const draw = () =>
    load(root, () => api(sp('/income')), (rows) => {
      const total = rows.filter((r) => r.active).reduce((a, r) => a + r.net_monthly_minor, 0);
      render(
        root,
        html`<h1 class="screen-title">Доход</h1>
          <div class="card"><div class="stat"><div class="label">Чистыми в месяц</div><div class="hero">${moneyHtml(total)}</div></div></div>
          ${rows.length
            ? html`<div class="list" style="margin-top:12px">${rows.map((r) =>
                listRow({
                  title: html`${r.name}${r.active ? '' : html` <span class="badge">выкл.</span>`}`,
                  subtitle: `${m1(r.gross_monthly_minor)} до налога · ${TAX_MODES.find((t) => t.value === r.tax_mode)?.label}${r.flat_rate ? ' ' + fmt(r.flat_rate, 2) + '%' : ''}`,
                  trail: html`<div style="text-align:right"><div class="num">${m1(r.net_monthly_minor)}</div><div class="caption">налог ${m1(r.tax_monthly_minor)}</div></div>`,
                  action: canWrite() ? 'edit' : null,
                  data: { id: r.id }
                })
              )}</div>`
            : html`<div class="card" style="margin-top:12px">${empty({ iconName: 'coins', cls: 'c-money', text: 'Добавьте первый источник дохода' })}</div>`}
          <div class="notice" style="margin-top:12px">Месячная сумма — среднегодовая: при прогрессивной шкале реальное удержание идёт нарастающим итогом, поэтому отдельный месяц может отличаться. Шкала НДФЛ редактируется в «Ещё → Налоги».</div>`
      );
      root.onclick = (e) => {
        const row = e.target.closest('[data-action="edit"]');
        if (row) incomeSheet(rows.find((r) => r.id === row.dataset.id), draw);
      };
    });
  if (canWrite()) setMainButton('Добавить доход', () => incomeSheet(null, draw));
  await draw();
}

// ---------- Постоянные расходы ----------
export async function fixedSheet(row, onSaved) {
  let cats, profiles;
  try {
    [cats, profiles] = await Promise.all([cached(sp('/categories')), cached(sp('/profiles'))]);
  } catch (e) {
    toastError(e);
    return;
  }
  const pets = profiles.filter((p) => p.kind === 'pet');
  const sorted = [...cats].sort((a, b) => (a.kind === 'fixed' ? -1 : 0) - (b.kind === 'fixed' ? -1 : 0));
  const fields = [
    { name: 'name', label: 'Название', required: true, placeholder: 'Аренда квартиры' },
    { name: 'amount_minor', label: 'Сумма', type: 'money', required: true },
    { name: 'period', label: 'Период', type: 'chips', small: true, options: PERIODS },
    { name: 'due_day', label: 'День оплаты (1–31)', type: 'number', inputmode: 'numeric' },
    { name: 'category_id', label: 'Категория', type: 'select', options: [{ value: '', label: '—' }, ...sorted.map((c) => ({ value: c.id, label: c.name }))] },
    pets.length ? { name: 'pet_id', label: 'Питомец', type: 'select', options: [{ value: '', label: 'Нет' }, ...pets.map((p) => ({ value: p.id, label: p.name }))] } : null,
    { name: 'active', label: 'Учитывать', type: 'toggle' }
  ];
  formSheet({
    title: row ? 'Обязательный расход' : 'Новый обязательный расход',
    fields,
    values: row || { period: 'month', active: true, category_id: cats.find((c) => c.kind === 'fixed')?.id },
    onSubmit: async (v) => {
      if (v.due_day != null && (v.due_day < 1 || v.due_day > 31)) throw new Error('День оплаты — от 1 до 31');
      const body = { ...v, category_id: v.category_id || null, pet_id: v.pet_id || null, due_day: v.due_day ? Math.round(v.due_day) : null };
      await api(row ? sp(`/fixed-costs/${row.id}`) : sp('/fixed-costs'), { method: row ? 'PATCH' : 'POST', body });
      notify('success');
      onSaved?.();
    },
    onDelete: row
      ? async () => {
          if (!(await confirmDialog('Удалить этот расход?'))) return false;
          await api(sp(`/fixed-costs/${row.id}`), { method: 'DELETE' });
          onSaved?.();
        }
      : null
  });
}

export async function fixedCosts(root) {
  const draw = () =>
    load(root, () => api(sp('/fixed-costs')), (rows) => {
      const total = rows.filter((r) => r.active).reduce((a, r) => a + r.monthly_minor, 0);
      render(
        root,
        html`<h1 class="screen-title">Обязательные расходы</h1>
          <div class="card"><div class="stat"><div class="label">В месяц</div><div class="hero">${moneyHtml(total)}</div></div></div>
          ${rows.length
            ? html`<div class="list" style="margin-top:12px">${rows.map((r) =>
                listRow({
                  title: html`${r.name}${r.active ? '' : html` <span class="badge">выкл.</span>`}`,
                  subtitle: `${m1(r.amount_minor)} ${PERIOD_SHORT[r.period]}${r.due_day ? ` · до ${r.due_day}-го числа` : ''}`,
                  iconName: r.pet_id ? 'pet' : 'calendar',
                  iconCls: r.pet_id ? 'c-pet' : 'c-money',
                  trail: r.period !== 'month' ? html`<div style="text-align:right"><div class="num">${m1(r.monthly_minor)}</div><div class="caption">в мес.</div></div>` : html`<span class="num">${m1(r.monthly_minor)}</span>`,
                  action: canWrite() ? 'edit' : null,
                  data: { id: r.id }
                })
              )}</div>`
            : html`<div class="card" style="margin-top:12px">${empty({ iconName: 'calendar', cls: 'c-money', text: 'Добавьте аренду, коммунальные платежи, связь и подписки' })}</div>`}
          <p class="caption" style="margin:12px 16px">Напоминание о дне оплаты можно добавить в «Развитие → Напоминания».</p>`
      );
      root.onclick = (e) => {
        const row = e.target.closest('[data-action="edit"]');
        if (row) fixedSheet(rows.find((r) => r.id === row.dataset.id), draw);
      };
    });
  if (canWrite()) setMainButton('Добавить расход', () => fixedSheet(null, draw));
  await draw();
}

// ---------- Покупки ----------
export async function purchases(root, _p, q) {
  let month = null;
  let cat = q.get('cat') || '';
  const pet = q.get('pet') || '';
  let cats = [];
  let stores = [];
  let profiles = [];

  const off = delegate(root, {
    prev: () => {
      month = addMonths(month, -1);
      draw();
    },
    next: () => {
      month = addMonths(month, 1);
      draw();
    },
    open: (el) => openPurchase(el.dataset.id)
  });
  let data = null;

  const draw = () =>
    load(root, async () => {
      [cats, stores, profiles] = await Promise.all([cached(sp('/categories')), cached(sp('/stores')), cached(sp('/profiles'))]);
      const params = new URLSearchParams();
      if (month) params.set('month', month);
      if (cat) params.set('category_id', cat);
      if (pet) params.set('pet_id', pet);
      data = await api(sp('/purchases?' + params));
      month = data.month;
      return data;
    }, (d) => {
      const byDay = new Map();
      for (const p of d.purchases) byDay.set(p.purchased_on, [...(byDay.get(p.purchased_on) || []), p]);
      const total = d.purchases.reduce((a, p) => a + Number(p.total_minor), 0);
      const catName = (id) => cats.find((c) => c.id === id)?.name || 'Без категории';
      const storeName = (id) => stores.find((s) => s.id === id)?.name;
      const petName = (id) => profiles.find((p) => p.id === id)?.name;
      render(
        root,
        html`<div class="row between" style="margin-bottom:12px">
            <button class="icon-btn" data-action="prev" aria-label="Предыдущий месяц" style="transform:rotate(180deg)">${icon('chevron')}</button>
            <div style="text-align:center"><div class="card-title">${monthName(d.month)}</div><div class="caption num">${m1(total)}</div></div>
            <button class="icon-btn" data-action="next" aria-label="Следующий месяц">${icon('chevron')}</button>
          </div>
          ${pet ? html`<div class="notice" style="margin-bottom:12px">Покупки питомца: ${petName(pet) || ''}</div>` : ''}
          ${chips('cat', [{ value: '', label: 'Все' }, ...cats.map((c) => ({ value: c.id, label: c.name }))], cat, { small: true })}
          ${d.purchases.length
            ? [...byDay.entries()].map(
                ([day, list]) => html`<div class="day-head"><span>${fmtDate(day, { weekday: true })}</span><span class="num">${m1(list.reduce((a, p) => a + Number(p.total_minor), 0))}</span></div>
                  <div class="list">${list.map((p) =>
                    listRow({
                      title: catName(p.category_id),
                      subtitle: [storeName(p.store_id), petName(p.pet_id), p.note, p.purchase_items?.length ? `${p.purchase_items.length} поз.` : ''].filter(Boolean).join(' · ') || ' ',
                      iconName: p.pet_id ? 'pet' : 'receipt',
                      iconCls: p.pet_id ? 'c-pet' : 'c-money',
                      trail: html`<span class="num">${m1(p.total_minor)}</span>`,
                      action: 'open',
                      data: { id: p.id },
                      chevron: false
                    })
                  )}</div>`
              )
            : html`<div class="card" style="margin-top:12px">${empty({ iconName: 'receipt', cls: 'c-money', text: 'Покупок за этот месяц нет' })}</div>`}`
      );
    });

  function openPurchase(id) {
    const p = data.purchases.find((x) => x.id === id);
    if (!p) return;
    const s = openSheet({
      title: m1(p.total_minor, { exact: true }),
      body: html`<div class="card" style="background:var(--fill)">
          <div class="kv"><span class="k">Дата</span><span>${fmtDate(p.purchased_on)}</span></div>
          <div class="kv"><span class="k">Категория</span><span>${cats.find((c) => c.id === p.category_id)?.name || '—'}</span></div>
          ${p.store_id ? html`<div class="kv"><span class="k">Магазин</span><span>${stores.find((x) => x.id === p.store_id)?.name}</span></div>` : ''}
          ${p.note ? html`<div class="kv"><span class="k">Заметка</span><span>${p.note}</span></div>` : ''}
        </div>
        ${p.purchase_items?.length
          ? html`<div class="section-title" style="margin-left:0">Позиции</div><div class="list plain" style="background:var(--fill)">${p.purchase_items.map(
              (i) => html`<div class="list-row no-icon"><div class="body"><div class="title">${i.label || '—'}</div>${i.qty ? html`<div class="subtitle">${fmt(i.qty, 1)}</div>` : ''}</div><div class="trail num">${m1(i.price_minor, { exact: true })}</div></div>`
            )}</div>`
          : ''}
        ${canWrite() ? html`<div class="sheet-actions"><button class="btn block danger" data-del>${icon('trash')} Удалить покупку</button></div>` : ''}`
    });
    s.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Удалить покупку?'))) return;
      try {
        await api(sp(`/purchases/${id}`), { method: 'DELETE' });
        s.close();
        toast('Покупка удалена');
        draw();
      } catch (e) {
        toastError(e);
      }
    });
  }

  root.addEventListener('change', (e) => {
    if (e.detail?.name === 'cat') {
      cat = e.detail.value;
      draw();
    }
  });
  setFab([{ label: 'Покупка', icon: 'receipt', cls: 'c-money', run: () => openPurchaseSheet({ onSaved: () => { invalidate(); draw(); } }) }]);
  await draw();
  return { destroy: off };
}

