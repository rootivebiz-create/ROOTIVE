/**
 * ホーム（今月の締め）の 5 つの段と「次にやること」（純関数。DB に触らない）。
 * 開いている月：上から順に、最初に済んでいない段が「次にやること」。
 * 締めた月：残りは「明細を送る」「振込データを作る」「振り込んだ日を記録する」だけ。全部済めば「締め済み」。
 * 閲覧の人（viewer）には、同じ段を「見る」ボタンにして、だれが進めるかを添える。
 */
import { monthLabelJa, monthParam } from "~/server/month";
import type { HomeStatus } from "./types";

export type StepKey = "import" | "watch" | "statements" | "transfer" | "close";
export type Tone = "green" | "yellow" | "red" | "gray";

export type HomeStepView = {
  key: StepKey;
  no: number;
  title: string;
  tone: Tone;
  /** 段の右に出す短い状態（「未作成」「赤 2 件」など） */
  badge: string;
  lines: string[];
  /** 行の下に出す、直す画面へのリンク（見張り番の赤い指摘など） */
  items?: { text: string; href: string | null }[];
  href: string;
  linkLabel: string;
  done: boolean;
  /** 「次にやること」の段か */
  current: boolean;
};

export type NextAction = {
  stepKey: StepKey | "executed";
  /** ボタンの文字 */
  label: string;
  href: string;
  /** ボタンの下の 1〜2 文 */
  description: string;
  /** 押した先で操作できる人か（閲覧の人は false） */
  canAct: boolean;
};

export type HomeView = {
  title: string;
  steps: HomeStepView[];
  next: NextAction | null;
  /** 締めた月で、残りの作業も無い */
  allDone: boolean;
};

const jstFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function jstShort(d: Date): string {
  return jstFormat.format(d);
}

function yen(n: number): string {
  return `${Math.round(n).toLocaleString("ja-JP")}円`;
}

/** 「木村 誠さん・佐藤 亮さん ほか 2人」（多いときは 3 人まで書く） */
function namesText(names: string[]): string {
  const shown = names.slice(0, 3).map((n) => `${n}さん`).join("・");
  return names.length > 3 ? `${shown} ほか ${names.length - 3}人` : shown;
}

export function homeView(st: HomeStatus, opts: { canEdit: boolean }): HomeView {
  const m = monthParam(st.month);
  const q = `?m=${m}`;
  const { canEdit } = opts;
  const w = st.work;
  const sm = st.statements;
  const tr = st.transfer;
  const hasWork = w.entries > 0 || w.adjustments > 0;
  const sendNeeded = sm.unsent + sm.needsResend;
  const statementsReady = st.closed ? sm.saved > 0 : sm.upToDate && sm.saved > 0;

  // ① 取り込み
  const importLines: string[] = [];
  if (hasWork) importLines.push(`稼働 ${w.entries} 件（${w.drivers}人）・調整 ${w.adjustments} 件`);
  else importLines.push(st.closed ? "この月の稼働はありません。" : "この月の稼働がまだありません。今お使いの Excel を、形を変えずにそのまま置けば取り込めます。");
  if (w.latestBatch) importLines.push(`最後の取り込み：${w.latestBatch.fileName}（${jstShort(w.latestBatch.createdAt)}${w.latestBatch.status === "draft" ? "・確認中" : ""}）`);
  if (w.openDrafts.length && !st.closed) importLines.push(`確認中の取り込みが ${w.openDrafts.length} 件あります（「反映する」を押すまで、稼働には入りません）。`);
  const importStep: HomeStepView = {
    key: "import",
    no: 1,
    title: "取り込み",
    tone: hasWork ? "green" : st.closed ? "gray" : "yellow",
    badge: hasWork ? "入っています" : "まだ",
    lines: importLines,
    href: w.openDrafts.length && canEdit && !st.closed ? `/import/${w.openDrafts[0].id}` : `/import${q}`,
    linkLabel: canEdit && !st.closed ? (w.openDrafts.length ? "確認中の取り込みを開く" : hasWork ? "取り込みを見る・足す" : "Excel を取り込む") : "取り込みを見る",
    done: hasWork || st.closed,
    current: false,
  };

  // ② 見張り番
  const wt = st.watch;
  let watchStep: HomeStepView;
  const watchBase = { key: "watch" as const, no: 2, title: "見張り番", href: `/watch${q}`, linkLabel: "見張り番を開く", current: false };
  if (wt.error) {
    watchStep = { ...watchBase, tone: "red", badge: "確かめられません", lines: [wt.error], done: st.closed };
  } else if (!hasWork && !st.closed) {
    watchStep = { ...watchBase, tone: "gray", badge: "稼働が入ってから", lines: ["稼働が入ると、フリーランス法・インボイス・いつもと違う数字を確かめます。"], done: false };
  } else if (wt.red > 0) {
    watchStep = {
      ...watchBase,
      tone: "red",
      badge: `赤 ${wt.red} 件`,
      lines: [
        st.closed
          ? "この月は締めてありますが、赤い指摘が残っています。来月に同じことが起きないよう、内容を確かめてください。"
          : "締めを止める指摘です。直すか、内容を確かめて「確認済み」にしてください。",
        ...(wt.red > wt.topRed.length ? [`ほか ${wt.red - wt.topRed.length} 件は、見張り番の画面にあります。`] : []),
      ],
      items: wt.topRed.map((i) => ({ text: `${i.title}${i.subjectLabel ? `（${i.subjectLabel}）` : ""}`, href: canEdit ? i.href : null })),
      done: st.closed,
    };
  } else {
    const lines = [wt.yellow > 0 ? `黄色の指摘が ${wt.yellow} 件あります。締めは止めませんが、確かめておくと安心です。` : "締めを止める指摘はありません。"];
    if (wt.redAcked > 0) lines.push(`確認済みにした赤い指摘が ${wt.redAcked} 件あります。`);
    watchStep = { ...watchBase, tone: wt.yellow > 0 ? "yellow" : "green", badge: wt.yellow > 0 ? `黄色 ${wt.yellow} 件` : "指摘なし", lines, done: true };
  }

  // ③ 支払明細
  const stBase = { key: "statements" as const, no: 3, title: "支払明細", href: `/statements${q}`, linkLabel: "明細を見る", current: false };
  let statementsStep: HomeStepView;
  const sendLines = (): string[] => {
    const lines = [
      `${sm.saved}人ぶん・送った ${sm.saved - sm.unsent}人・確認済み ${sm.confirmed}人${sm.deemed ? `（ほかに みなし確認 ${sm.deemed}人）` : ""}`,
    ];
    if (sm.needsResend > 0) lines.push(`送ったあとで中身が変わった人が ${sm.needsResend}人います（もう一度送ってください）。`);
    if (sm.changed > 0) lines.push(`確認のあとで明細が変わった人が ${sm.changed}人います。`);
    if (sm.openQuestions > 0) lines.push(`ドライバーからの、まだ解決していない質問が ${sm.openQuestions} 件あります。`);
    return lines;
  };
  if (st.closed) {
    statementsStep =
      sm.saved === 0
        ? { ...stBase, tone: "gray", badge: "明細なし", lines: ["この月は、明細を保存せずに締めています。"], done: true }
        : { ...stBase, tone: sendNeeded > 0 ? "yellow" : "green", badge: sendNeeded > 0 ? `未送付 ${sendNeeded}人` : "送付済み", lines: sendLines(), done: sendNeeded === 0 };
  } else if (sm.expected === 0 && sm.saved === 0) {
    statementsStep = { ...stBase, tone: "gray", badge: "稼働が入ってから", lines: ["稼働が入ると、ドライバーごとの支払明細を作れます。"], done: false };
  } else if (!sm.upToDate) {
    const parts = [
      sm.missing && `まだ作っていない ${sm.missing}人`,
      sm.stale && `作ったあとに稼働・設定が変わった ${sm.stale}人`,
      sm.orphan && `稼働が無くなった ${sm.orphan}人`,
    ].filter(Boolean);
    statementsStep = {
      ...stBase,
      tone: "yellow",
      badge: sm.saved === 0 ? "未作成" : "作り直しが必要",
      lines: [`${parts.join("・")}。`, `見込みは ${st.totals.drivers}人・振込額の合計 ${yen(st.totals.total)}です。`],
      done: false,
    };
  } else {
    statementsStep = { ...stBase, tone: sendNeeded > 0 ? "yellow" : "green", badge: sendNeeded > 0 ? `未送付 ${sendNeeded}人` : "送付済み", lines: sendLines(), done: sendNeeded === 0 };
  }

  // ④ 振込
  const trBase = { key: "transfer" as const, no: 4, title: "振込", href: `/transfer${q}`, linkLabel: canEdit ? "振込データへ" : "振込データを見る", current: false };
  // 振込データに入らない人（口座が無い・形が違う・振込額が 0 円以下）は、別に手当てが要るので必ず書く
  const noBank = tr.excluded.filter((x) => x.reason !== "not_positive").map((x) => x.name);
  const notPositive = tr.excluded.filter((x) => x.reason === "not_positive").map((x) => x.name);
  const excludedLines = statementsReady
    ? [
        ...(noBank.length
          ? [`口座が未登録か、口座の情報に直すところがあるため、振込データに入らない人が ${noBank.length}人います（${namesText(noBank)}）。口座を入れて作り直すか、別に振り込んでください。`]
          : []),
        ...(notPositive.length ? [`振込額が 0 円以下のため、振込データに入らない人が ${notPositive.length}人います（${namesText(notPositive)}）。明細を確かめてください。`] : []),
      ]
    : [];
  let transferStep: HomeStepView;
  if (st.closed && sm.saved === 0) {
    transferStep = { ...trBase, tone: "gray", badge: "明細なし", lines: ["明細が無いため、振込データはありません。"], done: true };
  } else if (tr.batches === 0 && statementsReady && tr.includable === 0 && tr.excluded.length > 0) {
    // 振込データに入れられる人がいない（全員、口座が無い など）。作れないので、止めずに知らせる
    transferStep = { ...trBase, tone: "yellow", badge: "振り込める人なし", lines: excludedLines, done: true };
  } else if (tr.batches === 0) {
    transferStep = {
      ...trBase,
      tone: "gray",
      badge: statementsReady ? "まだ" : "明細ができてから",
      lines: [
        statementsReady
          ? // 振込データがまだ無いので、入れられる人は全員「まだ入っていない人」
            `銀行にそのまま出せる振込データ（全銀形式）を作れます。${tr.includable}人・合計 ${yen(tr.notInBatchTotal)}の見込みです。`
          : "明細ができたら、銀行にそのまま出せる振込データ（全銀形式）を作れます。",
        ...excludedLines,
      ],
      done: false,
    };
  } else if (tr.changed > 0) {
    transferStep = {
      ...trBase,
      tone: "yellow",
      badge: "作り直しが必要",
      lines: [`作ったあとに明細が変わった振込データが ${tr.changed} 件あります。そのデータは銀行に出さずに取り消して、作り直してください。`],
      done: false,
    };
  } else if (statementsReady && tr.notInBatch > 0) {
    transferStep = {
      ...trBase,
      tone: "yellow",
      badge: `残り ${tr.notInBatch}人`,
      lines: [
        `${tr.batches} 件・${tr.people}人・合計 ${yen(tr.total)}を作ってあります。`,
        `まだどの振込データにも入っていない人が ${tr.notInBatch}人（合計 ${yen(tr.notInBatchTotal)}）います。振込データの画面で「まだ入っていない人だけ」を選んで作ってください。`,
        ...excludedLines,
      ],
      done: false,
    };
  } else {
    const lines = [
      `${tr.batches} 件・${tr.people}人・合計 ${yen(tr.total)}`,
      tr.executed < tr.batches
        ? `実際に振り込んだ日の記録：${tr.executed} / ${tr.batches} 件。振り込んだら記録してください（支払期日の確かめに使います）。`
        : "実際に振り込んだ日も記録してあります。",
    ];
    if (tr.changedExecuted > 0) {
      lines.push(`振り込んだあとに明細が変わった振込データが ${tr.changedExecuted} 件あります。振り込んだ額と明細の額が違うおそれがあるので、振込データの画面で確かめてください。`);
    }
    lines.push(...excludedLines);
    transferStep = { ...trBase, tone: tr.changedExecuted > 0 || excludedLines.length > 0 ? "yellow" : "green", badge: "作成済み", lines, done: true };
  }

  // ⑤ 締め
  const closeStep: HomeStepView = st.closed
    ? {
        key: "close",
        no: 5,
        title: "締め",
        tone: "green",
        badge: "締め済み",
        lines: [`${st.closedAt ? `${jstShort(st.closedAt)}に` : ""}締めました${st.closedByName ? `（${st.closedByName}さん）` : ""}。この月の稼働・調整・明細は、もう変わりません。`],
        href: `/close${q}`,
        linkLabel: "締めの記録を見る",
        done: true,
        current: false,
      }
    : {
        key: "close",
        no: 5,
        title: "締め",
        tone: "gray",
        badge: "まだ",
        lines: ["締めると、この月の稼働・調整・明細は、だれも書き換えられなくなります。"],
        href: `/close${q}`,
        linkLabel: canEdit ? "締める前の確かめへ" : "締めの様子を見る",
        done: false,
        current: false,
      };

  const steps = [importStep, watchStep, statementsStep, transferStep, closeStep];

  // 次にやること
  let next: NextAction | null = null;
  const act = (stepKey: NextAction["stepKey"], label: string, href: string, description: string, viewLabel: string): NextAction =>
    canEdit
      ? { stepKey, label, href, description, canAct: true }
      : { stepKey, label: viewLabel, href, description: `次は「${label}」です。事務・オーナーの方が進めます。この画面では様子を見られます。`, canAct: false };

  const sendAction = () =>
    act(
      "statements",
      `明細をドライバーへ送る（${sendNeeded}人）`,
      `/statements${q}&f=${sm.unsent > 0 ? "unsent" : "resend"}`,
      "リンクを送ると、ドライバーはスマホで明細を見て「確認しました」を押せます。質問もそこから届きます。",
      "明細の様子を見る",
    );
  const transferAction = () =>
    tr.changed > 0
      ? act("transfer", "振込データを作り直す", `/transfer${q}`, "作ったあとに明細が変わったので、前のデータは銀行に出さずに取り消して、作り直してください。", "振込データを見る")
      : tr.batches > 0 && tr.notInBatch > 0
        ? act(
            "transfer",
            `残りの人の振込データを作る（${tr.notInBatch}人）`,
            `/transfer${q}`,
            "前に作った振込データに入っていない人だけで作ります。同じ人に二重に振り込まないよう、しめ日ラボが見分けます。",
            "振込データを見る",
          )
        : act("transfer", "振込データを作る", `/transfer${q}`, "銀行のサイトにそのまま出せる振込データ（全銀形式）を作ります。口座が未登録の人は、先に知らせます。", "振込データを見る");

  if (!st.closed) {
    const first = steps.find((x) => !x.done);
    if (first?.key === "import") {
      next = w.openDrafts.length
        ? act("import", "確認中の取り込みを仕上げる", `/import/${w.openDrafts[0].id}`, "読み込んだ Excel の中身を確かめて「反映する」を押すと、稼働に入ります。", "取り込みの様子を見る")
        : act("import", "今の Excel を取り込む", `/import${q}`, "今お使いの Excel を、形を変えずにそのまま置くだけです。列の対応は一度覚えれば、翌月から自動です。", "取り込みの様子を見る");
    } else if (first?.key === "watch") {
      next = act(
        "watch",
        wt.error ? "見張り番を開き直す" : `見張り番の赤い指摘を確かめる（${wt.red} 件）`,
        `/watch${q}`,
        wt.error ? "見張り番を動かせませんでした。開き直すと、もう一度確かめます。" : "締めを止める指摘です。直すか、内容を確かめて「確認済み」にしてください。",
        "見張り番を見る",
      );
    } else if (first?.key === "statements") {
      next = !sm.upToDate
        ? act(
            "statements",
            sm.saved === 0 ? `明細を作る（${sm.expected}人）` : `明細を作り直す（${sm.missing + sm.stale + sm.orphan}人）`,
            `/statements${q}`,
            "今の稼働と設定から、ドライバーごとの支払明細（仕入明細書）を作ります。送るまで、ドライバーには見えません。",
            "明細の様子を見る",
          )
        : sendAction();
    } else if (first?.key === "transfer") {
      next = transferAction();
    } else if (first?.key === "close") {
      next = act("close", `${monthLabelJa(st.month)}を締める`, `/close${q}`, "締める前の確かめが出ます。締めると、この月の稼働・調整・明細は書き換えられなくなります。", "締めの様子を見る");
    }
  } else if (sm.saved > 0 && sendNeeded > 0) {
    next = sendAction();
  } else if (sm.saved > 0 && !transferStep.done) {
    next = transferAction();
  } else if (tr.batches > 0 && tr.executed < tr.batches) {
    next = act("executed", "振り込んだ日を記録する", `/transfer${q}`, "実際に振り込んだ日を記録すると、約束した支払日を守れたかを見張り番が確かめます。", "振込データを見る");
  }

  if (next) for (const x of steps) x.current = x.key === next.stepKey || (next.stepKey === "executed" && x.key === "transfer");
  return { title: `${monthLabelJa(st.month)}分の締め`, steps, next, allDone: st.closed && next === null };
}
