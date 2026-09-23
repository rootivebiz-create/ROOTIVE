// ライセンスの署名に使う鍵の組を作る。1 回だけ実行し、出てきた 2 行を Vercel の環境変数に入れる。
// 秘密鍵（LICENSE_PRIVATE_KEY）は誰にも見せない・Git に入れない。作り直すと発行済みのライセンスが全部使えなくなる。
const { subtle } = globalThis.crypto;
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const b64 = (buf) => Buffer.from(buf).toString("base64");
console.log(`LICENSE_PRIVATE_KEY=${b64(await subtle.exportKey("pkcs8", pair.privateKey))}`);
console.log(`NEXT_PUBLIC_LICENSE_PUBLIC_KEY=${b64(await subtle.exportKey("spki", pair.publicKey))}`);
