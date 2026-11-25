import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';
import { HttpError } from './http.js';

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface AuthInfo {
  user: TgUser;
  startParam: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo;
  }
}

/**
 * Проверка подписи initData Telegram Mini App.
 * secret = HMAC_SHA256(key="WebAppData", msg=bot_token)
 * hash   = hex(HMAC_SHA256(key=secret, msg=data_check_string))
 * data_check_string — все поля, кроме hash, отсортированные по ключу, "key=value" через \n.
 */
export function verifyInitData(initData: string, botToken: string, maxAgeSec: number, nowSec = Date.now() / 1000): AuthInfo {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new HttpError(401, 'Нет подписи initData');
  params.delete('hash');

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, 'Неверная подпись initData');
  }

  const authDate = Number(params.get('auth_date'));
  if (!authDate || nowSec - authDate > maxAgeSec) {
    throw new HttpError(401, 'Данные авторизации устарели, откройте приложение заново');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new HttpError(401, 'Нет данных пользователя');
  const user = JSON.parse(userRaw) as TgUser;
  if (!user || typeof user.id !== 'number') throw new HttpError(401, 'Нет данных пользователя');

  return { user, startParam: params.get('start_param') };
}

export function authenticate(req: FastifyRequest): AuthInfo {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('tma ')) {
    return verifyInitData(header.slice(4), config.botToken, config.initDataMaxAgeSec);
  }
  if (config.devAuth && header.startsWith('dev ')) {
    const id = Number(header.slice(4));
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(401, 'Неверный dev-идентификатор');
    return { user: { id, first_name: 'Разработчик' }, startParam: null };
  }
  throw new HttpError(401, 'Требуется авторизация через Telegram');
}

export function displayName(u: TgUser): string {
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id);
}
