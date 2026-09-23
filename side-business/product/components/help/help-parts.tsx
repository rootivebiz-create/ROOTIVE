import Link from "next/link";
import type { ReactNode } from "react";
import { roleAtLeast, type Role } from "~/server/auth";
import type { HelpLink, SupportContact } from "./content";

/** ヘルプの小さな部品（読むだけ。JavaScript が無くても動く） */

/** 役割で開ける画面にだけリンクを付ける（開けない画面は名前だけ） */
export function HelpLinks({ links, role }: { links: HelpLink[]; role: Role }) {
  if (!links.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 text-sm">
      {links.map((l) =>
        roleAtLeast(role, l.need) ? (
          <li key={l.href}>
            <Link href={l.href} className="inline-flex min-h-11 items-center font-bold">
              {l.label} →
            </Link>
          </li>
        ) : (
          <li key={l.href} className="inline-flex min-h-11 items-center text-muted-foreground">
            {l.label}（{l.need === "owner" ? "オーナー" : "事務・オーナー"}が使います）
          </li>
        ),
      )}
    </ul>
  );
}

/** 見出しつきのまとまり（ページ内のリンクで飛べる） */
export function HelpSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-3">
      <h2 id={`${id}-title`} className="text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** 開いて読む質問（押せる所を広く） */
export function FaqItem({ id, q, children }: { id: string; q: string; children: ReactNode }) {
  return (
    <details id={id} className="group rounded-lg border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 font-bold">
        <span>{q}</span>
        <span aria-hidden className="text-muted-foreground transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-2 border-t border-border p-3 text-sm">{children}</div>
    </details>
  );
}

/** 困ったときの連絡先 */
export function SupportCard({ contact }: { contact: SupportContact }) {
  const any = contact.email || contact.lineUrl;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
      {any ? (
        <>
          <p>使い方で分からないこと・動きがおかしいときは、こちらへご連絡ください。</p>
          <ul className="space-y-1">
            {contact.email && (
              <li>
                メール：{" "}
                <a href={`mailto:${contact.email}`} className="inline-flex min-h-11 items-center break-all font-bold">
                  {contact.email}
                </a>
              </li>
            )}
            {contact.lineUrl && (
              <li>
                LINE：{" "}
                <a href={contact.lineUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-bold">
                  LINE で問い合わせる
                  <span className="sr-only">（別のタブで開きます）</span>
                </a>
              </li>
            )}
          </ul>
        </>
      ) : (
        <p className="font-bold">{contact.fallback}</p>
      )}
      <p className="text-muted-foreground">
        連絡のときは、会社名・画面の名前・何をしたら何が出たかを書いてください。画面の写真を送るときは、口座番号など人に見せたくないところを隠してください。
      </p>
    </div>
  );
}
