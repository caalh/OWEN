import * as assert from 'assert';
import {
    parseKeff,
    cartesian,
    applyParameters,
    runDirName,
    buildManifest,
    buildSummaryTsv,
    validateParameters,
    SweepParameter,
    RunRecord,
} from '../../workflows/sweepCore';

suite('OWEN sweep — parameter expansion', () => {
    test('single parameter expands to one combination per value', () => {
        const params: SweepParameter[] = [
            { name: 'enrichment', values: [0.02, 0.03, 0.05], pattern: 'x' },
        ];
        const combos = cartesian(params);
        assert.strictEqual(combos.length, 3);
        assert.deepStrictEqual(combos, [
            { enrichment: 0.02 },
            { enrichment: 0.03 },
            { enrichment: 0.05 },
        ]);
    });

    test('two parameters produce the full cartesian product', () => {
        const params: SweepParameter[] = [
            { name: 'enr', values: [0.02, 0.04], pattern: 'a' },
            { name: 'pitch', values: [1.26, 1.30], pattern: 'b' },
        ];
        const combos = cartesian(params);
        assert.strictEqual(combos.length, 4);
        // First parameter varies slowest.
        assert.deepStrictEqual(combos, [
            { enr: 0.02, pitch: 1.26 },
            { enr: 0.02, pitch: 1.30 },
            { enr: 0.04, pitch: 1.26 },
            { enr: 0.04, pitch: 1.30 },
        ]);
    });

    test('no parameters yields a single empty combination', () => {
        assert.deepStrictEqual(cartesian([]), [{}]);
    });
});

suite('OWEN sweep — text substitution', () => {
    const schema: SweepParameter[] = [
        { name: 'enrichment', values: [], pattern: "add_nuclide\\('U235', ([0-9.]+)" },
    ];

    test('replaces only capture group 1, preserving surrounding text', () => {
        const base = "uo2.add_nuclide('U235', 0.040, percent_type='ao')";
        const out = applyParameters(base, { enrichment: 0.05 }, schema);
        assert.strictEqual(out, "uo2.add_nuclide('U235', 0.05, percent_type='ao')");
    });

    test('replaces only the captured group when the same digits recur nearby', () => {
        // The contract is capture-group-1 substitution; the literal "5000" in the
        // comment must be left intact — only the captured value is rewritten.
        const base = 'settings.particles = 5000  # was 5000 before';
        const out = applyParameters(base, { particles: 20000 }, [
            { name: 'particles', values: [], pattern: 'particles = ([0-9]+)' },
        ]);
        assert.strictEqual(out, 'settings.particles = 20000  # was 5000 before');
    });

    test('applies multiple parameters independently', () => {
        const base = "enr=OLD pitch=OLD";
        const out = applyParameters(
            base,
            { enr: 4.0, pitch: 1.3 },
            [
                { name: 'enr', values: [], pattern: 'enr=(OLD)' },
                { name: 'pitch', values: [], pattern: 'pitch=(OLD)' },
            ],
        );
        assert.strictEqual(out, 'enr=4 pitch=1.3');
    });
});

suite('OWEN sweep — k-eff parsing', () => {
    test('parses OpenMC "Combined k-effective" stdout', () => {
        const stdout = [
            ' =======================>     RESULTS    <=======================',
            '',
            ' k-effective (Collision)     = 1.18840 +/- 0.00100',
            ' k-effective (Track-length)  = 1.18790 +/- 0.00120',
            ' k-effective (Absorption)    = 1.18900 +/- 0.00150',
            ' Combined k-effective        = 1.18845 +/- 0.00080',
        ].join('\n');
        assert.strictEqual(parseKeff(stdout), 1.18845);
    });

    test('parses a generic "k-eff = ..." fallback line', () => {
        assert.strictEqual(parseKeff('final result: keff = 0.98231'), 0.98231);
        assert.strictEqual(parseKeff('k-eff: 1.00250'), 1.00250);
    });

    test('returns null when no k-eff is present (→ summary records n/a)', () => {
        assert.strictEqual(parseKeff(''), null);
        assert.strictEqual(parseKeff('Segmentation fault (core dumped)'), null);
        assert.strictEqual(parseKeff('ERROR: cross_sections.xml not found'), null);
    });

    test('increasing enrichment trend extracts increasing k-eff', () => {
        const samples = [
            ' Combined k-effective        = 0.92100 +/- 0.00090',
            ' Combined k-effective        = 1.05400 +/- 0.00090',
            ' Combined k-effective        = 1.18800 +/- 0.00090',
        ];
        const keffs = samples.map((s) => parseKeff(s));
        assert.deepStrictEqual(keffs, [0.921, 1.054, 1.188]);
        assert.ok(keffs[0]! < keffs[1]! && keffs[1]! < keffs[2]!, 'k-eff should increase');
    });
});

suite('OWEN sweep — run layout, manifest & summary', () => {
    test('run directories are zero-padded to three digits', () => {
        assert.strictEqual(runDirName(0), 'run_000');
        assert.strictEqual(runDirName(7), 'run_007');
        assert.strictEqual(runDirName(123), 'run_123');
    });

    const params: SweepParameter[] = [
        { name: 'enrichment', values: [0.02, 0.05], pattern: "add_nuclide\\('U235', ([0-9.]+)" },
    ];
    const records: RunRecord[] = [
        {
            index: 0,
            parameters: { enrichment: 0.02 },
            inputFile: '/out/run_000/pincell.py',
            outputDir: '/out/run_000',
            keff: 0.921,
            keffStd: 0.0009,
            keffSource: 'statepoint.20.h5',
            exitCode: 0,
            stdoutPath: '/out/run_000/owen-sweep.log',
        },
        {
            index: 1,
            parameters: { enrichment: 0.05 },
            inputFile: '/out/run_001/pincell.py',
            outputDir: '/out/run_001',
            keff: null,
            exitCode: 1,
            stdoutPath: '/out/run_001/owen-sweep.log',
        },
    ];

    test('manifest captures base file, language, schema and all runs', () => {
        const manifest = buildManifest('/base/pincell.py', 'openmc', params, records);
        assert.strictEqual(manifest.baseFile, '/base/pincell.py');
        assert.strictEqual(manifest.language, 'openmc');
        assert.strictEqual(manifest.parameters.length, 1);
        assert.strictEqual(manifest.runs.length, 2);
        assert.strictEqual(manifest.runs[0].keff, 0.921);
    });

    test('summary TSV has a header and one row per run; missing keff → n/a', () => {
        const tsv = buildSummaryTsv(params, records);
        const rows = tsv.split('\n');
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows[0], 'index\tenrichment\texit\tkeff\tkeff_std\tsource');
        assert.strictEqual(rows[1], '0\t0.02\t0\t0.921\t0.0009\tstatepoint.20.h5');
        // Second run failed (exit 1) and had no parseable k-eff → "n/a".
        assert.strictEqual(rows[2], '1\t0.05\t1\tn/a\tn/a\tn/a');
    });
});

suite('OWEN sweep — parameter validation', () => {
    const deck = "uo2.add_nuclide('U235', 0.040)\nsettings.particles = 5000\n";

    test('a pattern that matches nothing is refused before any run starts', () => {
        // The silent version of this failure gives every run the same deck, and
        // a summary table that reads as "this parameter does nothing".
        const problems = validateParameters(deck, [
            { name: 'enr', values: [0.03], pattern: "add_nuclide\\('U238', ([0-9.]+)" },
        ]);
        assert.strictEqual(problems.length, 1);
        assert.match(problems[0], /matches nothing/);
        assert.match(problems[0], /same deck/);
    });

    test('a pattern without a capture group is refused', () => {
        const problems = validateParameters(deck, [
            { name: 'enr', values: [0.03], pattern: "add_nuclide\\('U235', [0-9.]+" },
        ]);
        assert.match(problems[0], /no capture group/);
    });

    test('an invalid regex is reported rather than thrown', () => {
        const problems = validateParameters(deck, [{ name: 'enr', values: [1], pattern: '([' }]);
        assert.match(problems[0], /invalid pattern/);
    });

    test('empty values and missing names are reported', () => {
        assert.match(validateParameters(deck, [{ name: 'enr', values: [], pattern: 'particles = ([0-9]+)' }])[0], /no values/);
        assert.match(validateParameters(deck, [{ name: '', values: [1], pattern: 'x' }])[0], /no name/);
    });

    test('a working schema passes', () => {
        assert.deepStrictEqual(
            validateParameters(deck, [
                { name: 'enr', values: [0.03], pattern: "add_nuclide\\('U235', ([0-9.]+)" },
                { name: 'n', values: [100], pattern: 'particles = ([0-9]+)' },
            ]),
            [],
        );
    });
});
