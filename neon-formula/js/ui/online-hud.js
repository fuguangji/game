/**
 * ui/online-hud — 線上對戰的畫面介面（DOM，疊在遊戲畫面上）
 *   - 上方資訊條：競爭模式顯示剩餘時間／存活人數／我的分數；合作模式顯示隊友與血量
 *   - 結算面板：勝負、排名、貢獻；「回到大廳」
 *   - 暫停鍵：線上對戰不能凍結，改成詢問是否離開
 * 只在第一次進入對戰時才建立 DOM；對戰結束後隱藏。
 */
import { h } from "../core/dom-utils.js";
import { onlineState } from "../game/online-state.js";
import { confirmDialog } from "./feedback.js";

const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** @param {import('../game/online-match.js').OnlineMatch} match */
export function mountOnlineHud(match) {
  const strip = h("div", { id: "olStrip", class: "ol-strip", hidden: true, "aria-live": "off" });
  const panel = h("div", { id: "olEnd", class: "ol-end", hidden: true, role: "dialog", "aria-modal": "true", "aria-label": "對戰結算" });
  document.body.append(strip, panel);

  const nameOf = (id) => match.state.players.find((p) => p.id === id)?.name ?? "?";

  function renderStrip() {
    const s = match.state;
    const show = onlineState.active && s.status !== "idle";
    strip.hidden = !show;
    if (!show) return;
    const me = s.players.find((p) => p.id === match.myId);
    if (onlineState.pvp) {
      const alive = s.players.filter((p) => p.alive !== false).length;
      const left = s.endsAt ? Math.max(0, s.endsAt - Date.now()) : 0;
      strip.textContent = `競爭模式 · ${s.endsAt ? `剩 ${fmtTime(left)} · ` : ""}存活 ${alive}/${s.players.length} · 我的分數 ${Math.round(me?.score ?? 0)}`;
    } else {
      const mates = [...match.ghosts.values()].map((g) => `${g.name} ${g.alive ? `${Math.round(g.hp ?? 0)}%` : "倒下"}`);
      strip.textContent = `合作模式 · Boss ${Math.round((s.bossHp / s.bossPool) * 100)}%${mates.length ? ` · 隊友：${mates.join("、")}` : ""}`;
    }
  }

  function renderEnd() {
    const s = match.state;
    const show = onlineState.active && s.status === "ended";
    panel.hidden = !show;
    if (!show) return;
    const r = s.result;
    const mine = r?.scores?.find((x) => x.id === match.myId);
    const won = r ? (r.mode === "boss" ? r.victory : r.winnerId === match.myId) : false;
    const title = !r ? "連線中斷" : r.mode === "boss" ? (r.victory ? "討伐成功！" : "討伐失敗") : won ? "你獲勝了！" : `${nameOf(r.winnerId)} 獲勝`;
    const rows = (r?.scores ?? []).map((x, i) => h("li", { class: x.id === match.myId ? "me" : "" },
      h("span", {}, `${i + 1}. ${x.name}`),
      h("span", {}, r.mode === "boss" ? `貢獻 ${x.score}` : `擊倒 ${x.kills} · 分數 ${x.score}`),
    ));
    panel.replaceChildren(h("div", { class: "ol-card" },
      h("h2", {}, title),
      s.message ? h("p", { class: "ol-note" }, s.message) : "",
      rows.length ? h("ol", { class: "ol-scores" }, ...rows) : "",
      mine ? h("p", { class: "ol-note" }, r.mode === "boss" ? `你的貢獻：${mine.score}` : `你的分數：${mine.score}`) : "",
      h("button", { type: "button", class: "ol-btn", onclick: () => match.returnToLobby() }, "回到大廳"),
    ));
  }

  const render = () => { renderStrip(); renderEnd(); };
  match.addEventListener("change", render);
  match.addEventListener("hud", renderStrip);
  match.addEventListener("leave-request", async () => {
    if (match.state.status === "ended") return;
    const ok = await confirmDialog({ title: "離開對戰？", body: "對戰不會暫停；離開後會中斷連線，這一場的成績不會保留。", confirmText: "離開", cancelText: "繼續戰鬥", danger: true });
    if (ok && onlineState.active) match.disconnect();
  });
  render();
}
