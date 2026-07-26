import * as vscode from 'vscode';
import {
    filterEntries,
    guessCategoryFromDocument,
    loadSearchIndex,
    siteBaseUrl,
    uniqueCategories,
    type SearchEntry,
} from './searchIndex';

export class TutorialSearchPanel {
    public static currentPanel: TutorialSearchPanel | undefined;
    private static readonly viewType = 'owen.tutorialSearch';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _entries: SearchEntry[] = [];
    private _baseUrl = 'https://reactormc.net';
    private _indexSource: 'live' | 'bundled' = 'bundled';

    public static async createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;

        if (TutorialSearchPanel.currentPanel) {
            TutorialSearchPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            TutorialSearchPanel.viewType,
            'OWEN: ReactorMC Search',
            column,
            { enableScripts: true, retainContextWhenHidden: true },
        );

        TutorialSearchPanel.currentPanel = new TutorialSearchPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri) {
        this._panel = panel;
        this._panel.webview.html = this._loadingHtml();

        this._panel.webview.onDidReceiveMessage(
            async (msg) => {
                if (msg?.command === 'ready') {
                    await this._bootstrap(msg.query ?? '', msg.category ?? 'all');
                } else if (msg?.command === 'search') {
                    this._postResults(msg.query ?? '', msg.category ?? 'all');
                } else if (msg?.command === 'openExternal') {
                    const path = String(msg.path ?? '');
                    if (path.startsWith('/')) {
                        await vscode.env.openExternal(vscode.Uri.parse(`${this._baseUrl}${path}`));
                    }
                }
            },
            null,
            this._disposables,
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        void this._init(_extensionUri);
    }

    private async _init(extensionUri: vscode.Uri) {
        const cfg = vscode.workspace.getConfiguration('owen');
        this._baseUrl = siteBaseUrl(cfg);
        const loaded = await loadSearchIndex(extensionUri, cfg);
        this._entries = loaded.entries;
        this._indexSource = loaded.source;
        this._panel.webview.html = this._getHtml();

        const editor = vscode.window.activeTextEditor;
        const hint = guessCategoryFromDocument(editor?.document);
        const defaultCategory = hint ? hint.toLowerCase() : 'all';
        const defaultQuery = hint ?? '';

        this._panel.webview.postMessage({
            type: 'init',
            categories: ['all', ...uniqueCategories(this._entries)],
            indexSource: this._indexSource,
            count: this._entries.length,
            baseUrl: this._baseUrl,
            defaultQuery,
            defaultCategory,
        });
        this._postResults(defaultQuery, defaultCategory);
    }

    private async _bootstrap(query: string, category: string) {
        this._postResults(query, category);
    }

    private _postResults(query: string, category: string) {
        const catFilter = category === 'all' ? undefined : category;
        const results = filterEntries(this._entries, query, 24, catFilter);
        this._panel.webview.postMessage({ type: 'results', results, query, category });
    }

    public dispose() {
        TutorialSearchPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    private _loadingHtml(): string {
        return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:1rem;color:var(--vscode-foreground)">Loading ReactorMC search index…</body></html>`;
    }

    private _getHtml(): string {
        const csp = [
            "default-src 'none'",
            `style-src ${this._panel.webview.cspSource} 'unsafe-inline'`,
            `script-src ${this._panel.webview.cspSource} 'unsafe-inline'`,
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 12px 14px 20px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  h1 {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 0 0 4px;
  }
  .sub {
    font-size: 0.75rem;
    opacity: 0.75;
    margin-bottom: 12px;
  }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; align-items: center; }
  #q {
    flex: 1 1 220px;
    min-width: 180px;
    padding: 6px 10px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border-radius: 4px;
  }
  #q:focus { outline: 1px solid var(--vscode-focusBorder); }
  #cat {
    padding: 6px 8px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border-radius: 4px;
  }
  .meta { font-size: 0.7rem; opacity: 0.65; margin-bottom: 10px; }
  #results { display: flex; flex-direction: column; gap: 8px; }
  .card {
    border: 1px solid var(--vscode-widget-border);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08));
  }
  .card-head { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
  .card-title { font-weight: 600; font-size: 0.9rem; line-height: 1.3; }
  .badge {
    font-size: 0.65rem;
    white-space: nowrap;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .desc {
    margin: 6px 0 8px;
    font-size: 0.78rem;
    line-height: 1.45;
    opacity: 0.88;
  }
  .path { font-size: 0.68rem; opacity: 0.55; font-family: var(--vscode-editor-font-family); margin-bottom: 8px; }
  .open-btn {
    font-size: 0.72rem;
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .open-btn:hover { background: var(--vscode-button-hoverBackground); }
  .empty { opacity: 0.7; font-size: 0.85rem; padding: 24px 8px; text-align: center; }
</style>
</head>
<body>
  <h1>ReactorMC search</h1>
  <p class="sub">Tutorials, NRDP reference pages, and site tools — stay here while you work; open the full page only when you need it.</p>
  <div class="toolbar">
    <input id="q" type="search" placeholder="Search MCNP tallies, U-235, BEAVRS, materials…" autocomplete="off" />
    <select id="cat" aria-label="Category filter"></select>
  </div>
  <p class="meta" id="meta"></p>
  <div id="results"></div>
  <script>
    const vscode = acquireVsCodeApi();
    let debounce = null;

    const q = document.getElementById('q');
    const cat = document.getElementById('cat');
    const results = document.getElementById('results');
    const meta = document.getElementById('meta');

    function emitSearch() {
      vscode.postMessage({ command: 'search', query: q.value, category: cat.value });
    }

    q.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(emitSearch, 120);
    });
    cat.addEventListener('change', emitSearch);

    function renderResults(payload) {
      const { results: items, query, category } = payload;
      const label = category === 'all' ? 'all sections' : category;
      meta.textContent = items.length
        ? items.length + ' result(s)' + (query ? ' for "' + query + '"' : '') + ' · ' + label
        : 'No matches' + (query ? ' for "' + query + '"' : '') + ' · ' + label;

      if (!items.length) {
        results.innerHTML = '<p class="empty">Try a broader term — e.g. lattice, material, k-eff, Serpent, ALLEN.</p>';
        return;
      }

      results.innerHTML = items.map((item) => {
        const safeTitle = item.title.replace(/</g, '&lt;');
        const safeDesc = item.description.replace(/</g, '&lt;');
        const safePath = item.path.replace(/</g, '&lt;');
        const safeCat = item.category.replace(/</g, '&lt;');
        return '<article class="card">' +
          '<div class="card-head"><div class="card-title">' + safeTitle + '</div><span class="badge">' + safeCat + '</span></div>' +
          '<p class="desc">' + safeDesc + '</p>' +
          '<div class="path">' + safePath + '</div>' +
          '<button class="open-btn" data-path="' + safePath + '">Open on reactormc.net ↗</button>' +
        '</article>';
      }).join('');

      results.querySelectorAll('.open-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          vscode.postMessage({ command: 'openExternal', path: btn.getAttribute('data-path') });
        });
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'init') {
        cat.innerHTML = msg.categories.map((c) => {
          const label = c === 'all' ? 'All sections' : c;
          const selected = (msg.defaultCategory && c.toLowerCase() === msg.defaultCategory.toLowerCase()) || (c === 'all' && !msg.defaultCategory);
          return '<option value="' + c + '"' + (selected ? ' selected' : '') + '>' + label + '</option>';
        }).join('');
        if (msg.defaultQuery) q.value = msg.defaultQuery;
        meta.textContent = msg.count + ' indexed pages · ' + (msg.indexSource === 'live' ? 'live index' : 'bundled index');
        vscode.postMessage({ command: 'ready', query: q.value, category: cat.value });
      } else if (msg.type === 'results') {
        renderResults(msg);
      }
    });

    vscode.postMessage({ command: 'ready', query: '', category: 'all' });
  </script>
</body>
</html>`;
    }
}
