import { api, sp } from '../api.js';
import { icon } from '../icons.js';
import { m1, moneyHtml } from '../money.js';
import { canWrite } from '../store.js';
import { hideMainButton, notify, selectionHaptic, setMainButton } from '../tg.js';
import { chips, fmt, html, load, qty, render, toast, toastError, UNIT } from '../ui.js';

/** Список покупок активного плана. Возвращает функцию остановки (опрос каждые 5 с). */
export async function renderGrocery(container, planId) {
  let storeParam; // undefined — магазин плана
  let data = null;
  let timer = null;
  let stopped = false;

  const url = () => sp(`/meal-plans/${planId}/grocery`) + (storeParam !== undefined ? `?store_id=${storeParam || 'general'}` : '');

  const fetchData = async () => {
    data = await api(url());
    return data;
  };

  function draw() {
    if (stopped) return;
    const groups = new Map();
    for (const it of data.items) groups.set(it.category, [...(groups.get(it.category) || []), it]);
    const done = data.items.filter((i) => i.checked).length;
    const toRecord = data.items.filter((i) => i.checked && !i.recorded);
    const storeOpts = [
      { value: '', label: 'Общие цены' },
      ...data.stores.map((s) => ({ value: s.store_id, label: `${s.name} · ${m1(s.total_minor)}${s.missing ? ' *' : ''}` }))
    ];
    render(
      container,
      html`${data.stores.length ? html`<div style="margin-bottom:12px">${chips('gstore', storeOpts, data.store_id || '', { small: true })}</div>` : ''}
        <div class="card">
          <div class="row between"><div class="stat"><div class="label">Итого на ${data.days} дн.</div><div class="hero md">${moneyHtml(data.total_minor)}</div></div>
          <div class="muted small" style="text-align:right">Куплено<br /><b class="num" style="color:var(--text)">${done} из ${data.items.length}</b></div></div>
          ${data.missing_prices ? html`<div class="notice warn" style="margin-top:10px">Нет цены для ${data.missing_prices} поз. — итог неполный.</div>` : ''}
        </div>
        ${[...groups.entries()].map(
          ([cat, items]) => html`<div class="section-title">${cat}</div>
            <div class="list">${items.map(
              (it) => html`<div class="list-row ${it.checked ? 'done-row' : ''}" ${canWrite() ? html`data-check="${it.product_id}"` : ''} role="checkbox" aria-checked="${it.checked}">
                <div class="check ${it.checked ? 'on' : ''}">${icon('check')}</div>
                <div class="body">
                  <div class="title">${it.name}</div>
                  <div class="subtitle">${qty(it.qty, it.unit)}${it.packs ? ` · ${it.packs} × ${fmt(it.pack_qty)} ${UNIT[it.unit]} по ${m1(it.pack_price_minor)}` : ''}${it.recorded ? ' · записано' : ''}</div>
                </div>
                <div class="trail num">${it.cost_minor != null ? m1(it.cost_minor) : html`<span class="badge warn">нет цены</span>`}</div>
              </div>`
            )}</div>`
        )}
        <p class="caption" style="margin:12px 16px">Количество округлено вверх до целых упаковок. Отметки видят все участники.</p>`
    );
    if (canWrite() && toRecord.length) {
      setMainButton(`Записать покупку (${toRecord.length})`, recordPurchase);
    } else {
      hideMainButton();
    }
  }

  async function recordPurchase() {
    try {
      const r = await api(sp(`/meal-plans/${planId}/grocery-purchase`), {
        method: 'POST',
        body: storeParam !== undefined ? { store_id: storeParam || null } : {}
      });
      notify('success');
      toast(`Записано: ${r.count} поз. на ${m1(r.total_minor)}`, 'success');
      await fetchData();
      draw();
    } catch (e) {
      toastError(e);
    }
  }

  const onClick = async (e) => {
    const row = e.target.closest('[data-check]');
    if (!row) return;
    const item = data.items.find((i) => i.product_id === row.dataset.check);
    if (!item) return;
    const prev = item.checked;
    item.checked = !prev; // оптимистично
    selectionHaptic();
    draw();
    try {
      await api(sp(`/meal-plans/${planId}/grocery/${item.product_id}`), { method: 'POST', body: { checked: item.checked } });
    } catch (err) {
      item.checked = prev;
      draw();
      toastError(err);
    }
  };
  const onChange = async (e) => {
    if (e.detail?.name !== 'gstore') return;
    storeParam = e.detail.value;
    try {
      await fetchData();
      draw();
    } catch (err) {
      toastError(err);
    }
  };
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);

  await load(container, fetchData, draw, { skeletonRows: 6 });

  const poll = async () => {
    if (stopped) return;
    if (!document.hidden && !document.querySelector('.sheet')) {
      try {
        await fetchData();
        draw();
      } catch {
        /* пропускаем сбой опроса */
      }
    }
    timer = setTimeout(poll, 5000);
  };
  timer = setTimeout(poll, 5000);

  return () => {
    stopped = true;
    clearTimeout(timer);
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    hideMainButton();
  };
}

/** Отдельный экран списка для плана. */
export async function groceryScreen(root, { id }) {
  render(root, html`<h1 class="screen-title">Список покупок</h1><div id="g"></div>`);
  const stop = await renderGrocery(root.querySelector('#g'), id);
  return { destroy: stop };
}
