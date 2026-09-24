# Harbor 私人工作空間

台灣／菲律賓內部團隊的單一聊天室。繁體中文與 Filipino（Tagalog）介面；訊息、類別及姓名保留原文。React + Vite 部署 Vercel，Firebase Authentication 管理登入，Firestore 儲存文字／權限並推送訊息，Google Drive 儲存圖片。不使用 Firebase Storage、Firebase Functions 或 Supabase。

## 功能與資料流

- 管理員建立使用者／打手帳號及類別權限，頻道繼承類別權限。沒有公開註冊頁。只有後端建立的 profiles 可使用聊天室，自行呼叫 Firebase 註冊 API 取得的 Auth 帳號不會取得工作空間權限。
- 每則文字最多 4000 字；歷史每頁 40 則，Firestore 監聽可見頻道。提示音可關閉，瀏覽器需要先有使用者互動；關閉網頁不會提示。
- 貼上／選取 JPG、PNG、WebP，先壓縮 WebP（最大 1600×1200、品質 80%、最多 3 MiB），顯示最大 1000×600 等比例預覽，確認才上傳。僅保存壓縮版，原始輸入最多 20 MiB。
- Vercel API 驗證 Firebase ID token 和類別權限才上傳／讀取 Google Drive 私人資料夾。Drive 檔案 ID 不傳給瀏覽器，OAuth refresh token 在 Firestore 使用 AES-256-GCM 加密。
- 圖片捲入畫面後下載，使用當前頁面 blob URL，不建立公開分享連結。Google Drive 容量與 Vercel 傳輸／函式額度分開計算。
- Discord Webhook 由後端送出通用通知與网站連結，不帶私密文字／圖片。通知失敗不會讓已保存訊息消失。
- 正式建置缺少 Firebase 設定時顯示「工作空間尚未啟用」，不會自動進入示範管理員。

登入只需帳號＋密碼，帳號 3–32 字元（英文字母、數字、底線），不分大小寫。前後端使用相同的內部地址映射交給 Firebase 驗證，密碼不寫在前端或儲存庫。首位管理員初始化命令會把指定 UID 對應到 Ricky。

## 專案與 Firebase 設定

Firebase project：`harbor-9d3bc`；Firestore Standard、`(default)`、新加坡 `asia-southeast1`。Vercel：`https://php-web-tan.vercel.app`。以下設定實際完成後才能多人使用，儲存庫沒有正式憑證，也不自動建立正式管理員。

1. Firebase Console → Authentication → Sign-in method，啟用 Email/Password，Email link 和匿名登入保持關閉。
2. Authentication → Settings → Authorized domains，加入 `php-web-tan.vercel.app`，之後使用自訂網域時同步新增。
3. Firestore 以正式模式建立，部署本儲存庫規則，不要開放全體讀寫：

```powershell
npx firebase login
npx firebase deploy --only firestore:rules,firestore:indexes --project harbor-9d3bc
```

4. Project settings → Your apps → Harbor Web，取得四個前端設定，填到 `.env.local`／Vercel Environment Variables（下表）。Web API key 是公開前端設定，資料保護由規則和後端驗證提供。
5. Project settings → Service accounts 取得本專案後端 service account JSON，存為 Vercel 伺服器端 `FIREBASE_SERVICE_ACCOUNT_JSON`。此憑證可管理 Auth／資料庫，不能加 VITE_、不能貼聊天或提交 Git。可使用只授予 Firebase Authentication Admin 與 Cloud Datastore User 的專用服務帳戶，避免授予 Google Cloud Owner。
6. Authentication → Users，由擁有者親自建立第一個 Firebase 驗證帳號（可以使用內部識別地址 ricky@login.harbor.invalid，不需真實信箱）。取得 UID 後，本機 `.env.local` 設定服務憑證並執行：

```powershell
npm run bootstrap -- YOUR_AUTH_UID Ricky
```

命令只允許首次執行，建立首位管理員與初始類別／頻道；没有公開管理員初始化 API。後續帳號從網站管理面板建立，密碼至少 8 字元。

## Google Drive 設定

使用具有 Google One 空間的 Google 帳戶授權（可以與 Firebase 專案擁有者是不同帳號），圖片屬於該帳戶 My Drive；Firebase service account 不持有圖片。

1. Google Cloud Console 選 `harbor-9d3bc`，啟用 Google Drive API。
2. 設定 Google Auth Platform 的 OAuth consent screen（外部使用者）。只需 `https://www.googleapis.com/auth/drive.file` 範圍，存取本應用程式建立／獲授權的檔案，不需完整 Drive 範圍。
3. 建立 Web application OAuth client，Authorized redirect URI 完全等於：

```text
https://php-web-tan.vercel.app/api/workspace?action=drive-callback
```

4. Client ID／secret 填入 Vercel 伺服器環境變數。在自己的終端執行下方指令產生加密金鑰，填入 `DRIVE_TOKEN_ENCRYPTION_KEY` 並妥善保存，勿公開。變更金鑰後須重新授權 Drive。

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

5. Testing 狀態先加入 Drive 擁有者為 test user。此狀態的 Drive refresh token 通常 7 天到期；長期使用請完成適用 Google 要求並切換 Production，再重新授權。OAuth Production 不會將聊天室／資料夾公開。
6. 部署後，管理員登入網站 → 管理面板 → Google Drive → 連接 Google Drive。擁有者同意授權後，建立 `Harbor private chat images` 資料夾。成員用聊天室帳號即可，不必登入 Google。

不要公開分享或刪除圖片資料夾。重新授權使用原本可存取資料夾的 Google 帳戶，以保留歷史圖片。

## Vercel 環境變數與部署

| 名稱                          | 用途                                         |
| ----------------------------- | -------------------------------------------- |
| VITE_FIREBASE_API_KEY         | Firebase Web config apiKey                   |
| VITE_FIREBASE_AUTH_DOMAIN     | harbor-9d3bc.firebaseapp.com                 |
| VITE_FIREBASE_PROJECT_ID      | harbor-9d3bc                                 |
| VITE_FIREBASE_APP_ID          | Firebase Web config appId                    |
| FIREBASE_SERVICE_ACCOUNT_JSON | 完整後端憑證 JSON，只放伺服器                |
| APP_ORIGIN                    | https://php-web-tan.vercel.app，不加尾端斜線 |
| GOOGLE_DRIVE_CLIENT_ID        | Web OAuth client ID                          |
| GOOGLE_DRIVE_CLIENT_SECRET    | Web OAuth client secret，只放伺服器          |
| DRIVE_TOKEN_ENCRYPTION_KEY    | 32-byte 隨機值的 base64，只放伺服器          |
| DISCORD_WEBHOOK_URL           | 選填，Discord Webhook，只放伺服器            |

Vercel 匯入現有 GitHub repo `mkiitw123456/PHPWeb`，Framework Vite、build `npm run build`、output `dist`。`api/workspace.mjs` 為 Node.js Function，設定 60 秒上限。環境變數修改後要重新部署。前端與 API 必須使用同一 Firebase 專案。

自訂網域須更新 APP_ORIGIN、Firebase authorized domains、OAuth redirect URI 並重新部署。Drive 授權只在 APP_ORIGIN 正式網域執行；Preview 不應共用正式憑證。此版需要 Vercel API，不能僅部署 dist 到純靜態主機。

## 本機與驗證

Node.js 22.12+，目前 Node 24 測試。

```powershell
npm ci
npm run build
npm test
npm run test:rules
```

規則測試需 Java 21+，使用 Firebase Emulator demo 專案，不碰正式資料。涵蓋跨類別／未登入／自行註冊拒絕、權限撤銷、角色升級攻擊、憑證禁止讀取與 API 驗證。模擬器不取代真實 OAuth、Drive、Discord 驗收。

純本機示範：不填四個 VITE_FIREBASE 變數，`.env.local` 設 `VITE_DEMO_MODE=true` 後 `npm run dev`。示範無真實登入、資料存在瀏覽器。正式 Firebase 本機模式須有同源 API，可用 Vercel CLI `vercel dev`；單獨 Vite 不提供 API。

## 費用與維運界線

- 10 人、每天 50 圖，若平均壓縮 300 KB，每月新增約 450 MB；每人看一次約 4.5 GB 圖片下載，另加文字及重複觀看。這是估算，不是免費保證。
- Google One 容量不等於 Firebase／Vercel 免費額度。Firestore listener 初始載入、重連與權限依賴讀取會計量；中繼資料透過小型 revision 文件在變更時更新，回到頁面時也會同步，歷史分頁和圖片延遲載入減少傳輸。
- 撤銷權限後新讀取／上傳會被拒絕，已下載內容無法收回。停權時同步設定 `profiles/{uid}.disabled=true` 並在 Firebase Auth 停用，讓 listener 規則也立即阻擋。
- Discord 採防重複 claim，非可靠佇列，失敗不自動重試。訊息儲存後網路斷線時，先重新整理再決定是否重送。
- 上傳失敗會清理圖片；清理失敗記錄 server-only `cleanup`。函式中途終止可能留下 Drive 孤立檔或 submissions pending，須管理員排查。過期 OAuth state 與完成的 submissions／notifications 可定期清理，不能刪除仍使用中的 images 記錄。
- 第一版沒有訊息編輯／刪除、類別刪除、搜尋、一般檔案附件、背景 Push、停權／重設密碼 UI。內部地址不收信，不能用 Email 寄送重設密碼；由管理員使用 Firebase Admin SDK 重設。
- 雲端驗收：兩個帳號互傳文字／圖片、撤銷類別後拒絕圖片讀取、Filipino 介面、音效開關、Webhook、登出禁止讀取。

官方參考：[安全規則](https://firebase.google.com/docs/firestore/security/get-started)、[Drive 檔案權限](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[OAuth token 到期](https://developers.google.com/identity/protocols/oauth2#expiration)、[Vercel 限制](https://vercel.com/docs/functions/limitations)。
