/** game/redeem — 兌換碼 */
import { $ } from "../core/viewport.js";
import { STG, SV, save } from "./progress.js";

/* ===== 兌換碼：解密後改寫存檔（金幣 / 碎片 / 晶核 / 關卡進度）===== */
const RK = "2595dfeff027a3760fa9425b0664a2a5";
// 功能：處理「rdHex」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function rdHex(s) {
  const a = new Uint8Array(s.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(s.substr(i * 2, 2), 16);
  return a;
}
// 功能：處理「sha256」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function sha256(m) {
  const P = [];
  for (let c = 2; P.length < 64; c++) {
    let ok = 1;
    for (let d = 2; d * d <= c; d++)
      if (c % d === 0) {
        ok = 0;
        break;
      }
    if (ok) P.push(c);
  }
  const K = P.map((p) => Math.floor((Math.cbrt(p) % 1) * 4294967296)),
    h = P.slice(0, 8).map(
      (p) => Math.floor((Math.sqrt(p) % 1) * 4294967296) | 0,
    );
  const l = m.length,
    n = ((l + 9 + 63) >> 6) << 6,
    b = new Uint8Array(n);
  b.set(m);
  b[l] = 128;
  const dv = new DataView(b.buffer);
  dv.setUint32(n - 4, (l * 8) >>> 0);
  dv.setUint32(n - 8, Math.floor((l * 8) / 4294967296));
  const w = new Uint32Array(64),
    rr = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3),
        s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0],
      b2 = h[1],
      c = h[2],
      d = h[3],
      e = h[4],
      f = h[5],
      g = h[6],
      hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25),
        ch = (e & f) ^ (~e & g),
        t1 = (hh + S1 + ch + K[i] + w[i]) | 0,
        S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22),
        mj = (a & b2) ^ (a & c) ^ (b2 & c),
        t2 = (S0 + mj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b2;
      b2 = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b2) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  const out = new Uint8Array(32),
    ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v >>> 0));
  return out;
}
// 功能：處理「hmac」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function hmac(k, m) {
  const ip = new Uint8Array(64 + m.length),
    op = new Uint8Array(96);
  for (let i = 0; i < 64; i++) {
    const kb = k[i] || 0;
    ip[i] = kb ^ 54;
    op[i] = kb ^ 92;
  }
  ip.set(m, 64);
  op.set(sha256(ip), 64);
  return sha256(op);
}
const RB32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
  rdTxt = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
// 功能：處理「rdB32」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function rdB32(s) {
  let bits = 0,
    v = 0;
  const out = [];
  for (const ch of s) {
    const k = RB32.indexOf(ch);
    if (k < 0) return null;
    v = (v << 5) | k;
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
      v &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}
// 功能：處理「rdDecode」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function rdDecode(code) {
  const s = String(code)
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "");
  if (s.length !== 32) return { e: "格式不正確，請確認有輸入完整的 32 個字元" };
  const b = rdB32(s);
  if (!b || b.length !== 20) return { e: "格式不正確" };
  const nonce = b.slice(0, 2),
    ct = b.slice(2, 15),
    mac = b.slice(15, 20),
    key = rdHex(RK);
  const ks = hmac(key, Uint8Array.from([...rdTxt("NS1K"), ...nonce])),
    pt = Uint8Array.from(ct, (x, i) => x ^ ks[i]);
  const m = hmac(key, Uint8Array.from([...rdTxt("NS1M"), ...nonce, ...pt]));
  let bad = 0;
  for (let i = 0; i < 5; i++) bad |= m[i] ^ mac[i];
  if (bad) return { e: "驗證失敗：這不是有效的兌換碼" };
  const dv = new DataView(pt.buffer);
  return {
    add: !!(pt[0] & 128),
    stages: pt[0] & 127,
    gold: dv.getUint32(1),
    shards: dv.getUint32(5),
    cores: dv.getUint32(9),
    id:
      [...mac].map((x) => x.toString(16).padStart(2, "0")).join("") +
      [...nonce].map((x) => x.toString(16).padStart(2, "0")).join(""),
  };
}
// 功能：處理「redeem」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function redeem(code) {
  const r = rdDecode(code);
  if (r.e) return { ok: false, msg: r.e };
  SV.used = SV.used || [];
  if (r.add && SV.used.includes(r.id))
    return { ok: false, msg: "這組兌換碼已經在這個瀏覽器使用過了" };
  const u = Math.min(r.stages, STG.length);
  if (r.add) {
    SV.coins += r.gold;
    SV.sh += r.shards;
    SV.co += r.cores;
    SV.used.push(r.id);
  } else {
    SV.coins = r.gold;
    SV.sh = r.shards;
    SV.co = r.cores;
  }
  if (u > 0) {
    if (r.add) {
      for (let i = 0; i < u - 1; i++) SV.clr[i] = true;
    } else {
      SV.clr = [];
      for (let i = 0; i < STG.length; i++) SV.clr[i] = i < u - 1;
    }
    if (SV.sel >= u && !r.add) SV.sel = u - 1;
  }
  save();
  if (window.upd) window.upd();
  return {
    ok: true,
    msg:
      (r.add ? "已增加" : "已設定為") +
      "：金幣 " +
      r.gold.toLocaleString() +
      "、碎片 " +
      r.shards.toLocaleString() +
      "、晶核 " +
      r.cores.toLocaleString() +
      (u > 0
        ? "；解鎖關卡 " +
          u +
          " 關（" +
          (r.add ? "取較高者" : "依兌換碼設定") +
          "）"
        : "；關卡進度不變"),
  };
}
// 功能：處理「rdOpen」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function rdOpen() {
  let el = $("rd");
  if (!el) {
    el = document.createElement("div");
    el.id = "rd";
    el.innerHTML =
      '<div class="rdc"><h3>兌換碼</h3><p>輸入禮包代碼，兌換獎勵</p><input id="rdi" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false"><div id="rdm"></div><div class="rdb"><button class="x-btn pri" id="rdo">兌換</button><button class="x-btn" id="rdx">關閉</button></div></div>';
    document.body.append(el);
    const inp = $("rdi"),
      go = () => {
        const r = redeem(inp.value),
          m = $("rdm");
        m.textContent = r.msg;
        m.style.color = r.ok ? "#3dff8f" : "#ff6a8a";
        if (r.ok) inp.value = "";
      };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") go();
    });
    inp.addEventListener("keyup", (e) => e.stopPropagation());
    $("rdo").onclick = go;
    $("rdx").onclick = () => {
      el.style.display = "none";
    };
    el.addEventListener("mousedown", (e) => {
      if (e.target === el) el.style.display = "none";
    });
  }
  el.style.display = "flex";
  $("rdm").textContent = "";
  setTimeout(() => $("rdi").focus(), 50);
}
