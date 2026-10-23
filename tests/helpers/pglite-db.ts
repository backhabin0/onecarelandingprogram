/**
 * 컴퓨터 안(메모리)에서만 도는 테스트용 Postgres(PGlite).
 *
 * 실제 Supabase(운영/테스트 프로젝트)에는 연결하지 않는다. Supabase에만 있는
 * 역할(anon/authenticated/service_role), auth 함수, storage 테이블과
 * "public 스키마 새 객체에 세 역할 권한을 기본으로 준다"는 Supabase 기본 설정을
 * 아래 SUPABASE_SHIM_SQL로 흉내 낸 뒤, supabase/migrations/*.sql을 순서대로 적용한다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type PGliteInterface, type Transaction } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = join(__dirname, "..", "..");
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
export const ROLLBACK_DIR = join(ROOT, "supabase", "rollback");

const SUPABASE_SHIM_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public
    grant execute on functions to anon, authenticated, service_role;

  -- auth.uid()/auth.role(): 테스트에서는 request.jwt.claim.* 설정값을 읽는다.
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) $$;

  -- 005 migration이 쓰는 storage 테이블(필요한 컬럼만)
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text
  );
  alter table storage.objects enable row level security;
`;

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();
}

export function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

export function readRollback(name: string): string {
  return readFileSync(join(ROLLBACK_DIR, name), "utf8");
}

/**
 * Supabase 흉내 + migration을 적용한 DB를 만든다.
 * upTo를 주면 그 번호(예: "012")까지만 적용한다.
 */
export async function createMigratedDb(options: { upTo?: string } = {}): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_SHIM_SQL);
  for (const file of listMigrationFiles()) {
    if (options.upTo && file.slice(0, 3) > options.upTo) break;
    try {
      await db.exec(readMigration(file));
    } catch (err) {
      throw new Error(`[pglite] ${file} 적용 실패: ${(err as Error).message}`);
    }
  }
  return db;
}

export type DbRole = "anon" | "authenticated" | "service_role";

/** 트랜잭션 안에서 역할을 바꿔(set local role) 실행한다. 끝나면 원래(postgres)로 돌아온다. */
export async function asRole<T>(
  db: PGliteInterface,
  role: DbRole,
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}
