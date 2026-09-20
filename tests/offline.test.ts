import { describe, expect, it } from "vitest";
import {
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  createOutboxItem,
  dedupeKey,
  describeOutboxEntry,
  entryWorkDate,
  errorMessage,
  formatQueuedAt,
  isDue,
  markFailed,
  mergeQueued,
  nextRetryDelayMs,
  shouldRetry,
  sortOutbox,
  summarizeOutbox,
  toOutboxItem,
  toOutboxItems,
  type OutboxEntry,
  type OutboxItem,
} from "@/lib/offline/queue-core";

const ITEM_A = "11111111-1111-4111-8111-111111111111";
const ITEM_B = "22222222-2222-4222-8222-222222222222";

/** 2026-09-20 14:03（日本時間） */
const AT_1403 = Date.UTC(2026, 8, 20, 5, 3);
/** 2026-09-20 18:30（日本時間） */
const AT_1830 = Date.UTC(2026, 8, 20, 9, 30);

function preEntry(date = "2026-09-20", alcohol = "0"): OutboxEntry {
  return {
    kind: "daily_report",
    payload: { input: { work_date: date, vehicle_id: "", pre: { at: "", method: "app", alcohol, health_ok: true, inspection_ok: true } } },
  };
}

function postEntry(date = "2026-09-20"): OutboxEntry {
  return {
    kind: "daily_report",
    payload: { input: { work_date: date, post: { at: "", method: "app", alcohol: "0", condition_ok: true, incident: "" }, work: { distance_km: "80" } } },
  };
}

function dayEntries(date = "2026-09-20", qty: string | number = 12): OutboxEntry {
  return { kind: "day_entries", payload: { work_date: date, rows: [{ project_item_id: ITEM_A, qty }] } };
}

function item(entry: OutboxEntry, createdAt: number, over: Partial<OutboxItem> = {}): OutboxItem {
  return { ...createOutboxItem(entry, createdAt), ...over } as OutboxItem;
}

describe("dedupeKey（同じ日・同じ内容の二重送信を防ぐ）", () => {
  it("同じ日の出発前どうしは同じキーになる（入力し直しても 1 件にまとまる）", () => {
    expect(dedupeKey("daily_report", preEntry("2026-09-20", "0").payload)).toBe(dedupeKey("daily_report", preEntry("2026-09-20", "0.05").payload));
  });

  it("同じ日でも出発前と終了後は別のキーになる（点呼が上書きされない）", () => {
    expect(dedupeKey("daily_report", preEntry().payload)).not.toBe(dedupeKey("daily_report", postEntry().payload));
  });

  it("日付が違えば別のキーになる", () => {
    expect(dedupeKey("daily_report", preEntry("2026-09-20").payload)).not.toBe(dedupeKey("daily_report", preEntry("2026-09-19").payload));
  });

  it("今日の稼働は数量が変わっても同じ日なら同じキーになる（最新の入力で置き換える）", () => {
    expect(dedupeKey("day_entries", dayEntries("2026-09-20", 12).payload)).toBe(dedupeKey("day_entries", dayEntries("2026-09-20", 15).payload));
  });

  it("日報と今日の稼働は別のキーになる", () => {
    expect(dedupeKey("day_entries", dayEntries().payload)).not.toBe(dedupeKey("daily_report", preEntry().payload));
  });

  it("壊れた内容でも例外を投げずにキーを返す", () => {
    expect(typeof dedupeKey("daily_report", null)).toBe("string");
    expect(typeof dedupeKey("day_entries", { work_date: "2026-13-99" })).toBe("string");
  });
});

describe("nextRetryDelayMs（再送までの待ち時間）", () => {
  it("1 回目の失敗の後は 5 秒待つ", () => {
    expect(nextRetryDelayMs(1)).toBe(RETRY_BASE_MS * 2);
    expect(nextRetryDelayMs(0)).toBe(RETRY_BASE_MS);
  });

  it("失敗が重なるほど待ち時間が倍になる", () => {
    expect(nextRetryDelayMs(2)).toBe(20_000);
    expect(nextRetryDelayMs(3)).toBe(40_000);
    expect(nextRetryDelayMs(2)).toBeLessThan(nextRetryDelayMs(3));
  });

  it("待ち時間の上限は 5 分", () => {
    expect(nextRetryDelayMs(10)).toBe(RETRY_MAX_MS);
    expect(nextRetryDelayMs(1000)).toBe(RETRY_MAX_MS);
    expect(RETRY_MAX_MS).toBe(300_000);
  });

  it("回数が不正なら最短の待ち時間にする", () => {
    expect(nextRetryDelayMs(-5)).toBe(RETRY_BASE_MS);
    expect(nextRetryDelayMs(Number.NaN)).toBe(RETRY_BASE_MS);
  });
});

describe("isDue（いま送ってよいか）", () => {
  it("まだ一度も試していない記録はすぐ送る", () => {
    expect(isDue(item(preEntry(), AT_1403), AT_1403)).toBe(true);
  });

  it("待ち時間が過ぎていなければ送らない", () => {
    const failed = markFailed(item(preEntry(), AT_1403), "通信できませんでした", AT_1403);
    expect(isDue(failed, AT_1403 + 3_000)).toBe(false);
  });

  it("待ち時間が過ぎたら送る", () => {
    const failed = markFailed(item(preEntry(), AT_1403), "通信できませんでした", AT_1403);
    expect(isDue(failed, AT_1403 + RETRY_BASE_MS * 2)).toBe(true);
  });
});

describe("shouldRetry（あとで送り直してよい失敗か）", () => {
  it("通信が切れた失敗は送り直す", () => {
    expect(shouldRetry("Failed to fetch")).toBe(true);
    expect(shouldRetry("NetworkError when attempting to fetch resource.")).toBe(true);
    expect(shouldRetry("Load failed")).toBe(true);
  });

  it("例外オブジェクトでも判定できる", () => {
    expect(shouldRetry(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("締め済みの月のエラーは送り直さない", () => {
    expect(shouldRetry("締め済みの月は変更できません。締めを解除してから操作してください。")).toBe(false);
  });

  it("権限のエラーは送り直さない", () => {
    expect(shouldRetry("この操作を行う権限がありません。")).toBe(false);
  });

  it("入力の誤り（日本語の検証エラー）は送り直さない", () => {
    expect(shouldRetry("rows.0.qty: 数量は 0 以上で入力してください")).toBe(false);
    expect(shouldRetry("アルコール検知の数値を入力してください")).toBe(false);
  });

  it("日本語でも通信の案内なら送り直す", () => {
    expect(shouldRetry("ネットワークに接続できません")).toBe(true);
    expect(shouldRetry("通信がタイムアウトしました")).toBe(true);
  });

  it("ログインが切れた・サーバーが不調なときは捨てずに送り直す（1 年保存が必要な記録のため）", () => {
    expect(shouldRetry("ログインが必要です。")).toBe(true);
    expect(shouldRetry("セッションの有効期限が切れました")).toBe(true);
    expect(shouldRetry("データベースエラー: connection terminated")).toBe(true);
  });

  it("理由が分からないときは送り直す", () => {
    expect(shouldRetry(null)).toBe(true);
    expect(shouldRetry("")).toBe(true);
    expect(shouldRetry(undefined)).toBe(true);
  });

  it("サーバー側の一時的な失敗（5xx・429）は送り直し、入力の誤り（4xx）は送り直さない", () => {
    expect(shouldRetry({ status: 503 })).toBe(true);
    expect(shouldRetry({ status: 429 })).toBe(true);
    expect(shouldRetry({ status: 400 })).toBe(false);
  });

  it("ActionResult の形（{ ok:false, error }）でも判定できる", () => {
    expect(shouldRetry({ ok: false, error: "締め済みの月は変更できません。" })).toBe(false);
    expect(shouldRetry({ ok: false, error: "Failed to fetch" })).toBe(true);
  });
});

describe("errorMessage（利用者に見せる文言）", () => {
  it("日本語の理由はそのまま見せる", () => {
    expect(errorMessage("締め済みの月は変更できません。")).toBe("締め済みの月は変更できません。");
  });

  it("英語の通信エラーは日本語に言い換える", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toContain("電波");
  });

  it("理由が無いときも日本語の案内を返す", () => {
    expect(errorMessage(null)).not.toBe("");
  });
});

describe("summarizeOutbox（未送信の件数といちばん古い日時）", () => {
  it("未送信が無ければ 0 件と案内を返す", () => {
    const s = summarizeOutbox([]);
    expect(s.count).toBe(0);
    expect(s.oldestAt).toBeNull();
    expect(s.label).toBe("未送信はありません");
  });

  it("件数といちばん古い日時を日本語で返す", () => {
    const s = summarizeOutbox([item(preEntry(), AT_1403), item(postEntry(), AT_1830)]);
    expect(s.count).toBe(2);
    expect(s.oldestAt).toBe(AT_1403);
    expect(s.oldestLabel).toBe("9/20(日) 14:03");
    expect(s.label).toBe("未送信 2 件（最も古い記録：9/20(日) 14:03）");
  });

  it("新しい順に並んでいてもいちばん古いものを選ぶ", () => {
    const s = summarizeOutbox([item(postEntry(), AT_1830), item(preEntry(), AT_1403)]);
    expect(s.oldestAt).toBe(AT_1403);
  });

  it("null や undefined を渡しても落ちない", () => {
    expect(summarizeOutbox(null).count).toBe(0);
    expect(summarizeOutbox(undefined).label).toBe("未送信はありません");
  });
});

describe("mergeQueued（同じキーは新しいほうで置き換える）", () => {
  it("同じ内容を入れ直しても件数は増えない", () => {
    const first = item(preEntry("2026-09-20", "0"), AT_1403);
    const second = item(preEntry("2026-09-20", "0.02"), AT_1830);
    const merged = mergeQueued([first], second);
    expect(merged).toHaveLength(1);
    expect(merged[0].createdAt).toBe(AT_1830);
  });

  it("置き換えても並び順（位置）は変わらない", () => {
    const a = item(preEntry(), AT_1403);
    const b = item(dayEntries(), AT_1403 + 1);
    const c = item(postEntry(), AT_1403 + 2);
    const merged = mergeQueued([a, b, c], item(dayEntries("2026-09-20", 20), AT_1830));
    expect(merged).toHaveLength(3);
    expect(merged[1].id).toBe(b.id);
    expect(merged[1].createdAt).toBe(AT_1830);
  });

  it("別のキーは末尾に足す", () => {
    const merged = mergeQueued([item(preEntry(), AT_1403)], item(postEntry(), AT_1830));
    expect(merged).toHaveLength(2);
    expect(merged[1].id).toContain("post");
  });

  it("配列でまとめて渡せる（同じキーは最後のものが残る）", () => {
    const merged = mergeQueued([], [item(dayEntries("2026-09-20", 1), AT_1403), item(dayEntries("2026-09-20", 9), AT_1830)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].createdAt).toBe(AT_1830);
  });

  it("元の配列を書き換えない", () => {
    const items = [item(preEntry(), AT_1403)];
    mergeQueued(items, item(postEntry(), AT_1830));
    expect(items).toHaveLength(1);
  });
});

describe("キューの 1 件（作成・失敗・並べ替え）", () => {
  it("id は dedupeKey と同じで、最初は未試行", () => {
    const created = createOutboxItem(preEntry(), AT_1403);
    expect(created.id).toBe(dedupeKey("daily_report", preEntry().payload));
    expect(created.tries).toBe(0);
    expect(created.lastError).toBeNull();
    expect(created.lastTriedAt).toBeNull();
    expect(created.createdAt).toBe(AT_1403);
  });

  it("失敗すると回数が増え、理由と時刻が残る", () => {
    const failed = markFailed(item(preEntry(), AT_1403), "通信できませんでした", AT_1830);
    expect(failed.tries).toBe(1);
    expect(failed.lastError).toBe("通信できませんでした");
    expect(failed.lastTriedAt).toBe(AT_1830);
  });

  it("失敗の記録は元の 1 件を書き換えない", () => {
    const original = item(preEntry(), AT_1403);
    markFailed(original, "通信できませんでした", AT_1830);
    expect(original.tries).toBe(0);
    expect(original.lastError).toBeNull();
  });

  it("理由が空でも日本語の既定の文言を入れる", () => {
    expect(markFailed(item(preEntry(), AT_1403), "   ", AT_1830).lastError).not.toBe("   ");
  });

  it("古い順に並べ替える（入力した順に送る）", () => {
    const a = item(preEntry(), AT_1830);
    const b = item(postEntry(), AT_1403);
    expect(sortOutbox([a, b]).map((x) => x.createdAt)).toEqual([AT_1403, AT_1830]);
  });
});

describe("toOutboxItem（端末に保存されていた値の読み戻し）", () => {
  it("正しい 1 件はそのまま読み戻す", () => {
    const saved = JSON.parse(JSON.stringify(item(dayEntries(), AT_1403))) as unknown;
    const back = toOutboxItem(saved);
    expect(back?.kind).toBe("day_entries");
    expect(back?.createdAt).toBe(AT_1403);
  });

  it("種類が分からない行は捨てる", () => {
    expect(toOutboxItem({ kind: "unknown", payload: { work_date: "2026-09-20" } })).toBeNull();
  });

  it("日付が不正な行は捨てる", () => {
    expect(toOutboxItem({ kind: "day_entries", payload: { work_date: "2026-13-40", rows: [{ project_item_id: ITEM_B, qty: 1 }] } })).toBeNull();
    expect(toOutboxItem({ kind: "daily_report", payload: { input: { work_date: "" } } })).toBeNull();
  });

  it("中身が無い行・null は捨てる", () => {
    expect(toOutboxItem(null)).toBeNull();
    expect(toOutboxItem({ kind: "day_entries", payload: { work_date: "2026-09-20", rows: [] } })).toBeNull();
  });

  it("回数や時刻が壊れていても既定値で読み戻す", () => {
    const back = toOutboxItem({ kind: "day_entries", payload: dayEntries().payload, id: "", tries: "3", createdAt: "x", lastTriedAt: null });
    expect(back?.tries).toBe(0);
    expect(back?.createdAt).toBe(0);
    expect(back?.id).toBe(dedupeKey("day_entries", dayEntries().payload));
  });

  it("配列では壊れた行だけを捨てて古い順に並べる", () => {
    const items = toOutboxItems([item(postEntry(), AT_1830), { kind: "day_entries", payload: {} }, item(preEntry(), AT_1403), null]);
    expect(items).toHaveLength(2);
    expect(items[0].createdAt).toBe(AT_1403);
  });
});

describe("表示（日本語）", () => {
  it("未送信の 1 件を日本語で説明する", () => {
    expect(describeOutboxEntry(dayEntries())).toBe("今日の稼働（9/20(日)）");
    expect(describeOutboxEntry(preEntry("2026-09-19"))).toBe("点呼・業務記録（9/19(土)）");
  });

  it("対象の日付を取り出せる", () => {
    expect(entryWorkDate(preEntry("2026-09-19"))).toBe("2026-09-19");
    expect(entryWorkDate(dayEntries("2026-09-20"))).toBe("2026-09-20");
  });

  it("日時を日本時間で表示する", () => {
    expect(formatQueuedAt(AT_1830)).toBe("9/20(日) 18:30");
  });

  it("日時が不正なら空文字を返す", () => {
    expect(formatQueuedAt(null)).toBe("");
    expect(formatQueuedAt(Number.NaN)).toBe("");
    expect(formatQueuedAt(1e20)).toBe("");
  });
});
