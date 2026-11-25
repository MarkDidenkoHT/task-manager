import type { FastifyRequest } from 'fastify';
import { db, q } from './db.js';
import { HttpError } from './http.js';

export type Role = 'owner' | 'editor' | 'viewer';
export type Need = 'read' | 'write' | 'owner';

export interface SpaceCtx {
  spaceId: string;
  role: Role;
  tgId: number;
}

/**
 * Определяет роль пользователя в пространстве. Никогда не доверяем space_id
 * от клиента без проверки членства.
 */
export async function requireSpace(req: FastifyRequest, need: Need = 'read'): Promise<SpaceCtx> {
  const spaceId = (req.params as { sid?: string }).sid;
  if (!spaceId || !/^[0-9a-f-]{36}$/i.test(spaceId)) throw new HttpError(400, 'Не указано пространство');
  const tgId = req.auth.user.id;
  const rows = await q<{ role: Role }[]>(
    db().from('members').select('role').eq('space_id', spaceId).eq('tg_id', tgId).limit(1)
  );
  const role = rows[0]?.role;
  if (!role) throw new HttpError(403, 'Нет доступа к этому пространству');
  if (need === 'write' && role === 'viewer') throw new HttpError(403, 'Только просмотр: изменения недоступны');
  if (need === 'owner' && role !== 'owner') throw new HttpError(403, 'Действие доступно только владельцу');
  return { spaceId, role, tgId };
}

/** Проверяет, что запись таблицы принадлежит пространству. */
export async function assertInSpace(table: string, id: string, spaceId: string, what = 'Запись'): Promise<void> {
  const rows = await q<{ id: string }[]>(
    db().from(table).select('id').eq('id', id).eq('space_id', spaceId).limit(1)
  );
  if (!rows.length) throw new HttpError(404, `${what} не найдена`);
}

/** Проверяет набор необязательных ссылок (category_id, store_id и т.д.) на принадлежность пространству. */
export async function assertRefs(spaceId: string, refs: Record<string, { table: string; id: string | null | undefined }>) {
  for (const [, { table, id }] of Object.entries(refs)) {
    if (id) await assertInSpace(table, id, spaceId);
  }
}

/** Пространство программы-тренировки через цепочку program_exercise → day → program. */
export async function programExerciseSpace(peId: string): Promise<{ spaceId: string | null; programId: string }> {
  const pe = await q<{ program_day_id: string }[]>(db().from('program_exercises').select('program_day_id').eq('id', peId).limit(1));
  if (!pe.length) throw new HttpError(404, 'Упражнение программы не найдено');
  const day = await q<{ program_id: string }[]>(db().from('program_days').select('program_id').eq('id', pe[0].program_day_id).limit(1));
  const prog = await q<{ space_id: string | null }[]>(db().from('programs').select('space_id').eq('id', day[0].program_id).limit(1));
  return { spaceId: prog[0]?.space_id ?? null, programId: day[0].program_id };
}
