import type { PageQuery, Paginated } from '@quoteflow/shared';

export function skipTake(query: PageQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function toPaginated<T>(items: T[], total: number, query: PageQuery): Paginated<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}
