// 測試用載入器：把 https://www.gstatic.com/firebasejs/*/firebase-*.js 換成讀取 globalThis.__fb 的假模組
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("https://www.gstatic.com/firebasejs/")) return { url: specifier, shortCircuit: true, format: "module" };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith("https://www.gstatic.com/firebasejs/")) {
    const part = /firebase-(app|auth|database)\.js/.exec(url)?.[1];
    const names = { app: ["initializeApp", "getApps"], auth: ["getAuth", "signInAnonymously"], database: ["getDatabase", "ref", "get", "set", "update", "remove", "push", "runTransaction", "onValue", "onChildAdded", "onDisconnect"] }[part];
    return { format: "module", shortCircuit: true, source: names.map((n) => `export const ${n} = (...a) => globalThis.__fb.${n}(...a);`).join("\n") };
  }
  return next(url, context);
}
