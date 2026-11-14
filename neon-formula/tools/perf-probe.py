# 模擬手機（CPU 降速 4 倍、慢速 4G）量測首屏載入：FCP、LCP、TBT、CLS、請求數。
# 用法：python3 tools/perf-probe.py . index.html   （需要 pip install playwright && playwright install chromium）
# 這只是 Lighthouse 的近似；正式分數請用 Chrome DevTools 的 Lighthouse。
import sys, json, time, subprocess, os, signal
from playwright.sync_api import sync_playwright

root = sys.argv[1]; page_name = sys.argv[2] if len(sys.argv) > 2 else "index.html"
port = int(sys.argv[3]) if len(sys.argv) > 3 else 8123
srv = subprocess.Popen(["python3", "-m", "http.server", str(port), "--directory", root], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
INIT = """
window.__m = {lt: [], lcp: null, fcp: null, cls: 0, errs: []};
new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.lt.push([e.startTime, e.duration]); }).observe({type:'longtask', buffered:true});
new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.lcp = {t:e.startTime, tag:e.element && e.element.tagName, id:e.element && e.element.id, size:e.size}; }).observe({type:'largest-contentful-paint', buffered:true});
new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name==='first-contentful-paint') window.__m.fcp = e.startTime; }).observe({type:'paint', buffered:true});
new PerformanceObserver(l => { for (const e of l.getEntries()) if(!e.hadRecentInput) window.__m.cls += e.value; }).observe({type:'layout-shift', buffered:true});
window.addEventListener('error', e => window.__m.errs.push(String(e.message)));
"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        ctx = b.new_context(viewport={"width":412,"height":823}, device_scale_factor=2.625, is_mobile=True, has_touch=True,
            user_agent="Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36")
        pg = ctx.new_page()
        cdp = ctx.new_cdp_session(pg)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150, "downloadThroughput": 1.6*1024*1024/8, "uploadThroughput": 750*1024/8})
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        pg.add_init_script(INIT)
        reqs = []; cons = []
        pg.on("request", lambda r: reqs.append(r.url))
        pg.on("console", lambda m: cons.append((m.type, m.text)) if m.type in ("error","warning") else None)
        pg.on("pageerror", lambda e: cons.append(("pageerror", str(e))))
        pg.on("response", lambda r: cons.append(("http"+str(r.status), r.url)) if r.status >= 400 else None)
        t0 = time.time()
        pg.goto(f"http://localhost:{port}/{page_name}", wait_until="load")
        pg.wait_for_timeout(6000)
        m = pg.evaluate("window.__m")
        fcp = m["fcp"] or 0
        tbt = sum(max(0, d-50) for s, d in m["lt"] if s >= fcp)
        print(json.dumps({"fcp": round(fcp), "lcp": m["lcp"], "tbt_ms": round(tbt), "longtasks": len(m["lt"]), "maxLT": round(max([d for s,d in m["lt"]] or [0])), "cls": round(m["cls"],4), "requests": len(reqs), "problems": cons[:8]}, ensure_ascii=False, indent=1))
        b.close()
finally:
    srv.terminate()
