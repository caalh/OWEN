// MCNP cross-reference tree view.
//
// A side panel that maps where MCNP entities are defined vs. referenced, with a
// LATTICE focus: each lattice cell decodes its fill array into the universes it
// places (with counts and a jump to each universe's definition) and lists the
// surfaces that bound the unit cell. Cells / universes / surfaces / materials
// each expand to their definition + every reference, all clickable.

import * as vscode from 'vscode';
import {
    McnpReferenceIndex,
    McnpEntityKind,
    LatticeInfo,
    getDefinition,
    getOccurrences,
} from './mcnpReferences';
import { getIndexFor } from './providers';

interface RefNode {
    label: string;
    description?: string;
    tooltip?: string;
    contextValue?: string;
    icon?: string;
    collapsible?: vscode.TreeItemCollapsibleState;
    loc?: { uri: vscode.Uri; line: number; startCol: number; endCol: number };
    children?: () => RefNode[];
}

const KIND_ICON: Record<McnpEntityKind, string> = {
    cell: 'symbol-namespace',
    surface: 'symbol-interface',
    material: 'symbol-color',
    universe: 'symbol-class',
};

const KIND_PLURAL: Record<McnpEntityKind, string> = {
    cell: 'Cells', surface: 'Surfaces', material: 'Materials', universe: 'Universes',
};

class McnpReferenceTreeProvider implements vscode.TreeDataProvider<RefNode> {
    private readonly _emitter = new vscode.EventEmitter<RefNode | undefined | void>();
    readonly onDidChangeTreeData = this._emitter.event;

    refresh(): void {
        this._emitter.fire();
    }

    getTreeItem(node: RefNode): vscode.TreeItem {
        const item = new vscode.TreeItem(node.label, node.collapsible ?? vscode.TreeItemCollapsibleState.None);
        item.description = node.description;
        item.tooltip = node.tooltip;
        item.contextValue = node.contextValue;
        if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
        if (node.loc) {
            item.command = {
                command: 'owen.revealMcnpReference',
                title: 'Open',
                arguments: [node.loc],
            };
        }
        return item;
    }

    getChildren(node?: RefNode): RefNode[] {
        if (node) return node.children ? node.children() : [];
        return this.roots();
    }

    private roots(): RefNode[] {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'mcnp') {
            return [{ label: 'Open an MCNP file to see its references.', icon: 'info' }];
        }
        const doc = editor.document;
        const index = getIndexFor(doc);
        const uri = doc.uri;

        const groups: RefNode[] = [];

        // --- Lattices (the headline feature) ---
        if (index.lattices.length) {
            groups.push({
                label: 'Lattices',
                description: String(index.lattices.length),
                icon: 'grid',
                collapsible: vscode.TreeItemCollapsibleState.Expanded,
                children: () => index.lattices.map((lat) => latticeNode(index, uri, lat)),
            });
        }

        // --- Entity groups ---
        for (const kind of ['universe', 'material', 'surface', 'cell'] as McnpEntityKind[]) {
            const ids = uniqueIds(index, kind);
            if (!ids.length) continue;
            groups.push({
                label: KIND_PLURAL[kind],
                description: String(ids.length),
                icon: KIND_ICON[kind],
                collapsible: vscode.TreeItemCollapsibleState.Collapsed,
                children: () => ids.map((id) => entityNode(index, uri, kind, id)),
            });
        }

        if (!groups.length) {
            return [{ label: 'No cells, surfaces, materials, or universes found.', icon: 'info' }];
        }
        return groups;
    }
}

function uniqueIds(index: McnpReferenceIndex, kind: McnpEntityKind): number[] {
    const ids = new Set<number>();
    for (const o of index.occurrences) if (o.kind === kind) ids.add(o.id);
    return [...ids].sort((a, b) => a - b);
}

function latticeNode(index: McnpReferenceIndex, uri: vscode.Uri, lat: LatticeInfo): RefNode {
    const def = getDefinition(index, 'cell', lat.cellId);
    return {
        label: `Lattice in cell ${lat.cellId}`,
        description: `lat=${lat.lat} · ${lat.nx}×${lat.ny}${lat.nz > 1 ? `×${lat.nz}` : ''}`,
        icon: 'grid',
        collapsible: vscode.TreeItemCollapsibleState.Expanded,
        loc: def ? { uri, line: def.line, startCol: def.startCol, endCol: def.endCol } : undefined,
        children: () => {
            const kids: RefNode[] = [];
            // Bounding surfaces of the unit cell.
            if (lat.boundingSurfaces.length) {
                kids.push({
                    label: 'Unit-cell surfaces',
                    description: lat.boundingSurfaces.join(' '),
                    icon: 'symbol-interface',
                    collapsible: vscode.TreeItemCollapsibleState.Collapsed,
                    children: () => lat.boundingSurfaces.map((sid) => {
                        const sd = getDefinition(index, 'surface', sid);
                        return {
                            label: `surface ${sid}`,
                            description: sd ? sd.summary : '(undefined)',
                            icon: 'symbol-interface',
                            loc: sd ? { uri, line: sd.line, startCol: sd.startCol, endCol: sd.endCol } : undefined,
                        };
                    }),
                });
            }
            // Universes placed by the fill array, by count.
            const sorted = [...lat.universeCounts.entries()].sort((a, b) => b[1] - a[1]);
            for (const [uid, count] of sorted) {
                const ud = getDefinition(index, 'universe', uid);
                kids.push({
                    label: `universe ${uid}`,
                    description: `${ud ? ud.summary : 'universe'} ×${count}`,
                    tooltip: ud ? `${ud.summary} — defined at line ${ud.line + 1}` : undefined,
                    icon: 'symbol-class',
                    loc: ud ? { uri, line: ud.line, startCol: ud.startCol, endCol: ud.endCol } : undefined,
                });
            }
            return kids;
        },
    };
}

function entityNode(index: McnpReferenceIndex, uri: vscode.Uri, kind: McnpEntityKind, id: number): RefNode {
    const def = getDefinition(index, kind, id);
    const occ = getOccurrences(index, kind, id);
    const refCount = occ.filter((o) => !o.isDefinition).length;
    return {
        label: `${capitalize(kind)} ${id}`,
        description: `${def ? def.summary : '(undefined)'} · ${refCount} ref${refCount === 1 ? '' : 's'}`,
        icon: KIND_ICON[kind],
        collapsible: vscode.TreeItemCollapsibleState.Collapsed,
        loc: def ? { uri, line: def.line, startCol: def.startCol, endCol: def.endCol } : undefined,
        children: () => occ.map((o) => ({
            label: o.isDefinition ? 'definition' : 'reference',
            description: `line ${o.line + 1}${o.cellContext !== undefined ? ` (cell ${o.cellContext})` : ''}`,
            icon: o.isDefinition ? 'symbol-key' : 'references',
            loc: { uri, line: o.line, startCol: o.startCol, endCol: o.endCol },
        })),
    };
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export function registerMcnpReferencesView(context: vscode.ExtensionContext): void {
    const provider = new McnpReferenceTreeProvider();
    const view = vscode.window.createTreeView('owenMcnpReferences', { treeDataProvider: provider });
    context.subscriptions.push(view);

    const refresh = () => provider.refresh();
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(refresh),
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) refresh();
        }),
        vscode.commands.registerCommand('owen.showMcnpReferences', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'mcnp') {
                vscode.window.showWarningMessage('OWEN: open an MCNP file to view its references.');
                return;
            }
            provider.refresh();
            await vscode.commands.executeCommand('owenMcnpReferences.focus');
        }),
        vscode.commands.registerCommand('owen.revealMcnpReference', async (loc: { uri: vscode.Uri; line: number; startCol: number; endCol: number }) => {
            if (!loc) return;
            const doc = await vscode.workspace.openTextDocument(loc.uri);
            const ed = await vscode.window.showTextDocument(doc, { preview: true });
            const range = new vscode.Range(loc.line, loc.startCol, loc.line, loc.endCol);
            ed.selection = new vscode.Selection(range.start, range.end);
            ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }),
    );
}
