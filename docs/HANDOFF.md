# AsPEN 網站 — IT 交接文件

**一頁式參考文件,供 IT 部門理解、備份、鏡像、或接手營運 AsPEN 網站平台使用。**

> 目前系統已完整運作中,並仍在持續開發。主要維護者(蔡相德/Daniel Tsai
> 與邱宏嘉/Hong-Chia Chiu,皆為 NCKU)計畫繼續以 PHD-Center 的 GitHub
> repo 作為「single source of truth」進行迭代開發。**建議模式:IT 保留鏡像/有讀取權以供稽核及備份,
> 主要開發節奏仍由主席掌握。** 若 IT 之後想完全自架或在不同基礎建設
> 上重建,本文件已列出所需的一切。

**最後更新日期:** 2026-05-27。
**正式網址:** https://www.aspensig.asia/ (PHDc 主機 + GitHub Pages 雙部署)
**GH Pages 鏡像:** https://phd-center.github.io/AsPEN/ (仍可用,過渡期保留)
**PHDc NAS:** https://dev.aspensig.asia/ (GitHub Actions 經 WebDAV 同步)

---

## 1 · 一張圖看懂架構

```
                    會員瀏覽器
                          │
                          │  訪問 aspensig.asia
                          ▼
        ┌──────────────────────────────────────────┐
        │  AsPEN 網站 (Astro 5, 靜態)                │
        │  原始碼: PHD-Center/AsPEN  (公開)          │  ← 公開網站
        │  Hosting: GitHub Pages                     │
        │  Build: GitHub Actions (.github/workflows) │
        │  頁面: /, /about, /databases, /publications│
        │       /activities, /contact, /membership,  │
        │       /nhird (台灣健保資料庫生態),         │
        │       /members/* (由下方 Worker 把關存取)   │
        └──────────────────────────────────────────┘
                          │
                          │  /members/* 內的 JS 跨域 fetch
                          ▼
        ┌──────────────────────────────────────────┐
        │  aspen-auth Cloudflare Worker             │
        │  部署在 Cloudflare (非 GitHub Pages)       │  ← 認證 gateway
        │  原始碼: PHD-Center/AsPEN repo 的           │
        │         workers/aspen-auth/                │
        │  URL: aspen-auth.danielhttsai.workers.dev  │
        │  路由: magic-link 登入、session、           │
        │       reading group 狀態、檔案 proxy、       │
        │       admin 操作                           │
        │  Secrets (放在 CF dashboard):              │
        │    · GITHUB_PAT   — 讀寫 aspen-members      │
        │    · JWT_SECRET   — 簽 session cookie       │
        │    · RESEND_API_KEY — 寄 magic-link 信件     │
        └──────────────────────────────────────────┘
                          │
                          │  GitHub REST API
                          ▼
        ┌──────────────────────────────────────────┐
        │  PHD-Center/aspen-members  (私有 repo)    │  ← 會員 + 資料
        │  members.json      — emails、姓名、狀態    │
        │  reading.json      — 讀書會選文、reactions、│
        │                      個人 take、留言        │
        │  suggestions.json  — 待審的論文推薦         │
        │  papers/           — (目前空的)             │
        │  materials/        — protocol、slides、code │
        │  pending/          — 審核中的上傳檔         │
        └──────────────────────────────────────────┘

        ┌──────────────────────────────────────────┐
        │  Resend (獨立第三方)                       │
        │  從 noreply@aspensig.asia 寄出 magic-link  │
        │  (網域驗證完成前先用 sandbox                │
        │  onboarding@resend.dev)                    │
        └──────────────────────────────────────────┘
```

**為什麼是三塊而不是一塊?** 公開網站是靜態的 HTML/CSS/JS bundle(到處都
可以 host)。認證與會員區需要小型 server 元件(Worker),因為靜態主機
無法安全保管 GitHub PAT。私有 repo 等於是個 git-tracked 的資料庫 —
主席可以透過 git history 稽核會員資料與內容的每一次變更。

---

## 2 · 完整清單 · 系統包含的所有東西

| 元件 | URL / 位置 | 公開性 | 擁有者 |
|---|---|---|---|
| 公開網站原始碼 | https://github.com/PHD-Center/AsPEN | 公開 | PHD-Center 組織 |
| 線上公開網站 (GH Pages) | https://phd-center.github.io/AsPEN/ | 公開 | 由上面那包 build 出來 |
| 認證 worker 原始碼 | 上述 repo 內的 `workers/aspen-auth/` | 公開 | (同上) |
| 已部署的 worker | https://aspen-auth.danielhttsai.workers.dev | 公開 endpoint (CORS-gated) | Daniel 的 Cloudflare |
| 私有資料 repo | https://github.com/PHD-Center/aspen-members | **私有** | PHD-Center 組織 |
| Email 寄信服務 | https://resend.com/ — 網域 `aspensig.asia` | 第三方帳號 | Daniel 的 Resend |
| aspensig.asia DNS | (註冊商由 IT 決定) | DNS provider | 待定 |
| GH Pages CI | `.github/workflows/deploy.yml` | 在公開 repo 內 | 每次推 main 自動跑 |
| Worker CI | 無 — 由本機跑 `wrangler deploy` | 手動 | 目前由主席執行 |

### 含有真實個資的檔案
- `PHD-Center/aspen-members/members.json` — 會員 email、姓名、機構、
  可選的 `passwordHash` (PBKDF2-SHA256, 100k iterations)。
- `PHD-Center/aspen-members/reading.json` — 公開的 reactions 與 shared
  takes 對所有會員可見;private take 只有當事人看得到。
- `PHD-Center/aspen-members/pending/**/meta.json` — 每筆待審上傳的上傳者
  email。

凡是有 **aspen-members** repo 存取權的人,都能讀到每一位會員的 email。
Worker 的 GitHub PAT 也可以從 API 讀到這份檔案。

### Secrets — 絕對不要進 git、不要進 chat

| Secret | 位置 | 用途 | 輪替的影響 |
|---|---|---|---|
| `GITHUB_PAT` | Cloudflare Worker secret store | Worker 讀寫 aspen-members repo | 可隨時輪替。Worker 在更新前會失敗。 |
| `JWT_SECRET` | Cloudflare Worker secret store | 簽 session cookie | 輪替會使所有現有 session 失效,所有會員必須重新登入。 |
| `RESEND_API_KEY` | Cloudflare Worker secret store | 寄 magic-link 信件 | 輪替後在更新前無法寄信。 |
| Cloudflare 帳號密碼 / 2FA | Daniel | 擁有 worker + secrets | 失去部署 / 變更 worker 的能力。 |
| Resend 帳號密碼 / 2FA | Daniel | 擁有寄信網域 | 失去寄信 / 變更寄信者的能力。 |
| GitHub 帳號 | Daniel (PHD-Center org admin) | Push 兩個 repo | 失去 commit 權限。 |

### 目前的維運分工

兩位主要維護者皆有**完整最高權限**,可獨立做任何維運動作。
帳號層級擁有權仍在 Daniel(Cloudflare/Resend 註冊在他名下),但操作
權限對等。

| 維護者 | GitHub | Cloudflare | Resend |
|---|---|---|---|
| 蔡相德 Daniel Tsai | PHD-Center org admin · 兩個 repo Admin | 帳號擁有者 · Super Administrator | 帳號擁有者 |
| 邱宏嘉 Hong-Chia Chiu | `yumemi2020` · 兩個 repo Admin | Super Administrator (account member) | Owner/Admin (member) |

意涵:
- **網站更新** — 任一人 push 到 `PHD-Center/AsPEN` main → GitHub Actions
  自動 build + 部署 GitHub Pages。
- **會員資料 / 讀書會內容** — 站內 admin UI 是日常方式(透過 Worker
  寫回 aspen-members repo);也可任一人直接編 `PHD-Center/aspen-members`
  的 JSON 後 push。
- **Worker 更新** — 任一人在本機 `cd workers/aspen-auth && npx wrangler deploy`
  即可,secrets 已存在 Cloudflare 不必重設。
- **Secrets 輪替 / Resend 寄信網域變更 / 加減其他 collaborator** — 兩人
  都可獨立操作,無需另一人協助。

---

## 3 · 給 IT 的三種「擁有」這套系統的方法

### A · 唯讀鏡像 / 備份 (摩擦最少)

目的:IT 持有完整副本以供稽核 / 災難復原,但日常營運不參與。

1. **把兩個 GitHub repo 鏡像到 IT 自己的 Git server:**
   ```bash
   git clone --mirror https://github.com/PHD-Center/AsPEN.git
   git clone --mirror https://github.com/PHD-Center/aspen-members.git
   ```
   定期重做(cron,或在 IT 的鏡像端設 GitHub Actions 讓每次 commit
   都 push 過去)。
2. **把 Cloudflare + Resend 的存取權記錄到 IT 的密碼保險庫**(Daniel
   把帳密分享給 IT admin)。
3. **DNS 不用動。** aspensig.asia DNS 仍指向 GitHub Pages(或其他目的地)。
4. **IT 日常不需要做任何事。** 主席照常 push 到 PHD-Center repos,鏡像
   自動同步。

### B · IT 接手公開網站、開發仍在 PHD-Center (推薦的混合模式)

目的:aspensig.asia 從 IT 的 web server 提供服務(合規 / 「自己的基礎
建設」),但主席仍能在 GitHub 上維持快速開發節奏。

1. 做 A 的全部步驟,再加:
2. 在 PHD-Center/AsPEN 設一個 GitHub Actions job:每次 push 到 main 時
   執行 `npm run build`,然後把 `dist/` 上傳到 IT 的 server(rsync over
   SSH、S3 sync、FTP 都行,看 IT 偏好)。IT 把帳密放進 GitHub secrets。
3. 把 aspensig.asia DNS 指向 IT 的 server。
4. 更新 Cloudflare Worker 的**兩個**環境變數以對應新網域:
   - `SITE_BASE_URL` → `https://aspensig.asia`
   - `ALLOWED_ORIGINS` → `https://aspensig.asia` (給 /members/* fetch
     用的 CORS)
5. Worker、私有 repo、Resend 維持原位。Magic-link 信件 URL 仍正確,
   會員區仍可運作。

網站生命週期:
- 主席推 code → GH Actions build + 部署到 IT server → 上線。
- IT 隨時可拉下來看 / 稽核。

### C · IT 完全接手 (完整遷移)

目的:IT 營運整個 stack,主席交棒退出。

1. 把 GitHub repos 的擁有權轉到 IT 的 org (GitHub Settings → Transfer
   ownership),或讓 IT fork 後把 fork 視為 source of truth。主席失去
   push 權(或保留為 collaborator)。
2. 把 Worker 所在的 Cloudflare 帳號轉給 IT(或讓 IT 從 `workers/aspen-auth/`
   原始碼重建 — code 一樣,帳號跟 URL 改新的)。
3. 同樣轉移 Resend 帳號。
4. 接手後 IT 輪替 `JWT_SECRET`(逼所有會員重新登入,等於是行政交接的
   公開訊號)。
5. IT 更新 Worker secrets、env vars,以及 `src/data/site-config.ts` 內
   的 `WORKER_URL` 以對應新的 Worker URL。
6. DNS 完全屬於 IT。

這條路不重做以上所有步驟就無法回頭。**除非 IT 真的要長期營運這套平台,
否則不建議走這條。**

---

## 4 · 從零重建 runbook (假設既有基礎建設全部消失)

只要有兩個 GitHub repo + 本文件,IT 就能重建整個系統。步驟:

1. **公開網站**:clone PHD-Center/AsPEN,`npm install`,`npm run build`。
   把 `dist/` 部署到任何靜態 host(GH Pages、Cloudflare Pages、Netlify、
   S3 + CloudFront、IT 自己的 Nginx 都行)。
2. **Worker**:clone 同一個 repo,`cd workers/aspen-auth`,
   `npm install`。開一個 Cloudflare 帳號(免費 tier 即可)。
   `wrangler login`。`wrangler secret put GITHUB_PAT`(fine-grained PAT
   scoped 到 aspen-members repo,Contents Read+Write)。
   `wrangler secret put JWT_SECRET`(32 隨機 bytes 的 hex)。
   `wrangler secret put RESEND_API_KEY`(從 Resend dashboard 拿)。
   修改 `wrangler.toml` 內對應新網域的 env vars。`wrangler deploy`。
3. **私有資料 repo**:PHD-Center/aspen-members 任何有讀權的人都能
   clone。需要的話在 IT 的 git server 重建,把 `members.json` 等 JSON
   檔搬過去。
4. **Resend**:在 resend.com 註冊,驗證寄信網域(DNS 紀錄:SPF、DKIM、
   MX、DMARC — Resend dashboard 會給確切的值)。產生 API key,push 成
   Worker secret。
5. **接線**:用新的 Worker URL 更新 `src/data/site-config.ts`,rebuild
   網站,部署。
6. **Smoke test**:打開 `/members/login`,用主席的 email 索取
   magic-link,點 link,確認 dashboard 可載入。

總時間:假設帳號都有、DNS 可控,大約 2-4 小時。

---

## 5 · 主席接下來的開發計畫

- 未來所有 commit 推到 **PHD-Center/AsPEN** main branch。
- GH Pages 自動部署(或在 B 方案下,IT 的 CI 接收 build 出來的成品)。
- IT 的鏡像應定期 pull(cron,或 GitHub webhook → IT 的 repo)。
- Worker 更新:主席從本機 `workers/aspen-auth/` 跑 `wrangler deploy`。
  IT 不需要同步重新部署 — Worker 只在 endpoint 有變更時才動。
- 新增會員 / 讀書會選文 / 內容審核:由主席 (+ admin 會員)透過站內 admin
  UI 完成,經 Worker 寫回 aspen-members repo。不需要 IT 介入。

## 6 · 聯絡人

主要維護者:
- 蔡相德 Daniel Tsai (danielhttsai@gmail.com),NCKU
- 邱宏嘉 Hong-Chia Chiu (yumemi@hourcenter.org.tw),NCKU

主席:Ju-Young Shin,SKKU/SNU。
