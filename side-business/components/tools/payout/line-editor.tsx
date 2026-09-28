/**
 * /tools/payout の報酬の1行。計算の形（数量 × 単価・売上 × 率・段階歩合・最低保証・精算幅・人数の加算 ほか）を選び、
 * 形ごとの欄と源泉徴収の区分を入れる。値は文字のまま親へ返す（読むのは state.tsx）。
 */
import { Money } from "@/components/ui";
import { PAY_MODEL_LABELS, SETTLEMENT_MODE_LABELS, type SettlementMode } from "@/lib/engine/payModels";
import type { IndustryPreset } from "@/lib/engine/presets";
import { FEE_WITHHOLDING_NOTE } from "@/lib/engine/statement";
import { en } from "@/lib/engine/types";
import { WITHHOLDING_CATEGORIES, WITHHOLDING_CATEGORY_ORDER } from "@/lib/engine/withholding";
import { AddButton, Check, Choice, NumField, RemoveButton, SelectField, TextField } from "./fields";
import {
  MODEL_HINTS,
  MODEL_ORDER,
  PRICE_STEPS,
  TIME_UNITS,
  WITHHOLDING_HELP,
  blankCategory,
  blankTier,
  isEarningModel,
  type LineForm,
} from "./state";

type Patch = (patch: Partial<LineForm>) => void;

const MAX_CATEGORIES = 8;
const MAX_TIERS = 8;

/** 単位を欄の右に出すのは短いときだけ */
function shortSuffix(unit: string): string | undefined {
  const u = unit.trim();
  return u && u.length <= 3 ? u : undefined;
}

export function LineEditor({
  line,
  index,
  preset,
  computed,
  precedingTotal,
  onPatch,
  onRemove,
  takeId,
}: {
  line: LineForm;
  index: number;
  preset: IndustryPreset;
  /** この行の計算の結果（金額と今月の式） */
  computed: { amount: number; detail: string } | null;
  /** この行より上の報酬の行の合計（差し引きの元の額を自動にするとき） */
  precedingTotal: number;
  onPatch: Patch;
  onRemove: (() => void) | null;
  takeId: () => number;
}) {
  const name = line.label.trim() || PAY_MODEL_LABELS[line.model];
  return (
    <li className="rounded-card border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 pt-2.5 text-sm font-bold [overflow-wrap:anywhere]">
          {index + 1}. {name}
        </h3>
        {onRemove && <RemoveButton what={`${index + 1}行目（${name}）`} onClick={onRemove} />}
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <TextField label="行の名前" value={line.label} onChange={(v) => onPatch({ label: v })} placeholder="原稿料・宅配・施術 など" />
        <SelectField
          label="計算の形"
          value={line.model}
          options={MODEL_ORDER.map((m) => ({ value: m, label: PAY_MODEL_LABELS[m] }))}
          onChange={(model) => onPatch({ model })}
          hint={MODEL_HINTS[line.model]}
        />
      </div>

      <div className="mt-3 space-y-3">
        {line.model === "unit" && <UnitFields line={line} preset={preset} onPatch={onPatch} />}
        {line.model === "commission" && <CommissionFields line={line} onPatch={onPatch} takeId={takeId} />}
        {line.model === "guarantee" && (
          <>
            <CommissionFields line={line} onPatch={onPatch} takeId={takeId} />
            <div className="grid grid-cols-2 gap-3">
              <NumField label="保証の日額" suffix="円" value={line.dailyGuarantee} onChange={(v) => onPatch({ dailyGuarantee: v })} integer />
              <NumField label="稼働日数" suffix="日" value={line.guaranteeDays} onChange={(v) => onPatch({ guaranteeDays: v })} />
            </div>
          </>
        )}
        {line.model === "tiered" && <TieredFields line={line} onPatch={onPatch} takeId={takeId} />}
        {line.model === "settlement" && <SettlementFields line={line} onPatch={onPatch} />}
        {line.model === "threshold" && <ThresholdFields line={line} onPatch={onPatch} />}
        {line.model === "fixed" && <FixedFields line={line} onPatch={onPatch} />}
        {line.model === "contractFee" && <FeeFields line={line} onPatch={onPatch} precedingTotal={precedingTotal} />}
        {line.model === "chairRental" && <ChairFields line={line} onPatch={onPatch} />}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        {isEarningModel(line.model) ? (
          <>
            <SelectField
              label="源泉徴収の区分"
              value={line.withholding}
              options={WITHHOLDING_CATEGORY_ORDER.map((c) => ({ value: c, label: WITHHOLDING_CATEGORIES[c].label }))}
              onChange={(withholding) => onPatch({ withholding })}
              hint={WITHHOLDING_HELP}
            />
            <p className="mt-1 text-xs text-muted-foreground">例：{WITHHOLDING_CATEGORIES[line.withholding].examples}</p>
            <Check checked={line.needsReview} onChange={(needsReview) => onPatch({ needsReview })}>
              区分に迷う（「要確認」の印を付ける）
            </Check>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {line.model === "contractFee"
              ? FEE_WITHHOLDING_NOTE
              : "この道具では、面貸しの精算を報酬とは別の精算として扱い、消費税・源泉徴収・インボイスの負担の計算には入れていません。契約の中身によって扱いが変わることがあるので、迷うときは税理士に確かめてください。"}
          </p>
        )}
      </div>

      {computed && (
        <div className="mt-3 rounded-lg bg-muted p-3">
          <p className="flex items-baseline justify-between gap-3 text-sm font-bold">
            <span>この行</span>
            <Money value={computed.amount} />
          </p>
          {computed.detail && <p className="num mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{computed.detail}</p>}
        </div>
      )}
    </li>
  );
}

/* ───────────── 数量 × 単価 ───────────── */

function UnitFields({ line, preset, onPatch }: { line: LineForm; preset: IndustryPreset; onPatch: Patch }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="数量" suffix={shortSuffix(line.unitLabel)} value={line.qty} onChange={(v) => onPatch({ qty: v })} />
        <NumField label="単価（税抜）" suffix="円" value={line.unitRate} onChange={(v) => onPatch({ unitRate: v })} />
      </div>
      <TextField
        label="数量の単位"
        value={line.unitLabel}
        onChange={(v) => onPatch({ unitLabel: v })}
        hint={`例：${preset.terms.qty}。単価は 1字 2円 のような小数も入れられます（1円未満は切り捨て）`}
      />
    </>
  );
}

/* ───────────── 売上 × 率（最低保証でも使う） ───────────── */

const SALES_BASIS: { value: string; label: string }[] = [
  { value: "excl-excl", label: "税抜の売上を入れ、そのまま率を掛ける" },
  { value: "incl-incl", label: "税込の売上を入れ、そのまま率を掛ける" },
  { value: "incl-excl", label: "税込の売上を入れ、税抜に直してから率を掛ける" },
  { value: "excl-incl", label: "税抜の売上を入れ、税込に直してから率を掛ける" },
];

function CommissionFields({ line, onPatch, takeId }: { line: LineForm; onPatch: Patch; takeId: () => number }) {
  const patchCategory = (id: number, patch: Partial<LineForm["categories"][number]>) =>
    onPatch({ categories: line.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  return (
    <>
      <fieldset className="min-w-0">
        <legend className="text-sm font-bold">売上の区分と率</legend>
        <ul className="mt-2 space-y-2">
          {line.categories.map((c, i) => (
            <li key={c.id} className="rounded-lg border border-border p-2">
              <div className="flex items-end gap-2">
                <TextField
                  label={`区分${i + 1}`}
                  value={c.label}
                  onChange={(v) => patchCategory(c.id, { label: v })}
                  placeholder="フリー・指名・店販 など"
                  className="flex-1"
                />
                {line.categories.length > 1 && (
                  <RemoveButton
                    what={`区分${i + 1}（${c.label || "名前なし"}）`}
                    onClick={() => onPatch({ categories: line.categories.filter((x) => x.id !== c.id) })}
                  />
                )}
              </div>
              <div className="mt-2 grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
                <NumField label="売上" suffix="円" value={c.sales} onChange={(v) => patchCategory(c.id, { sales: v })} />
                <NumField label="率" suffix="%" value={c.ratePct} onChange={(v) => patchCategory(c.id, { ratePct: v })} />
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <AddButton
            onClick={() => onPatch({ categories: [...line.categories, blankCategory(takeId())] })}
            disabled={line.categories.length >= MAX_CATEGORIES}
          >
            区分を足す
          </AddButton>
        </div>
      </fieldset>
      <SelectField
        label="売上の入れ方と、率を掛ける売上"
        value={`${line.salesIncludeTax ? "incl" : "excl"}-${line.rateAppliesTo}`}
        options={SALES_BASIS}
        onChange={(v) => {
          const [input, applyTo] = v.split("-");
          onPatch({ salesIncludeTax: input === "incl", rateAppliesTo: applyTo === "incl" ? "incl" : "excl" });
        }}
        hint="税込の売上を税抜に直すときは、1円未満を切り捨てます。区分ごとの売上 × 率も1円未満は切り捨て。"
      />
    </>
  );
}

/* ───────────── 段階歩合 ───────────── */

function TieredFields({ line, onPatch, takeId }: { line: LineForm; onPatch: Patch; takeId: () => number }) {
  const last = line.tiers.length - 1;
  const patchTier = (id: number, patch: Partial<LineForm["tiers"][number]>) =>
    onPatch({ tiers: line.tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const salesName = line.tierSalesLabel.trim() || "売上";
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="売上の呼び方" value={line.tierSalesLabel} onChange={(v) => onPatch({ tierSalesLabel: v })} placeholder="技術売上" />
        <NumField label={salesName} suffix="円" value={line.tierSales} onChange={(v) => onPatch({ tierSales: v })} integer />
      </div>
      <Choice
        legend="段階の当て方"
        value={line.tierMode}
        onChange={(tierMode) => onPatch({ tierMode })}
        options={[
          { value: "progressive", label: "超過累進", note: "段階ごとの部分 × その段階の率を合計" },
          { value: "slide", label: "全額スライド", note: `${salesName}の全額 × その額が入る段階の率` },
        ]}
      />
      <fieldset className="min-w-0">
        <legend className="text-sm font-bold">段階（上限の小さい順）</legend>
        <ol className="mt-2 space-y-2">
          {line.tiers.map((t, i) => (
            <li key={t.id} className="rounded-lg border border-border p-2">
              {i === last ? (
                <div className="grid grid-cols-2 items-end gap-2">
                  <p className="pb-2.5 text-sm">
                    段階{i + 1}：<span className="font-bold">それより上（上限なし）</span>
                  </p>
                  <NumField label="率" suffix="%" value={t.ratePct} onChange={(v) => patchTier(t.id, { ratePct: v })} />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField
                      label={`段階${i + 1}の上限`}
                      suffix="円"
                      value={t.upTo}
                      onChange={(v) => patchTier(t.id, { upTo: v })}
                      integer
                    />
                    <NumField label="率" suffix="%" value={t.ratePct} onChange={(v) => patchTier(t.id, { ratePct: v })} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">上限の額を含みます</p>
                    {line.tiers.length > 2 && (
                      <RemoveButton what={`段階${i + 1}`} onClick={() => onPatch({ tiers: line.tiers.filter((x) => x.id !== t.id) })} />
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
        <div className="mt-2">
          <AddButton
            onClick={() => onPatch({ tiers: [...line.tiers.slice(0, -1), blankTier(takeId()), line.tiers[last]] })}
            disabled={line.tiers.length >= MAX_TIERS}
          >
            段階を足す
          </AddButton>
        </div>
      </fieldset>
    </>
  );
}

/* ───────────── 月額と精算幅 ───────────── */

const SETTLEMENT_ORDER: SettlementMode[] = ["updown", "middle", "fixed", "hourly"];

const SETTLEMENT_HINTS: Record<SettlementMode, string> = {
  updown: "超過は「月額 ÷ 上限」、控除は「月額 ÷ 下限」の単価で精算",
  middle: "超過・控除とも「月額 ÷ 上限と下限の中間」の単価で精算",
  fixed: "時間による精算なし",
  hourly: "時間単価 × 実働時間",
};

function SettlementFields({ line, onPatch }: { line: LineForm; onPatch: Patch }) {
  const mode = line.settleMode;
  const ranged = mode === "updown" || mode === "middle";
  return (
    <>
      <SelectField
        label="精算の方式"
        value={mode}
        options={SETTLEMENT_ORDER.map((m) => ({ value: m, label: SETTLEMENT_MODE_LABELS[m] }))}
        onChange={(settleMode) => onPatch({ settleMode })}
        hint={`${SETTLEMENT_HINTS[mode]}。方式・丸め・端数は法律ではなく契約で決めるものです。`}
      />
      <div className="grid grid-cols-2 gap-3">
        {mode === "hourly" ? (
          <NumField label="時間単価（税抜）" suffix="円" value={line.hourlyRate} onChange={(v) => onPatch({ hourlyRate: v })} integer />
        ) : (
          <NumField label="月額（税抜）" suffix="円" value={line.monthly} onChange={(v) => onPatch({ monthly: v })} integer />
        )}
        {mode !== "fixed" && (
          <NumField label="実働" suffix="時間" value={line.actualHours} onChange={(v) => onPatch({ actualHours: v })} />
        )}
        {ranged && (
          <>
            <NumField label="精算幅の下限" suffix="時間" value={line.lower} onChange={(v) => onPatch({ lower: v })} />
            <NumField label="精算幅の上限" suffix="時間" value={line.upper} onChange={(v) => onPatch({ upper: v })} />
          </>
        )}
      </div>
      {mode !== "fixed" && (
        <SelectField
          label="実働の丸め"
          value={line.timeUnit}
          options={TIME_UNITS}
          onChange={(timeUnit) => onPatch({ timeUnit })}
        />
      )}
      {ranged && (
        <SelectField
          label="超過・控除の単価の端数"
          value={line.priceStep}
          options={PRICE_STEPS}
          onChange={(priceStep) => onPatch({ priceStep })}
        />
      )}
      {mode !== "hourly" && (
        <>
          <Check
            checked={line.prorate}
            onChange={(prorate) => onPatch({ prorate })}
            hint="月額と精算幅を「稼働した営業日 ÷ その月の営業日」で縮めます"
          >
            月の途中で入った・抜けた（営業日で日割り）
          </Check>
          {line.prorate && (
            <div className="grid grid-cols-2 gap-3">
              <NumField label="稼働した営業日" suffix="日" value={line.workedDays} onChange={(v) => onPatch({ workedDays: v })} integer />
              <NumField label="その月の営業日" suffix="日" value={line.businessDays} onChange={(v) => onPatch({ businessDays: v })} integer />
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ───────────── 基準を超えた人数の加算 ───────────── */

function ThresholdFields({ line, onPatch }: { line: LineForm; onPatch: Patch }) {
  const unit = line.countLabel.trim() || "人";
  return (
    <>
      <TextField
        label={`${unit}数`}
        value={line.counts}
        onChange={(v) => onPatch({ counts: v })}
        hint="1回ごとに数えるときは、読点・カンマ・空白で区切って入れます（例：12、11、10）"
      />
      <div className="grid grid-cols-2 gap-3">
        <NumField label="基準" suffix={shortSuffix(unit)} value={line.countBase} onChange={(v) => onPatch({ countBase: v })} />
        <NumField
          label="加算の単価"
          suffix="円"
          value={line.countUnitPrice}
          onChange={(v) => onPatch({ countUnitPrice: v })}
          hint={`基準を超えた1${unit}あたり`}
          integer
        />
      </div>
      <TextField label="数える単位" value={line.countLabel} onChange={(v) => onPatch({ countLabel: v })} placeholder="人" />
    </>
  );
}

/* ───────────── 定額 ───────────── */

function FixedFields({ line, onPatch }: { line: LineForm; onPatch: Patch }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="金額（税抜）" suffix="円" value={line.fixedAmount} onChange={(v) => onPatch({ fixedAmount: v })} integer />
        <TextField label="呼び方" value={line.fixedText} onChange={(v) => onPatch({ fixedText: v })} placeholder="月額・一式" />
      </div>
      <Check
        checked={line.fixedSalaryLike}
        onChange={(fixedSalaryLike) => onPatch({ fixedSalaryLike })}
        hint="オンにすると、労働者性のリスクがある設計だという注意を出します（判定はしません）"
      >
        勤怠や働いた時間と結びついた固定の支払
      </Check>
    </>
  );
}

/* ───────────── 契約で決めた差し引き ───────────── */

function FeeFields({ line, onPatch, precedingTotal }: { line: LineForm; onPatch: Patch; precedingTotal: number }) {
  return (
    <>
      <Choice
        legend="差し引く額の決め方"
        value={line.feeMode}
        onChange={(feeMode) => onPatch({ feeMode })}
        options={[
          { value: "fixed", label: "決まった額" },
          { value: "rate", label: "元の額 × 率" },
        ]}
      />
      {line.feeMode === "fixed" ? (
        <NumField label="差し引く額" suffix="円" value={line.feeAmount} onChange={(v) => onPatch({ feeAmount: v })} integer />
      ) : (
        <>
          <Check
            checked={line.feeBaseAuto}
            onChange={(feeBaseAuto) => onPatch({ feeBaseAuto })}
            hint={`いまは ${en(precedingTotal)}`}
          >
            元の額は、この行より上の報酬の合計（自動）
          </Check>
          <div className="grid grid-cols-2 gap-3">
            {!line.feeBaseAuto && (
              <NumField label="元の額" suffix="円" value={line.feeBase} onChange={(v) => onPatch({ feeBase: v })} integer />
            )}
            <NumField label="率" suffix="%" value={line.feeRatePct} onChange={(v) => onPatch({ feeRatePct: v })} />
          </div>
          <TextField
            label="元の額の呼び方"
            value={line.feeBaseLabel}
            onChange={(v) => onPatch({ feeBaseLabel: v })}
            placeholder="委託料・技術売上 など"
          />
        </>
      )}
      <TextField label="根拠" value={line.feeBasis} onChange={(v) => onPatch({ feeBasis: v })} placeholder="業務委託契約 第○条" />
      <Check
        checked={line.feeAgreed}
        onChange={(feeAgreed) => onPatch({ feeAgreed })}
        hint="書面に書いていない・合意していない差し引きは、フリーランス法の「減額」にあたるおそれがあります"
      >
        取引条件で書面に明示・合意している
      </Check>
    </>
  );
}

/* ───────────── 面貸しの精算 ───────────── */

function ChairFields({ line, onPatch }: { line: LineForm; onPatch: Patch }) {
  return (
    <>
      <NumField
        label="預かった売上"
        suffix="円"
        value={line.chairSales}
        onChange={(v) => onPatch({ chairSales: v })}
        hint="サロンが預かった、その人のお客様の売上"
        integer
      />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="場所代"
          value={line.rentMode}
          options={[
            { value: "rate", label: "売上 × 率" },
            { value: "fixed", label: "決まった額" },
          ]}
          onChange={(rentMode) => onPatch({ rentMode })}
        />
        {line.rentMode === "rate" ? (
          <NumField label="場所代の率" suffix="%" value={line.rentRatePct} onChange={(v) => onPatch({ rentRatePct: v })} />
        ) : (
          <NumField label="場所代の額" suffix="円" value={line.rentAmount} onChange={(v) => onPatch({ rentAmount: v })} integer />
        )}
        <SelectField
          label="決済手数料"
          value={line.cardFeeMode}
          options={[
            { value: "none", label: "なし" },
            { value: "fixed", label: "決まった額" },
            { value: "rate", label: "売上 × 率" },
          ]}
          onChange={(cardFeeMode) => onPatch({ cardFeeMode })}
        />
        {line.cardFeeMode === "rate" && (
          <NumField label="手数料の率" suffix="%" value={line.cardFeeRatePct} onChange={(v) => onPatch({ cardFeeRatePct: v })} />
        )}
        {line.cardFeeMode === "fixed" && (
          <NumField label="手数料の額" suffix="円" value={line.cardFeeAmount} onChange={(v) => onPatch({ cardFeeAmount: v })} integer />
        )}
      </div>
      <NumField label="サロンから買った材料" suffix="円" value={line.materials} onChange={(v) => onPatch({ materials: v })} integer />
    </>
  );
}
