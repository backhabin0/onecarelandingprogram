import { describe, expect, it } from "vitest";
import { fetchAllRows, SUPABASE_PAGE_SIZE } from "@/lib/supabase/fetch-all-rows";
import { FakeSupabase } from "./helpers/fake-supabase";
import { SIZES } from "./helpers/fixtures";

function itemsTable(n: number) {
  // 7행씩 같은 created_at → id tie-breaker가 없으면 페이지 경계가 흔들린다.
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${String(i).padStart(5, "0")}`,
    created_at: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 7) * 1000).toISOString(),
  }));
}

describe("가짜 Supabase 클라이언트 자체 동작", () => {
  it("range 없이 조회하면 1,000행에서 잘린다(실제 Supabase와 동일)", async () => {
    const fake = new FakeSupabase({ tables: { items: itemsTable(2500) } });
    const { data } = (await fake.from("items").select("*")) as { data: unknown[] };
    expect(data).toHaveLength(1000);
  });

  it(".limit 대신 큰 range를 요청해도 1,000행에서 잘린다", async () => {
    const fake = new FakeSupabase({ tables: { items: itemsTable(2500) } });
    const { data } = (await fake.from("items").select("*").range(0, 9999)) as {
      data: unknown[];
    };
    expect(data).toHaveLength(1000);
  });
});

describe("fetchAllRows", () => {
  it.each(SIZES)("%i행을 빠짐없이, 중복 없이 읽는다", async (n) => {
    const table = itemsTable(n);
    const fake = new FakeSupabase({ tables: { items: table } });

    const { data, error } = await fetchAllRows<{ id: string }>((from, to) =>
      fake
        .from("items")
        .select("id, created_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
    );

    expect(error).toBeNull();
    expect(data).toHaveLength(n);
    const ids = data.map((row) => row.id);
    expect(new Set(ids).size).toBe(n);
    expect(new Set(ids)).toEqual(new Set(table.map((row) => row.id)));

    // 요청 수: 꽉 찬 페이지 수 + 마지막(덜 찬/빈) 페이지 1번
    expect(fake.requests).toHaveLength(Math.floor(n / SUPABASE_PAGE_SIZE) + 1);
    for (const request of fake.requests) {
      expect(request.returned).toBeLessThanOrEqual(SUPABASE_PAGE_SIZE);
      expect(request.to! - request.from! + 1).toBe(SUPABASE_PAGE_SIZE);
    }
  });

  it("중간 페이지에서 실패하면 모은 행을 버리고 error를 반환한다", async () => {
    const fake = new FakeSupabase({ tables: { items: itemsTable(2500) } });
    let calls = 0;

    const result = await fetchAllRows<{ id: string }>((from, to) => {
      calls += 1;
      if (calls === 2) {
        return Promise.resolve({ data: null, error: { message: "boom" } });
      }
      return fake.from("items").select("id").order("id").range(from, to) as PromiseLike<{
        data: unknown[] | null;
        error: { message: string } | null;
      }>;
    });

    expect(result).toEqual({ data: [], error: "boom" });
    expect(calls).toBe(2);
  });
});
