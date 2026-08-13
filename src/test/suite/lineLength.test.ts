import * as assert from 'assert';
import {
    describeLineLimit,
    expandedWidth,
    findOverlengthLines,
    MCNP_DEFAULT_LINE_LIMIT,
    MCNP_LEGACY_LINE_LIMIT,
    MCNP_MODERN_LINE_LIMIT,
    parseLineLimitDirective,
    resolveLineLimit,
} from '../../decorations/lineLength';

suite('OWEN MCNP line-length guard', () => {
    test('default limit is the classic 80-column card image', () => {
        assert.strictEqual(MCNP_DEFAULT_LINE_LIMIT, 80);
    });

    test('expandedWidth counts tabs to the next 8-column stop', () => {
        assert.strictEqual(expandedWidth('abc'), 3);
        assert.strictEqual(expandedWidth('\t'), 8);
        assert.strictEqual(expandedWidth('a\t'), 8); // 1 → next stop at 8
        assert.strictEqual(expandedWidth('abcdefg\t'), 8); // 7 → 8
        assert.strictEqual(expandedWidth('abcdefgh\t'), 16); // 8 → 16
    });

    test('flags lines longer than the limit', () => {
        const short = 'c '.padEnd(80, 'x'); // exactly 80
        const long = 'c '.padEnd(81, 'x'); // 81 columns
        const text = [short, long, 'm1 92235.80c 1.0'].join('\n');
        const over = findOverlengthLines(text, 80);
        assert.strictEqual(over.length, 1);
        assert.strictEqual(over[0].line, 1);
        assert.strictEqual(over[0].startCol, 80);
        assert.strictEqual(over[0].expandedLength, 81);
    });

    test('80-column line is allowed; 81 is flagged', () => {
        assert.strictEqual(findOverlengthLines('x'.repeat(80), 80).length, 0);
        assert.strictEqual(findOverlengthLines('x'.repeat(81), 80).length, 1);
    });

    test('tab expansion can push an apparently-short line over the limit', () => {
        // 75 visible chars + a tab that expands well past 80.
        const line = 'x'.repeat(79) + '\t' + 'y';
        const over = findOverlengthLines(line, 80);
        assert.strictEqual(over.length, 1);
        assert.ok(over[0].expandedLength > 80);
    });

    test('honors a custom (e.g. MCNP6.2 128-column) limit', () => {
        const line = 'x'.repeat(100);
        assert.strictEqual(findOverlengthLines(line, 80).length, 1);
        assert.strictEqual(findOverlengthLines(line, 128).length, 0);
    });
});

suite('OWEN MCNP line-limit dialect resolution', () => {
    test('constants match the documented dialects (80 for ≤6.1, 128 for 6.2+)', () => {
        assert.strictEqual(MCNP_LEGACY_LINE_LIMIT, 80);
        assert.strictEqual(MCNP_MODERN_LINE_LIMIT, 128);
    });

    test('dialect mcnp6.1-and-earlier resolves to 80', () => {
        const r = resolveLineLimit('title', { dialect: 'mcnp6.1-and-earlier', customLimit: 999 });
        assert.strictEqual(r.limit, 80);
        assert.strictEqual(r.source, 'dialect');
    });

    test('dialect mcnp6.2+ resolves to 128 and does not flag cols 81–128', () => {
        const r = resolveLineLimit('title', { dialect: 'mcnp6.2+' });
        assert.strictEqual(r.limit, 128);
        // col 81..128 content is fine at 128; col 129 is not.
        assert.strictEqual(findOverlengthLines('x'.repeat(128), r.limit).length, 0);
        assert.strictEqual(findOverlengthLines('x'.repeat(129), r.limit).length, 1);
    });

    test('dialect custom honors owen.mcnp.lineLengthLimit', () => {
        const r = resolveLineLimit('title', { dialect: 'custom', customLimit: 96 });
        assert.strictEqual(r.limit, 96);
        assert.strictEqual(r.source, 'custom');
    });

    test('dialect custom without a usable number falls back to the 80 default', () => {
        const r = resolveLineLimit('title', { dialect: 'custom', customLimit: 0 });
        assert.strictEqual(r.limit, MCNP_DEFAULT_LINE_LIMIT);
        assert.strictEqual(r.source, 'default');
    });

    test('legacy: dialect unset but lineLengthLimit=128 keeps working', () => {
        const r = resolveLineLimit('title', { customLimit: 128 });
        assert.strictEqual(r.limit, 128);
        assert.strictEqual(r.source, 'custom');
    });

    test('nothing configured resolves to the portable 80 default', () => {
        const r = resolveLineLimit('title', {});
        assert.strictEqual(r.limit, 80);
        assert.strictEqual(r.source, 'default');
    });

    test('tab expansion still applies in the 128 dialect', () => {
        // 121 chars + tab expands to 128, then one more char overflows.
        const ok = 'x'.repeat(121) + '\t';
        const over = 'x'.repeat(121) + '\t' + 'y';
        assert.strictEqual(findOverlengthLines(ok, 128).length, 0);
        assert.strictEqual(findOverlengthLines(over, 128).length, 1);
    });

    test('file directive c owen: line-limit=128 parses and wins over settings', () => {
        const text = [
            'pin cell demo',
            'c owen: line-limit=128',
            '1 1 -10.4 -1 imp:n=1',
        ].join('\n');
        const d = parseLineLimitDirective(text);
        assert.ok(d);
        assert.strictEqual(d!.limit, 128);
        assert.strictEqual(d!.line, 1);
        const r = resolveLineLimit(text, { dialect: 'mcnp6.1-and-earlier', customLimit: 80 });
        assert.strictEqual(r.limit, 128);
        assert.strictEqual(r.source, 'file-directive');
        assert.strictEqual(r.directiveLine, 1);
    });

    test('directive is case-insensitive and tolerates spacing', () => {
        assert.strictEqual(parseLineLimitDirective('C OWEN: LINE-LIMIT = 96')?.limit, 96);
        assert.strictEqual(parseLineLimitDirective('  c owen:line-limit=72')?.limit, 72);
    });

    test('directive outside the first 10 lines is ignored', () => {
        const text = Array(10).fill('c filler').concat('c owen: line-limit=128').join('\n');
        assert.strictEqual(parseLineLimitDirective(text), null);
    });

    test('directive with an out-of-range value is ignored', () => {
        assert.strictEqual(parseLineLimitDirective('c owen: line-limit=0'), null);
        assert.strictEqual(parseLineLimitDirective('c owen: line-limit=99999'), null);
    });

    test('a c card with trailing junk is not a directive', () => {
        assert.strictEqual(parseLineLimitDirective('c owen: line-limit=128 please'), null);
    });

    test('describeLineLimit names the dialect that produced the warning', () => {
        assert.match(
            describeLineLimit(resolveLineLimit('t', {})),
            /6\.1 limit; 6\.2\+ allows 128/,
        );
        assert.match(
            describeLineLimit(resolveLineLimit('t', { dialect: 'mcnp6.2+' })),
            /MCNP 6\.2\+ limit/,
        );
        assert.match(
            describeLineLimit(resolveLineLimit('t', { dialect: 'custom', customLimit: 96 })),
            /owen\.mcnp\.lineLengthLimit/,
        );
        assert.match(
            describeLineLimit(resolveLineLimit('c owen: line-limit=128', {})),
            /line-limit=128' on line 1/,
        );
    });
});
