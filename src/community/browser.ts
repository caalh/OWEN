import * as vscode from 'vscode';
import { detectMonteCarloLanguage } from '../util/detectLanguage';
import { getSupabaseClient } from './client';

interface CommunityModel {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    code: string | null;
    reactor_type: string | null;
    body: string | null;
    status: string | null;
}

const DISABLED_MESSAGE =
    'OWEN: the Community Library browser is turned off (`owen.community.enabled`). ' +
    'You can still browse it on the web.';

const OPEN_ON_WEB = 'Open on reactormc.net';

/** Message fragments meaning the backend was never reached, as opposed to a query
 *  being refused. ReactorMC runs on Supabase's free tier, which pauses a project
 *  after about a week of inactivity, so this is a routine condition rather than a
 *  bug and must not be reported to the user as a raw `TypeError`. */
const UNREACHABLE_SIGNATURES = [
    'failed to fetch',
    'fetch failed',
    'networkerror',
    'network request failed',
    'load failed',
    'is paused',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
    'econnrefused',
    'enotfound',
    'etimedout',
    'timeout',
    'timed out',
];

/** Exported for tests. */
export function isUnreachable(message: string): boolean {
    const m = message.toLowerCase();
    return UNREACHABLE_SIGNATURES.some((sig) => m.includes(sig));
}

/** Shows `message` with a button that opens the library in a browser. */
async function offerWeb(message: string, kind: 'info' | 'warning' = 'info'): Promise<void> {
    const show = kind === 'warning' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const choice = await show(message, OPEN_ON_WEB);
    if (choice === OPEN_ON_WEB) {
        await vscode.commands.executeCommand('owen.openCommunityLibrary');
    }
}

function languageFilter(value: string | null | undefined): string | null {
    if (!value) return null;
    const norm = value.toLowerCase();
    if (norm.includes('mcnp')) return 'mcnp';
    if (norm.includes('openmc')) return 'openmc';
    if (norm.includes('serpent')) return 'serpent';
    if (norm.includes('scone')) return 'scone';
    return null;
}

export function registerSearchReactorLibrary(): vscode.Disposable {
    return vscode.commands.registerCommand('owen.searchReactorLibrary', async () => {
        const cfg = vscode.workspace.getConfiguration('owen');
        if (!cfg.get<boolean>('community.enabled', true)) {
            await offerWeb(DISABLED_MESSAGE);
            return;
        }

        const client = await getSupabaseClient();
        if (!client) {
            await offerWeb(
                'OWEN: no Community Library backend is configured. Restore the defaults for ' +
                '`owen.supabase.url` and `owen.supabase.anonKey`, or browse on the web instead.',
                'warning',
            );
            return;
        }

        const editor = vscode.window.activeTextEditor;
        const detected = editor ? detectMonteCarloLanguage(editor.document) : null;

        let query = client
            .from('models')
            .select('id, slug, title, description, code, reactor_type, body, status')
            .eq('status', 'approved')
            .limit(100);

        // `code` is public.model_code (Postgres enum). ILIKE / ~~* is not defined
        // on enums — that surfaces as "operator does not exist: model_code ~~* unknown".
        // detectMonteCarloLanguage already returns the exact enum label.
        if (detected) {
            query = query.eq('code', detected);
        }

        const result = await vscode.window.withProgress<{
            data: CommunityModel[] | null;
            error: { message: string } | null;
        }>(
            { location: vscode.ProgressLocation.Window, title: 'OWEN: searching Community Library…' },
            async () => {
                const { data, error } = await query;
                return { data: (data as CommunityModel[] | null) ?? null, error };
            },
        );

        if (result.error) {
            if (isUnreachable(result.error.message)) {
                await offerWeb(
                    'OWEN: the Community Library is temporarily unreachable. Nothing is wrong with ' +
                    'your deck — try again in a few minutes.',
                    'warning',
                );
            } else {
                vscode.window.showErrorMessage(`OWEN: community search failed: ${result.error.message}`);
            }
            return;
        }
        const rows = result.data ?? [];
        if (rows.length === 0) {
            await offerWeb(
                detected
                    ? `OWEN: no approved community models for ${detected} yet. Yours could be the first.`
                    : 'OWEN: no approved community models yet. Yours could be the first.',
            );
            return;
        }

        const pick = await vscode.window.showQuickPick(
            rows.map<vscode.QuickPickItem & { _row: CommunityModel }>((row) => ({
                label: row.title,
                description: [languageFilter(row.code), row.reactor_type].filter(Boolean).join(' • '),
                detail: row.description ?? '',
                _row: row,
            })),
            {
                placeHolder: detected
                    ? `Approved community models matching ${detected}`
                    : 'Approved community models',
                matchOnDescription: true,
                matchOnDetail: true,
            },
        );
        if (!pick) return;

        const body = pick._row.body ?? '';
        if (!body) {
            vscode.window.showWarningMessage('OWEN: selected model has no body to insert.');
            return;
        }

        const action = await vscode.window.showQuickPick(
            [
                { label: 'Insert at cursor', value: 'insert' as const },
                { label: 'Open in new untitled document', value: 'open' as const },
            ],
            { placeHolder: 'How would you like to use this model?' },
        );
        if (!action) return;

        if (action.value === 'insert' && editor) {
            const padded = body.endsWith('\n') ? body : body + '\n';
            await editor.edit((eb) => eb.insert(editor.selection.active, padded));
        } else {
            const doc = await vscode.workspace.openTextDocument({
                content: body,
                language: detected ?? undefined,
            });
            await vscode.window.showTextDocument(doc);
        }
    });
}
