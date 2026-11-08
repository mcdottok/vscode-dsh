import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import { EXTENSION_DISPLAY_NAME } from '../constants.js'

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
    // Shiki and React supply bounded token colors as style attributes.
    "style-src-attr 'unsafe-inline'",
    // Allow packaged module chunks in addition to the nonced entry point.
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
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
    <title>${EXTENSION_DISPLAY_NAME}</title>
  </head>
  <body>
    <main id="root" aria-live="polite"></main>
    <script type="module" nonce="${nonce}" src="${script.toString()}"></script>
  </body>
</html>`
}
