import * as vscode from 'vscode';

const DEFAULT_URL = 'https://reactormc.net/community';

/**
 * Opens the ReactorMC Community Library in the user's browser.
 *
 * Deliberately separate from `owen.searchReactorLibrary`, which reads the
 * Supabase backend: this command is the submission and discussion path. OWEN
 * browses and inserts decks but has no upload flow, so uploading, rating and
 * commenting all happen on the website.
 *
 * Because it is a plain external link it keeps working when the backend is
 * unreachable — the site's own pages degrade gracefully — and when the user has
 * turned `owen.community.enabled` off.
 */
export function registerOpenCommunityLibrary(): vscode.Disposable {
    return vscode.commands.registerCommand('owen.openCommunityLibrary', async () => {
        const configured = vscode.workspace
            .getConfiguration('owen')
            .get<string>('community.webUrl', DEFAULT_URL);

        // Only http(s) is honored, so a bad setting cannot turn this command into
        // a launcher for arbitrary schemes (file:, vscode:, and so on).
        let target: vscode.Uri;
        try {
            target = vscode.Uri.parse((configured || DEFAULT_URL).trim(), true);
        } catch {
            target = vscode.Uri.parse(DEFAULT_URL, true);
        }
        if (target.scheme !== 'http' && target.scheme !== 'https') {
            target = vscode.Uri.parse(DEFAULT_URL, true);
        }

        await vscode.env.openExternal(target);
    });
}
