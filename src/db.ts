import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { HttpError } from './http.js';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** Разворачивает ответ supabase-js: бросает ошибку или возвращает данные. */
export async function q<T = any>(p: PromiseLike<Result>): Promise<T> {
  const { data, error } = await p;
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'Такая запись уже существует');
    if (error.code === '23503') throw new HttpError(409, 'Запись используется в других данных');
    throw new HttpError(500, 'Ошибка базы данных: ' + error.message);
  }
  return data as T;
}

/** То же, но запись обязана существовать. */
export async function q1<T = any>(p: PromiseLike<Result>, notFound = 'Не найдено'): Promise<NonNullable<T>> {
  const data = await q<T>(p);
  if (data == null) throw new HttpError(404, notFound);
  return data as NonNullable<T>;
}
