# Harbor 私人工作空間

單一工作空間，供台灣／菲律賓內部夥伴使用。沒有公開註冊、伺服器切換或語音功能。支援繁體中文與 Filipino（Tagalog）；登入頁、側欄與設定可切換語言，偏好儲存在目前瀏覽器。首次使用若瀏覽器偏好 Filipino／Tagalog，會自動選擇 Filipino。訊息、姓名、類別與頻道名稱保留使用者原文，不提供自動翻譯。React + Vite 產生可部署的 HTML/CSS/JS，Supabase 提供 Auth、Postgres、Realtime、私有 Storage 與 Edge Functions。

## 本機啟動

需要 Node.js 22.12 以上（目前以 Node 24 測試）。

```powershell
npm install
npm run dev
```

開啟 http://127.0.0.1:5173 。沒有 `.env.local` 時為本機示範，資料只存在此瀏覽器。可從「設定」切換示範角色。示範建立帳號不保存密碼，也不能用於正式登入。不要把示範模式用來存正式資料。

## 已實作

- 管理員建立類別、文字頻道。使用者／打手只有獲授權的類別；子頻道繼承。
- Email + 密碼登入，管理員透過伺服器端 API 建立帳號。
- 文字聊天（4000 字上限）、Enter 傳送、Shift+Enter 換行，支援中文輸入法。
- JPG/PNG/WebP 上傳或剪貼簿貼上。先壓縮為 WebP（最大 1600×1200、80% 品質），再顯示最大 1000×600 等比預覽，確認才上傳。原圖最多 20 MB，壓縮結果最多 3 MB。
- 正式訊息每次載入 40 筆，可往前載入。Realtime 接收新增訊息，分頻道未讀數、提示音開關。
- 圖片延遲載入、私有儲存桶、5 分鐘短效網址。關閉網站後不會播放聲音；首次互動後瀏覽器才允許聲音，手機背景執行可能被作業系統暫停。
- Discord Webhook 伺服器端傳送通用通知，避免跨類別洩露聊天文字與圖片。Webhook 不出現在瀏覽器。

## Supabase 設定（需要專案擁有者登入）

1. 在 Supabase Dashboard 建立專案。**Auth → Providers / Sign In 設定關閉 Allow new users to sign up**，停用匿名登入。網站本身沒有註冊入口，關閉服務端註冊也可阻止直接呼叫 API 註冊。
2. 在 SQL Editor 執行 `supabase/migrations/001_harbor.sql`（全新專案只執行一次）。這會建立資料表、索引、RLS、Storage 規則、預設頻道與 Realtime publication。
3. 在 Auth → Users 建立第一位管理員，取得其 UUID，再執行以下 SQL，替換 UUID 與名稱：

```sql
insert into public.profiles(id,name,role)
values ('YOUR_AUTH_USER_UUID','你的名稱','admin');
```

4. 將 `.env.example` 複製為 `.env.local`，填入 Project URL 與 anon key（或 publishable key），不要放 service_role / secret key。重新啟動 Vite。正式建置也必須在建置前設定這兩個環境變數。
5. 以 Supabase CLI 登入並連接專案，部署兩個函式。命令中的 PROJECT_REF 為專案 ID：

```powershell
npx supabase login
npx supabase link --project-ref PROJECT_REF
npx supabase functions deploy admin-users --no-verify-jwt
npx supabase functions deploy notify --no-verify-jwt
```

這兩個函式會自行以 `auth.getUser(accessToken)` 驗證使用者；admin-users 另外查詢資料庫管理員角色。`--no-verify-jwt` 只停用閘道的舊式 JWT 驗證，並非允許未登入呼叫業務操作，可支援新式 signing keys。

6. 在 Edge Functions → Secrets 設定：

| 名稱                | 內容                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| APP_ORIGIN          | 網站完整 origin，例如 https://chat.example.com；本機測試則為 http://127.0.0.1:5173 |
| DISCORD_WEBHOOK_URL | Discord 頻道的完整 Webhook URL，僅填在 Secrets                                     |

`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 為 Supabase 函式執行環境提供的變數，不能放進前端 `.env.local` 或聊天室。

7. 以管理員登入，在「設定 → 成員、權限與通知串接」建立 Email 帳號、至少 12 字元密碼並勾選類別。初始密碼請透過可信任的私下管道交付；此版密碼重設由管理員在 Supabase Dashboard 處理。
8. 在 Supabase Auth URL Configuration 設定正式 Site URL。上線後用管理員、使用者、打手三個真實帳號驗證各自可見的類別、私有圖片、Realtime 與 Webhook。

## 部署與網域

### Vercel

1. 在 Vercel 的 New Project 匯入 `mkiitw123456/PHPWeb`，Framework 選 Vite。`vercel.json` 已設定建置命令 `npm run build` 與輸出目錄 `dist`。
2. 正式上線前在 Environment Variables 填入 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。前端僅使用 anon／publishable key，不得使用 service_role／secret key。
3. Deploy 後取得 HTTPS 網址，在 Supabase Auth 設定 Site URL，並把 Edge Functions 的 `APP_ORIGIN` 更新成相同 origin。綁定自訂網域後也要更新這兩處設定。
4. 若暫時未設定 Supabase 環境變數，部署結果是清楚標示的本機示範模式，無法提供正式多人聊天。Vercel 環境變數變更後需要重新部署。

### 其他靜態主機

```powershell
npm run build
```

將 `dist` 內容部署到支援 HTTPS 的靜態網站主機，綁定你的網域。亦可放在現有 Apache/Nginx/PHP 主機的網站根目錄，不需 PHP 程式。請勿把原始碼目錄當成 public root。此版預設部署於網域根路徑。

網域尚未購買不影響本機開發。網站網址可以被知道，但正式內容必须登入並通過 RLS 才能存取。單純隱藏網址不是權限保護。

## 流量與第一版界線

- 圖片上傳前即縮圖、WebP，僅儲存壓縮後版本；不另外保存原圖。避免每次載入整段聊天，歷史每頁 40 筆。已開啟頁面保留的歷史訊息不會重複抓取。
- 權限／類別資料每 30 秒同步一次、頁面重新聚焦時同步；訊息走 Realtime。RLS 在伺服器立即生效，已下載到瀏覽器的內容無法收回；已簽發的圖片網址最長仍有效 5 分鐘。
- Webhook 目前由傳訊息後呼叫 Edge Function，採 delivery claim 防止重複發送；不是可靠訊息佇列。網路中斷、Discord rate limit 或函式失敗會提示，不自動重送。需要保證送達時，下一版應改資料庫 outbox + 排程重試。
- 提示音不是 Push Notification，不承諾關閉分頁仍有提示。
- 第一版未提供刪除／編輯訊息、刪除類別、停權 UI、搜尋、檔案附件（僅圖片）；帳號停權／重設可在 Supabase 管理。介面支援繁體中文和 Filipino，但不翻譯成員的聊天內容。
- 費用取決於圖片數量、尺寸、讀取次數與同時在線人数，未連接專案前不保證免費額度足夠。先以小團隊測試並從 Dashboard 監控儲存、傳出流量與 Realtime 使用量。

## 驗證

`npm run build` 做 TypeScript 與 production build；`npm test` 在本機 PostgreSQL 相容 PGlite 中建立最小 Supabase schema 模擬，執行真實 migration 並驗證 RLS。它不取代雲端 Auth、Storage、Realtime、Edge Functions 整合測試。

設計概念為 `design/concept.png`。原概念中的多伺服器／裝飾性成員、搜尋與附件樣式已依使用者的單一私人空間、純文字／圖片需求移除或調整。

參考：

- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://supabase.com/docs/reference/javascript/auth-admin-createuser
- https://supabase.com/docs/guides/functions/auth-legacy-jwt
