import * as vscode from 'vscode';

/**
 * Webview-safe URI of a file under `media/vendor/` (three.js, uPlot — see
 * `scripts/vendor-webview-libs.mjs`). Every OWEN webview that needs a browser
 * library loads it from here rather than a CDN, so the extension works on a
 * machine with no route to unpkg.com — which describes most reactor-physics
 * workstations. The default panel `localResourceRoots` already includes the
 * extension directory, so no extra webview options are needed.
 */
export function vendorUri(webview: vscode.Webview, extensionUri: vscode.Uri, ...parts: string[]): string {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'vendor', ...parts)).toString();
}
