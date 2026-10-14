/** main — 啟動流程與主迴圈 */
import { GameEvents, bus } from "./core/event-bus.js";
import { G } from "./core/game-state.js";
import { fsm } from "./core/state-machine.js";
import { resize } from "./core/viewport.js";
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

/* 依原本的載入順序，逐一執行各模組的初始化（與單檔時的執行順序相同） */
init_core_viewport();
init_game_elite();
init_game_weapons();
init_game_battle();
init_game_ultimates();
init_game_progress();
init_game_chips();
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


/* ---------- 啟動 ---------- */
resize();
legend();
buildHome();
applyLO();
setup();
fsm.transition("menu");
showOv(0);
G.last = performance.now();
// 主迴圈：計算 dt、更新、繪製、排下一幀
export function loop(n) {
  const rd = Math.min(0.033, (n - G.last) / 1000);
  G.last = n;
  let dt = rd;
  if (fsm.state === "over" || fsm.state === "menu") G.TSt = 0;
  if (G.TSt > 0) {
    G.TSt -= rd;
    dt = rd * G.TSv;
    if (G.TSt <= 0) G.TSv = 1;
  }
  if (fsm.state !== "menu" && fsm.state !== "pause") {
    update(dt);
    bus.emit(GameEvents.TICK, dt);
  }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

tutorial.init();
