/**
 * 音声認識（Web Speech API）の薄い包み。
 *
 * ブラウザによって名前が違い（`SpeechRecognition` / `webkitSpeechRecognition`）、
 * 対応していない端末もあるため、**使えるかどうかを必ず確かめてから**使う。
 * 使えないときは画面で文字入力に切り替える（機能そのものは無くならない）。
 *
 * 音声は端末（またはブラウザの提供元）で文字にされる。
 * このアプリは **文字になった結果しか受け取らない**（音声は保存も送信もしない）。
 */

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  0: SpeechAlternative;
  isFinal: boolean;
  length: number;
}
interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechErrorEvent {
  error?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** この端末で音声認識が使えるか */
export function isSpeechSupported(): boolean {
  return ctor() != null;
}

/** 音声認識のエラーを日本語にする */
export function speechErrorMessage(code: string | undefined): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "マイクの使用が許可されていません。ブラウザの設定で許可してください。";
    case "no-speech":
      return "声が聞き取れませんでした。もう一度お試しください。";
    case "audio-capture":
      return "マイクが見つかりません。端末の設定を確認してください。";
    case "network":
      return "通信できませんでした。電波の良い場所でお試しください。";
    case "aborted":
      return "";
    default:
      return "音声を聞き取れませんでした。文字で入力してください。";
  }
}

export interface VoiceRecognizerOptions {
  /** 確定した文字（話し終わるたびに呼ばれる） */
  onFinal: (text: string) => void;
  /** 認識中の文字（まだ確定していない） */
  onInterim?: (text: string) => void;
  /** 止まったとき（自分で止めた場合も含む） */
  onEnd?: () => void;
  /** エラー（日本語の文言。空文字なら黙って止める） */
  onError?: (message: string) => void;
}

export interface VoiceRecognizer {
  start(): void;
  stop(): void;
}

/** 音声認識を作る（使えない端末では null） */
export function createRecognizer(opts: VoiceRecognizerOptions): VoiceRecognizer | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  let rec: SpeechRecognitionLike | null = null;
  return {
    start() {
      try {
        rec = new Ctor();
      } catch {
        opts.onError?.("音声認識を開始できませんでした。文字で入力してください。");
        return;
      }
      rec.lang = "ja-JP";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const r = e.results[i];
          const text = r[0]?.transcript ?? "";
          if (r.isFinal) opts.onFinal(text);
          else interim += text;
        }
        opts.onInterim?.(interim);
      };
      rec.onerror = (e) => {
        const message = speechErrorMessage(e.error);
        if (message) opts.onError?.(message);
      };
      rec.onend = () => {
        rec = null;
        opts.onEnd?.();
      };
      try {
        rec.start();
      } catch {
        // 既に動いているときは何もしない
      }
    },
    stop() {
      try {
        rec?.stop();
      } catch {
        /* 何もしない */
      }
    },
  };
}
