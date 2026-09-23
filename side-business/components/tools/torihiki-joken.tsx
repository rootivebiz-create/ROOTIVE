"use client";

/**
 * 無料ツール：軽貨物版 取引条件明示書（フリーランス法）の作成と、支払期日の60日チェック。
 * 入れた内容はこの画面の中だけで使い、どこにも送らない。文面と日付の計算は lib/tools/torihiki-joken.ts に任せる。
 * 印刷するときは明示書だけを紙に出す（ほかは .no-print）。
 */
import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, Card, Field, Input, NumberInput, Select, TableWrap } from "@/components/ui";
import { parseAmount } from "@/lib/payroll/money";
import { groupDigits, readAmount, toDateString } from "@/lib/tools/invoice-cost";
import {
  BLANK,
  DAY_CHOICES,
  DEDUCTION_KINDS,
  PAY_MONTH_LABELS,
  RATE_UNITS,
  STATUS_LABELS,
  buildTorihikiJoken,
  dayLabel,
  latestSafePayRule,
  shortDate,
  torihikiPlainText,
  type Bearer,
  type ChecklistStatus,
  type DayOfMonth,
  type DeadlineResult,
  type DeadlineRow,
  type DeadlineStatus,
  type DeductionKindId,
  type HolidayRule,
  type PayMonthOffset,
  type RateUnitId,
  type TorihikiDoc,
} from "@/lib/tools/torihiki-joken";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// 「今日」と共有ボタンの有無は端末でしか分からない。サーバーの HTML では null / false にして、表示のあとで入れかえる
const noSubscribe = () => () => {};
const clientToday = () => toDateString(new Date());
const serverToday = () => null;
const clientCanShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";
const serverCanShare = () => false;

type RateRow = { id: number; label: string; unit: RateUnitId; price: string };
type DeductionRow = { id: number; label: string; kind: DeductionKindId; amount: string };
type ExpenseRow = { id: number; label: string; bearer: Bearer | "none" };

const MAX_ROWS = 12;

const DEDUCTION_PRESETS: { label: string; kind: DeductionKindId }[] = [
  { label: "管理費", kind: "monthly" },
  { label: "ロイヤリティ", kind: "percent" },
  { label: "車両リース代", kind: "monthly" },
  { label: "保険料", kind: "monthly" },
];

const DEFAULT_EXPENSES: ExpenseRow[] = [
  { id: 1, label: "燃料代", bearer: "none" },
  { id: 2, label: "高速代", bearer: "none" },
  { id: 3, label: "駐車代", bearer: "none" },
  { id: 4, label: "車両（リース・保険・修理など）", bearer: "none" },
];

const textareaClass =
  "block w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground outline-none focus:border-foreground";

const STATUS_BADGE: Record<DeadlineStatus, string> = {
  ok: "bg-success text-card",
  caution: "bg-warning text-card",
  ng: "bg-danger text-card",
};

const STATUS_BORDER: Record<DeadlineStatus, string> = {
  ok: "border-success",
  caution: "border-warning",
  ng: "border-danger",
};

function toDay(value: string): DayOfMonth {
  return value === "末" ? "末" : Number(value);
}

function readPercent(text: string): number | null {
  const v = parseAmount(text.replace(/[%％]/g, ""));
  return v === null || v < 0 || v > 100 ? null : v;
}

export function TorihikiJokenTool() {
  const today = useSyncExternalStore(noSubscribe, clientToday, serverToday);
  const canShare = useSyncExternalStore(noSubscribe, clientCanShare, serverCanShare);

  const [clientName, setClientName] = useState("");
  const [driverName, setDriverName] = useState("");
  // null のあいだは「今日」を使う
  const [commissionDate, setCommissionDate] = useState<string | null>(null);
  const [work, setWork] = useState("");
  const [workDetail, setWorkDetail] = useState("");
  const [periodFrom, setPeriodFrom] = useState<string | null>(null);
  const [periodTo, setPeriodTo] = useState("");
  const [autoRenew, setAutoRenew] = useState(true);
  const [place, setPlace] = useState("");
  const [rates, setRates] = useState<RateRow[]>([{ id: 1, label: "", unit: "piece", price: "" }]);
  const [taxIncluded, setTaxIncluded] = useState(false);
  const [deductions, setDeductions] = useState<DeductionRow[]>([]);
  const [closingDay, setClosingDay] = useState<DayOfMonth>("末");
  const [payMonthOffset, setPayMonthOffset] = useState<PayMonthOffset>(1);
  const [payDay, setPayDay] = useState<DayOfMonth>("末");
  const [holidayRule, setHolidayRule] = useState<HolidayRule>("before");
  const [transferFeeBearer, setTransferFeeBearer] = useState<Bearer>("company");
  const [expenses, setExpenses] = useState<ExpenseRow[]>(DEFAULT_EXPENSES);
  const [inspection, setInspection] = useState(false);
  const [inspectionDue, setInspectionDue] = useState("");
  const [other, setOther] = useState("");
  const [nextId, setNextId] = useState(100);
  const [copied, setCopied] = useState<{ text: string; ok: boolean } | null>(null);

  const ready = today !== null;
  const commissionValue = commissionDate ?? today ?? "";
  const periodFromValue = periodFrom ?? today ?? "";

  const doc = ready
    ? buildTorihikiJoken({
        clientName,
        driverName,
        commissionDate: commissionValue,
        work,
        workDetail,
        periodFrom: periodFromValue,
        periodTo,
        autoRenew,
        place,
        rates: rates.map((r) => ({ label: r.label, unit: r.unit, unitPrice: readAmount(r.price).value })),
        taxIncluded,
        deductions: deductions.map((d) => ({
          label: d.label,
          kind: d.kind,
          amount: d.kind === "percent" ? readPercent(d.amount) : readAmount(d.amount).value,
        })),
        closingDay,
        payMonthOffset,
        payDay,
        holidayRule,
        transferFeeBearer,
        expenses: expenses.flatMap((e) => (e.bearer === "none" ? [] : [{ label: e.label, bearer: e.bearer }])),
        inspection,
        inspectionDue,
        other,
      })
    : null;
  const plainText = doc ? torihikiPlainText(doc) : "";
  const safeRule =
    doc && doc.deadline.error === null && doc.deadline.status !== "ok"
      ? latestSafePayRule({ closingDay, holidayRule, serviceFrom: periodFromValue || undefined })
      : null;

  function takeId() {
    setNextId((n) => n + 1);
    return nextId;
  }

  function fillExample() {
    setClientName("〇〇運送株式会社");
    setDriverName("〇〇 〇〇（屋号：〇〇便）");
    setWork("宅配便の配達");
    setWorkDetail("〇〇営業所の担当コース。荷物の積み込みから配達・持ち戻りまで");
    setPlace("〇〇営業所と、〇〇市〇〇町の担当エリア");
    setRates([
      { id: nextId, label: "宅配（通常）", unit: "piece", price: "150" },
      { id: nextId + 1, label: "企業配（ルート配送）", unit: "day", price: "15,000" },
    ]);
    setDeductions([
      { id: nextId + 2, label: "管理費", kind: "monthly", amount: "10,000" },
      { id: nextId + 3, label: "ロイヤリティ", kind: "percent", amount: "10" },
    ]);
    setExpenses([
      { id: nextId + 4, label: "燃料代", bearer: "driver" },
      { id: nextId + 5, label: "高速代", bearer: "company" },
      { id: nextId + 6, label: "駐車代", bearer: "company" },
      { id: nextId + 7, label: "車両（リース・保険・修理など）", bearer: "driver" },
    ]);
    setNextId((n) => n + 8);
  }

  async function copyText() {
    if (!plainText) return;
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied({ text: plainText, ok: true });
    } catch {
      setCopied({ text: plainText, ok: false });
    }
  }

  async function shareText() {
    if (!plainText) return;
    try {
      await navigator.share({ title: "取引条件明示書", text: plainText });
    } catch {
      // 閉じただけ（AbortError）など。何もしない
    }
  }

  const copyMessage =
    copied && copied.text === plainText
      ? copied.ok
        ? "コピーしました。LINE やメールに貼り付けて送ってください。"
        : "コピーできませんでした。下の「文面を見る」を開いて、長押しで選んでください。"
      : "";

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6 print:block">
      {/* ───── 入力 ───── */}
      <div className="no-print space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={fillExample}>
            例を入れてみる
          </Button>
          <span className="text-xs text-muted-foreground">〇〇の入った例で、できあがりを先に見られます。</span>
        </div>

        <Card>
          <h2 className="text-lg font-bold">1. 誰と、いつ</h2>
          <div className="mt-3 space-y-4">
            <Field label="委託する会社（御社）の名前">
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="例：〇〇運送株式会社" autoComplete="organization" />
            </Field>
            <Field label="ドライバーの名前（屋号）" hint="名前のかわりに、社内の番号や記号で書いてもかまいません。">
              <Input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="例：〇〇 〇〇" autoComplete="off" />
            </Field>
            <Field label="業務委託をした日" hint="仕事を頼むことを、話し合って決めた日です。">
              <Input type="date" value={commissionValue} onChange={(e) => setCommissionDate(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">2. どんな仕事を、どこで</h2>
          <div className="mt-3 space-y-4">
            <Field label="業務の内容">
              <Input value={work} onChange={(e) => setWork(e.target.value)} placeholder="例：宅配便の配達／企業配（ルート配送）" list="torihiki-work" />
              <datalist id="torihiki-work">
                <option value="宅配便の配達" />
                <option value="企業配（ルート配送）" />
                <option value="スポット便（チャーター）" />
                <option value="ネットスーパーの配達" />
              </datalist>
            </Field>
            <Field label="くわしい内容（なくても可）" hint="担当コース・荷物・時間帯など。改行すると別の行になります。">
              <textarea value={workDetail} onChange={(e) => setWorkDetail(e.target.value)} rows={2} className={textareaClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="期間のはじめ">
                <Input type="date" value={periodFromValue} onChange={(e) => setPeriodFrom(e.target.value)} />
              </Field>
              <Field label="期間の終わり">
                <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
              </Field>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">終わりを決めていないなら、空のままでかまいません。</p>
            {periodTo && (
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="size-5 shrink-0 accent-primary" />
                <span className="text-sm">申し出がなければ、同じ条件で更新する</span>
              </label>
            )}
            <Field label="業務を行う場所・エリア">
              <Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="例：〇〇営業所と、〇〇市の担当エリア" />
            </Field>
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input type="checkbox" checked={inspection} onChange={(e) => setInspection(e.target.checked)} className="size-5 shrink-0 accent-primary" />
              <span className="text-sm">仕事の結果を検査（検収）する</span>
            </label>
            {inspection && (
              <Field label="検査を終える日">
                <Input value={inspectionDue} onChange={(e) => setInspectionDue(e.target.value)} placeholder="例：締め日の翌日から5日以内" />
              </Field>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">3. 報酬（単価）</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            「単価 × 数量」の形で書けば、月ごとに金額が変わっても、報酬の決め方（算定方法）を示したことになります。
          </p>
          <div className="mt-3 space-y-3">
            {rates.map((r, i) => (
              <div key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Field label={`内容 ${i + 1}`}>
                      <Input
                        value={r.label}
                        onChange={(e) => setRates(rates.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)))}
                        placeholder="例：宅配（通常）"
                      />
                    </Field>
                  </div>
                  {rates.length > 1 && (
                    <RemoveButton label={`内容 ${i + 1} を消す`} onClick={() => setRates(rates.filter((x) => x.id !== r.id))} />
                  )}
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                  <Field label="単価の種類">
                    <Select value={r.unit} onChange={(e) => setRates(rates.map((x) => (x.id === r.id ? { ...x, unit: e.target.value as RateUnitId } : x)))}>
                      {RATE_UNITS.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="単価">
                    <Suffix unit="円">
                      <NumberInput
                        value={r.price}
                        onChange={(e) => setRates(rates.map((x) => (x.id === r.id ? { ...x, price: e.target.value } : x)))}
                        onBlur={() => {
                          const v = readAmount(r.price).value;
                          if (v !== null) setRates(rates.map((x) => (x.id === r.id ? { ...x, price: groupDigits(v) } : x)));
                        }}
                        className="pr-9"
                      />
                    </Suffix>
                  </Field>
                </div>
                {readAmount(r.price).error && <p className="mt-1 text-sm font-bold text-danger">{readAmount(r.price).error}</p>}
              </div>
            ))}
            {rates.length < MAX_ROWS && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRates([...rates, { id: takeId(), label: "", unit: "piece", price: "" }])}
              >
                ＋ 単価を足す
              </Button>
            )}
            <Field label="単価に消費税は">
              <Select value={taxIncluded ? "incl" : "excl"} onChange={(e) => setTaxIncluded(e.target.value === "incl")}>
                <option value="excl">含まない（税抜。消費税は別に払う）</option>
                <option value="incl">含む（税込）</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">4. 報酬から差し引くもの</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            管理費・ロイヤリティ・車両リース代など、話し合って決めたものだけを書きます。ドライバーに責任がないのに、決めた報酬を後から減らすことはできません。
          </p>
          <div className="mt-3 space-y-3">
            {deductions.map((d) => (
              <div key={d.id} className="rounded-lg border border-border p-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Field label="名前">
                      <Input
                        value={d.label}
                        onChange={(e) => setDeductions(deductions.map((x) => (x.id === d.id ? { ...x, label: e.target.value } : x)))}
                        placeholder="例：管理費"
                      />
                    </Field>
                  </div>
                  <RemoveButton label={`${d.label || "差し引くもの"}を消す`} onClick={() => setDeductions(deductions.filter((x) => x.id !== d.id))} />
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                  <Field label="決め方">
                    <Select
                      value={d.kind}
                      onChange={(e) => setDeductions(deductions.map((x) => (x.id === d.id ? { ...x, kind: e.target.value as DeductionKindId } : x)))}
                    >
                      {DEDUCTION_KINDS.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={d.kind === "percent" ? "割合" : "金額"}>
                    <Suffix unit={d.kind === "percent" ? "%" : "円"}>
                      <NumberInput
                        value={d.amount}
                        onChange={(e) => setDeductions(deductions.map((x) => (x.id === d.id ? { ...x, amount: e.target.value } : x)))}
                        onBlur={() => {
                          if (d.kind === "percent") return;
                          const v = readAmount(d.amount).value;
                          if (v !== null) setDeductions(deductions.map((x) => (x.id === d.id ? { ...x, amount: groupDigits(v) } : x)));
                        }}
                        className="pr-9"
                      />
                    </Suffix>
                  </Field>
                </div>
                {d.amount.trim() !== "" && (d.kind === "percent" ? readPercent(d.amount) === null : readAmount(d.amount).value === null) && (
                  <p className="mt-1 text-sm font-bold text-danger">{d.kind === "percent" ? "0〜100の数字で入れてください" : "数字で入れてください"}</p>
                )}
              </div>
            ))}
            {deductions.length < MAX_ROWS && (
              <div className="flex flex-wrap gap-2">
                {DEDUCTION_PRESETS.filter((p) => !deductions.some((d) => d.label === p.label)).map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    variant="secondary"
                    onClick={() => setDeductions([...deductions, { id: takeId(), label: p.label, kind: p.kind, amount: "" }])}
                  >
                    ＋ {p.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDeductions([...deductions, { id: takeId(), label: "", kind: "monthly", amount: "" }])}
                >
                  ＋ ほかのもの
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">5. 締め日と支払日</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="締め日">
              <Select value={String(closingDay)} onChange={(e) => setClosingDay(toDay(e.target.value))}>
                {DAY_CHOICES.map((d) => (
                  <option key={String(d)} value={String(d)}>
                    {dayLabel(d)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="支払う月">
              <Select value={String(payMonthOffset)} onChange={(e) => setPayMonthOffset(Number(e.target.value) as PayMonthOffset)}>
                {([0, 1, 2] as PayMonthOffset[]).map((o) => (
                  <option key={o} value={o}>
                    {PAY_MONTH_LABELS[o]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="支払日">
              <Select value={String(payDay)} onChange={(e) => setPayDay(toDay(e.target.value))}>
                {DAY_CHOICES.map((d) => (
                  <option key={String(d)} value={String(d)}>
                    {dayLabel(d)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {doc && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {doc.deadline.error ? (
                <span className="font-bold text-danger">{doc.deadline.error}</span>
              ) : (
                <>
                  <StatusBadge status={doc.deadline.status} />
                  <a href="#torihiki-check">60日チェックの結果を見る</a>
                </>
              )}
            </p>
          )}
          <div className="mt-4 space-y-4">
            <Field label="支払日が銀行の休みの日なら" hint={holidayRule === "after" ? "次の営業日にずらすと、60日を超える月が出ることがあります。" : undefined}>
              <Select value={holidayRule} onChange={(e) => setHolidayRule(e.target.value as HolidayRule)}>
                <option value="before">前の営業日に払う</option>
                <option value="after">次の営業日に払う</option>
              </Select>
            </Field>
            <Field label="振込手数料">
              <Select value={transferFeeBearer} onChange={(e) => setTransferFeeBearer(e.target.value as Bearer)}>
                <option value="company">会社（御社）が負担する</option>
                <option value="driver">ドライバーの報酬から差し引く</option>
              </Select>
            </Field>
            {transferFeeBearer === "driver" && (
              <p role="alert" className="-mt-2 text-sm font-bold text-danger">
                2026年1月1日以後に発注する取引では、合意があっても振込手数料を報酬から差し引くと違反になると、公正取引委員会が示しています。
              </p>
            )}
            <p className="text-xs text-muted-foreground">支払方法は銀行振込で作ります。手形・電子記録債権・デジタル払いなどで払う場合は、別に書く事項があります。</p>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">6. 費用はどちらが持つか</h2>
          <p className="mt-1 text-xs text-muted-foreground">後でもめやすいところです。会社が持つ費用は、報酬とあわせて払う形で書きます。「書かない」にした項目は明示書に出ません。</p>
          <div className="mt-3 space-y-2">
            {expenses.map((x) => (
              <div key={x.id} className="grid grid-cols-[minmax(0,1fr)_9.5rem] items-center gap-2">
                <span className="text-sm">{x.label}</span>
                <Select
                  aria-label={`${x.label}の負担`}
                  value={x.bearer}
                  onChange={(e) => setExpenses(expenses.map((y) => (y.id === x.id ? { ...y, bearer: e.target.value as ExpenseRow["bearer"] } : y)))}
                >
                  <option value="none">書かない</option>
                  <option value="driver">ドライバー</option>
                  <option value="company">会社</option>
                </Select>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">7. その他（なくても可）</h2>
          <Field label="ほかに決めていること" hint="事故や荷物の破損のとき・制服や端末の貸し出し・まだ決まっていないこと（決まらない理由と、決める予定の日）など。">
            <textarea value={other} onChange={(e) => setOther(e.target.value)} rows={3} className={cx(textareaClass, "mt-1")} />
          </Field>
        </Card>
      </div>

      {/* ───── 結果と明示書 ───── */}
      <div className="mt-6 space-y-4 lg:mt-0 print:mt-0">
        {!doc ? (
          <Card className="no-print min-h-40">
            <p className="text-muted-foreground">準備しています…</p>
          </Card>
        ) : (
          <>
            <DeadlineCard deadline={doc.deadline} safeRuleLabel={safeRule?.ruleLabel ?? null} />
            <ChecklistCard doc={doc} />
            {doc.warnings.length > 0 && (
              <div role="status" className="no-print rounded-card border-2 border-warning bg-card p-4 text-sm">
                <p className="font-bold text-warning">気をつけること</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {doc.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="no-print">
              <h2 className="text-lg font-bold">できあがりの見本（A4）</h2>
              <p className="text-xs text-muted-foreground">入力に合わせて、すぐに変わります。印刷するとこの部分だけが紙に出ます。</p>
            </div>
            <DocSheet doc={doc} />
            <Card className="no-print">
              <h2 className="font-bold">ドライバーに渡す</h2>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button type="button" onClick={() => window.print()}>
                  印刷・PDFにする
                </Button>
                <Button type="button" variant="secondary" onClick={copyText}>
                  LINE・メールで送る文面をコピー
                </Button>
                {canShare && (
                  <Button type="button" variant="secondary" onClick={shareText}>
                    共有する
                  </Button>
                )}
              </div>
              <p aria-live="polite" className="mt-2 min-h-6 text-sm">
                {copyMessage}
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>紙のほか、LINE・メールなど相手を決めて送るメッセージで示してもかまいません。</li>
                <li>送ったメッセージは消さずに残し、スクリーンショットなどで記録を保存しておきましょう。</li>
                <li>メッセージで示したあとでも、ドライバーから紙で求められたら、印刷して渡します。</li>
              </ul>
              <details className="group mt-3 rounded-lg border border-border">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
                  文面を見る
                  <span aria-hidden className="text-lg leading-none text-muted-foreground transition group-open:rotate-45">
                    ＋
                  </span>
                </summary>
                <textarea
                  readOnly
                  value={plainText}
                  rows={14}
                  aria-label="LINE・メールで送る文面"
                  className="block w-full resize-y border-0 border-t border-border bg-card p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
                />
              </details>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Suffix({ unit, children }: { unit: string; children: ReactNode }) {
  return (
    <span className="relative block">
      {children}
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{unit}</span>
    </span>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-lg text-muted-foreground hover:bg-muted"
    >
      ×
    </button>
  );
}

function StatusBadge({ status }: { status: DeadlineStatus }) {
  return <span className={cx("inline-block rounded px-2 py-0.5 text-sm font-bold", STATUS_BADGE[status])}>{STATUS_LABELS[status]}</span>;
}

function DeadlineCard({ deadline, safeRuleLabel }: { deadline: DeadlineResult; safeRuleLabel: string | null }) {
  const titleId = useId();
  if (deadline.error) {
    return (
      <Card className="no-print border-2 border-danger">
        <h2 id="torihiki-check" className="font-bold">
          支払期日の60日チェック
        </h2>
        <p className="mt-2 font-bold text-danger">{deadline.error}</p>
      </Card>
    );
  }
  return (
    <section aria-labelledby={titleId} className={cx("no-print scroll-mt-20 rounded-card border-2 bg-card p-4", STATUS_BORDER[deadline.status])} id="torihiki-check">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={deadline.status} />
        <h2 id={titleId} className="font-bold">
          支払期日の60日チェック
        </h2>
      </div>
      <p className="mt-2 text-lg font-bold">{deadline.ruleLabel}</p>
      <p className="mt-1 text-sm">{deadline.summary}</p>

      {deadline.status === "caution" && (
        <div className="mt-3 rounded-lg bg-muted p-3 text-sm">
          <p className="font-bold">締め日から数えてよいのは、次のすべてにあてはまるときです</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>毎月の締めでまとめて払うことを、ドライバーと話し合って決め、明示書に書いている</li>
            <li>報酬の額か、決め方（単価 × 数量など）を明示書に書いている</li>
            <li>同じ種類の仕事が続いている</li>
          </ol>
          <p className="mt-2">この道具で作る明示書には、1 と 2 を書き込みます。あてはまるか心配なら、支払日を早めるのが確実です。</p>
        </div>
      )}
      {safeRuleLabel && (
        <p className="mt-3 text-sm">
          締め期間の最初の日から数えても60日（2か月）以内にするなら：<strong>{safeRuleLabel}</strong>までに払う
        </p>
      )}

      <details className="group mt-3 rounded-lg border border-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
          {deadline.rows.length}か月分の支払日を見る
          <span aria-hidden className="text-lg leading-none text-muted-foreground transition group-open:rotate-45">
            ＋
          </span>
        </summary>
        <div className="px-3 pb-3">
          <TableWrap>
            <table className="mt-2 w-full min-w-[30rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 text-left">
                    締め期間
                  </th>
                  <th scope="col" className="px-2 py-2 text-left">
                    支払日
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    初日から
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    締め日から
                  </th>
                  <th scope="col" className="py-2 pl-2 text-left">
                    判定
                  </th>
                </tr>
              </thead>
              <tbody>
                {deadline.rows.map((row) => (
                  <DeadlineTableRow key={row.closingMonth} row={row} />
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-2 text-xs text-muted-foreground">
            日数は、その日から支払日まで何日後かです。月ごとに締める場合は、60日を「2か月」として数える扱いがあり（31日の月も1か月）、61日後でも
            OK になる月があります。支払日は土日と年末年始（12月31日〜1月3日）をずらして計算しています。祝日は入れていません。
          </p>
        </div>
      </details>
      <p className="mt-3 text-xs text-muted-foreground">
        60日のルールは、従業員がいる（または役員が2人以上いる）会社などが、個人のドライバーに仕事を頼むときの決まりです。元請から受けた仕事をそのまま頼む場合の「元請からの支払日から30日以内」という決まりは、このチェックでは扱っていません。
      </p>
    </section>
  );
}

function DeadlineTableRow({ row }: { row: DeadlineRow }) {
  const [y, m] = row.closingMonth.split("-").map(Number);
  return (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className="py-2 pr-2 text-left font-normal">
        <span className="block whitespace-nowrap font-bold">
          {y}年{m}月締め
        </span>
        <span className="num block whitespace-nowrap text-xs text-muted-foreground">
          {shortDate(row.periodStart)}〜{shortDate(row.periodEnd)}
        </span>
      </th>
      <td className="num whitespace-nowrap px-2 py-2">
        {shortDate(row.payDateActual)}
        {row.shifted && <span className="block text-xs text-muted-foreground">（{shortDate(row.payDate)}から）</span>}
      </td>
      <td className="num whitespace-nowrap px-2 py-2 text-right">{row.daysFromStart}日</td>
      <td className="num whitespace-nowrap px-2 py-2 text-right">{row.daysFromEnd}日</td>
      <td className="whitespace-nowrap py-2 pl-2">
        <StatusBadge status={row.status} />
      </td>
    </tr>
  );
}

const CHECK_MARK: Record<ChecklistStatus, { mark: string; className: string; label: string }> = {
  ok: { mark: "✓", className: "bg-success text-card", label: "書けています" },
  missing: { mark: "!", className: "bg-danger text-card", label: "未記入" },
  na: { mark: "−", className: "bg-muted text-muted-foreground", label: "不要" },
};

function ChecklistCard({ doc }: { doc: TorihikiDoc }) {
  const missing = doc.checklist.filter((c) => c.status === "missing").length;
  return (
    <Card className="no-print">
      <h2 className="font-bold">明示する事項のチェック</h2>
      <p className="mt-1 text-sm">
        {missing === 0 ? "決められた事項は、すべて書けています。" : `あと${missing}つ、書けていない事項があります。`}
      </p>
      <ul className="mt-3 space-y-2">
        {doc.checklist.map((c) => {
          const s = CHECK_MARK[c.status];
          return (
            <li key={c.label} className="flex items-start gap-3 text-sm">
              <span aria-hidden className={cx("mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", s.className)}>
                {s.mark}
              </span>
              <span>
                <span className="font-bold">{c.label}</span>
                <span className="sr-only">：{s.label}</span>
                {c.note && <span className="block text-xs text-muted-foreground">{c.note}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** 「（未記入）」を赤く目立たせる */
function Blankable({ text }: { text: string }) {
  if (!text.includes(BLANK)) return <>{text}</>;
  const parts = text.split(BLANK);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <span className="font-bold text-red-700">{BLANK}</span>}
        </span>
      ))}
    </>
  );
}

function DocSheet({ doc }: { doc: TorihikiDoc }) {
  return (
    <article
      aria-label="取引条件明示書の見本"
      className="mx-auto w-full max-w-[210mm] border border-neutral-300 bg-white p-5 text-[13px] leading-relaxed text-black shadow-sm sm:p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none"
    >
      <header className="border-b-2 border-black pb-2 text-center">
        <h2 className="text-xl font-bold tracking-[0.3em]">{doc.title}</h2>
      </header>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <p className="border-b border-black pb-0.5 text-base font-bold">
          <Blankable text={doc.driverName} /> 様
        </p>
        <div className="text-right">
          <p>
            <Blankable text={doc.dateText} />
          </p>
          <p className="font-bold">
            <Blankable text={doc.clientName} />
          </p>
        </div>
      </div>
      <p className="mt-4">{doc.intro}</p>
      <ol className="mt-4 space-y-3">
        {doc.sections.map((s, i) => (
          <li key={s.key} className="break-inside-avoid">
            <h3 className="border-b border-neutral-400 font-bold">
              {i + 1}. {s.heading}
            </h3>
            {s.table && (
              <table className="mt-1 w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-black">
                    <th scope="col" className="py-0.5 pr-2 text-left font-bold">
                      {s.table.head[0]}
                    </th>
                    <th scope="col" className="py-0.5 text-left font-bold">
                      {s.table.head[1]}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.table.rows.map(([a, b], j) => (
                    <tr key={j} className="border-b border-neutral-300">
                      <td className="py-0.5 pr-2 align-top">
                        <Blankable text={a} />
                      </td>
                      <td className="num py-0.5 align-top">
                        <Blankable text={b} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-1 space-y-0.5 [overflow-wrap:anywhere]">
              {s.lines.map((line, j) => (
                <p key={j}>
                  <Blankable text={line} />
                </p>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <footer className="mt-6 border-t border-black pt-2 text-[11px] leading-relaxed">
        <p>{doc.footer}</p>
      </footer>
      <div className="mt-6 grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2 print:grid-cols-2">
        <p className="border-b border-black pb-1">受け取った日：　　　　年　　月　　日</p>
        <p className="border-b border-black pb-1">ドライバーの署名：</p>
      </div>
    </article>
  );
}
