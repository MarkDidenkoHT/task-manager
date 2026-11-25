import { get } from './store.js';
import { html } from './ui.js';

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const rate = () => Number(get('space')?.usd_rate) || 90;

export function rub(minor, { exact = false } = {}) {
  const v = Number(minor || 0) / 100;
  return (exact ? nf2.format(v) : nf0.format(Math.round(v))) + ' ₽';
}

export function usd(minor) {
  const v = Number(minor || 0) / 100 / rate();
  return '≈ ' + (Math.abs(v) < 10 ? nf1.format(v) : nf0.format(Math.round(v))) + ' $';
}

/** { main, sub } с учётом выбранной в шапке валюты. */
export function money(minor, opts) {
  return get('currency') === 'USD' ? { main: usd(minor), sub: rub(minor, opts) } : { main: rub(minor, opts), sub: usd(minor) };
}

/** Короткая строка в основной валюте. */
export const m1 = (minor, opts) => money(minor, opts).main;

/** HTML: сумма и подпись во второй валюте. */
export function moneyHtml(minor, { cls = '', opts } = {}) {
  const m = money(minor, opts);
  return html`<span class="num ${cls}">${m.main}</span><span class="money-sub num">${m.sub}</span>`;
}

/** Разбор ввода «1 234,56» в копейки. */
export function parseMoney(str) {
  if (str == null) return null;
  const s = String(str).replace(/\s| /g, '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!s) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

export const minorToInput = (minor) => (minor == null ? '' : String(Number(minor) / 100).replace('.', ','));

export const fmtNum = (v, digits = 0) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number(v || 0));
