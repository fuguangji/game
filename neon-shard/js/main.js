/** main — 啟動流程與主迴圈 */
import { GameEvents, bus } from "./core/event-bus.js";
import { G } from "./core/game-state.js";
import { GameStates, fsm } from "./core/state-machine.js";
import { resize } from "./core/viewport.js";
import { GameLoop } from "./core/game-loop.js";
import { apply as applyInterp, restore as restoreInterp, snapshot } from "./core/interpolation.js";
import { platform } from "./core/platform.js";
import { initRenderProfile, onScaleChange, reportFrame } from "./core/render-profile.js";
import { settings } from "./core/settings-store.js";
import { updatePerfOverlay } from "./ui/perf-overlay.js";
import { cx } from "./core/viewport.js";
import { setup } from "./game/battle.js";
import { legend } from "./game/elite.js";
import { update } from "./game/simulation.js";
import { tutorial } from "./game/tutorial.js";
import { applyLO } from "./game/weapons.js";
import { buildHome } from "./ui/menu.js";
import { render, showOv } from "./ui/render.js";
import { init as init_core_viewport } from "./core/viewport.js";
import { init as init_game_elite } from "./game/elite.js";
import { init as init_game_weapons } from "./game/weapons.js";
import { init as init_game_battle } from "./game/battle.js";
import { init as init_game_ultimates } from "./game/ultimates.js";
import { init as init_game_progress } from "./game/progress.js";
import { init as init_game_chips } from "./game/chips.js";
import { init as init_ui_workshop } from "./ui/workshop.js";
import { init as init_game_pickups } from "./game/pickups.js";
import { init as init_ui_menu } from "./ui/menu.js";
import { init as init_ui_hud } from "./ui/hud.js";
import { init as init_ui_aim } from "./ui/aim.js";
import { init as init_game_pathfinding } from "./game/pathfinding.js";
import { init as init_game_boss } from "./game/boss.js";
import { init as init_game_simulation } from "./game/simulation.js";
import { init as init_ui_render } from "./ui/render.js";
import { init as init_core_input } from "./core/input.js";
import { init as init_game_tutorial } from "./game/tutorial.js";
import { init as init_api_extension } from "./api/extension.js";
import "./techniques/index.js"; // 術式武器的內容
import { initTechniques } from "./game/techniques.js";

/**
 * 讓出主執行緒，讓瀏覽器先處理繪製與輸入。啟動工作被切成幾段，每段之間呼叫一次，
 * 避免「模組執行 + 初始化 + 建首頁」連成一個好幾百毫秒的長任務（那會讓頁面卡住、Lighthouse 的 TBT 變高）。
 */
const yieldToMain = () =>
  typeof scheduler !== "undefined" && scheduler.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));

/* 依原本的載入順序，逐一執行各模組的初始化（與單檔時的執行順序相同；順序有相依，不要調換） */
init_core_viewport();
init_game_elite();
init_game_weapons();
init_game_battle();
init_game_ultimates();
initTechniques();
init_game_progress();
init_game_chips();
await yieldToMain(); // ── 第 1 段結束
init_ui_workshop();
init_game_pickups();
init_ui_menu();
init_ui_hud();
init_ui_aim();
init_game_pathfinding();
init_game_boss();
init_game_simulation();
init_ui_render();
init_core_input();
init_game_tutorial();
init_api_extension();
await yieldToMain(); // ── 第 2 段結束

/* ---------- 啟動 ---------- */
platform.init(); // 先決定是手機還是電腦（輸入層、HUD 版面都依此）
initRenderProfile(cx); // 畫質檔位、發光倍率
onScaleChange(resize); // 解析度比例改變 → 重設畫布
resize();
legend();
applyLO();
setup();
await yieldToMain(); // ── 第 3 段結束
buildHome(); // 建大廳 DOM（最重的一步）
fsm.transition("menu");
showOv(0);
G.last = performance.now();

/**
 * 主迴圈：模擬與繪製分離（見 core/game-loop.js）。
 *   - 模擬：固定步長（設定「模擬頻率」，預設 60 Hz），在戰鬥／補給／結算時才前進。
 *   - 繪製：每個 requestAnimationFrame 一次，可限制幀率；戰鬥中以「動態補償」在兩次模擬之間插值。
 */
export const loop = new GameLoop({
  simRate: () => settings.get("simRate"),
  fpsCap: () => settings.get("fpsCap"),
  simulating: () => fsm.state !== "menu" && fsm.state !== "pause",
  idleFps: () => 0, // 選單、暫停：畫面是靜止的（或被不透明介面蓋住），只在進入時畫最後一幀，之後休眠
  beforeStep: snapshot,
  step(stepDt) {
    let dt = stepDt;
    if (fsm.state === "over" || fsm.state === "menu") G.TSt = 0;
    if (G.TSt > 0) { // 打擊停頓／慢動作：縮放「模擬時間」，不影響繪製頻率
      G.TSt -= stepDt;
      dt = stepDt * G.TSv;
      if (G.TSt <= 0) G.TSv = 1;
    }
    update(dt);
    bus.emit(GameEvents.TICK, dt);
  },
  draw(alpha, stepDt) {
    if (settings.get("interpolation")) applyInterp(alpha, stepDt);
    try {
      render();
    } finally {
      restoreInterp(); // 不論繪製有沒有出錯，都要把真實座標換回去
    }
  },
  onFrame(frameMs, drawMs, targetMs) {
    reportFrame(frameMs, drawMs, targetMs);
    updatePerfOverlay(loop.stats, performance.now());
  },
});
loop.start();
// 選單時主迴圈會休眠（不排 requestAnimationFrame）；視窗縮放、狀態切換、任何輸入都會喚醒它
addEventListener("resize", () => loop.invalidate());
for (const s of Object.values(GameStates)) fsm.onEnter(s, () => loop.wake());
for (const t of ["pointerdown", "keydown", "visibilitychange"]) addEventListener(t, () => loop.wake(), { passive: true, capture: true });

tutorial.init();
