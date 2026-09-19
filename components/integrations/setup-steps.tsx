/** 設定手順の折りたたみ（外部連携のカードで共用） */
export function SetupSteps({ title, steps, note }: { title: string; steps: string[]; note?: string }) {
  return (
    <details className="rounded-md border border-dashed p-3">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </details>
  );
}
