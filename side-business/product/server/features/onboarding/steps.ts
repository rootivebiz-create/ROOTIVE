/**
 * 最初の設定の案内（純関数）。どの手順がどこまで済んだかを、保存した印（tenants.onboarding）と
 * 実際のデータ（ドライバーの人数など）から決める。DB に触らない。
 *
 * tenants.onboarding の形：{ company: "done", drivers: "skipped", …, finished: "done" }
 * - done：済んだ ／ skipped：あとでやる（とばした）／ 印が無い：まだ
 * - 印が無くても、データがあれば「済み（auto）」と見る（設定の画面から先に入れた会社のため）
 * - finished：「案内を終える」を押した（残りの手順があってもホームの案内を出さない）
 */

export type OnboardingKey = "company" | "drivers" | "projects" | "rules" | "import" | "parallel";
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

export const ONBOARDING_STEPS: OnboardingStepDef[] = [
  { key: "company", no: 1, title: "会社の基本", minutes: 5, summary: "締め日・支払日・振込手数料・インボイスの登録番号・消費税の計算方法", path: "/onboarding/company", ownerOnly: true },
  { key: "drivers", no: 2, title: "ドライバー", minutes: 10, summary: "Excel の名簿を貼り付けるか、ファイルを置くだけで、まとめて登録します", path: "/onboarding/drivers" },
  { key: "projects", no: 3, title: "元請と案件", minutes: 10, summary: "元請の名前・案件・単位・受注単価・支払単価を、表に書くように入れます", path: "/onboarding/projects" },
  { key: "rules", no: 4, title: "控除のルール", minutes: 5, summary: "ロイヤリティ・管理費など、毎月の支払から引くものを決めます", path: "/onboarding/rules" },
  { key: "import", no: 5, title: "先月の Excel を取り込む", minutes: 15, summary: "今お使いの稼働の Excel を、そのまま置きます（形を変えなくて大丈夫です）", path: "/import", withMonth: true },
  { key: "parallel", no: 6, title: "Excel と比べる", minutes: 10, summary: "先月の振込額が、今の Excel と同じになるかを確かめます", path: "/parallel", withMonth: true },
];

export const ONBOARDING_KEYS = ONBOARDING_STEPS.map((s) => s.key);

export function isOnboardingKey(value: unknown): value is OnboardingKey {
  return typeof value === "string" && (ONBOARDING_KEYS as string[]).includes(value);
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
};

export type OnboardingStepView = {
  def: OnboardingStepDef;
  state: StepState;
  /** データから分かること（「登録済み 8人」など） */
  note: string | null;
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
    default:
      return null;
  }
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
    return { def, state, note };
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
