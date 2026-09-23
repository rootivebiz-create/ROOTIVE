"use client";

/**
 * 元請のご担当者への「確認のお願い」を作る。差を選ぶと文面が変わる。
 * 文面はそのまま直せる。コピー・メールソフトで開く・選んだ差を「問い合わせ済み」にする、までをここで。
 */
import { useActionState, useMemo, useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { markAskedAction } from "~/app/(app)/reconcile/actions";
import { Badge } from "~/components/page";
import { DiffAmount, FormMessage } from "~/components/reconcile/bits";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, type ItemStatus } from "~/server/features/reconcile/labels";
import { buildLetter, mailtoHref, type LetterItem } from "~/server/features/reconcile/letter";

export type ComposerItem = LetterItem & { status: ItemStatus };

export function LetterComposer({
  noticeId,
  month,
  clientName,
  companyName,
  senderName,
  items,
  canEdit,
}: {
  noticeId: string;
  month: string;
  clientName: string;
  companyName: string;
  senderName: string;
  items: ComposerItem[];
  canEdit: boolean;
}) {
  // 最初は「未対応」で、受け取りが少ない可能性のある差を選んでおく
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.filter((i) => i.status === "open" && i.diff < 0).map((i) => i.id)));
  const [contact, setContact] = useState("ご担当者様");
  const [sender, setSender] = useState(senderName);
  const [to, setTo] = useState("");
  const [offerRecords, setOfferRecords] = useState(true);
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState(markAskedAction, undefined);

  const chosen = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const letter = useMemo(
    () => buildLetter({ clientName, contactName: contact, companyName, senderName: sender, month, items: chosen, offerRecords }),
    [clientName, contact, companyName, sender, month, chosen, offerRecords],
  );
  const body = edited ?? letter.body;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setEdited(null);
  };

  const copy = async () => {
    const text = `件名：${letter.subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 古いブラウザ：文面を選んだ状態にして、手でコピーしてもらう
      const el = document.getElementById("letter-body") as HTMLTextAreaElement | null;
      el?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  const askable = chosen.filter((i) => i.status === "open");

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="font-bold">1. 書く差を選ぶ</h2>
        <p className="mt-1 text-sm text-muted-foreground">はじめは「未対応」で受け取りが少ない可能性のある差を選んでいます。</p>
        <ul className="mt-3 space-y-2">
          {items.map((it) => (
            <li key={it.id}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted">
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={selected.has(it.id)} onChange={() => toggle(it.id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold">{it.label}</span>
                    <Badge tone="gray">{KIND_LABEL[it.kind]}</Badge>
                    <Badge tone={STATUS_TONE[it.status]}>{STATUS_LABEL[it.status]}</Badge>
                  </span>
                </span>
                <DiffAmount value={it.diff} />
              </label>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="font-bold">2. 宛名と差出人</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="宛名" hint="例：経理部 山田様">
            <Input value={contact} onChange={(e) => (setContact(e.target.value), setEdited(null))} />
          </Field>
          <Field label="差出人（お名前）">
            <Input value={sender} onChange={(e) => (setSender(e.target.value), setEdited(null))} />
          </Field>
          <Field label="送り先のメールアドレス（任意）" hint="入れると「メールソフトで開く」で宛先に入ります">
            <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />
          </Field>
          <label className="flex min-h-11 items-center gap-3 self-end text-sm">
            <input type="checkbox" className="h-5 w-5" checked={offerRecords} onChange={(e) => (setOfferRecords(e.target.checked), setEdited(null))} />
            日ごとの記録をお送りできる旨を添える
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="font-bold">3. 文面を確かめて送る</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          文面はここで直せます（差の選び方や宛名を変えると、作り直します）。送る前に、数字が当社の記録と合っているか確かめてください。
        </p>
        <Field label="件名">
          <Input readOnly value={letter.subject} />
        </Field>
        <label className="mt-3 block">
          <span className="block text-sm font-bold">本文</span>
          <textarea
            id="letter-body"
            className="mt-1 block min-h-[24rem] w-full rounded-lg border border-border bg-card p-3 text-base leading-relaxed text-foreground focus:border-foreground"
            value={body}
            onChange={(e) => setEdited(e.target.value)}
          />
        </label>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" onClick={copy}>
            {copied ? "コピーしました" : "件名と本文をコピー"}
          </Button>
          <a
            href={mailtoHref(to, letter.subject, body)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold text-foreground no-underline hover:bg-muted"
          >
            メールソフトで開く
          </a>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">しめ日ラボからはメールを送りません。コピーするか、お使いのメールソフトで送ってください。</p>
        {body.length > 1500 && (
          <p className="mt-1 text-xs text-warning">文面が長いため、メールソフトによっては途中までしか入らないことがあります。そのときは「コピー」を使って貼り付けてください。</p>
        )}
      </Card>

      {canEdit && (
        <Card>
          <h2 className="font-bold">4. 送ったら「問い合わせ済み」にする</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            選んだ差のうち「未対応」の {askable.length}件 を「問い合わせ済み」にします。返事が来たら、結果の画面で「解決」か「この金額で了承」にしてください。
          </p>
          <form action={action} className="mt-3 space-y-2">
            <input type="hidden" name="noticeId" value={noticeId} />
            {askable.map((i) => (
              <input key={i.id} type="hidden" name="itemIds" value={i.id} />
            ))}
            <Button type="submit" variant="secondary" disabled={pending || askable.length === 0}>
              {pending ? "保存中…" : `${askable.length}件を「問い合わせ済み」にする`}
            </Button>
            <FormMessage state={state} />
          </form>
        </Card>
      )}
    </div>
  );
}
