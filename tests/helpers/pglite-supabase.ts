/**
 * PGlite(컴퓨터 안 Postgres) 위에서 supabase-js 쿼리 빌더처럼 동작하는 테스트용 어댑터.
 *
 * lib/ 코드가 쓰는 범위만 지원한다:
 *   select(cols, { count, head }) / insert / update / delete
 *   eq / neq / in / ilike / or("a.ilike.x,b.ilike.y") / order / range / maybeSingle / 쓰기 뒤 select
 *
 * 실제 Supabase와 맞춘 점
 * - 모든 쿼리를 authenticated 역할로 실행한다(RLS·권한이 실제처럼 적용됨)
 * - 요청 1번에 최대 1,000행(max_rows)
 * - count를 요청하면서 전체 건수를 넘는 offset이면 PGRST103
 * - 오류는 { message, code }(Postgres 오류 코드, 예: 23505)로 돌려준다
 * - timestamptz는 ISO 문자열, numeric은 숫자로 돌려준다(PostgREST JSON과 같게)
 * - insert는 PostgREST처럼 보낸 컬럼만 넣고 나머지는 DB 기본값을 쓴다
 */
import type { PGliteInterface } from "@electric-sql/pglite";
import type { DbRole } from "./pglite-db";

type Row = Record<string, unknown>;

interface PgError {
  message: string;
  code: string;
}

export interface PgResponse {
  data: unknown;
  error: PgError | null;
  count: number | null;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const MAX_ROWS = 1000;
const NUMERIC_OID = 1700;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`[pglite-supabase] 지원하지 않는 이름: ${name}`);
  return `"${name}"`;
}

function columnsSql(columns: string): string {
  if (columns.trim() === "*") return "*";
  return columns
    .split(",")
    .map((c) => ident(c.trim()))
    .join(", ");
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  return value;
}

function normalizeRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[key] = normalizeValue(value);
  return out;
}

export class PgliteSupabase {
  constructor(
    readonly db: PGliteInterface,
    readonly role: DbRole = "authenticated"
  ) {}

  from(table: string) {
    return new PgQueryBuilder(this, table);
  }

  /** 지정한 역할로 SQL을 실행한다 */
  async run(sql: string, params: unknown[]): Promise<Row[]> {
    return this.db.transaction(async (tx) => {
      await tx.exec(`set local role ${this.role}`);
      const result = await tx.query<Row>(sql, params, {
        parsers: { [NUMERIC_OID]: (value: string) => Number(value) },
      });
      return result.rows.map(normalizeRow);
    });
  }
}

type Mode = "select" | "insert" | "update" | "delete";

class PgQueryBuilder implements PromiseLike<PgResponse> {
  private mode: Mode = "select";
  private columns = "*";
  private returning: string | null = null;
  private countRequested = false;
  private head = false;
  private single = false;
  private payload: Row[] = [];
  private where: { sql: string; params: unknown[] }[] = [];
  private orders: string[] = [];
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;

  constructor(
    private readonly client: PgliteSupabase,
    private readonly table: string
  ) {
    ident(table);
  }

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    if (this.mode === "select") {
      this.columns = columns;
      this.countRequested = options?.count === "exact";
      this.head = options?.head === true;
    } else {
      this.returning = columns;
    }
    return this;
  }

  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(values: Row) {
    this.mode = "update";
    this.payload = [values];
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.where.push({ sql: `${ident(column)}::text = ?`, params: [String(value)] });
    return this;
  }

  neq(column: string, value: unknown) {
    this.where.push({ sql: `${ident(column)}::text <> ?`, params: [String(value)] });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.where.push({ sql: `${ident(column)}::text = any(?::text[])`, params: [values.map(String)] });
    return this;
  }

  ilike(column: string, pattern: string) {
    this.where.push({ sql: `${ident(column)} ilike ?`, params: [pattern] });
    return this;
  }

  /** "col.ilike.pattern,col2.ilike.pattern" 형태만 지원 */
  or(filter: string) {
    const parts = filter.split(",").map((part) => {
      const match = part.match(/^([a-z_][a-z0-9_]*)\.ilike\.(.*)$/);
      if (!match) throw new Error(`[pglite-supabase] or 필터 미지원: ${part}`);
      return { sql: `${ident(match[1])} ilike ?`, param: match[2] };
    });
    this.where.push({
      sql: `(${parts.map((p) => p.sql).join(" or ")})`,
      params: parts.map((p) => p.param),
    });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push(`${ident(column)} ${options?.ascending === false ? "desc" : "asc"}`);
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  maybeSingle() {
    this.single = true;
    return this;
  }

  /** ? 자리표시자를 $1, $2 ...로 바꾸며 WHERE 절을 만든다 */
  private buildWhere(startIndex: number): { sql: string; params: unknown[] } {
    if (this.where.length === 0) return { sql: "", params: [] };
    let index = startIndex;
    const params: unknown[] = [];
    const clauses = this.where.map((clause) => {
      params.push(...clause.params);
      return clause.sql.replace(/\?/g, () => `$${(index += 1)}`);
    });
    return { sql: ` where ${clauses.join(" and ")}`, params };
  }

  private async execute(): Promise<PgResponse> {
    const table = `public.${ident(this.table)}`;
    try {
      if (this.mode === "select") return await this.executeSelect(table);

      if (this.mode === "insert") {
        const keys = Array.from(new Set(this.payload.flatMap((row) => Object.keys(row))));
        const cols = keys.map(ident).join(", ");
        const rows = await this.client.run(
          `insert into ${table} (${cols})
           select ${cols} from jsonb_populate_recordset(null::${table}, $1::jsonb)
           returning ${this.returning ? columnsSql(this.returning) : "*"}`,
          [JSON.stringify(this.payload)]
        );
        return { data: this.returning ? rows : null, error: null, count: null };
      }

      if (this.mode === "update") {
        const keys = Object.keys(this.payload[0]);
        const cols = keys.map(ident).join(", ");
        const where = this.buildWhere(1);
        const rows = await this.client.run(
          `update ${table} set (${cols}) = (select ${cols} from jsonb_populate_record(null::${table}, $1::jsonb))${where.sql}
           returning ${this.returning ? columnsSql(this.returning) : "*"}`,
          [JSON.stringify(this.payload[0]), ...where.params]
        );
        return { data: this.returning ? rows : null, error: null, count: null };
      }

      const where = this.buildWhere(0);
      const rows = await this.client.run(
        `delete from ${table}${where.sql} returning ${this.returning ? columnsSql(this.returning) : "*"}`,
        where.params
      );
      return { data: this.returning ? rows : null, error: null, count: null };
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return { data: null, error: { message: e.message ?? String(err), code: e.code ?? "" }, count: null };
    }
  }

  private async executeSelect(table: string): Promise<PgResponse> {
    const where = this.buildWhere(0);
    let count: number | null = null;
    if (this.countRequested) {
      const [{ n }] = await this.client.run(`select count(*)::int as n from ${table}${where.sql}`, where.params);
      count = Number(n);
    }
    if (this.head) return { data: null, error: null, count };

    const from = this.rangeFrom ?? 0;
    const requested = this.rangeTo === null ? MAX_ROWS : this.rangeTo - from + 1;
    const limit = Math.min(requested, MAX_ROWS);

    if (count !== null && from > 0 && from >= count) {
      return {
        data: null,
        count: null,
        error: { code: "PGRST103", message: "Requested range not satisfiable" },
      };
    }

    const order = this.orders.length > 0 ? ` order by ${this.orders.join(", ")}` : "";
    const rows = await this.client.run(
      `select ${columnsSql(this.columns)} from ${table}${where.sql}${order} limit ${limit} offset ${from}`,
      where.params
    );
    if (this.single) {
      if (rows.length > 1) {
        return { data: null, count: null, error: { code: "PGRST116", message: "multiple rows" } };
      }
      return { data: rows[0] ?? null, error: null, count };
    }
    return { data: rows, error: null, count };
  }

  then<TResult1 = PgResponse, TResult2 = never>(
    onfulfilled?: ((value: PgResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
