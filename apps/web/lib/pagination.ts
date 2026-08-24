import { Buffer } from "node:buffer";
import { ApiError } from "@pulse/shared";

interface CursorToken {
  version: 1;
  id: string;
  value: string;
}

interface PaginateArgs<T, Where, OrderBy> {
  where?: Where;
  orderBy: OrderBy;
  cursor?: string;
  limit: number;
  withTotal?: boolean;
  // The first ordered field is part of the cursor. This prevents rows with tied timestamps
  // from being skipped or repeated between pages.
  cursorField?: keyof T & string;
  cursorDirection?: "asc" | "desc";
  cursorValue?: (item: T) => string;
  parseCursorValue?: (value: string) => unknown;
}

function encodeCursor(token: CursorToken) {
  return Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorToken | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<CursorToken>;
    if (parsed.version === 1 && typeof parsed.id === "string" && typeof parsed.value === "string") {
      return parsed as CursorToken;
    }
  } catch {
    // Cursors issued before the structured format remain readable below.
  }
  return null;
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
  args: PaginateArgs<T, Where, OrderBy>,
): Promise<{ data: T[]; nextCursor: string | null; total?: number }> {
  let where = args.where;
  const token = args.cursor ? decodeCursor(args.cursor) : null;
  // Cursors issued before the structured format were plain database IDs. Keep accepting those
  // so an open browser tab or a client that has cached the previous response does not silently
  // restart at page one.
  const legacyCursor: string | undefined = token
    ? args.cursorField
      ? undefined
      : token.id
    : args.cursor;

  if (token && "version" in token && args.cursorField && args.cursorValue) {
    let value: unknown = token.value;
    try {
      value = args.parseCursorValue ? args.parseCursorValue(token.value) : token.value;
    } catch {
      throw ApiError.validation("Invalid pagination cursor");
    }
    if (value instanceof Date && Number.isNaN(value.getTime())) {
      throw ApiError.validation("Invalid pagination cursor");
    }
    const operator = args.cursorDirection === "asc" ? "gt" : "lt";
    const cursorWhere = {
      OR: [
        { [args.cursorField]: { [operator]: value } },
        { [args.cursorField]: value, id: { [operator]: token.id } },
      ],
    };
    where = { AND: [args.where ?? {}, cursorWhere] } as Where;
  }

  let items: T[];
  try {
    items = await model.findMany({
      where,
      orderBy: args.orderBy,
      take: args.limit + 1,
      ...(legacyCursor ? { cursor: { id: legacyCursor }, skip: 1 } : {}),
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2025"
    ) {
      throw ApiError.validation("Invalid pagination cursor");
    }
    throw error;
  }
  const hasMore = items.length > args.limit;
  const data = hasMore ? items.slice(0, args.limit) : items;
  const last = data[data.length - 1];
  const nextCursor =
    hasMore && last && args.cursorField && args.cursorValue
      ? encodeCursor({
          version: 1,
          id: last.id,
          value: args.cursorValue(last),
        })
      : hasMore && last
        ? // Models that do not opt into a compound cursor keep the original raw-id contract.
          // Encoding only the id as base64 would be ambiguous with the legacy reader and would
          // make the next request look up a database row whose id was the encoded text.
          last.id
        : null;

  if (!args.withTotal) return { data, nextCursor };
  return { data, nextCursor, total: await model.count({ where: args.where }) };
}
