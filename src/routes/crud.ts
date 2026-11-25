import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertRefs, requireSpace, type SpaceCtx } from '../access.js';
import { db, q, q1 } from '../db.js';
import { parse } from '../http.js';

type Refs = Record<string, { table: string; id: string | null | undefined }>;

export interface CrudOptions<C extends z.ZodObject> {
  path: string;
  table: string;
  create: C;
  order?: { column: string; ascending?: boolean };
  refs?: (body: Partial<z.infer<C>>) => Refs;
  /** Дополнить запись перед вставкой (например, owner_tg_id). */
  prepare?: (body: z.infer<C>, ctx: SpaceCtx) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Валидация перед вставкой/обновлением. */
  validate?: (body: Partial<z.infer<C>>, ctx: SpaceCtx) => void | Promise<void>;
  /** Дополнить список (вычисляемые поля). */
  decorate?: (rows: Record<string, unknown>[], ctx: SpaceCtx) => Promise<unknown[]> | unknown[];
  methods?: ('list' | 'create' | 'update' | 'delete')[];
  listFilter?: (query: Record<string, string>) => [string, unknown][];
}

/** Типовые маршруты: GET список, POST, PATCH /:id, DELETE /:id — все в рамках пространства. */
export function crud<C extends z.ZodObject>(app: FastifyInstance, o: CrudOptions<C>) {
  const base = `/spaces/:sid/${o.path}`;
  const methods = o.methods ?? ['list', 'create', 'update', 'delete'];
  const updateSchema = o.create.partial();

  if (methods.includes('list')) {
    app.get(base, async (req) => {
      const ctx = await requireSpace(req, 'read');
      let query = db().from(o.table).select('*').eq('space_id', ctx.spaceId);
      for (const [col, val] of o.listFilter?.(req.query as Record<string, string>) ?? []) query = query.eq(col, val);
      if (o.order) query = query.order(o.order.column, { ascending: o.order.ascending ?? true });
      const rows = await q<Record<string, unknown>[]>(query);
      return o.decorate ? o.decorate(rows, ctx) : rows;
    });
  }

  if (methods.includes('create')) {
    app.post(base, async (req) => {
      const ctx = await requireSpace(req, 'write');
      const body = parse(o.create, req.body);
      await o.validate?.(body, ctx);
      if (o.refs) await assertRefs(ctx.spaceId, o.refs(body));
      const extra = o.prepare ? await o.prepare(body, ctx) : {};
      const row = await q1(db().from(o.table).insert({ ...body, ...extra, space_id: ctx.spaceId }).select().single());
      return row;
    });
  }

  if (methods.includes('update')) {
    app.patch(`${base}/:id`, async (req) => {
      const ctx = await requireSpace(req, 'write');
      const { id } = req.params as { id: string };
      const body = parse(updateSchema, req.body) as Partial<z.infer<C>>;
      await o.validate?.(body, ctx);
      if (o.refs) await assertRefs(ctx.spaceId, o.refs(body));
      const row = await q1(
        db().from(o.table).update(body as Record<string, unknown>).eq('id', id).eq('space_id', ctx.spaceId).select().maybeSingle(),
        'Запись не найдена'
      );
      return row;
    });
  }

  if (methods.includes('delete')) {
    app.delete(`${base}/:id`, async (req) => {
      const ctx = await requireSpace(req, 'write');
      const { id } = req.params as { id: string };
      await q(db().from(o.table).delete().eq('id', id).eq('space_id', ctx.spaceId));
      return { ok: true };
    });
  }
}
