import { z } from 'zod'

type ActionResult = void | Promise<void>

export function withOptions<TSchema extends z.ZodType>(
  schema: TSchema,
  action: (options: z.output<TSchema>) => ActionResult,
): (options: Record<string, unknown>) => ActionResult {
  return (options) => action(schema.parse(options))
}

export function withArgument<TArgument, TSchema extends z.ZodType>(
  schema: TSchema,
  action: (argument: TArgument, options: z.output<TSchema>) => ActionResult,
): (argument: TArgument, options: Record<string, unknown>) => ActionResult {
  return (argument, options) => action(argument, schema.parse(options))
}
