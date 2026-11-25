import { hideMainButton, setBack } from './tg.js';
import { closeAllSheets } from './ui.js';

const routes = [];
let current = null;
let beforeEach = null;
let afterEach = null;
let runId = 0;

export function route(pattern, view) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ re, keys, view });
}

export function go(path, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, '', '#' + path);
    run();
  } else {
    location.hash = path;
  }
}

export const currentPath = () => (location.hash.slice(1) || '/').split('?')[0];
export const query = () => new URLSearchParams((location.hash.split('?')[1] || ''));

export function back(fallback = '/') {
  if (history.length > 1) history.back();
  else go(fallback);
}

export function onRoute(before, after) {
  beforeEach = before;
  afterEach = after;
}

export async function run(opts) {
  // reload(): новый экран собирается вне документа и подменяет старый целиком,
  // когда готов, — без скелетона, мигания и сброса прокрутки.
  const keep = opts?.keep === true;
  const id = ++runId;
  const path = currentPath();
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    if (current && typeof current.destroy === 'function') current.destroy();
    if (typeof current === 'function') current();
    current = null;
    closeAllSheets();
    hideMainButton();
    const depth = path.split('/').filter(Boolean).length;
    setBack(depth > 1, () => back('/' + path.split('/')[1]));
    beforeEach?.(path, depth);
    // Новый контейнер на каждый экран: обработчики событий прошлого экрана не накапливаются.
    const old = document.getElementById('view');
    const root = old.cloneNode(false);
    root.removeAttribute('data-loaded');
    root.className = '';
    if (keep) root.dataset.loaded = '1';
    else {
      old.replaceWith(root);
      window.scrollTo(0, 0);
    }
    const res = await r.view(root, params, query());
    if (keep && id === runId) {
      const y = window.scrollY;
      document.getElementById('view').replaceWith(root);
      window.scrollTo(0, y);
    }
    if (id === runId) current = res;
    else if (res && typeof res.destroy === 'function') res.destroy();
    afterEach?.(path);
    return;
  }
  go('/', { replace: true });
}

export function start() {
  window.addEventListener('hashchange', () => run());
  run();
}

export const reload = () => run({ keep: true });
