"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mic, Square, Trash2, Plus, Check, Loader2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Qty } from "@/components/ui/money";
import type { Masters } from "@/lib/db/types";
import { parseNumberInput } from "@/lib/calc";
import { formatMonthJa } from "@/lib/month";
import { mergeVoiceRows, parseVoiceEntries, type VoiceMasters, type VoiceSaveRow } from "@/lib/voice/parse";
import { createRecognizer, isSpeechSupported, type VoiceRecognizer } from "@/lib/voice/speech";
import { quickSetEntriesAction } from "@/lib/actions/entries";
import { itemOptions, oldestEntryFor, unitSuffix, type EntryRow } from "./helpers";
import { cn } from "@/lib/utils";

export interface VoiceEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 表示中の稼動月 */
  month: string;
  /** 稼働中のドライバー・案件内容だけ */
  masters: Masters;
  /** いまの月の稼働行（既存の数量を見せるため） */
  rows: EntryRow[];
  onSaved?: () => void;
}

/** 画面で直せる 1 行 */
interface DraftRow {
  key: string;
  driverId: string;
  itemId: string;
  /** 文字のまま持つ（全角・カンマを許す） */
  qty: string;
  /** 元の言葉（何を聞き取ったか分かるように） */
  source: string;
}

/** 言い方の見本を、実際に登録されているドライバー・案件から作る */
function buildExamples(drivers: { name: string }[], items: { label: string }[]): string[] {
  const d1 = drivers[0]?.name ?? "ドライバー名";
  const d2 = drivers[1]?.name ?? d1;
  const i1 = items[0]?.label ?? "案件名";
  const i2 = items[1]?.label ?? i1;
  return [`${d1}さん ${i1} 10件`, `${d1} ${i1} 10、${d2} ${i2} 5`];
}

export function VoiceEntryDialog({ open, onOpenChange, month, masters, rows, onSaved }: VoiceEntryDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [addToExisting, setAddToExisting] = useState(false);
  const recognizer = useRef<VoiceRecognizer | null>(null);
  const nextKey = useRef(0);

  // 対応していない端末では文字入力だけにする（機能そのものは使える）
  useEffect(() => setSupported(isSpeechSupported()), []);

  // 閉じたら片付ける
  useEffect(() => {
    if (open) return;
    recognizer.current?.stop();
    recognizer.current = null;
    setListening(false);
    setText("");
    setInterim("");
    setError("");
    setDraft(null);
    setAddToExisting(false);
  }, [open]);

  const voiceMasters: VoiceMasters = useMemo(
    () => ({
      drivers: masters.drivers.map((d) => ({ id: d.id, name: d.name, kana: d.kana })),
      items: itemOptions(masters).map((o) => ({ id: o.id, label: o.label, projectName: o.projectName, itemName: o.itemName, unit: o.unit })),
    }),
    [masters],
  );

  const items = useMemo(() => itemOptions(masters), [masters]);
  const examples = useMemo(() => buildExamples(masters.drivers, items), [masters.drivers, items]);

  /** いま聞き取れている内容（話している最中の下書き） */
  const preview = useMemo(() => parseVoiceEntries(`${text} ${interim}`.trim(), voiceMasters), [text, interim, voiceMasters]);

  const startListening = () => {
    setError("");
    if (!recognizer.current) {
      recognizer.current = createRecognizer({
        onFinal: (t) => setText((prev) => (prev ? `${prev} ${t}` : t).trim()),
        onInterim: (t) => setInterim(t),
        onEnd: () => {
          setListening(false);
          setInterim("");
        },
        onError: (message) => setError(message),
      });
    }
    if (!recognizer.current) {
      setError("この端末では音声を使えません。文字で入力してください。");
      return;
    }
    setListening(true);
    recognizer.current.start();
  };

  const stopListening = () => {
    recognizer.current?.stop();
    setListening(false);
  };

  /** 聞き取った内容を、直せる行にする */
  const toReview = () => {
    stopListening();
    const parsed = parseVoiceEntries(text, voiceMasters);
    if (parsed.entries.length === 0) {
      setError("聞き取れた内容から稼働を作れませんでした。言い方を変えるか、文字で入力してください。");
      return;
    }
    setError("");
    setDraft(
      parsed.entries.map((e) => {
        nextKey.current += 1;
        return { key: `v${nextKey.current}`, driverId: e.driverId ?? "", itemId: e.itemId ?? "", qty: e.qty == null ? "" : String(e.qty), source: e.source };
      }),
    );
  };

  const update = (key: string, patch: Partial<DraftRow>) => {
    setDraft((prev) => (prev ? prev.map((r) => (r.key === key ? { ...r, ...patch } : r)) : prev));
  };
  const remove = (key: string) => setDraft((prev) => (prev ? prev.filter((r) => r.key !== key) : prev));
  const addBlank = () => {
    nextKey.current += 1;
    setDraft((prev) => [...(prev ?? []), { key: `v${nextKey.current}`, driverId: "", itemId: "", qty: "", source: "" }]);
  };

  /** 既存の数量（この月に同じドライバー × 案件内容の行があるか） */
  const existingQty = (driverId: string, itemId: string): number | null => {
    if (!driverId || !itemId) return null;
    const { entry } = oldestEntryFor(rows, driverId, itemId);
    return entry ? entry.qty : null;
  };

  /** 保存する値（「足す」なら既存 ＋ 聞き取り） */
  const finalQty = (r: DraftRow): number | null => {
    const n = parseNumberInput(r.qty);
    if (n == null || !(n > 0)) return null;
    if (!addToExisting) return n;
    const now = existingQty(r.driverId, r.itemId);
    return now == null ? n : now + n;
  };

  const incomplete = (draft ?? []).filter((r) => !r.driverId || !r.itemId || finalQty(r) == null);
  const ready = (draft ?? []).filter((r) => r.driverId && r.itemId && finalQty(r) != null);

  const save = () => {
    const merged: VoiceSaveRow[] = mergeVoiceRows(ready.map((r) => ({ driverId: r.driverId, itemId: r.itemId, qty: parseNumberInput(r.qty) ?? 0 })));
    // 「足す」は合算したあとの数量に、いまの数量を足す
    const payload = merged.map((r) => {
      const now = addToExisting ? existingQty(r.driverId, r.itemId) : null;
      return { driver_id: r.driverId, project_item_id: r.itemId, qty: String(r.qty + (now ?? 0)) };
    });
    if (payload.length === 0) {
      toast.error("保存できる行がありません。");
      return;
    }
    startTransition(async () => {
      const res = await quickSetEntriesAction(month, payload);
      if (!res.ok) {
        toast.error(res.error);
        // 案件内容ごとに保存するため、途中まで入っていることがある。一覧を読み直して実際の状態を見せる
        router.refresh();
        return;
      }
      toast.success(res.message ?? "保存しました");
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>声で稼働を入力</DialogTitle>
          <DialogDescription>
            {formatMonthJa(month)}。「{examples[0]}」のように話すと、ドライバー・案件・数量に分けて下書きにします。保存する前に必ず確認できます。
          </DialogDescription>
        </DialogHeader>

        {draft == null ? (
          <div className="flex flex-col gap-3">
            {supported ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
                <button
                  type="button"
                  onClick={listening ? stopListening : startListening}
                  aria-label={listening ? "聞き取りを止める" : "話して入力する"}
                  className={cn(
                    "flex h-20 w-20 items-center justify-center rounded-full text-primary-foreground shadow transition",
                    listening ? "animate-pulse bg-destructive" : "bg-primary hover:opacity-90",
                  )}
                >
                  {listening ? <Square className="h-7 w-7" /> : <Mic className="h-8 w-8" />}
                </button>
                <p className="text-sm text-muted-foreground">{listening ? "聞き取り中…　話し終わったら止めてください" : "マイクを押して話してください"}</p>
              </div>
            ) : (
              <Alert>この端末では音声を使えません。下の欄に文字で入力してください（同じように読み取ります）。</Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="voice-text">聞き取った内容（直せます）</Label>
              <Textarea
                id="voice-text"
                value={interim ? `${text} ${interim}`.trim() : text}
                onChange={(e) => {
                  setText(e.target.value);
                  setInterim("");
                }}
                rows={3}
                placeholder={examples[0]}
              />
              <p className="text-xs text-muted-foreground">例：{examples.join(" ／ ")}</p>
            </div>

            {preview.entries.length > 0 && (
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">読み取り中</p>
                <ul className="space-y-1 text-sm">
                  {preview.entries.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-x-2">
                      <span>{e.driverName || "（ドライバー未指定）"}</span>
                      <span className="text-muted-foreground">/</span>
                      <span>{e.itemLabel || "（案件未指定）"}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="num">{e.qty != null ? e.qty : "（数量未指定）"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <Alert variant="destructive">{error}</Alert>}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                やめる
              </Button>
              <Button onClick={toReview} disabled={!text.trim()}>
                <Pencil /> 内容を確認する
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={addToExisting} onCheckedChange={(v) => setAddToExisting(v === true)} aria-label="いまの数量に足す" />
              いまの数量に足す（外すと、聞き取った数量で置き換えます）
            </label>

            <ul className="space-y-2">
              {draft.map((r) => {
                const now = existingQty(r.driverId, r.itemId);
                const after = finalQty(r);
                const item = items.find((o) => o.id === r.itemId);
                const missing = !r.driverId || !r.itemId || after == null;
                return (
                  <li key={r.key} className={cn("rounded-lg border p-3", missing && "border-warning/50 bg-warning/5")}>
                    {r.source && <p className="mb-2 text-xs text-muted-foreground">「{r.source}」</p>}
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem_auto] sm:items-end">
                      <div className="space-y-1">
                        <Label htmlFor={`d-${r.key}`} className="text-xs">
                          ドライバー
                        </Label>
                        <Select id={`d-${r.key}`} value={r.driverId} onChange={(e) => update(r.key, { driverId: e.target.value })}>
                          <option value="">選択してください</option>
                          {masters.drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`i-${r.key}`} className="text-xs">
                          案件
                        </Label>
                        <Select id={`i-${r.key}`} value={r.itemId} onChange={(e) => update(r.key, { itemId: e.target.value })}>
                          <option value="">選択してください</option>
                          {items.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`q-${r.key}`} className="text-xs">
                          数量{item ? `（${unitSuffix(item.unit)}）` : ""}
                        </Label>
                        <NumberInput id={`q-${r.key}`} value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} className="text-right" />
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => remove(r.key)} aria-label="この行を消す" className="justify-self-end">
                        <Trash2 />
                      </Button>
                    </div>
                    {now != null && after != null && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        いまの数量 <Qty value={now} /> → <Qty value={after} />
                        {addToExisting ? "（足します）" : "（置き換えます）"}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={addBlank}>
                <Plus /> 行を足す
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                <Mic /> 話し直す
              </Button>
              {incomplete.length > 0 && <Badge variant="warning">未入力 {incomplete.length} 行</Badge>}
            </div>

            {incomplete.length > 0 && <Alert variant="warning">ドライバー・案件・数量がそろっていない行は保存しません。</Alert>}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                やめる
              </Button>
              <Button onClick={save} disabled={pending || ready.length === 0}>
                {pending ? <Loader2 className="animate-spin" /> : <Check />}
                {ready.length} 件を保存
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
