import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { ActionForm } from "~/components/import/action-form";
import { MoneyExtrasSection } from "~/components/import/extras";
import { MappingForm, type MappingColumn } from "~/components/import/mapping-form";
import { NameResolver } from "~/components/import/name-resolver";
import {
  ChecksList,
  CompareTable,
  DriverTotals,
  DuplicateList,
  ProjectTotals,
  qtyText,
  Section,
  SheetPreview,
  SkippedList,
  StatementDiffTable,
  StatusBadge,
} from "~/components/import/sections";
import { Badge, Notice, PageHeader } from "~/components/page";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { baseName, colLetter, dayOfHeader, unitHint } from "~/server/features/import/detect";
import { registrableDrivers, type NameGroup } from "~/server/features/import/resolve";
import { columnSamples, isApplyMode, listClients, loadDraftView, sameFileMessage, type DraftView } from "~/server/features/import/service";
import { APPLY_MODE_LABEL, layoutOf, ROLE_LABEL, type ApplyMode, type ColumnRole } from "~/server/features/import/types";
import { monthLabelJa, monthParam } from "~/server/month";
import {
  adoptRuleAction,
  applyAction,
  discardAction,
  headerRowAction,
  mappingAction,
  monthAction,
  registerAllDriversAction,
  resolveAction,
  selectSheetAction,
  undoAction,
} from "../actions";

export const metadata = { title: "取り込みの確認" };

const dateTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} バイト`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ENCODING: Record<string, string> = { xlsx: "Excel", "utf-8": "CSV（UTF-8）", shift_jis: "CSV（Shift_JIS）" };
const MONTH_FROM: Record<string, string> = {
  dates: "ファイルの日付から",
  title: "表の題名から",
  sheet: "シートの名前から",
  file: "ファイル名から",
  page: "開いていた月",
  user: "選んだ月",
};
const HOW: Record<string, string> = { exact: "名前", alias: "覚えた書き方", code: "番号", normalized: "書き方の違いを除いて", partial: "名前の一部" };

/** どの列を何として読んだか（ふつうの言葉で） */
function readingText(header: string[], roles: ColumnRole[]): string[] {
  const out: string[] = [];
  const name = (i: number) => `${colLetter(i)}列${header[i] ? `「${header[i]}」` : ""}`;
  for (const r of ["driver", "driverCode", "project", "qty", "date", "note"] as ColumnRole[]) {
    const i = roles.indexOf(r);
    if (i >= 0) out.push(`${ROLE_LABEL[r]}＝${name(i)}`);
  }
  const values = roles.flatMap((r, i) => (r === "value" ? [i] : []));
  if (values.length) {
    const days = values.filter((i) => dayOfHeader(header[i] ?? ""));
    const heads = values.map((i) => header[i]).filter(Boolean);
    out.push(
      days.length === values.length
        ? `日ごとの数＝${colLetter(values[0])}〜${colLetter(values.at(-1)!)}列（${values.length}日ぶん）`
        : `案件ごとの数＝${values.length}列（${heads.slice(0, 5).join("・")}${heads.length > 5 ? " ほか" : ""}）`,
    );
  }
  return out;
}

function needsAnswer(g: NameGroup): boolean {
  return !g.match || g.needsCheck || g.skipped;
}

export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; done?: string; mapping?: string }>;
}) {
  const user = await requirePageUser("viewer");
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const view = await loadDraftView(db, user.tenantId, id, { mode: isApplyMode(sp.mode) ? sp.mode : undefined });
  if (!view) notFound();
  const canEdit = roleAtLeast(user.role, "staff");
  const { batch } = view;
  const m = monthParam(batch.month);

  return (
    <div className="space-y-5">
      <PageHeader
        title="取り込みの確認"
        description={
          <span className="break-all">
            {batch.fileName}・{monthLabelJa(batch.month)}分
          </span>
        }
        actions={
          <Link href={`/import?m=${m}`} className={buttonClass("secondary")}>
            ← 取り込みの一覧
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <StatusBadge status={batch.status} reason={view.summary.discarded?.reason} />
        <span>
          {dateTime.format(batch.createdAt)}に{batch.createdByName ?? "（記録なし）"}が置きました
        </span>
      </div>

      {sp.done === "applied" && batch.status === "applied" && (
        <Notice tone="ok">
          反映しました。{view.summary.applied?.entries ?? view.appliedEntries} 件を{monthLabelJa(batch.month)}
          分の稼働に入れました。明細を作り直すと、金額に反映されます。
        </Notice>
      )}
      {sp.done === "undone" && batch.status === "discarded" && (
        <Notice tone="ok">取り消しました。この取り込みで入れた稼働を消し、入れ替えた前の分は元に戻しました。</Notice>
      )}

      {batch.status === "draft" ? (
        <DraftBody view={view} canEdit={canEdit} tenantId={user.tenantId} openMapping={sp.mapping === "1"} />
      ) : (
        <DoneBody view={view} canEdit={canEdit} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 確認中

async function DraftBody({ view, canEdit, tenantId, openMapping }: { view: DraftView; canEdit: boolean; tenantId: string; openMapping: boolean }) {
  const { batch, summary, computed, preview } = view;
  const m = monthParam(batch.month);
  const rows = computed.rows;
  const mapping = summary.mapping;
  const problem = computed.problem;
  const layout = layoutOf(mapping.roles);
  const res = computed.resolution;
  const open = [...res.drivers.map((g) => ({ kind: "driver" as const, g })), ...res.projects.map((g) => ({ kind: "project" as const, g }))].filter((x) =>
    needsAnswer(x.g),
  );
  const matched = [...res.drivers, ...res.projects].filter((g) => g.match && !g.needsCheck && !g.skipped);
  // 選ぶ（または「合っている」を押す）必要がある名前の数
  const toAnswer = open.filter((x) => !x.g.skipped).length;
  // 台帳に無い人（初めての月など）：まとめて登録できる名前
  const newDrivers = problem ? [] : registrableDrivers(res);
  const clients = canEdit && open.length > 0 ? await listClients(await getDb(), tenantId) : [];
  const samples = rows.length ? columnSamples(rows, mapping) : [];
  const columns: MappingColumn[] = computed.header.map((h, i) => ({
    index: i,
    letter: colLetter(i),
    header: h,
    samples: samples[i] ?? [],
    role: mapping.roles[i] ?? "ignore",
    isDay: dayOfHeader(h) !== null,
  }));
  const allDrivers = view.known.drivers.map((d) => ({ id: d.id, name: d.name }));
  const allProjects = view.known.projects.map((p) => ({ id: p.id, name: p.name }));
  const mode: ApplyMode = preview?.mode ?? "replace";
  const option = preview?.modes[mode];
  const unreadable = computed.parse.skipped.some((s) => s.reason.includes("は数字ではありません"));
  // 読み方・名前が決まるまでは、入れ替え方や明細の見通しは出さない（中身が無いので誤解を招く）
  const ready = !problem && res.unresolvedRecords === 0 && view.stats.records > 0;

  return (
    <>
      {/* まとめ：スマホで下まで読まなくても、反映できるかが分かるように */}
      <div
        className={`rounded-card border p-4 ${view.sameFile ? "border-danger/40 bg-danger/10" : ready && !view.closed ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/10"}`}
      >
        <p className="font-bold">{view.sameFile ? "このファイルは反映済みです" : ready && !view.closed ? "このまま反映できます" : "反映の前に、決めることがあります"}</p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          <li>{problem ? "✕ 列の読み方を決めてください" : "✓ 列の読み方"}</li>
          <li>
            {problem
              ? "・ 名前の確認（読み方のあと）"
              : res.unresolvedRecords > 0
                ? `✕ 名前を選んでください（${toAnswer} 件）`
                : "✓ 名前はすべて台帳に当たりました"}
          </li>
          <li>
            {computed.parse.checks.length === 0
              ? "・ ファイルに合計が無いので、照らし合わせなし"
              : computed.parse.checks.every((c) => c.ok)
                ? "✓ ファイルの合計と一致"
                : "✕ ファイルの合計と合いません（4 を見てください）"}
          </li>
          <li>{view.closed ? `✕ ${monthLabelJa(batch.month)}は締め済み` : `✓ ${monthLabelJa(batch.month)}分に書き込み`}</li>
          {view.sameFile ? (
            <li>✕ 同じファイルがすでに反映されています（5 を見てください）</li>
          ) : (
            ready && option && option.duplicates.length > 0 && <li>✕ 今ある稼働と重なる所が {option.duplicates.length} 件（5 で入れ替え方を選んでください）</li>
          )}
          {!problem && res.codeConflicts.length > 0 && <li>△ 番号と名前が合わない行があります（3 を見てください）</li>}
        </ul>
        {ready && !view.closed && canEdit && !view.sameFile && (
          <a href="#apply" className={buttonClass("accent", "mt-3")}>
            反映へ進む ↓
          </a>
        )}
      </div>

      {/* 1. ファイルと月 */}
      <Section step="1" title="ファイルと月" aside={view.closed ? <Badge tone="red">締め済みの月</Badge> : <Badge tone="green">OK</Badge>}>
        <p className="text-sm">
          {summary.file.name}（{sizeText(summary.file.size)}・{ENCODING[summary.file.encoding] ?? summary.file.encoding}）
          {summary.file.sample && <Badge>見本（架空の会社）</Badge>}
        </p>
        {summary.sheets.length > 1 && (
          <div>
            <p className="text-sm font-bold">
              シート
              {summary.sheetFrom === "month"
                ? "（開いていた月のシートを選んでいます）"
                : summary.sheetFrom === "user"
                  ? "（選び直したシート）"
                  : "（データの行がいちばん多いものを選んでいます）"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {summary.sheets.map((sh, i) =>
                i === summary.sheetIndex || !canEdit ? (
                  <span
                    key={i}
                    className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm ${i === summary.sheetIndex ? "border-foreground font-bold" : "border-border text-muted-foreground"}`}
                  >
                    {sh.name}（{sh.dataRows}行）
                  </span>
                ) : (
                  <ActionForm key={i} action={selectSheetAction} submit={`${sh.name}（${sh.dataRows}行）`} pendingText="切り替えています…">
                    <input type="hidden" name="batchId" value={batch.id} />
                    <input type="hidden" name="sheet" value={i} />
                  </ActionForm>
                ),
              )}
            </div>
          </div>
        )}
        <p className="text-sm">
          <b>{monthLabelJa(batch.month)}分</b>の稼働として書き込みます（{MONTH_FROM[summary.monthFrom] ?? ""}）。
        </p>
        {view.sameFileOtherMonths.length > 0 && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            同じファイルが、
            {view.sameFileOtherMonths.map((o, i) => (
              <span key={o.batchId}>
                {i > 0 && "・"}
                <Link href={`/import/${o.batchId}`}>{monthLabelJa(o.month)}分</Link>
              </span>
            ))}
            にも反映されています。月を選び間違えていないか確かめてください。
          </p>
        )}
        {view.closed && (
          <Notice tone="error">
            {monthLabelJa(batch.month)}
            は締め済みなので、このままでは反映できません。別の月のファイルなら、下で月を選び直してください。この月を直すときは、オーナーが「締め」の画面で締めを外してから。
          </Notice>
        )}
        {canEdit && (
          <details className="text-sm" open={view.closed}>
            <summary className="min-h-11 cursor-pointer py-2 font-bold">月を選び直す</summary>
            <ActionForm
              key={m}
              action={monthAction}
              submit="この月にする"
              pendingText="変えています…"
              className="flex flex-col gap-2 sm:flex-row sm:items-start"
            >
              <input type="hidden" name="batchId" value={batch.id} />
              <input
                type="month"
                name="month"
                defaultValue={m}
                required
                aria-label="書き込む月"
                className="block min-h-11 rounded-lg border border-border bg-card px-3 text-base"
              />
            </ActionForm>
          </details>
        )}
      </Section>

      {/* 2. 読み方 */}
      <Section step="2" title="列の読み方" aside={problem ? <Badge tone="red">決めてください</Badge> : <Badge tone="green">OK</Badge>}>
        {summary.mappingFrom === "profile" && !problem && (
          <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
            <b>前回と同じ形のファイルなので、前回の読み方で読みました。</b>
            {canEdit && (
              <>
                {"（"}
                <Link href={`/import/${batch.id}?mapping=1#mapping`} scroll={false} className="inline-block min-h-11 py-2 font-bold">
                  読み方を変える
                </Link>
                {"）"}
              </>
            )}
          </p>
        )}
        {rows.length > 0 && (
          <>
            <p className="text-sm">{layout === "long" ? "1 行が 1 件の表として読みました。" : "人ごとに数が横に並ぶ表として読みました。"}</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {readingText(computed.header, mapping.roles).map((t) => (
                <li key={t}>{t}</li>
              ))}
              {mapping.fixedProjectId && (
                <li>案件＝すべて「{view.known.projects.find((p) => p.id === mapping.fixedProjectId)?.name ?? "（見つかりません）"}」</li>
              )}
              <li>
                見出し＝{mapping.headerRow + 1}行目{mapping.headerDepth === 2 ? `と${mapping.headerRow + 2}行目（2 段）` : ""}
              </li>
            </ul>
          </>
        )}
        {problem && <Notice tone="error">{problem}</Notice>}
        {rows.length > 0 && (
          <details id="mapping" open={!!problem || openMapping}>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">
              {canEdit ? "表の最初の行を見る・読み方を変える" : "表の最初の行を見る"}
            </summary>
            <div className="space-y-4 pt-2">
              <SheetPreview rows={rows} headerRow={mapping.headerRow} headerDepth={mapping.headerDepth} roles={mapping.roles} />
              {canEdit && (
                <>
                  <ActionForm
                    key={`${summary.sheetIndex}:${mapping.headerRow}`}
                    action={headerRowAction}
                    submit="この行を見出しにする"
                    pendingText="読み直しています…"
                    className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  >
                    <input type="hidden" name="batchId" value={batch.id} />
                    <label className="block text-sm sm:w-96">
                      <span className="block font-bold">見出しの行</span>
                      <select
                        name="headerRow"
                        defaultValue={mapping.headerRow}
                        className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base"
                      >
                        {rows.slice(0, 30).map((r, i) => (
                          <option key={i} value={i}>
                            {i + 1}行目：{r.filter(Boolean).slice(0, 5).join(" / ").slice(0, 40) || "（空の行）"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </ActionForm>
                  <MappingForm
                    key={`${summary.sheetIndex}:${mapping.headerRow}:${mapping.roles.join(",")}:${mapping.fixedProjectId ?? ""}:${mapping.useDates}`}
                    action={mappingAction}
                    batchId={batch.id}
                    columns={columns}
                    projects={allProjects}
                    fixedProjectId={mapping.fixedProjectId}
                    useDates={mapping.useDates}
                  />
                </>
              )}
            </div>
          </details>
        )}
      </Section>

      {/* 3. 名前 */}
      <Section
        step="3"
        title="名前の確認"
        aside={
          res.unresolvedRecords > 0 ? (
            <Badge tone="red">{toAnswer} 件を選んでください</Badge>
          ) : problem ? null : (
            <Badge tone="green">OK</Badge>
          )
        }
      >
        {problem ? (
          <p className="text-sm text-muted-foreground">列の読み方が決まると、ここに名前の当たり具合が出ます。</p>
        ) : (
          <>
            {open.length > 0 ? (
              <>
                <p className="text-sm">
                  台帳に当たらなかった名前と、名前の一部だけが同じで念のため確かめたい名前です。選ぶと、その書き方を覚えて、来月からは聞きません。
                </p>
                {canEdit && newDrivers.length >= 2 && (
                  <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                    <p className="font-bold">台帳に無い人が {newDrivers.length} 人います</p>
                    <p className="mt-1 text-muted-foreground">
                      {newDrivers
                        .slice(0, 12)
                        .map((g) => baseName(g.raw))
                        .join("、")}
                      {newDrivers.length > 12 && ` ほか ${newDrivers.length - 12} 人`}
                    </p>
                    <p className="mt-1">
                      みなさん新しい方なら、まとめて台帳に登録できます。今いる方の書き間違いが混じっていれば、先にその方だけ下で選んでください。
                    </p>
                    <ActionForm
                      action={registerAllDriversAction}
                      submit={`${newDrivers.length} 人をまとめて登録する`}
                      className="mt-2"
                      confirm={
                        <>
                          次の {newDrivers.length} 人を、ファイルの書き方の名前で台帳に登録します：
                          {newDrivers.map((g) => baseName(g.raw)).join("、")}。口座・インボイスの登録番号などは、あとで台帳から入れます。
                        </>
                      }
                      confirmSubmit="登録する"
                      pendingText="登録しています…"
                    >
                      <input type="hidden" name="batchId" value={batch.id} />
                    </ActionForm>
                  </div>
                )}
                {canEdit ? (
                  <ul className="divide-y divide-border rounded-card border border-border">
                    {open.map(({ kind, g }) => (
                      <NameResolver
                        key={`${kind}:${g.key}`}
                        action={resolveAction}
                        batchId={batch.id}
                        kind={kind}
                        group={{
                          key: g.key,
                          raw: g.raw,
                          spellings: g.spellings,
                          rows: g.rows,
                          qty: g.qty,
                          match: g.match,
                          needsCheck: g.needsCheck,
                          skipped: g.skipped,
                          candidates: g.candidates,
                          codes: g.codes,
                        }}
                        all={kind === "driver" ? allDrivers : allProjects}
                        clients={clients}
                        defaults={{ name: kind === "driver" && g.nameless ? "" : baseName(g.raw), unit: unitHint(g.raw) ?? "個" }}
                      />
                    ))}
                  </ul>
                ) : (
                  <ul className="list-disc pl-5 text-sm">
                    {open.map(({ kind, g }) => (
                      <li key={`${kind}:${g.key}`}>
                        「{g.raw}」{g.skipped ? "（取り込まない）" : g.match ? `（${g.match.name} かもしれません）` : "（台帳に当たりません）"}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-sm">
                名前はすべて台帳に当たりました（ドライバー {new Set(res.drivers.map((g) => g.match?.id)).size} 人・案件{" "}
                {mapping.fixedProjectId ? 1 : new Set(res.projects.map((g) => g.match?.id)).size} 件）。
              </p>
            )}
            {res.codeConflicts.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-bold">番号と名前が、台帳の別の人を指している行があります（番号で当てています）</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {res.codeConflicts.slice(0, 10).map((c) => (
                    <li key={`${c.code}|${c.fileName}`}>
                      番号「{c.code}」は台帳では{c.codeName}さんですが、名前は「{c.fileName}」（台帳の{c.nameMatch}さん）です（{c.rows}行）
                    </li>
                  ))}
                  {res.codeConflicts.length > 10 && <li>ほか {res.codeConflicts.length - 10} 件</li>}
                </ul>
                <p className="mt-1">
                  別の人に払ってしまわないよう、Excel の番号と名前を確かめてください。番号が違っていたら、直したファイルを置き直してください。
                </p>
              </div>
            )}
            {summary.learned.length > 0 && (
              <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
                <p className="font-bold text-success">覚えたこと（来月から自動で当たります）</p>
                <ul className="mt-1 space-y-0.5">
                  {summary.learned.map((l) => (
                    <li key={`${l.kind}:${l.raw}`}>
                      「{l.raw}」→ {l.name}
                      {l.how === "new" && "（新しく登録）"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {matched.length > 0 && (
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-2 font-bold">当たった名前を見る（{matched.length}）</summary>
                <ul className="grid gap-x-4 gap-y-1 pt-1 sm:grid-cols-2">
                  {matched.map((g) => (
                    <li key={g.key} className="min-w-0 break-all">
                      「{g.raw}」→ {g.match!.name}
                      <span className="ml-1 text-xs text-muted-foreground">（{HOW[g.match!.how] ?? ""}）</span>
                      {g.inactive && <Badge tone="yellow">稼働していない人</Badge>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </Section>

      {/* 4. 中身 */}
      <Section step="4" title="中身の確かめ" aside={computed.parse.checks.some((c) => !c.ok) ? <Badge tone="red">合計が合いません</Badge> : null}>
        {problem ? (
          <p className="text-sm text-muted-foreground">列の読み方が決まると、ここに合計と、取り込まない行が出ます。</p>
        ) : (
          <>
            <p className="text-sm">
              取り込む <b>{view.stats.records} 件</b>（{view.stats.drivers} 人・{view.stats.projects} 案件）
              {res.unresolvedRecords > 0 && `・名前が決まっていない行 ${res.unresolvedRecords} 行（決まると取り込む数に入ります）`}
              {computed.parse.skipped.length > 0 && `・取り込まない行 ${computed.parse.skipped.length} 行`}
              {res.skippedRecords > 0 && `・「取り込まない」にした名前の分 ${res.skippedRecords} 件（数量 ${qtyText(res.skippedQty)}）`}
              {computed.parse.emptyCells > 0 && `・空か 0 のセル ${computed.parse.emptyCells} 個（取り込みません）`}
            </p>
            <ChecksList checks={computed.parse.checks} />
            {computed.parse.warnings.length > 0 && (
              <ul className="space-y-1">
                {computed.parse.warnings.map((w) => (
                  <li key={w} className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                    {w}
                  </li>
                ))}
              </ul>
            )}
            <ProjectTotals rows={view.totals.byProject} />
            {view.totals.byDriver.length > 0 && (
              <details>
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">人ごとの数量を見る（{view.totals.byDriver.length}人）</summary>
                <DriverTotals rows={view.totals.byDriver} />
              </details>
            )}
            {computed.parse.skipped.length > 0 && (
              <details open={unreadable}>
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">取り込まない行を見る（{computed.parse.skipped.length}行）</summary>
                <SkippedList skipped={computed.parse.skipped} />
              </details>
            )}
            {preview &&
              ready &&
              (preview.compare.some((r) => r.prev > 0) ? (
                <CompareTable rows={preview.compare} prevLabel={monthLabelJa(preview.prevMonth)} />
              ) : (
                <p className="text-sm text-muted-foreground">{monthLabelJa(preview.prevMonth)}の稼働が無いので、先月との比べはしていません。</p>
              ))}
          </>
        )}
      </Section>

      {/* 金額の列（振込額・控除・振込手数料） */}
      {view.extras && <MoneyExtrasSection extras={view.extras} canEdit={canEdit} batchId={batch.id} month={m} adopt={adoptRuleAction} />}

      {/* 5. 反映 */}
      {ready && preview && view.sameFile && (
        <Section step="5" title="反映する">
          <div id="apply" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
            <p className="font-bold text-danger">{sameFileMessage(view.sameFile)}</p>
            <p className="mt-1">
              前の取り込み
              <Link href={`/import/${view.sameFile.batchId}`} className="mx-1">
                「{view.sameFile.fileName}」
              </Link>
              の稼働 {view.sameFile.entries} 件が入っています。このファイルを入れ直すときは、前の取り込みを取り消してから入れます（数量は倍になりません）。直したファイルなら、ファイル名か中身が違うはずです。
            </p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-bold">入れ直すと、明細の金額はこうなります（明細と同じ計算）</h3>
            <StatementDiffTable rows={preview.statements} unchanged={preview.unchangedStatements} />
          </div>
          {preview.reapply && <DuplicateList rows={preview.reapply.duplicates} total={preview.reapply.duplicateYen} />}
          {view.blockers.map((b) => (
            <Notice key={b} tone="error">
              {b}
            </Notice>
          ))}
          {canEdit && view.blockers.length === 0 && (
            <ActionForm
              action={applyAction}
              submit="取り消して入れ直す"
              variant="accent"
              pendingText="入れ直しています…"
              buttonClassName="w-full sm:w-auto"
              confirm={
                <>
                  前の取り込み「{view.sameFile.fileName}」の稼働 {view.sameFile.entries} 件を消して、このファイルの {view.stats.records} 件を入れます。あとで「取り消し」を押すと、前の取り込みに戻ります。
                </>
              }
              confirmSubmit="入れ直す"
            >
              <input type="hidden" name="batchId" value={batch.id} />
              <input type="hidden" name="mode" value="replace" />
              <input type="hidden" name="reapply" value="1" />
              {preview.reapply && preview.reapply.duplicates.length > 0 && (
                <label className="mb-3 flex min-h-11 items-start gap-3 text-sm">
                  <input type="checkbox" name="confirmDuplicates" required className="mt-1 h-5 w-5 shrink-0" />
                  <span>重なっている所は二重ではない（別の仕事の分）ことを確かめました</span>
                </label>
              )}
            </ActionForm>
          )}
          {canEdit && (
            <ActionForm
              action={discardAction}
              submit="この取り込みをやめる"
              variant="ghost"
              confirm="この取り込みをやめます（稼働には何も入りません）。記録は履歴に残ります。"
              confirmSubmit="やめる"
              pendingText="やめています…"
            >
              <input type="hidden" name="batchId" value={batch.id} />
              <input type="hidden" name="month" value={m} />
            </ActionForm>
          )}
        </Section>
      )}
      {!ready && (
        <Section step="5" title="反映する">
          {view.blockers.map((b) => (
            <Notice key={b} tone="error">
              {b}
            </Notice>
          ))}
          {canEdit && (
            <ActionForm
              action={discardAction}
              submit="この取り込みをやめる"
              variant="ghost"
              confirm="この取り込みをやめます（稼働には何も入りません）。記録は履歴に残ります。"
              confirmSubmit="やめる"
              pendingText="やめています…"
            >
              <input type="hidden" name="batchId" value={batch.id} />
              <input type="hidden" name="month" value={m} />
            </ActionForm>
          )}
        </Section>
      )}
      {ready && preview && option && !view.sameFile && (
        <Section step="5" title="反映する">
          <div id="apply" className="space-y-2" role="radiogroup" aria-label="入れ替え方">
            {(["replace", "replaceAll", "add"] as ApplyMode[]).map((k) => {
              const o = preview.modes[k];
              const selected = k === mode;
              return (
                <Link
                  key={k}
                  href={`/import/${batch.id}?mode=${k}#apply`}
                  scroll={false}
                  role="radio"
                  aria-checked={selected}
                  className={`block rounded-lg border p-3 text-sm text-foreground no-underline ${selected ? "border-foreground bg-muted" : "border-border hover:bg-muted"}`}
                >
                  <span className="flex items-center gap-2 font-bold">
                    <span
                      aria-hidden
                      className={`inline-block h-4 w-4 shrink-0 rounded-full border-2 ${selected ? "border-foreground bg-foreground" : "border-muted-foreground"}`}
                    />
                    {APPLY_MODE_LABEL[k]}
                    {k === preview.suggested && <Badge tone="green">おすすめ</Badge>}
                  </span>
                  <span className="mt-1 block text-muted-foreground">{modeDetail(k, o)}</span>
                </Link>
              );
            })}
          </div>
          {preview.suggested === "replaceAll" && mode === "replaceAll" && (
            <p className="text-sm text-muted-foreground">
              今この月に入っている稼働は、すべてこのファイルと重なっています。ファイルを丸ごと出し直したものとみなして、入れ替えをおすすめしています。
            </p>
          )}
          {option.sameFileApplied && (
            <Notice tone="error">同じファイルがこの月にもう反映されています。足すと数量が倍になるので、「入れ替える」を選んでください。</Notice>
          )}
          <DuplicateList rows={option.duplicates} total={option.duplicateYen} />
          <div>
            <h3 className="mb-2 text-sm font-bold">反映すると、明細の金額はこうなります（明細と同じ計算）</h3>
            <StatementDiffTable rows={preview.statements} unchanged={preview.unchangedStatements} />
          </div>
          {view.blockers.map((b) => (
            <Notice key={b} tone="error">
              {b}
            </Notice>
          ))}
          {canEdit && view.blockers.length === 0 && !option.sameFileApplied && (
            <ActionForm
              action={applyAction}
              submit={`反映する（${view.stats.records}件を${monthLabelJa(batch.month)}分へ）`}
              variant="accent"
              pendingText="反映しています…"
              buttonClassName="w-full sm:w-auto"
            >
              <input type="hidden" name="batchId" value={batch.id} />
              <input type="hidden" name="mode" value={mode} />
              {option.duplicates.length > 0 && (
                <label className="mb-3 flex min-h-11 items-start gap-3 text-sm">
                  <input type="checkbox" name="confirmDuplicates" required className="mt-1 h-5 w-5 shrink-0" />
                  <span>重なっている所は二重ではない（別の仕事の分）ことを確かめました</span>
                </label>
              )}
              <p className="mb-3 text-xs text-muted-foreground">反映したあとも、締めるまでは「取り消し」で元に戻せます。</p>
            </ActionForm>
          )}
          {canEdit && (
            <ActionForm
              action={discardAction}
              submit="この取り込みをやめる"
              variant="ghost"
              confirm="この取り込みをやめます（稼働には何も入りません）。記録は履歴に残ります。"
              confirmSubmit="やめる"
              pendingText="やめています…"
            >
              <input type="hidden" name="batchId" value={batch.id} />
              <input type="hidden" name="month" value={m} />
            </ActionForm>
          )}
        </Section>
      )}
    </>
  );
}

function modeDetail(mode: ApplyMode, o: NonNullable<DraftView["preview"]>["modes"][ApplyMode]): string {
  if (mode === "replace") {
    const kept = o.keptSameShape.length ? `同じ形の「${o.keptSameShape.join("」「")}」は、人と案件が重ならないので別のファイルとみなして残します。` : "";
    if (o.removeBatches.length === 0) return `${kept || "同じ形のファイルはまだ反映していません。"}今ある稼働は、そのまま残ります。`;
    return `前に反映した「${o.removeBatches.map((b) => b.fileName).join("」「")}」の ${o.removeEntries} 件を消してから入れます（直したファイルを置き直しても倍になりません）。${kept}`;
  }
  if (mode === "replaceAll") {
    if (o.removeEntries === 0) return "この月にはまだ稼働がありません。";
    return `この月の稼働 ${o.removeEntries} 件（手入力 ${o.removeManual} 件・取り込み ${o.removeEntries - o.removeManual} 件）を消してから入れます。`;
  }
  return "今ある稼働は消さずに、このファイルの分を足します（別の元請のファイルを足すとき など）。";
}

// ---------------------------------------------------------------- 反映済み・取り消し・やめた

function DoneBody({ view, canEdit }: { view: DraftView; canEdit: boolean }) {
  const { batch, summary } = view;
  const m = monthParam(batch.month);
  const applied = summary.applied;
  const related = new Map(view.related.map((r) => [r.id, r]));
  return (
    <>
      {batch.status === "applied" && applied && (
        <Section title="反映済み">
          <p className="text-sm">
            {dateTime.format(new Date(applied.at))}に反映しました（{applied.reappliedFrom?.length ? "同じファイルの前の取り込みを取り消して入れ直し" : APPLY_MODE_LABEL[applied.mode]}）。今この取り込みの稼働は{" "}
            <b>{view.appliedEntries} 件</b>
            です。
          </p>
          {applied.payouts && (
            <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
              {applied.payouts.saved > 0 ? (
                <p>
                  <b>今の Excel の振込額も読みました（{applied.payouts.saved}人）</b>
                  <Link href={`/parallel?m=${m}`} className="ml-2 inline-block min-h-11 py-2 font-bold">
                    → Excel と比べる
                  </Link>
                </p>
              ) : (
                <p>「{applied.payouts.header}」の列の振込額は、比べ合わせに入れていません{applied.payouts.error ? `（${applied.payouts.error}）` : ""}。</p>
              )}
              {applied.payouts.kept.length > 0 && (
                <p className="mt-1 text-muted-foreground">
                  理由のメモが付いている {applied.payouts.kept.join("・")} さんは、前の額のままにしました。
                </p>
              )}
            </div>
          )}
          {applied.replacedBatchIds.length > 0 && (
            <p className="text-sm">
              入れ替えた前の取り込み：
              {applied.replacedBatchIds.map((rid, i) => (
                <span key={rid}>
                  {i > 0 && "・"}
                  <Link href={`/import/${rid}`}>{related.get(rid)?.fileName ?? "前の取り込み"}</Link>
                </span>
              ))}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={`/work?m=${m}`} className={buttonClass("secondary")}>
              稼働と調整を見る
            </Link>
            <Link href={`/statements?m=${m}`} className={buttonClass("primary")}>
              明細を作る・作り直す →
            </Link>
          </div>
          {view.appliedTotals && <ProjectTotals rows={view.appliedTotals.byProject} />}
          {view.appliedTotals && view.appliedTotals.byDriver.length > 0 && (
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">人ごとの数量を見る</summary>
              <DriverTotals rows={view.appliedTotals.byDriver} />
            </details>
          )}
          {view.computed.parse.checks.length > 0 && <ChecksList checks={view.computed.parse.checks} />}
          {view.blockers.map((b) => (
            <Notice key={b} tone="info">
              {b}
            </Notice>
          ))}
          {canEdit && view.blockers.length === 0 && (
            <ActionForm
              action={undoAction}
              submit="この取り込みを取り消す"
              variant="secondary"
              confirm={
                <>
                  この取り込みで入れた稼働 {view.appliedEntries} 件を消します。
                  {applied.removed.length > 0 && `反映したときに入れ替えで消した稼働 ${applied.removed.length} 件は、元に戻します。`}
                  明細は、あとで作り直してください。
                </>
              }
              confirmSubmit="取り消す"
              pendingText="取り消しています…"
            >
              <input type="hidden" name="batchId" value={batch.id} />
            </ActionForm>
          )}
        </Section>
      )}

      {batch.status === "discarded" && (
        <Section title={summary.discarded?.reason === "replaced" ? "入れ替え済み" : summary.discarded?.reason === "undo" ? "取り消し済み" : "やめた取り込み"}>
          <p className="text-sm">
            {summary.discarded?.reason === "replaced" && (
              <>
                あとで反映した
                {summary.discarded.replacedBy ? (
                  <Link href={`/import/${summary.discarded.replacedBy}`}>「{related.get(summary.discarded.replacedBy)?.fileName ?? "取り込み"}」</Link>
                ) : (
                  "取り込み"
                )}
                と入れ替わりました。この取り込みの稼働は、今は入っていません（あとの取り込みを取り消すと戻ります）。
              </>
            )}
            {summary.discarded?.reason === "undo" && "取り消しました。この取り込みで入れた稼働は、今は入っていません。"}
            {summary.discarded?.reason === "cancel" && "反映せずにやめました。稼働には何も入っていません。"}
            {summary.discarded && ` （${dateTime.format(new Date(summary.discarded.at))}）`}
          </p>
          {view.stats.records > 0 && <ProjectTotals rows={view.totals.byProject} />}
          {canEdit && (
            <Link href={`/import?m=${m}`} className={buttonClass("secondary")}>
              ファイルを置き直す
            </Link>
          )}
        </Section>
      )}
    </>
  );
}
