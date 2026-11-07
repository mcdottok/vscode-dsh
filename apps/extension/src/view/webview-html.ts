import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'

export function createWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  hostLanguage: string,
): string {
  const nonce = randomBytes(16).toString('base64url')
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'))
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css'))
  const documentLanguage = /^zh(?:-[A-Za-z0-9]{1,8})*$/iu.test(hostLanguage) ? 'zh-CN' : 'en'
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `style-src-elem ${webview.cspSource}`,
    // Shiki and React supply bounded token colors as style attributes. Keep
    // stylesheet elements restricted to packaged resources, and do not relax
    // script-src or permit model-authored HTML.
    "style-src-attr 'unsafe-inline'",
    // VS Code 1.144 起，动态 import() 的模块加载受 script-src 约束；只放行 nonce
    // 会拦掉 webview.js 用 import() 拉取的 assets/*.js 分块，页面因此无法完成初始化。
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    // 同一批分块请求在 Chromium 里按 connect-src 判定；'none' 会让它们全部被拦。
    `connect-src ${webview.cspSource}`,
    "frame-src 'none'",
  ].join('; ')
  return `<!doctype html>
<html lang="${documentLanguage}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${style.toString()}">
    <title>DeepSeek Harness</title>
  </head>
  <body>
    <main id="root" aria-live="polite"></main>
    <script type="module" nonce="${nonce}" src="${script.toString()}"></script>
  </body>
</html>`
}
