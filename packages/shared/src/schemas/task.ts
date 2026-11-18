import { z } from 'zod';
import { LIMITS, TASK_PRIORITIES, TASK_STATUSES, TASK_VIEWS } from '../enums';
import { cleanLine, cleanText } from '../text';

const title = z
  .string()
  .transform(cleanLine)
  .pipe(z.string().min(1, { error: 'required' }).max(LIMITS.taskTitle, { error: 'too_long' }));

const description = z
  .string()
  .transform(cleanText)
  .pipe(z.string().max(LIMITS.taskDescription, { error: 'too_long' }))
  .transform((v) => (v === '' ? null : v));

const dueAt = z.iso.datetime({ offset: true, error: 'invalid_date' });

export const taskCreateSchema = z
  .object({
    id: z.uuid().optional(),
    title,
    description: description.nullable().optional(),
    dueAt: dueAt.nullable().optional(),
    dueHasTime: z.boolean().default(false),
    priority: z.enum(TASK_PRIORITIES).default('medium'),
    status: z.enum(TASK_STATUSES).default('todo'),
  })
  .strict();
export type TaskCreateInput = z.input<typeof taskCreateSchema>;

export const taskUpdateSchema = z
  .object({
    version: z.number().int().min(1),
    title: title.optional(),
    description: description.nullable().optional(),
    dueAt: dueAt.nullable().optional(),
    dueHasTime: z.boolean().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    status: z.enum(TASK_STATUSES).optional(),
  })
  .strict();
export type TaskUpdateInput = z.input<typeof taskUpdateSchema>;

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).filter(Boolean))
    .pipe(z.array(z.enum(values)));

export const taskListQuerySchema = z.object({
  view: z.enum(TASK_VIEWS).default('mine'),
  status: csv(TASK_STATUSES).optional(),
  priority: csv(TASK_PRIORITIES).optional(),
  dueFrom: z.iso.date().optional(),
  dueTo: z.iso.date().optional(),
  q: z.string().trim().max(LIMITS.search).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type TaskListQuery = z.input<typeof taskListQuerySchema>;
