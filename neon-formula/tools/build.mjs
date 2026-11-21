#!/usr/bin/env node
/**
 * tools/build.mjs — 產生上線用的壓縮檔（dist/）
 *
 *   npm run build
 *
 * 做了三件事：
 *   1. 把 js/main.js 與它 import 的所有模組打包成單一 dist/app.js（壓縮 + sourcemap）。
 *      原本載入首頁要 90+ 個請求（模組一層一層往下抓），打包後只剩 1 個。
 *   2. 把 css/*.css 合併壓縮成 dist/app.css。
 *   3. 把 index.html 的資源參照改成 dist 版本並加上內容雜湊（?v=…），部署後瀏覽器不會用到舊檔。
 *
 * 開發時直接開 index.dev.html（原始 ES 模組，改了存檔就生效，不用建置）。
 * 需要 esbuild：npm install（devDependencies）。
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

let esbuild;
try { esbuild = await import("esbuild"); }
catch { console.error("找不到 esbuild，請先執行：npm install"); process.exit(1); }

mkdirSync(dist, { recursive: true });

const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);

/**
 * 倉庫根目錄的 account/（共用登入：shared-auth.js、firebase-config.js…）不打包進 dist/app.js，保持外部載入。
 * 原因：
 *   - 那是整個站台共用的檔案（帳號頁 /account/ 也在用），應該只有一份、只由它自己更新；
 *     打包進來會在這台機器建置時「拍下當下的版本」，之後帳號檔改了，遊戲還在用舊的。
 *   - 在沒有真正帳號檔的環境（例如測試機、CI）建置時，不會把替身或殘缺的檔案悄悄寫進線上版。
 * dist/app.js 位在 <站台>/neon-shard/dist/，帳號檔在 <站台>/account/，所以改寫成 ../../account/<檔名>
 * （部署在 /game/ 底下就是 /game/account/…，與 index.dev.html 直接載入原始模組時指到的是同一個檔案）。
 */
const repoRoot = path.resolve(root, "..");
const sharedAccountDir = path.join(repoRoot, "account");
const keepSharedAccountExternal = {
  name: "keep-shared-account-external",
  setup(b) {
    b.onResolve({ filter: /account\/.+\.js$/ }, (args) => {
      if (!args.path.startsWith(".")) return null;
      const abs = path.resolve(args.resolveDir, args.path);
      if (!abs.startsWith(sharedAccountDir + path.sep)) return null; // js/account/ 底下自己的模組照常打包
      return { path: `../../${path.relative(repoRoot, abs).split(path.sep).join("/")}`, external: true };
    });
  },
};

// 1. JavaScript
await esbuild.build({
  entryPoints: [path.join(root, "js/main.js")],
  outfile: path.join(dist, "app.js"),
  bundle: true,
  minify: true,
  sourcemap: "linked",
  format: "esm",
  target: "es2022",
  legalComments: "none",
  logLevel: "warning",
  plugins: [keepSharedAccountExternal],
});

// 2. CSS（保持原本的載入順序）
const cssFiles = ["css/account-features.css", "css/profile.css", "css/ui-kit.css"];
const css = await esbuild.transform(cssFiles.map((f) => readFileSync(path.join(root, f), "utf8")).join("\n"), { loader: "css", minify: true });
writeFileSync(path.join(dist, "app.css"), css.code);

// 3. index.html：由 index.dev.html（開發版，原始模組）產生上線版 index.html
const devPath = path.join(root, "index.dev.html");
if (!existsSync(devPath)) { console.error("缺少 index.dev.html（開發版首頁）"); process.exit(1); }
let html = readFileSync(devPath, "utf8");
const jsV = hash(path.join(dist, "app.js")), cssV = hash(path.join(dist, "app.css"));
html = html.replace(/<link rel="stylesheet" href="css\/account-features\.css[^>]*>\s*<link rel="stylesheet" href="css\/profile\.css[^>]*>\s*<link rel="stylesheet" href="css\/ui-kit\.css[^>]*>/,
  `<link rel="stylesheet" href="dist/app.css?v=${cssV}" />`);
html = html.replace(/<script type="module" src="js\/main\.js"><\/script>[^\n]*/, `<script type="module" src="dist/app.js?v=${jsV}"></script>`);
if (!html.includes("dist/app.js") || !html.includes("dist/app.css")) { console.error("index.dev.html 的資源標籤格式變了，build.mjs 需要跟著更新"); process.exit(1); }
writeFileSync(path.join(root, "index.html"), html);

const kb = (f) => (readFileSync(f).length / 1024).toFixed(1);
console.log(`dist/app.js ${kb(path.join(dist, "app.js"))} KB  dist/app.css ${kb(path.join(dist, "app.css"))} KB  → index.html 已更新（js ${jsV}, css ${cssV}）`);
