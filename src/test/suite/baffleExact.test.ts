// The stepped baffle used to be synthesized from a fuel-adjacency guess
// (BaffleNeighborhood), which drew plates on faces the deck leaves open —
// on BEAVRS the corners rendered as X/T crossings and plan-view IoU against
// the exact slice was 0.45. Plates now come from each baffle universe's own
// cell halfspaces; these tests pin that: exact rect math, no overlapping
// plates, every plate centred on real steel, and the same 76 plates from all
// three text codes.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { plateRectFromConstraints } from '../../preview/radialStructure';
import { parseMcnp } from '../../preview/codes/mcnp';
import { parseSerpent } from '../../preview/codes/serpent';
import { parseScone } from '../../preview/codes/scone';
import { parseDeckToModel } from '../../preview/engineDispatch';
import { findCell } from '../../preview/mcnpEvaluate';
import { PREBUILT_MODELS } from '../paths';
import type { CylinderSpec } from '../../preview/types';

const HP = 21.50364 / 2;

function platesOf(sc: { cylinders: CylinderSpec[] }): CylinderSpec[] {
    return sc.cylinders.filter((c) => c.shape === 'box' && /baffle/i.test(c.label || ''));
}

function signature(plates: CylinderSpec[]): string[] {
    return plates
        .map((p) => [p.x, p.y, p.halfX!, p.halfY!].map((v) => Number(v.toFixed(4))).join(','))
        .sort();
}

suite('Baffle plates from cell halfspaces (BEAVRS X/T corner fix)', () => {
    test('plateRectFromConstraints: side plate unbounded in y spans the element', () => {
        const r = plateRectFromConstraints(
            [{ axis: 'x', sense: 1, d: 8.36662 }, { axis: 'x', sense: -1, d: 10.58912 }], HP, HP)!;
        assert.ok(Math.abs(r.x0 - 8.36662) < 1e-9 && Math.abs(r.x1 - 10.58912) < 1e-9);
        assert.ok(Math.abs(r.y0 + HP) < 1e-9 && Math.abs(r.y1 - HP) < 1e-9, 'unbounded y clamps to the element');
    });

    test('plateRectFromConstraints: L-corner arms from half-bounded cells are disjoint', () => {
        // BAF_TL of the BEAVRS MCNP deck: `43 -41 -46` and `44 -46 41`.
        const arm1 = plateRectFromConstraints([
            { axis: 'x', sense: 1, d: -10.58912 }, { axis: 'x', sense: -1, d: -8.36662 },
            { axis: 'y', sense: -1, d: 10.58912 },
        ], HP, HP)!;
        const arm2 = plateRectFromConstraints([
            { axis: 'y', sense: 1, d: 8.36662 }, { axis: 'y', sense: -1, d: 10.58912 },
            { axis: 'x', sense: 1, d: -8.36662 },
        ], HP, HP)!;
        assert.ok(arm1 && arm2);
        const overlapX = Math.min(arm1.x1, arm2.x1) - Math.max(arm1.x0, arm2.x0);
        const overlapY = Math.min(arm1.y1, arm2.y1) - Math.max(arm1.y0, arm2.y0);
        assert.ok(!(overlapX > 1e-6 && overlapY > 1e-6), 'MCNP cells are disjoint; the arms must be too');
    });

    test('plateRectFromConstraints: empty intersection is null', () => {
        assert.strictEqual(plateRectFromConstraints(
            [{ axis: 'x', sense: 1, d: 5 }, { axis: 'x', sense: -1, d: 4 }], HP, HP), null);
    });

    test('BEAVRS: all three codes emit identical, non-overlapping plates on real steel', function () {
        this.timeout(60000);
        const mcnpText = fs.readFileSync(path.join(PREBUILT_MODELS, 'beavrs_fullcore_mcnp.i'), 'utf8');
        const m = platesOf(parseMcnp(mcnpText, { maxInstances: 2_000_000 }));
        const s = platesOf(parseSerpent(fs.readFileSync(path.join(PREBUILT_MODELS, 'beavrs_fullcore_serpent.sss'), 'utf8'), { maxInstances: 2_000_000 }));
        const c = platesOf(parseScone(fs.readFileSync(path.join(PREBUILT_MODELS, 'beavrs_fullcore_scone.scone'), 'utf8'), { maxInstances: 2_000_000 }));

        assert.ok(m.length >= 70, `expected the full stepped ring, got ${m.length} plates`);
        assert.deepStrictEqual(signature(s), signature(m), 'Serpent plates must match MCNP');
        assert.deepStrictEqual(signature(c), signature(m), 'SCONE plates must match MCNP');

        // No two plates may share plan area — crossing plates were the X/T bug.
        for (let i = 0; i < m.length; i++) {
            for (let j = i + 1; j < m.length; j++) {
                const a = m[i], b = m[j];
                const ox = Math.min(a.x + a.halfX!, b.x + b.halfX!) - Math.max(a.x - a.halfX!, b.x - b.halfX!);
                const oy = Math.min(a.y + a.halfY!, b.y + b.halfY!) - Math.max(a.y - a.halfY!, b.y - b.halfY!);
                assert.ok(!(ox > 0.05 && oy > 0.05), `plates overlap: ${a.label} × ${b.label}`);
            }
        }

        // Every plate centre sits on the deck's SS304 (m7) per the exact engine.
        const model = parseDeckToModel(mcnpText, 'mcnp')!;
        for (const p of m) {
            const f = findCell(model, [p.x, p.y, 219.628]);
            assert.strictEqual(f.cell?.material, 7, `plate ${p.label} centre (${p.x}, ${p.y}) is not on steel`);
        }
    });
});
