import { api, cached, invalidate, sp } from '../api.js';
import { icon } from '../icons.js';
import { m1 } from '../money.js';
import { back, go } from '../router.js';
import { canWrite } from '../store.js';
import { confirmDialog, notify, setMainButton } from '../tg.js';
import {
  delegate, fmt, fmtDate, formFields, formSheet, html, load, priceChange, readFields, render, sectionTitle,
  sparkline, toast, toastError, todayStr, UNIT
} from '../ui.js';
import { unitPrice } from './food.js';

const QUALITY = [
  { value: 1, label: 'Базовое' },
  { value: 2, label: 'Обычное' },
  { value: 3, label: 'Премиум' }
];
const SLOTS = [
  { value: 'breakfast', label: 'Завтрак' },
  { value: 'main', label: 'Основной приём' },
  { value: 'snack', label: 'Перекус' }
];

export async function product(root, { id }) {
  if (id === 'new') return productEdit(root, { id });
  let stores = [];
  const off = delegate(root, {
    edit: () => go(`/food/product/${id}/edit`),
    'del-price': async (el) => {
      if (!(await confirmDialog('Удалить эту запись о цене?'))) return;
      try {
        await api(sp(`/products/${id}/prices/${el.dataset.id}`), { method: 'DELETE' });
        invalidate(sp('/products'));
        draw();
      } catch (e) {
        toastError(e);
      }
    }
  });

  async function draw() {
    await load(root, async () => {
      const [p, s] = await Promise.all([api(sp(`/products/${id}`)), cached(sp('/stores'))]);
      stores = s;
      return p;
    }, (p) => {
      const up = unitPrice(p);
      const storeName = (sid) => (sid ? stores.find((s) => s.id === sid)?.name || 'Магазин' : 'Общая цена');
      const hist = [...p.history].reverse();
      const series = hist.filter((h) => h.store_id === (p.general_price ? null : p.price?.store_id)).map((h) => Number(h.price_minor) / Number(h.pack_qty));
      const cheapest = p.cheapest_store_id;
      render(
        root,
        html`<h1 class="screen-title" style="margin-bottom:4px">${p.name}</h1>
          <p class="screen-sub" style="margin-top:0">${p.unit === 'pcs' ? `Штучный, ${fmt(p.grams_per_piece)} г за штуку` : p.unit === 'ml' ? 'Жидкий, мл' : 'Весовой, г'}${p.active ? '' : ' · не участвует в планах'}</p>

          <div class="card">
            <div class="row between">
              <div class="stat"><div class="label">Цена сейчас</div>
                <div class="hero md">${up ? html`${m1(up.minor)}<span class="muted" style="font-size:16px;font-weight:500"> / ${up.unit}</span>` : '—'}</div>
              </div>
              ${p.price ? priceChange(p.price.change_pct) : ''}
            </div>
            ${series.length > 1 ? html`<div style="margin-top:8px">${sparkline(series)}</div>` : ''}
            ${p.price ? html`<div class="caption">Упаковка ${fmt(p.price.pack_qty)} ${UNIT[p.unit]} за ${m1(p.price.price_minor, { exact: true })} · ${fmtDate(p.price.observed_on)}</div>` : html`<p class="muted small">Добавьте цену, чтобы продукт участвовал в планах.</p>`}
          </div>

          ${sectionTitle('На 100 г', canWrite() ? html`<button class="action" data-action="edit">${icon('edit')}</button>` : '')}
          <div class="card macro-grid">
            <div><div class="v">${fmt(p.kcal_100)}</div><div class="l">ккал</div></div>
            <div><div class="v">${fmt(p.protein_100, 1)}</div><div class="l">белки</div></div>
            <div><div class="v">${fmt(p.fat_100, 1)}</div><div class="l">жиры</div></div>
            <div><div class="v">${fmt(p.carbs_100, 1)}</div><div class="l">углеводы</div></div>
          </div>

          ${p.store_prices.length || p.general_price
            ? html`${sectionTitle('Цены по магазинам')}
              <div class="list plain">${[...(p.general_price ? [p.general_price] : []), ...p.store_prices].map((sp2) => {
                const u = unitPrice(p, sp2);
                return html`<div class="list-row no-icon">
                  <div class="body"><div class="title">${sp2.store_id === cheapest && p.store_prices.length > 1 ? html`<span class="dot"></span> ` : ''}${storeName(sp2.store_id)}</div><div class="subtitle">${fmtDate(sp2.observed_on)}</div></div>
                  <div class="trail"><span class="num">${m1(u.minor)}/${u.unit}</span>${priceChange(sp2.change_pct)}</div>
                </div>`;
              })}</div>`
            : ''}

          ${p.history.length
            ? html`${sectionTitle('История цен')}
              <div class="list plain">${p.history.slice(0, 20).map(
                (h) => html`<div class="list-row no-icon">
                  <div class="body"><div class="title num">${m1(h.price_minor, { exact: true })} за ${fmt(h.pack_qty)} ${UNIT[p.unit]}</div><div class="subtitle">${storeName(h.store_id)} · ${fmtDate(h.observed_on)}</div></div>
                  ${canWrite() ? html`<div class="trail"><button class="icon-btn" data-action="del-price" data-id="${h.id}" aria-label="Удалить">${icon('trash')}</button></div>` : ''}
                </div>`
              )}</div>`
            : ''}

          ${sectionTitle('Ограничения для планов')}
          <div class="card">
            <div class="kv"><span class="k">В день</span><span>${fmt(p.min_g_day)}–${fmt(p.max_g_day)} ${p.unit === 'ml' ? 'мл' : 'г'}</span></div>
            <div class="kv"><span class="k">Качество</span><span>${QUALITY.find((q) => q.value === p.quality)?.label}</span></div>
            <div class="kv"><span class="k">Приёмы пищи</span><span>${p.slots.map((s) => SLOTS.find((x) => x.value === s)?.label).join(', ')}</span></div>
          </div>`
      );
      if (canWrite()) setMainButton('Добавить цену', () => openPriceSheet(p, stores, draw));
    });
  }
  await draw();
  return { destroy: off };
}

export function openPriceSheet(p, stores, onSaved) {
  const fields = [
    {
      name: 'store_id',
      label: 'Магазин',
      type: 'chips',
      small: true,
      options: [{ value: '', label: 'Общая цена' }, ...stores.map((s) => ({ value: s.id, label: s.name }))]
    },
    { name: 'pack_qty', label: `Размер упаковки, ${UNIT[p.unit]}`, type: 'number', required: true, placeholder: p.unit === 'pcs' ? '10' : '1000' },
    { name: 'price_minor', label: 'Цена упаковки', type: 'money', required: true },
    { name: 'observed_on', label: 'Дата', type: 'date' }
  ];
  formSheet({
    title: 'Новая цена',
    fields,
    values: { store_id: p.price?.store_id ?? '', pack_qty: p.price?.pack_qty ?? '', observed_on: todayStr() },
    submitText: 'Сохранить цену',
    onSubmit: async (v) => {
      if (!(v.pack_qty > 0)) throw new Error('Укажите размер упаковки');
      await api(sp(`/products/${p.id}/prices`), {
        method: 'POST',
        body: { store_id: v.store_id || null, pack_qty: v.pack_qty, price_minor: v.price_minor, observed_on: v.observed_on || undefined }
      });
      invalidate(sp('/products'));
      notify('success');
      toast('Цена сохранена', 'success');
      onSaved?.();
    }
  });
}

export async function productEdit(root, { id }) {
  const isNew = id === 'new';
  await load(root, async () => {
    const [cats, p] = await Promise.all([cached(sp('/categories')), isNew ? null : api(sp(`/products/${id}`))]);
    return { cats, p };
  }, ({ cats, p }) => {
    const v = p || { unit: 'g', quality: 2, slots: ['breakfast', 'main', 'snack'], min_g_day: 0, max_g_day: 500, active: true, category_id: cats.find((c) => c.kind === 'grocery')?.id };
    const fields = [
      { name: 'name', label: 'Название', required: true, placeholder: 'Например, Гречка' },
      { name: 'category_id', label: 'Категория', type: 'select', options: [{ value: '', label: '—' }, ...cats.map((c) => ({ value: c.id, label: c.name }))] },
      { name: 'unit', label: 'Единица', type: 'chips', options: [{ value: 'g', label: 'Граммы' }, { value: 'ml', label: 'Миллилитры' }, { value: 'pcs', label: 'Штуки' }] },
      { name: 'grams_per_piece', label: 'Вес одной штуки, г', type: 'number', hint: 'Только для штучных продуктов (например, яйцо ≈ 55 г)' }
    ];
    const macro = [
      { name: 'kcal_100', label: 'Калории на 100 г', type: 'number', required: true },
      { name: 'protein_100', label: 'Белки, г', type: 'number', required: true },
      { name: 'fat_100', label: 'Жиры, г', type: 'number', required: true },
      { name: 'carbs_100', label: 'Углеводы, г', type: 'number', required: true }
    ];
    const limits = [
      { name: 'min_g_day', label: 'Минимум в день, г', type: 'number' },
      { name: 'max_g_day', label: 'Максимум в день, г', type: 'number' },
      { name: 'quality', label: 'Качество (для премиум-плана)', type: 'chips', numeric: true, options: QUALITY },
      { name: 'slots', label: 'Подходит для', type: 'multichips', options: SLOTS },
      { name: 'active', label: 'Участвует в планах', type: 'toggle' }
    ];
    render(
      root,
      html`<h1 class="screen-title">${isNew ? 'Новый продукт' : 'Изменить продукт'}</h1>
        ${formFields(fields, v)}
        <div class="section-title">Пищевая ценность (на 100 г)</div>
        ${formFields(macro, v)}
        <div class="section-title">Для подбора плана</div>
        ${formFields(limits, v)}
        ${!isNew ? html`<div class="btn-row"><button class="btn danger" id="del">${icon('trash')} Удалить продукт</button></div>` : ''}`
    );
    const pcsField = root.querySelector('[name="grams_per_piece"]').closest('.field');
    const syncUnit = () => pcsField.classList.toggle('hidden', root.querySelector('[data-name="unit"]').dataset.value !== 'pcs');
    syncUnit();
    root.addEventListener('change', (e) => e.detail?.name === 'unit' && syncUnit());

    root.querySelector('#del')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Удалить «${p.name}»? История цен тоже удалится.`))) return;
      try {
        await api(sp(`/products/${id}`), { method: 'DELETE' });
        invalidate(sp('/products'));
        toast('Продукт удалён');
        go('/food?tab=products', { replace: true });
      } catch (e) {
        toastError(e);
      }
    });

    setMainButton('Сохранить', async () => {
      try {
        const all = [...fields, ...macro, ...limits];
        const vals = readFields(root, all);
        const body = {
          ...vals,
          category_id: vals.category_id || null,
          grams_per_piece: vals.unit === 'pcs' ? vals.grams_per_piece : null,
          min_g_day: vals.min_g_day ?? 0,
          max_g_day: vals.max_g_day ?? 1000,
          quality: vals.quality ?? 2
        };
        if (!body.slots.length) throw new Error('Выберите хотя бы один приём пищи');
        const saved = await api(isNew ? sp('/products') : sp(`/products/${id}`), { method: isNew ? 'POST' : 'PATCH', body });
        invalidate(sp('/products'));
        notify('success');
        toast('Сохранено', 'success');
        if (isNew) go(`/food/product/${saved.id}`, { replace: true });
        else back();
      } catch (e) {
        toastError(e);
      }
    });
  });
}

