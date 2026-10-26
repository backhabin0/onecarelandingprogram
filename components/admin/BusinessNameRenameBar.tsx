"use client";

import { useState, type FormEvent } from "react";
import { withDirectionParticle } from "@/lib/business-info";
import {
  buildRenameConfirmMessage,
  chunkArray,
  type RenameTarget,
} from "@/lib/business-name-rename";
import {
  BUSINESS_NAME_RENAME_CHUNK_SIZE,
  LANDING_PAGE_MAX_LENGTH,
  validateBusinessNameInput,
} from "@/lib/landing-page-validation";

interface RenameResult {
  success: boolean;
  changed: number;
  error?: string;
}

interface BusinessNameRenameBarProps {
  /** 선택한 항목(id와 지금 업체명) */
  selected: RenameTarget[];
  /** 확인 창 문구에 쓰는 이름 + 목적격 조사(예: "페이지를", "대기열 항목을") */
  objectLabel: string;
  /** 100개 이하 묶음 하나를 바꾸는 Server Action */
  rename: (ids: string[], businessName: string) => Promise<RenameResult>;
  /** 끝나면(일부만 성공해도) 선택을 비우고 목록을 새로 읽는다 */
  onDone: () => void;
  /** 홈 대표 업체명(관리자 설정). 이름이 똑같을 때만 홈 업체로 묶인다는 안내에 쓴다 */
  siteBusinessName?: string | null;
}

/**
 * 선택한 항목의 업체명을 한꺼번에 바꾸는 막대(랜딩페이지 목록·공개 대기열 공용).
 * 확인 창을 띄운 뒤 100개씩 나눠 순서대로 보내고, 서버가 같은 규칙(필수, 100자)으로 다시 검사한다.
 * 중간 묶음이 실패하면 거기서 멈추고 몇 개까지 바꿨는지 알려 준다.
 */
export default function BusinessNameRenameBar({
  selected,
  objectLabel,
  rename,
  onDone,
  siteBusinessName = null,
}: BusinessNameRenameBarProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || selected.length === 0) return;
    setMessage(null);

    const { value, error } = validateBusinessNameInput(name);
    if (error) {
      setMessage({ type: "error", text: error });
      return;
    }
    if (!window.confirm(buildRenameConfirmMessage(selected, value, objectLabel))) return;

    setBusy(true);
    const chunks = chunkArray(
      selected.map((target) => target.id),
      BUSINESS_NAME_RENAME_CHUNK_SIZE
    );
    let done = 0;
    let changed = 0;
    let failure: string | null = null;
    for (const ids of chunks) {
      setProgress(`${done} / ${selected.length} 처리 중...`);
      try {
        const result = await rename(ids, value);
        if (!result.success) {
          failure = result.error ?? "업체명을 바꾸지 못했습니다.";
          break;
        }
        changed += result.changed;
      } catch {
        failure = "업체명을 바꾸지 못했습니다.";
        break;
      }
      done += ids.length;
    }
    setProgress(null);
    setBusy(false);

    if (failure) {
      setMessage({
        type: "error",
        text: `${failure} (${selected.length}개 중 ${done}개까지 처리하고 멈췄습니다. 바뀐 항목 ${changed}개)`,
      });
    } else {
      const unchanged = selected.length - changed;
      setMessage({
        type: "success",
        text:
          `${changed}개의 업체명을 "${value}"${withDirectionParticle(value).slice(value.length)} 바꿨습니다.` +
          (unchanged > 0 ? ` ${unchanged}개는 이미 같은 이름이거나 바꿀 수 없는 항목이라 그대로 두었습니다.` : ""),
      });
      setName("");
    }
    onDone();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm"
    >
      <label htmlFor="rename-business-name" className="font-medium text-slate-700">
        선택한 {selected.length}개 업체명 바꾸기
      </label>
      <input
        id="rename-business-name"
        className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
        placeholder="새 업체명"
        maxLength={LANDING_PAGE_MAX_LENGTH.businessName}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
      />
      <button
        type="submit"
        disabled={busy || selected.length === 0 || !name.trim()}
        className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "바꾸는 중..." : "업체명 바꾸기"}
      </button>
      {progress ? <span className="text-blue-600">{progress}</span> : null}
      {message ? (
        <span className={message.type === "error" ? "text-red-600" : "text-green-700"}>{message.text}</span>
      ) : null}
      <p className="w-full text-xs text-slate-400">
        {siteBusinessName
          ? `업체명이 홈 대표 업체명("${siteBusinessName}")과 똑같은 페이지만 홈 업체로 묶입니다.`
          : "홈 대표 업체명이 비어 있어 어떤 페이지도 홈 업체로 묶이지 않습니다(관리자 설정에서 입력)."}
      </p>
    </form>
  );
}
