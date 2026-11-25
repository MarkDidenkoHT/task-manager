import { api, cached, invalidate, sp } from '../api.js';
import { icon } from '../icons.js';
import { m1, moneyHtml } from '../money.js';
import { go, query } from '../router.js';
import { header, headerHandlers, setFab } from '../shell.js';
import { canWrite, get } from '../store.js';
import { notify } from '../tg.js';
import {
  chips, delegate, empty, fmt, fmtDate, html, listRow, load, openSheet, plural, priceChange, render, sectionTitle,
  segmented, stepper, tierBadge, toast, toastError
} from '../ui.js';
import { renderGrocery } from './grocery.js';

const TABS = [
  { value: 'plans', label: 'Планы' },
  { value: 'products', label: 'Продукты' },
  { value: 'list', label: 'Список' }
];

/** Цена за кг / л / шт для отображения. */
export function unitPrice(p, price = p.price) {
  if (!price) return null;
  if (p.unit === 'pcs') return { minor: price.per_unit, unit: 'шт' };
  return { minor: price.per_unit * 1000, unit: p.unit === 'ml' ? 'л' : 'кг' };
}

export async function food(root) {
  const q = query();
  let tab = q.get('tab') || 'plans';
  let stopInner = null;

  render(root, html`${header('Еда')}${segmented('tab', TABS, tab)}<div id="tab-body"></div>`);
  const body = root.querySelector('#tab-body');
  const offHeader = delegate(root, headerHandlers);

  const show = async () => {
    stopInner?.();
    stopInner = null;
    history.replaceState(null, '', `#/food?tab=${tab}`);
    if (tab === 'plans') stopInner = await plansTab(body);
    else if (tab === 'products') stopInner = await productsTab(body);
    else stopInner = await listTab(body);
  };
  root.addEventListener('segchange', (e) => {
    if (e.detail.name !== 'tab') return;
    tab = e.detail.value;
    show();
  });
  await show();
  if (q.get('new') === '1' && canWrite()) openGenerateSheet();
  return {
    destroy() {
      stopInner?.();
      offHeader();
    }
  };
}

// ---------- Планы ----------
async function plansTab(body) {
  setFab([
    { label: 'Новый план питания', hint: 'Три варианта с ценами', icon: 'food', cls: 'c-food', run: openGenerateSheet },
    { label: 'Продукт', icon: 'tag', cls: 'c-food', run: () => go('/food/product/new/edit') }
  ]);
  const off = delegate(body, {
    go: (el) => go(el.dataset.to),
    generate: () => openGenerateSheet()
  });
  await load(body, () => api(sp('/meal-plans')), (plans) => {
    const active = plans.find((p) => p.status === 'active');
    const drafts = plans.filter((p) => p.status === 'draft');
    const batch = drafts[0]?.batch_id;
    const done = plans.filter((p) => p.status === 'done').slice(0, 10);
    render(
      body,
      html`${active
        ? html`${sectionTitle('Активный план')}
          <div class="card tap" data-action="go" data-to="/food/plan/${active.id}">
            <div class="row between">${tierBadge(active.tier)}<span class="muted small">с ${fmtDate(active.start_on).toLowerCase()}</span></div>
            <div class="stat" style="margin-top:8px"><div class="hero md">${moneyHtml(active.total_minor)}</div>
            <div class="sub">${active.days} ${plural(active.days, 'день', 'дня', 'дней')} · ${m1(active.total_minor / active.days)} в день</div></div>
          </div>
          <div class="btn-row">
            <button class="btn secondary" data-action="go" data-to="/food/plan/${active.id}/list">${icon('cart')} Список</button>
            <button class="btn secondary" data-action="go" data-to="/food/plan/${active.id}/check">${icon('chart')} План/факт</button>
          </div>`
        : ''}
      ${sectionTitle('Новый план')}
      <div class="card tap" ${canWrite() ? html`data-action="generate"` : ''}>
        <div class="row"><div class="icon-chip c-food">${icon('sparkle')}</div>
          <div class="grow"><div class="card-title">Сгенерировать план</div><div class="caption">Подбор продуктов под ваши КБЖУ: дёшево, средний и премиум, с ценами по магазинам</div></div>
          ${icon('chevron', 'chev')}</div>
      </div>
      ${batch
        ? html`${sectionTitle('Последняя генерация')}
          <div class="list">${listRow({
            title: html`${drafts.map((d) => html`${tierBadge(d.tier)} `)}`,
            subtitle: `${drafts[0].days} ${plural(drafts[0].days, 'день', 'дня', 'дней')} · от ${m1(Math.min(...drafts.map((d) => d.total_minor)))}`,
            action: 'go',
            data: { to: `/food/batch/${batch}` }
          })}</div>`
        : ''}
      ${done.length
        ? html`${sectionTitle('Прошлые планы')}<div class="list">${done.map((p) =>
            listRow({
              title: html`${tierBadge(p.tier)} <span class="small">${p.days} ${plural(p.days, 'день', 'дня', 'дней')}</span>`,
              subtitle: `с ${fmtDate(p.start_on).toLowerCase()}`,
              trail: html`<span class="num">${m1(p.total_minor)}</span>`,
              action: 'go',
              data: { to: `/food/plan/${p.id}` }
            })
          )}</div>`
        : ''}`
    );
  });
  return off;
}

export async function openGenerateSheet() {
  let profiles, stores, products;
  try {
    [profiles, stores, products] = await Promise.all([cached(sp('/profiles')), cached(sp('/stores')), cached(sp('/products'))]);
  } catch (e) {
    toastError(e);
    return;
  }
  const people = profiles.filter((p) => p.active && p.kind !== 'pet');
  if (!people.length) {
    toast('Сначала добавьте людей в разделе «Ещё → Люди»', 'error');
    return;
  }
  if (!products.some((p) => p.price)) {
    toast('Добавьте продукты и укажите цены', 'error');
    go('/food?tab=products');
    return;
  }
  const me = people.find((p) => Number(p.tg_id) === Number(get('me')?.id)) || people[0];
  const exclude = new Set();
  const s = openSheet({
    title: 'Новый план',
    body: html`<div class="form">
        <div class="field inline"><span class="lbl">Дни</span>${stepper('days', 7, { min: 1, max: 31 })}</div>
        <div class="field inline"><span class="lbl">Приёмов в день</span>${stepper('meals', me.meals_per_day || 3, { min: 1, max: 6 })}</div>
        <div class="field"><span class="lbl">Люди</span>
          ${chips('people', people.map((p) => ({ value: p.id, label: p.name + (p.targets ? '' : ' ⚠') })), people.filter((p) => p.targets).map((p) => p.id), { multi: true, wrap: true, small: true })}
          <div class="hint">По умолчанию приёмов берётся из профиля; здесь можно переопределить для всех.</div>
        </div>
        <div class="field"><span class="lbl">Магазин</span>
          ${chips('store', [{ value: '', label: 'Любой' }, ...stores.map((x) => ({ value: x.id, label: x.name }))], '', { wrap: true, small: true })}
        </div>
        <div class="field"><span class="lbl">Исключить</span>
          <div id="excl" class="chips wrap"></div>
          <button class="btn ghost small" data-excl style="padding-left:0">${icon('plus')} продукт</button>
        </div>
      </div>
      <div class="sheet-actions"><button class="btn block" data-go>Сгенерировать</button></div>
      <p class="caption" style="margin-top:8px">Подбор — математическая оптимизация по ценам и КБЖУ. Это не медицинская рекомендация.</p>`
  });
  let mealsTouched = false;
  s.el.querySelector('[data-name="meals"]').addEventListener('change', () => (mealsTouched = true));
  const drawExcl = () =>
    render(
      s.el.querySelector('#excl'),
      html`${[...exclude].map((id) => html`<button class="chip small on" data-unexcl="${id}">${products.find((p) => p.id === id)?.name} ✕</button>`)}`
    );
  s.el.addEventListener('click', (e) => {
    const un = e.target.closest('[data-unexcl]');
    if (un) {
      exclude.delete(un.dataset.unexcl);
      drawExcl();
    }
    if (e.target.closest('[data-excl]')) {
      const pick = openSheet({
        title: 'Исключить продукт',
        body: html`<div class="list plain">${products
          .filter((p) => p.price && !exclude.has(p.id))
          .map((p) => listRow({ title: p.name, action: 'x', data: { id: p.id }, chevron: false }))}</div>`
      });
      pick.el.addEventListener('click', (ev) => {
        const row = ev.target.closest('[data-action="x"]');
        if (!row) return;
        exclude.add(row.dataset.id);
        drawExcl();
        pick.close();
      });
    }
  });
  s.el.querySelector('[data-go]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const val = (n) => s.el.querySelector(`[data-name="${n}"]`).dataset.value;
    const ids = val('people') ? val('people').split(',') : [];
    if (!ids.length) return toast('Выберите хотя бы одного человека', 'error');
    btn.disabled = true;
    btn.textContent = 'Считаю варианты…';
    try {
      const res = await api(sp('/meal-plans/generate'), {
        method: 'POST',
        body: {
          days: Number(val('days')),
          meals_per_day: mealsTouched ? Number(val('meals')) : null,
          profile_ids: ids,
          store_id: val('store') || null,
          exclude: [...exclude]
        }
      });
      notify('success');
      s.close();
      go(`/food/batch/${res.batch_id}`);
    } catch (err) {
      toastError(err);
      btn.disabled = false;
      btn.textContent = 'Сгенерировать';
    }
  });
}

// ---------- Продукты ----------
async function productsTab(body) {
  setFab([
    { label: 'Продукт', icon: 'tag', cls: 'c-food', run: () => go('/food/product/new/edit') },
    { label: 'Магазины', icon: 'store', cls: 'c-gray', run: () => go('/food/stores') }
  ]);
  let search = '';
  let cat = '';
  let data = null;
  let stores = [];

  const off = delegate(body, {
    go: (el) => go(el.dataset.to),
    starter: async (el) => {
      el.disabled = true;
      try {
        const r = await api(sp('/products/starter'), { method: 'POST' });
        invalidate(sp('/products'));
        toast(`Добавлено продуктов: ${r.added}. Теперь укажите цены.`, 'success');
        await reloadData();
      } catch (e) {
        toastError(e);
        el.disabled = false;
      }
    },
    'new-product': () => go('/food/product/new/edit')
  });

  const reloadData = () =>
    load(body, async () => {
      [data, stores] = await Promise.all([api(sp('/products')), cached(sp('/stores'))]);
      return data;
    }, drawAll);

  function drawAll() {
    if (!data.length) {
      render(
        body,
        html`<div class="card">${empty({
          iconName: 'tag',
          cls: 'c-food',
          text: 'Добавьте первый продукт. Можно начать с базового набора: 24 продукта с КБЖУ — останется только ввести цены.'
        })}
        ${canWrite() ? html`<div class="btn-row"><button class="btn" data-action="starter">Базовый набор</button><button class="btn secondary" data-action="new-product">Свой продукт</button></div>` : ''}</div>`
      );
      return;
    }
    const cats = [...new Map(data.filter((p) => p.category_id).map((p) => [p.category_id, p.category_id])).keys()];
    render(
      body,
      html`<div class="form" style="margin-bottom:12px"><label class="field" style="display:flex;align-items:center;gap:8px">${icon('search')}<input id="q" placeholder="Поиск продукта" value="${search}" autocomplete="off" /></label></div>
        <div id="cat-chips"></div>
        <div id="plist" style="margin-top:12px"></div>
        ${canWrite() ? html`<div class="btn-row"><button class="btn ghost" data-action="go" data-to="/food/stores">${icon('store')} Магазины (${stores.length})</button></div>` : ''}`
    );
    // Категории подгружаем для подписей
    cached(sp('/categories')).then((all) => {
      const used = all.filter((c) => cats.includes(c.id));
      if (used.length > 1) {
        render(body.querySelector('#cat-chips'), chips('cat', [{ value: '', label: 'Все' }, ...used.map((c) => ({ value: c.id, label: c.name }))], cat, { small: true }));
      }
    }).catch(() => {});
    body.querySelector('#q').addEventListener('input', (e) => {
      search = e.target.value.trim().toLowerCase();
      drawList();
    });
    drawList();
  }
  const onCat = (e) => {
    if (e.detail?.name === 'cat') {
      cat = e.detail.value;
      drawList();
    }
  };
  body.addEventListener('change', onCat);

  function drawList() {
    const rows = data.filter((p) => (!search || p.name.toLowerCase().includes(search)) && (!cat || p.category_id === cat));
    const storeName = (id) => stores.find((s) => s.id === id)?.name;
    render(
      body.querySelector('#plist'),
      rows.length
        ? html`<div class="list">${rows.map((p) => {
            const up = unitPrice(p);
            return listRow({
              title: html`${p.name}${p.active ? '' : html` <span class="badge">выкл.</span>`}`,
              subtitle: html`<span class="macro-chips" style="margin-top:3px"><span class="macro">К <b>${fmt(p.kcal_100)}</b></span><span class="macro">Б <b>${fmt(p.protein_100, 1)}</b></span><span class="macro">Ж <b>${fmt(p.fat_100, 1)}</b></span><span class="macro">У <b>${fmt(p.carbs_100, 1)}</b></span></span>`,
              trail: up
                ? html`<div style="text-align:right"><div class="num">${m1(up.minor)}/${up.unit}</div><div class="caption">${p.general_price ? '' : storeName(p.price.store_id) || ''} ${priceChange(p.price.change_pct)}</div></div>`
                : html`<span class="badge warn">нет цены</span>`,
              action: 'go',
              data: { to: `/food/product/${p.id}` }
            });
          })}</div>`
        : html`<div class="card"><p class="muted">Ничего не найдено</p></div>`
    );
  }

  await reloadData();
  return () => {
    off();
    body.removeEventListener('change', onCat);
  };
}

// ---------- Список ----------
async function listTab(body) {
  setFab(null);
  let stop = null;
  await load(body, () => api(sp('/meal-plans')), async (plans) => {
    const active = plans.find((p) => p.status === 'active');
    if (!active) {
      render(
        body,
        html`<div class="card">${empty({ iconName: 'cart', cls: 'c-food', text: 'Список покупок строится из активного плана питания. Сгенерируйте план и сделайте его активным.' })}</div>`
      );
      return;
    }
    stop = await renderGrocery(body, active.id);
  });
  return () => stop?.();
}
