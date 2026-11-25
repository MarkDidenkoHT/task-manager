import { api, cached, invalidate, sp } from '../api.js';
import { icon } from '../icons.js';
import { m1, parseMoney } from '../money.js';
import { notify } from '../tg.js';
import { chips, fmt, formFields, html, openSheet, readFields, render, toast, toastError, todayStr, UNIT } from '../ui.js';

/** Шторка «Запись покупки»: сумма, категория, магазин, дата, питомец, позиции. */
export async function openPurchaseSheet({ onSaved, preset = {} } = {}) {
  let cats, stores, profiles;
  try {
    [cats, stores, profiles] = await Promise.all([cached(sp('/categories')), cached(sp('/stores')), cached(sp('/profiles'))]);
  } catch (e) {
    toastError(e);
    return;
  }
  const pets = profiles.filter((p) => p.kind === 'pet' && p.active);
  const grocery = cats.find((c) => c.kind === 'grocery');
  const items = [];

  const extraFields = [
    { name: 'purchased_on', label: 'Дата', type: 'date' },
    { name: 'note', label: 'Заметка', placeholder: 'Необязательно' }
  ];

  const s = openSheet({
    title: 'Покупка',
    body: html`<div class="amount-wrap">
        <input class="amount-input" id="amount" inputmode="decimal" placeholder="0 ₽" autocomplete="off" value="${preset.total_minor ? String(preset.total_minor / 100).replace('.', ',') : ''}" />
        <div class="caption" id="amount-hint">Сумма покупки</div>
      </div>
      <div class="section-title" style="margin-left:0">Категория</div>
      ${chips('category_id', cats.map((c) => ({ value: c.id, label: c.name })), preset.category_id ?? grocery?.id ?? cats[0]?.id, { wrap: true, small: true })}
      ${stores.length
        ? html`<div class="section-title" style="margin-left:0">Магазин</div>
          ${chips('store_id', [{ value: '', label: 'Не указан' }, ...stores.map((x) => ({ value: x.id, label: x.name }))], preset.store_id ?? '', { wrap: true, small: true })}`
        : ''}
      ${pets.length
        ? html`<div class="section-title" style="margin-left:0">Питомец</div>
          ${chips('pet_id', [{ value: '', label: 'Нет' }, ...pets.map((x) => ({ value: x.id, label: x.name }))], preset.pet_id ?? '', { wrap: true, small: true })}`
        : ''}
      <div style="margin-top:16px">${formFields(extraFields, { purchased_on: todayStr() })}</div>
      <div class="section-title" style="margin-left:0"><span>Позиции</span><button class="action" data-add-item>${icon('plus')} Добавить</button></div>
      <div id="items"></div>
      <label class="field inline hidden" id="upd-wrap" style="padding-left:0;padding-right:0"><span class="lbl">Обновить цены продуктов</span><label class="toggle"><input type="checkbox" id="upd" checked /><span></span></label></label>
      <div class="sheet-actions"><button class="btn block" data-save>Записать покупку</button></div>`
  });

  const itemsEl = s.el.querySelector('#items');
  const drawItems = () => {
    render(
      itemsEl,
      items.length
        ? html`<div class="list plain" style="background:var(--fill)">${items.map(
            (it, i) => html`<div class="list-row no-icon">
              <div class="body"><div class="title">${it.label}</div><div class="subtitle">${it.qty ? fmt(it.qty, 1) + ' ' + (UNIT[it.unit] || '') : ''}</div></div>
              <div class="trail"><span class="num">${m1(it.price_minor, { exact: true })}</span><button class="icon-btn" data-del-item="${i}" aria-label="Удалить">${icon('trash')}</button></div>
            </div>`
          )}</div>`
        : html`<p class="caption">Необязательно. Позиции с продуктами нужны для сравнения «план против факта».</p>`
    );
    s.el.querySelector('#upd-wrap').classList.toggle('hidden', !items.some((i) => i.product_id));
    const sum = items.reduce((a, b) => a + b.price_minor, 0);
    s.el.querySelector('#amount-hint').textContent = items.length ? `Сумма позиций: ${m1(sum, { exact: true })}` : 'Сумма покупки';
  };
  drawItems();

  s.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add-item]')) {
      addItemSheet((it) => {
        items.push(it);
        drawItems();
      });
    }
    const del = e.target.closest('[data-del-item]');
    if (del) {
      items.splice(Number(del.dataset.delItem), 1);
      drawItems();
    }
    const save = e.target.closest('[data-save]');
    if (!save) return;
    try {
      const vals = readFields(s.el, extraFields);
      const typed = parseMoney(s.el.querySelector('#amount').value);
      const sum = items.reduce((a, b) => a + b.price_minor, 0);
      const total = typed ?? (items.length ? sum : null);
      if (!total) throw new Error('Введите сумму');
      const pick = (name) => s.el.querySelector(`[data-name="${name}"]`)?.dataset.value || null;
      save.disabled = true;
      await api(sp('/purchases'), {
        method: 'POST',
        body: {
          total_minor: total,
          category_id: pick('category_id'),
          store_id: pick('store_id'),
          pet_id: pick('pet_id'),
          purchased_on: vals.purchased_on || undefined,
          note: vals.note,
          items: items.map(({ product_id, label, qty, price_minor }) => ({ product_id, label, qty, price_minor })),
          update_prices: items.some((i) => i.product_id) && s.el.querySelector('#upd').checked
        }
      });
      invalidate(sp('/products'));
      notify('success');
      toast('Покупка записана', 'success');
      s.close();
      onSaved?.();
    } catch (err) {
      save.disabled = false;
      toastError(err);
    }
  });
  setTimeout(() => s.el.querySelector('#amount')?.focus(), 300);
}

async function addItemSheet(onAdd) {
  let products;
  try {
    products = await cached(sp('/products'));
  } catch (e) {
    toastError(e);
    return;
  }
  const fields = [
    {
      name: 'product_id',
      label: 'Продукт',
      type: 'select',
      options: [{ value: '', label: '— Без продукта —' }, ...products.map((p) => ({ value: p.id, label: p.name }))]
    },
    { name: 'label', label: 'Название (если без продукта)', placeholder: 'Например, бытовая химия' },
    { name: 'qty', label: 'Количество (г, мл или шт)', type: 'number', placeholder: 'Например, 900' },
    { name: 'price_minor', label: 'Цена', type: 'money', required: true }
  ];
  const s = openSheet({
    title: 'Позиция',
    body: html`${formFields(fields, {})}<div class="sheet-actions"><button class="btn block" data-ok>Добавить</button></div>`
  });
  const sel = s.el.querySelector('[name="product_id"]');
  const qtyLbl = s.el.querySelector('[name="qty"]').closest('.field').querySelector('.lbl');
  sel.addEventListener('change', () => {
    const p = products.find((x) => x.id === sel.value);
    qtyLbl.textContent = p ? `Количество, ${UNIT[p.unit]}` + (p.price ? ` (упаковка ${fmt(p.price.pack_qty)} ${UNIT[p.unit]})` : '') : 'Количество (г, мл или шт)';
    if (p?.price && !s.el.querySelector('[name="qty"]').value) s.el.querySelector('[name="qty"]').value = String(p.price.pack_qty).replace('.', ',');
  });
  s.el.querySelector('[data-ok]').addEventListener('click', () => {
    try {
      const v = readFields(s.el, fields);
      const p = products.find((x) => x.id === v.product_id);
      if (!p && !v.label) throw new Error('Выберите продукт или введите название');
      onAdd({ product_id: p?.id ?? null, label: p ? p.name : v.label, unit: p?.unit, qty: v.qty, price_minor: v.price_minor });
      s.close();
    } catch (e) {
      toastError(e);
    }
  });
}

