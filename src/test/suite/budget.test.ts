import * as assert from 'assert';
import {
    estimatePrimitives,
    planRender,
    simplificationNote,
    truncationWarning,
    DEFAULT_MAX_INSTANCES,
} from '../../preview/budget';
import { buildScene } from '../../preview/extractor';

// Pure-logic budget / level-of-detail tests — no vscode / no DOM — run
// headlessly (tsc + mocha, `--ui tdd`) like the measure / lattice-codegen
// suites. These assert the instance-budget math and the auto-LOD degradation
// that keeps a full BEAVRS-scale core renderable without dropping pins.

suite('OWEN preview instance budget', () => {
    test('estimatePrimitives scales by layers and axial segments', () => {
        const base = { totalPins: 1000, avgLayers: 3, axialSegments: 10 };
        assert.strictEqual(estimatePrimitives({ ...base, detail: 'disc', axial: false }), 1000);
        assert.strictEqual(estimatePrimitives({ ...base, detail: 'layers', axial: false }), 3000);
        assert.strictEqual(estimatePrimitives({ ...base, detail: 'disc', axial: true }), 10000);
        assert.strictEqual(estimatePrimitives({ ...base, detail: 'layers', axial: true }), 30000);
        assert.strictEqual(
            estimatePrimitives({ ...base, detail: 'layers', axial: false, context: 7 }), 3007);
    });

    test('planRender leaves fidelity untouched when it fits', () => {
        const plan = planRender({
            totalPins: 1000, avgLayers: 3, axialSegments: 10,
            detail: 'layers', axial: true, maxInstances: 1_000_000,
        });
        assert.strictEqual(plan.detail, 'layers');
        assert.strictEqual(plan.axial, true);
        assert.strictEqual(plan.simplified, false);
    });

    test('planRender drops layers→disc first (preserving axial) to fit', () => {
        // layers+axial = 30k; disc+axial = 10k. Budget 12k fits disc+axial.
        const plan = planRender({
            totalPins: 1000, avgLayers: 3, axialSegments: 10,
            detail: 'layers', axial: true, maxInstances: 12_000,
        });
        assert.strictEqual(plan.detail, 'disc', 'should drop to disc');
        assert.strictEqual(plan.axial, true, 'axial should be preserved');
        assert.strictEqual(plan.droppedToDisc, true);
        assert.strictEqual(plan.droppedAxial, false);
        assert.ok(plan.estimate <= 12_000);
    });

    test('planRender then collapses axial when disc+axial still overflows', () => {
        // disc+axial = 10k; disc = 1k. Budget 5k forces axial off too.
        const plan = planRender({
            totalPins: 1000, avgLayers: 3, axialSegments: 10,
            detail: 'layers', axial: true, maxInstances: 5_000,
        });
        assert.strictEqual(plan.detail, 'disc');
        assert.strictEqual(plan.axial, false);
        assert.strictEqual(plan.droppedToDisc, true);
        assert.strictEqual(plan.droppedAxial, true);
        assert.strictEqual(plan.estimate, 1000, 'every pin still placed (one disc each)');
    });

    test('planRender never changes the pin count (no pins dropped)', () => {
        for (const max of [100, 5_000, 12_000, 10_000_000]) {
            const plan = planRender({
                totalPins: 1000, avgLayers: 3, axialSegments: 10,
                detail: 'layers', axial: true, maxInstances: max,
            });
            // Estimate is always pins × (1 or avgLayers) × (1 or segs); the pin
            // factor (totalPins) is never reduced.
            assert.ok(plan.estimate % 1000 === 0, `estimate ${plan.estimate} should stay a multiple of pins`);
        }
    });

    test('default ceiling is high enough for a radially-complete BEAVRS core', () => {
        // ~56k pins × ~3 shells ≈ 170k < default.
        assert.ok(DEFAULT_MAX_INSTANCES >= 200_000, `default ${DEFAULT_MAX_INSTANCES} too low`);
    });

    test('simplificationNote / truncationWarning text', () => {
        assert.strictEqual(simplificationNote(false, false, 100), null);
        assert.match(simplificationNote(true, false, 100)!, /discs/);
        assert.match(simplificationNote(false, true, 100)!, /axial/);
        assert.match(simplificationNote(true, true, 100)!, /discs.*axial/);
        assert.match(truncationWarning(1_500_000)!, /1,500,000/);
    });
});

// --- Auto-LOD integration: a synthetic full-core SCONE deck -----------------

/** Builds an A×A core of B×B pin assemblies (every position a 2-layer fuel pin). */
function bigSconeCore(asmGrid: number, pinGrid: number): string {
    const asmMap = Array(pinGrid * pinGrid).fill('10').join(' ');
    const coreMap = Array(asmGrid * asmGrid).fill('20').join(' ');
    return `
geometry {
  universes {
    pinF { id 10; type pinUniverse; radii (0.4 0.46 0.0); fills (UO2 Zircaloy Water); }
    asm  { id 20; type latUniverse; origin (0 0 0); pitch (1.26 1.26 0); shape (${pinGrid} ${pinGrid} 0); padMat Water; map ( ${asmMap} ); }
    core { id 9999; type latUniverse; origin (0 0 0); pitch (${1.26 * pinGrid} ${1.26 * pinGrid} 0); shape (${asmGrid} ${asmGrid} 0); padMat Water; map ( ${coreMap} ); }
  }
}`;
}

function distinctX(cyls: { x: number }[]): number {
    return new Set(cyls.map((c) => Math.round(c.x * 1000))).size;
}

suite('OWEN preview auto-LOD (no pins dropped)', () => {
    // 4×4 assemblies × 8×8 pins = 1024 pin positions, 2 shells each.
    const deck = bigSconeCore(4, 8);
    const pins = 1024;

    test('layers fits under a generous ceiling and stays layered', () => {
        const scene = buildScene(deck, 'scone', { detail: 'layers', axial: false, maxInstances: 1_000_000 });
        assert.strictEqual(scene.fidelity.detail, 'layers');
        assert.strictEqual(scene.primitiveCount, pins * 2, `expected ${pins * 2} shells`);
        assert.strictEqual(scene.warnings.length, 0);
    });

    test('auto-LOD drops to discs (not pins) when layers would overflow', () => {
        // layers = 2048 instances; budget 1500 forces one disc per pin (1024).
        const scene = buildScene(deck, 'scone', { detail: 'layers', axial: false, maxInstances: 1500 });
        assert.strictEqual(scene.fidelity.detail, 'disc', 'should auto-simplify to discs');
        assert.strictEqual(scene.primitiveCount, pins, 'every pin still drawn as one disc');
        assert.strictEqual(scene.warnings.length, 0, 'no truncation warning when discs fit');
        assert.ok(scene.notes.some((n) => /Auto-simplified/.test(n)), 'expected an auto-LOD note');
        assert.strictEqual(distinctX(scene.cylinders), 32, 'all 32 pin columns still present');
    });

    test('truncation warning only when even one disc per pin overflows', () => {
        const scene = buildScene(deck, 'scone', { detail: 'disc', axial: false, maxInstances: 500 });
        assert.ok(scene.primitiveCount <= 500, 'capped at the ceiling');
        assert.ok(scene.warnings.some((w) => /exceeded/.test(w)), 'expected a truncation warning');
    });
});
