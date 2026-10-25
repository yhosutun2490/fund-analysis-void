// 寄件者:void.config.ts 的 email.from 與 sendEmail 的 from 共用這一份。
// （sendEmail 省略 from 時要靠 Void 執行環境注入的設定;明確帶上,測試與各環境的行為才一致。）
//
// 直接部署到自有 Cloudflare 帳號時,寄件網域必須是帳號內的 zone。
// 目前還沒有確定的網域:換成 Cloudflare 上的寄件地址,如 "fund-risks-analysis <noreply@mail.your-domain.com>"。
// 本機 vite dev 不會真的寄出（進 /__void/inbox）,所以佔位值不影響本機與測試。
export const EMAIL_FROM = "fund-risks-analysis <noreply@REPLACE-WITH-YOUR-MAIL-DOMAIN.example>";
