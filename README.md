# Deadlift Lab｜硬舉動作分析

由臺灣運動健康科技學會資助的瀏覽器端硬舉動作分析原型，版本更新為 2026 年 11 月。

## 功能

- 匯入側面硬舉影片，在瀏覽器本機進行 MediaPipe Pose Landmarker 推論。
- 估算完整次數、起拉／鎖定／下降時間、髖角、膝角與軀幹角度變化。
- 逐次跳轉回放，匯出 CSV 與 JSON。
- 影片不會由本專案上傳；模型檔首次使用時由 Google Storage 下載。

## 重要限制

這是單鏡頭、未經效度驗證的教學與動作複核工具。角度、次數及軀幹穩定度皆為影像估算，會受到鏡位、遮擋、衣著、影片品質及個體差異影響。它不是醫療診斷、傷害風險判定、正式裁判或教練專業判斷的替代品。

本專案受到 `jeremyipark/vision-demos/deadlift` 啟發；原專案使用 SAM 3.1、ViTPose+ Large 與 Gemma 模型。本專案為獨立的瀏覽器端實作，不宣稱與原始結果等價。詳見 `NOTICE`。

## 本機執行

```bash
pnpm install
pnpm dev
```

## 建置與部署

```bash
pnpm test
pnpm build
pnpm dlx firebase-tools deploy --only hosting:deadlift-analysis-skyfu218 --project sports-intel-skyfu218
```

正式部署前必須先確認 Firebase 登入身分、專案與 Hosting site 是否正確存在。
