/**
 * 最初の設定の案内（純関数）。どの手順がどこまで済んだかを、保存した印（tenants.onboarding）と
 * 実際のデータ（ドライバーの人数など）から決める。DB に触らない。
 *
 * tenants.onboarding の形：{ company: "done", drivers: "skipped", …, finished: "done" }
 * - done：済んだ ／ skipped：あとでやる（とばした）／ 印が無い：まだ
 * - 印が無くても、データがあれば「済み（auto）」と見る（設定の画面から先に入れた会社のため）
 * - finished：「案内を終える」を押した（残りの手順があってもホームの案内を出さない）
 */

export type OnboardingKey = "company" | "drivers" | "projects" | "rules" | "terms" | "import" | "parallel";
export type StepMark = "done" | "skipped";
export type StepState = "done" | "skipped" | "auto" | "todo";

export type OnboardingStepDef = {
  key: OnboardingKey;
  no: number;
  title: string;
  /** かかる時間の目安（分） */
  minutes: number;
  /** 何をするか（1 行） */
  summary: string;
  /** 開く画面（取り込み・比べ合わせは月を付ける） */
  path: string;
  /** 月を付けて開くか（先月の分を開く） */
  withMonth?: boolean;
  /** 書き込めるのはオーナーだけ */
  ownerOnly?: boolean;
};

/**
 * 手順の順番（SPEC P0-1）：会社 → 先月の稼働ファイル → 名前・案件・控除の確かめ → 今の振込額と比べる → 取引条件の明示。
 * マスタ（ドライバー・案件）を先に埋めさせない。取り込みが知らない名前・案件をその場で登録するので、
 * 取り込んだあとのドライバー・案件・控除は「データあり（済み）」になり、足りないものを足す手順になる。
 * 取引条件の明示は、Excel と合うのを確かめたあと（台帳の単価・控除が固まってから明示書を作る）。
 */
export const ONBOARDING_STEPS: OnboardingStepDef[] = [
  { key: "company", no: 1, title: "会社の基本", minutes: 5, summary: "締め日・支払日・振込手数料・インボイスの登録番号・消費税の計算方法（会社の大きさは任意）", path: "/onboarding/company", ownerOnly: true },
  {
    key: "import",
    no: 2,
    title: "先月の Excel を取り込む",
    minutes: 15,
    summary: "今お使いの稼働の Excel を、形を変えずにそのまま置きます。知らない名前・案件はその場で登録でき、控除の列があれば控除の提案も出ます",
    path: "/import",
    withMonth: true,
  },
  { key: "drivers", no: 3, title: "ドライバー", minutes: 5, summary: "取り込みで登録した人を確かめます。足りない人は、Excel の名簿を貼り付けるかファイルを置いて、まとめて足せます", path: "/onboarding/drivers" },
  { key: "projects", no: 4, title: "元請と案件", minutes: 10, summary: "案件ごとの元請の名前・単位・受注単価・支払単価を確かめ、足りないものを表に書くように入れます", path: "/onboarding/projects" },
  { key: "rules", no: 5, title: "控除のルール", minutes: 5, summary: "ロイヤリティ・管理費など、毎月の支払から引くものを確かめます（取り込みの「控除の提案」で採ったものは入っています）", path: "/onboarding/rules" },
  { key: "parallel", no: 6, title: "Excel と比べる", minutes: 10, summary: "今の Excel で出した先月の振込額を入れて、しめ日ラボの額と同じになるかを確かめます（取り込みの振込額の列からも入ります）", path: "/parallel", withMonth: true },
  {
    key: "terms",
    no: 7,
    title: "取引条件の明示",
    minutes: 10,
    summary: "Excel と合うのを確かめたら、仕事の内容・報酬・支払日・引くものを書いた明示書を、台帳からまとめて作ります（紙で渡している人は、渡した日を記録します）",
    path: "/terms",
  },
];

export const ONBOARDING_KEYS = ONBOARDING_STEPS.map((s) => s.key);

export function isOnboardingKey(value: unknown): value is OnboardingKey {
  return typeof value === "string" && (ONBOARDING_KEYS as string[]).includes(value);
}

/** その手順の次の手順（最後なら null）。「次の手順へ」のリンクはすべてここから決める（順番を画面に書かない） */
export function nextStepOf(key: OnboardingKey): OnboardingStepDef | null {
  const i = ONBOARDING_STEPS.findIndex((s) => s.key === key);
  return i >= 0 ? (ONBOARDING_STEPS[i + 1] ?? null) : null;
}

/** 手順の画面へのリンク。取り込み・比べ合わせは先月（lastMonth：YYYY-MM）の分を開く */
export function stepHref(def: OnboardingStepDef, lastMonth: string): string {
  return def.withMonth ? `${def.path}?m=${lastMonth}` : def.path;
}

/** 実際のデータ（印が無くても、あれば済みと見る） */
export type OnboardingFacts = {
  drivers: number;
  projects: number;
  rules: number;
  /** 稼働の行（どの月でも） */
  workEntries: number;
  /** Excel と比べた記録（どの月でも） */
  parallelChecks: number;
  /**
   * 有効なドライバーの人数と、そのうち取引条件を明示した記録（明示書・明示した日）が見つからない人の名前。
   * 渡さなければ（古い呼び出し）取引条件の手順はデータから決めない
   */
  activeDrivers?: number;
  driversWithoutTerms?: string[];
};

export type OnboardingStepView = {
  def: OnboardingStepDef;
  state: StepState;
  /** データから分かること（「登録済み 8人」など）。これがあると「済み」と見る */
  note: string | null;
  /** まだ済んでいない手順で、残っていること（「記録が無い人 1人：遠藤 大輔さん」など）。済みの判定には使わない */
  pending?: string | null;
};

export type OnboardingProgress = {
  steps: OnboardingStepView[];
  /** 済み・とばした・データあり の数 */
  doneCount: number;
  total: number;
  /** すべての手順が済んだ（とばした）か、「案内を終える」を押した */
  complete: boolean;
  finished: boolean;
  /** 次にやる手順（無ければ null） */
  next: OnboardingStepDef | null;
  /** 残りの手順の目安の合計（分） */
  minutesLeft: number;
};

function autoNote(key: OnboardingKey, facts: OnboardingFacts): string | null {
  switch (key) {
    case "drivers":
      return facts.drivers > 0 ? `登録済み ${facts.drivers}人` : null;
    case "projects":
      return facts.projects > 0 ? `案件 ${facts.projects} 件` : null;
    case "rules":
      return facts.rules > 0 ? `控除のルール ${facts.rules} 件` : null;
    case "import":
      return facts.workEntries > 0 ? "稼働が入っています" : null;
    case "parallel":
      return facts.parallelChecks > 0 ? `比べた記録 ${facts.parallelChecks} 件` : null;
    case "terms":
      // 有効な人が全員、明示の記録を持っているときだけ「済み」
      return facts.activeDrivers && facts.driversWithoutTerms && facts.driversWithoutTerms.length === 0
        ? `有効なドライバー ${facts.activeDrivers}人の全員に、取引条件の記録があります`
        : null;
    default:
      return null;
  }
}

/** 「遠藤 大輔さん・木村 誠さん ほか 2人」 */
function namesText(names: string[]): string {
  const shown = names.slice(0, 3).map((n) => `${n}さん`).join("・");
  return names.length > 3 ? `${shown} ほか ${names.length - 3}人` : shown;
}

function pendingNote(key: OnboardingKey, facts: OnboardingFacts): string | null {
  if (key !== "terms" || !facts.driversWithoutTerms?.length) return null;
  const missing = facts.driversWithoutTerms;
  return `取引条件を明示した記録（明示書か、明示した日）が見つからない人が ${missing.length}人います（有効な ${facts.activeDrivers ?? missing.length}人のうち）：${namesText(missing)}`;
}

export function onboardingProgress(record: Record<string, string> | null | undefined, facts: OnboardingFacts): OnboardingProgress {
  const rec = record ?? {};
  const steps: OnboardingStepView[] = ONBOARDING_STEPS.map((def) => {
    const mark = rec[def.key];
    const note = autoNote(def.key, facts);
    let state: StepState;
    if (mark === "done") state = "done";
    else if (mark === "skipped") state = note ? "auto" : "skipped";
    else state = note ? "auto" : "todo";
    return { def, state, note, pending: state === "auto" || state === "done" ? null : pendingNote(def.key, facts) };
  });
  const doneCount = steps.filter((s) => s.state !== "todo").length;
  const finished = rec.finished === "done";
  const todo = steps.filter((s) => s.state === "todo");
  return {
    steps,
    doneCount,
    total: steps.length,
    complete: finished || todo.length === 0,
    finished,
    next: todo[0]?.def ?? null,
    minutesLeft: todo.reduce((a, s) => a + s.def.minutes, 0),
  };
}

/** 印を付け替えた新しい記録（null は印を消す＝まだに戻す） */
export function withMark(record: Record<string, string> | null | undefined, key: OnboardingKey | "finished", mark: StepMark | null): Record<string, string> {
  const next = { ...(record ?? {}) };
  if (mark === null) delete next[key];
  else next[key] = mark;
  return next;
}

/** 「案内を終える」：まだの手順を「とばした」にして、終えた印を付ける */
export function finishRecord(record: Record<string, string> | null | undefined): Record<string, string> {
  const next = { ...(record ?? {}) };
  for (const key of ONBOARDING_KEYS) if (next[key] !== "done") next[key] = "skipped";
  next.finished = "done";
  return next;
}

/** 「ホームに案内をまた出す」：終えた印と「あとで」の印を外す（済んだ手順はそのまま） */
export function reopenRecord(record: Record<string, string> | null | undefined): Record<string, string> {
  const next = { ...(record ?? {}) };
  delete next.finished;
  for (const key of ONBOARDING_KEYS) if (next[key] === "skipped") delete next[key];
  return next;
}

export const STATE_LABEL: Record<StepState, string> = { done: "済み", auto: "済み", skipped: "あとで", todo: "まだ" };

/** 「約5分」 */
export function minutesText(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `約${h}時間${m}分` : `約${h}時間`;
  }
  return `約${minutes}分`;
}
