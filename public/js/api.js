import { initData, inTelegram } from './tg.js';
import { get } from './store.js';

function authHeader() {
  if (inTelegram) return 'tma ' + initData();
  // Обычный браузер: режим разработки (сервер должен быть запущен с DEV_AUTH=1).
  let id = new URLSearchParams(location.search).get('dev');
  try {
    if (id) localStorage.setItem('dev_tg_id', id);
    else id = localStorage.getItem('dev_tg_id');
  } catch {
    /* нет хранилища */
  }
  return 'dev ' + (id || '1');
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        Authorization: authHeader()
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* пустой ответ */
  }
  if (!res.ok) {
    const msg = data?.error || (res.status === 403 ? 'Нет доступа' : `Ошибка ${res.status}`);
    throw new ApiError(res.status, msg);
  }
  return data;
}

/** Путь внутри текущего пространства. */
export const sp = (path = '') => `/spaces/${get('spaceId')}${path}`;

// Небольшой кэш ответов с коротким временем жизни.
const cache = new Map();
export async function cached(path, ttlMs = 15000) {
  const key = path;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await api(path);
  cache.set(key, { t: Date.now(), v });
  return v;
}
export function invalidate(prefix = '') {
  for (const k of cache.keys()) if (k.startsWith(prefix) || !prefix) cache.delete(k);
}
