import * as vscode from 'vscode';

type PrebuiltCode = 'mcnp' | 'openmc' | 'serpent' | 'scone';

interface PrebuiltModel {
    id: string;
    name: string;
    code: PrebuiltCode;
    scale: string;
    provenance: string;
    description: string;
    filename: string;
}

const CODE_LABELS: Record<PrebuiltCode, string> = {
    mcnp: 'MCNP',
    openmc: 'OpenMC',
    serpent: 'Serpent',
    scone: 'SCONE',
};

// OpenMC decks are Python scripts; everything else maps to its own language id.
const CODE_LANGUAGE_ID: Record<PrebuiltCode, string> = {
    mcnp: 'mcnp',
    openmc: 'python',
    serpent: 'serpent',
    scone: 'scone',
};

async function loadManifest(extensionUri: vscode.Uri): Promise<PrebuiltModel[]> {
    const uri = vscode.Uri.joinPath(extensionUri, 'prebuilt-models', 'index.json');
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
        return Array.isArray(parsed) ? (parsed as PrebuiltModel[]) : [];
    } catch (err) {
        console.warn('[owen.openPrebuiltModel] failed to read prebuilt-models/index.json', err);
        return [];
    }
}

export function registerOpenPrebuiltModel(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('owen.openPrebuiltModel', async () => {
        const models = await loadManifest(context.extensionUri);
        if (models.length === 0) {
            vscode.window.showErrorMessage(
                'OWEN: no prebuilt models are bundled (prebuilt-models/index.json missing or empty).',
            );
            return;
        }

        const items = models.map<vscode.QuickPickItem & { _model: PrebuiltModel }>((m) => ({
            label: `${CODE_LABELS[m.code] ?? m.code}: ${m.name}`,
            description: `${m.scale} • ${m.provenance}`,
            detail: m.description,
            _model: m,
        }));

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: 'Open a bundled prebuilt model (offline)',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!pick) return;

        const model = pick._model;
        const fileUri = vscode.Uri.joinPath(context.extensionUri, 'prebuilt-models', model.filename);
        let content: string;
        try {
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            content = Buffer.from(bytes).toString('utf8');
        } catch (err) {
            vscode.window.showErrorMessage(
                `OWEN: failed to read bundled model "${model.filename}": ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return;
        }

        const doc = await vscode.workspace.openTextDocument({
            content,
            language: CODE_LANGUAGE_ID[model.code] ?? undefined,
        });
        await vscode.window.showTextDocument(doc);
    });
}
