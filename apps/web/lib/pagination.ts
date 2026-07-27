interface PaginateArgs<Where, OrderBy> {
  where?: Where;
  orderBy: OrderBy;
  cursor?: string;
  limit: number;
  /** Opt-in COUNT of all matching rows (doc 04 §Pagination `total`). Off by default: the
   *  extra query only earns its keep where the UI states a total, e.g. "Retry all matching". */
  withTotal?: boolean;
}

interface FindManyModel<T, Where, OrderBy> {
  findMany: (args: {
    where?: Where;
    orderBy: OrderBy;
    take: number;
    cursor?: { id: string };
    skip?: number;
  }) => Promise<T[]>;
  count: (args: { where?: Where }) => Promise<number>;
}

export async function paginate<T extends { id: string }, Where, OrderBy>(
  model: FindManyModel<T, Where, OrderBy>,
  args: PaginateArgs<Where, OrderBy>,
): Promise<{ data: T[]; nextCursor: string | null; total?: number }> {
  const items = await model.findMany({
    where: args.where,
    orderBy: args.orderBy,
    take: args.limit + 1,
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > args.limit;
  const data = hasMore ? items.slice(0, args.limit) : items;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  if (!args.withTotal) return { data, nextCursor };
  return { data, nextCursor, total: await model.count({ where: args.where }) };
}
