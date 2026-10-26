"use client";

import { useState } from "react";

interface SelectAllResultsNoticeProps {
  /** 이 페이지에서 고를 수 있는 항목 수 */
  pageCount: number;
  /** 지금 선택한 항목 수 */
  selectedCount: number;
  /** 이 페이지 항목을 모두 골랐는지 */
  allPageSelected: boolean;
  /** 검색 결과 전체 건수(목록 아래 페이지 수 기준) */
  totalCount: number;
  /** 전체 선택 버튼 글자(예: "검색 결과 전체 1,107개 선택") */
  selectAllLabel: string;
  /** 검색 결과 전체를 불러와 선택한다. 실패하면 안내 문구를 돌려준다 */
  onSelectAll: () => Promise<string | null>;
  onClear: () => void;
}

/**
 * 목록 한 페이지(50개)를 모두 고르면 "검색 결과 전체 선택"을 보여 주는 안내 줄(업체명 일괄 변경용).
 * 전체를 고른 뒤에는 몇 개를 골랐는지와 '선택 해제'를 보여 준다.
 */
export default function SelectAllResultsNotice({
  pageCount,
  selectedCount,
  allPageSelected,
  totalCount,
  selectAllLabel,
  onSelectAll,
  onClear,
}: SelectAllResultsNoticeProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showSelectAll = allPageSelected && selectedCount <= pageCount && totalCount > pageCount;
  const showSelectedAll = selectedCount > pageCount;
  if (!showSelectAll && !showSelectedAll) return null;

  const handleSelectAll = async () => {
    setLoading(true);
    setError(null);
    try {
      setError(await onSelectAll());
    } catch {
      setError("검색 결과를 불러오지 못했습니다.");
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-blue-50 px-4 py-2 text-sm text-slate-700">
      {showSelectedAll ? (
        <>
          <span>검색 결과 {selectedCount.toLocaleString("ko-KR")}개를 모두 선택했습니다.</span>
          <button type="button" onClick={onClear} className="font-medium text-blue-700 hover:underline">
            선택 해제
          </button>
        </>
      ) : (
        <>
          <span>이 페이지의 {pageCount}개를 선택했습니다.</span>
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={loading}
            className="font-medium text-blue-700 hover:underline disabled:opacity-60"
          >
            {loading ? "불러오는 중..." : selectAllLabel}
          </button>
        </>
      )}
      {error ? <span className="text-red-600">{error}</span> : null}
    </div>
  );
}
