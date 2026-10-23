/**
 * Supabase(PostgREST) 응답을 흉내 내는 테스트용 가짜 클라이언트.
 *
 * 실제 DB에 연결하지 않고, 메모리의 테이블 데이터로 lib/ 코드가 쓰는 쿼리
 * 빌더 체인(select/eq/is/gte/lt/not/like/or/order/range)을 처리한다.
 *
 * 실제 Supabase와 같게 맞춘 동작:
 * - 요청 1번에 최대 maxRows(기본 1,000)행만 돌려준다. `.range()`로 더 큰 구간을
 *   요청하거나 range 없이 조회해도 조용히 잘린다.
 * - `.range(from, to)`는 from~to(양 끝 포함) 구간만 돌려준다.
 * - `select(..., { count: "exact" })`는 필터에 맞는 전체 건수를, `head: true`는
 *   data 없이 count만 돌려준다.
 * - count를 요청하면서 전체 건수를 넘는 offset으로 range를 요청하면 PostgREST처럼
 *   PGRST103(416 Requested range not satisfiable) 오류를 돌려준다.
 * - `alias:table(cols)` 형태의 관계 조인(embedded select)을 relations 설정대로 붙인다.
 */

type Row = Record<string, unknown>;

export interface FakeRelation {
  /** "one"이면 객체(또는 null), "many"면 배열로 붙인다. */
  kind: "one" | "many";
  /** 현재 테이블의 컬럼 */
  localKey: string;
  /** 대상 테이블의 컬럼 */
  foreignKey: string;
}

export interface FakeSupabaseOptions {
  tables: Record<string, Row[]>;
  /** relations[fromTable][toTable] */
  relations?: Record<string, Record<string, FakeRelation>>;
  maxRows?: number;
}

export interface FakeRequestLog {
  table: string;
  from: number | null;
  to: number | null;
  head: boolean;
  count: boolean;
  returned: number;
}

interface SelectItem {
  kind: "all" | "column" | "embed";
  column?: string;
  alias?: string;
  table?: string;
  inner?: SelectItem[];
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseSelect(input: string): SelectItem[] {
  return splitTopLevel(input).map((part) => {
    if (part === "*") return { kind: "all" };
    const embed = part.match(/^(?:([a-zA-Z0-9_]+):)?([a-zA-Z0-9_]+)\((.*)\)$/);
    if (embed) {
      const [, alias, table, inner] = embed;
      return { kind: "embed", alias: alias ?? table, table, inner: parseSelect(inner) };
    }
    return { kind: "column", column: part };
  });
}

function likeToRegExp(pattern: string, flags: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`, flags);
}

type Predicate = (row: Row) => boolean;

/** 결정적(seed 고정) Fisher–Yates 셔플 — 테스트 결과가 실행마다 달라지지 않게 한다. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let state = (seed * 2654435761) >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

interface PostgrestLikeError {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}

export class FakeSupabase {
  readonly tables: Record<string, Row[]>;
  readonly relations: Record<string, Record<string, FakeRelation>>;
  readonly maxRows: number;
  readonly requests: FakeRequestLog[] = [];

  constructor(options: FakeSupabaseOptions) {
    this.tables = options.tables;
    this.relations = options.relations ?? {};
    this.maxRows = options.maxRows ?? 1000;
  }

  from(table: string) {
    return new FakeQueryBuilder(this, table);
  }

  resetRequests() {
    this.requests.length = 0;
  }

  /** 행 하나에 select 항목을 적용한다(관계 조인 포함). */
  project(table: string, row: Row, items: SelectItem[]): Row {
    const result: Row = {};
    for (const item of items) {
      if (item.kind === "all") {
        Object.assign(result, row);
      } else if (item.kind === "column") {
        result[item.column!] = row[item.column!];
      } else {
        const relation = this.relations[table]?.[item.table!];
        if (!relation) {
          throw new Error(`[fake-supabase] relation ${table} -> ${item.table} 미정의`);
        }
        const targets = (this.tables[item.table!] ?? []).filter(
          (target) => target[relation.foreignKey] === row[relation.localKey]
        );
        const projected = targets.map((target) =>
          this.project(item.table!, target, item.inner!)
        );
        result[item.alias!] =
          relation.kind === "one" ? (projected[0] ?? null) : projected;
      }
    }
    return result;
  }
}

export type FakeResponse =
  | { data: Row[] | null; error: null; count: number | null }
  | { data: null; error: PostgrestLikeError; count: null };

class FakeQueryBuilder implements PromiseLike<FakeResponse> {
  private selectItems: SelectItem[] = [{ kind: "all" }];
  private countRequested = false;
  private head = false;
  private predicates: Predicate[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string
  ) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.selectItems = parseSelect(columns);
    this.countRequested = options?.count === "exact";
    this.head = options?.head === true;
    return this;
  }

  eq(column: string, value: unknown) {
    this.predicates.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: null) {
    this.predicates.push((row) => (row[column] ?? null) === value);
    return this;
  }

  gte(column: string, value: string) {
    this.predicates.push((row) => String(row[column]) >= value);
    return this;
  }

  lt(column: string, value: string) {
    this.predicates.push((row) => String(row[column]) < value);
    return this;
  }

  not(column: string, operator: "is", value: null) {
    if (operator !== "is") throw new Error(`[fake-supabase] not(${operator}) 미지원`);
    this.predicates.push((row) => (row[column] ?? null) !== value);
    return this;
  }

  like(column: string, pattern: string) {
    const re = likeToRegExp(pattern, "");
    this.predicates.push((row) => re.test(String(row[column] ?? "")));
    return this;
  }

  /** "name.ilike.%x%,phone.ilike.%x%" 형태만 지원한다. */
  or(filter: string) {
    const conditions = filter.split(",").map((part) => {
      const match = part.match(/^([a-zA-Z0-9_]+)\.ilike\.(.*)$/);
      if (!match) throw new Error(`[fake-supabase] or 필터 미지원: ${part}`);
      return { column: match[1], re: likeToRegExp(match[2], "i") };
    });
    this.predicates.push((row) =>
      conditions.some(({ column, re }) => re.test(String(row[column] ?? "")))
    );
    return this;
  }

  order(column: string, options?: { ascending?: boolean; referencedTable?: string }) {
    // 관계 테이블 정렬(referencedTable)은 이 테스트 범위에서 쓰지 않으므로 무시한다.
    if (!options?.referencedTable) {
      this.orders.push({ column, ascending: options?.ascending ?? true });
    }
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  private execute(): FakeResponse {
    const source = this.db.tables[this.table] ?? [];
    let rows = source.filter((row) => this.predicates.every((p) => p(row)));

    // 실제 Postgres는 ORDER BY 값이 같은 행끼리의 순서를 보장하지 않는다.
    // 요청마다 다른 순서로 섞어 두면, 유일한 정렬 기준(id tie-breaker)이 빠진
    // 코드는 페이지 경계에서 행이 빠지거나 중복되어 테스트가 실패한다.
    rows = seededShuffle(rows, this.db.requests.length + 1);

    if (this.orders.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const { column, ascending } of this.orders) {
          const av = a[column] as string | number | null;
          const bv = b[column] as string | number | null;
          if (av === bv) continue;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          const cmp = av < bv ? -1 : 1;
          return ascending ? cmp : -cmp;
        }
        return 0;
      });
    }

    const total = rows.length;
    const from = this.rangeFrom ?? 0;
    const requested = this.rangeTo === null ? Infinity : this.rangeTo - from + 1;
    const limit = Math.min(requested, this.db.maxRows);

    const log: FakeRequestLog = {
      table: this.table,
      from: this.rangeFrom,
      to: this.rangeTo,
      head: this.head,
      count: this.countRequested,
      returned: 0,
    };
    this.db.requests.push(log);

    if (this.head) {
      return { data: null, error: null, count: this.countRequested ? total : null };
    }

    if (this.countRequested && from > 0 && from >= total) {
      return {
        data: null,
        count: null,
        error: {
          code: "PGRST103",
          message: "Requested range not satisfiable",
          details: `An offset of ${from} was requested, but there are only ${total} rows.`,
          hint: null,
        },
      };
    }

    const page = rows
      .slice(from, from + limit)
      .map((row) => this.db.project(this.table, row, this.selectItems));
    log.returned = page.length;

    return { data: page, error: null, count: this.countRequested ? total : null };
  }

  then<TResult1 = FakeResponse, TResult2 = never>(
    onfulfilled?: ((value: FakeResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }
}
