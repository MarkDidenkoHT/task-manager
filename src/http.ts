import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue?.path?.join('.') || 'тело запроса';
    throw new HttpError(400, `Неверные данные (${path}): ${issue?.message ?? 'ошибка'}`);
  }
  return r.data;
}

export function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.status(err.status).send({ error: err.message });
  }
  const e = err as { statusCode?: number; message?: string };
  if (e.statusCode && e.statusCode < 500) {
    return reply.status(e.statusCode).send({ error: e.message ?? 'Ошибка запроса' });
  }
  req.log.error(err);
  return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
}

// Общие схемы
export const zId = z.string().uuid();
export const zMinor = z.number().int().min(0).max(1e13);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате ГГГГ-ММ-ДД');
export const zTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'время в формате ЧЧ:ММ');
