#!/usr/bin/env node
// Standing check for the results readers (src/results/**).
//
// Why this exists: every one of these parsers used to be a regex guess against
// a format nobody had looked at, validated by fixtures written to match the
// guess (MCNP tally values were hardcoded to 0; a "flux spectrum" was assembled
// from any line holding two numbers; the OpenMC statepoint reader asked h5wasm
// for a filesystem it does not expose there, so it always fell back). The
// checks below pin each reader to a file in the format the code actually emits.
//
// Ground truth:
//   * OpenMC — a real statepoint, tallies.out and log from OpenMC 0.15.3, with
//     the expected numbers taken from OpenMC's own Python API.
//   * MCNP outp — layout copied from production output; if real MCNP output is
//     present on this machine (OWEN_MCNP_OUTP, or the research-decks research
//     outputs), it is parsed too and the internal identity
//     (Li6 + Li7 + F19 == total) has to hold.
//   * mctal / Serpent / SCONE — fixtures in the documented layouts; see
//     src/test/fixtures/README.md for where each layout came from.
//
// Run: node ./scripts/verify-results.mjs   (needs `tsc -p .` first)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const FIX = path.join(repo, 'src', 'test', 'fixtures');

const OUT = path.join(repo, 'out', 'src', 'results');
if (!fs.existsSync(OUT)) {
    console.error(`Compiled output missing at ${OUT}. Run: npx tsc -p .`);
    process.exit(1);
}
const mcnp = require(path.join(OUT, 'parsers', 'mcnp.js'));
const mctal = require(path.join(OUT, 'parsers', 'mctal.js'));
const openmc = require(path.join(OUT, 'parsers', 'openmc.js'));
const serpent = require(path.join(OUT, 'parsers', 'serpent.js'));
const scone = require(path.join(OUT, 'parsers', 'scone.js'));
const detect = require(path.join(OUT, 'detectOutputs.js'));

let pass = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) {
        pass++;
        return true;
    }
    failures.push(detail ? `${name} — ${detail}` : name);
    return false;
}
function close(name, got, want, tol) {
    const ok = Number.isFinite(got) && Math.abs(got - want) <= tol;
    return check(name, ok, `expected ${want} ± ${tol}, got ${got}`);
}
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

// ---------------------------------------------------------------- MCNP outp
{
    const r = mcnp.parseMcnpText(read('mcnp_outp.txt'), 'mcnp_outp.txt');
    check('outp: identified as mcnp', r.code === 'mcnp');
    check('outp: three tallies', r.tallies.length === 3, `got ${r.tallies.length}`);
    const t4 = r.tallies.find((t) => t.id === '4');
    close('outp: F4 total value', t4?.value, 1.26947e-1, 1e-8);
    close('outp: F4 relative error', t4?.error, 0.0012, 1e-9);
    check('outp: F4 has six energy bins + total', t4?.bins?.length === 6, `got ${t4?.bins?.length}`);
    check('outp: F4 passed the 10 checks', t4?.checks === 'passed', `got ${t4?.checks}`);
    close('outp: F4 FOM', t4?.fom, 66340, 1);
    check('outp: F4 TFC history has 4 rows', t4?.history?.x.length === 4, `got ${t4?.history?.x.length}`);
    const t7 = r.tallies.find((t) => t.id === '7');
    close('outp: F7 value', t7?.value, 2.84512e-1, 1e-8);
    check('outp: F7 flagged as missing a check', t7?.checks === 'missed', `got ${t7?.checks}`);
    const t14 = r.tallies.find((t) => t.id === '14');
    check('outp: zero tally flagged', t14?.checks === 'zero', `got ${t14?.checks}`);
    close('outp: final combined keff', r.keff?.final?.mean, 1.31231, 1e-9);
    close('outp: final keff std dev', r.keff?.final?.std, 0.00054, 1e-9);
    check('outp: spectrum extracted', r.spectra.length === 1, `got ${r.spectra.length}`);
    close('outp: spectrum first energy is eV', r.spectra[0]?.E[0], 1.0e3, 1e-6);
    check('outp: histories', r.metadata?.histories === 2000000, `got ${r.metadata?.histories}`);
    close('outp: computer time', r.metadata?.computerTimeMin, 31.42, 1e-9);
    check('outp: warnings captured', (r.warnings ?? []).length >= 2, `got ${(r.warnings ?? []).length}`);
    check(
        'outp: energy rows are not mistaken for extra tallies',
        r.tallies.every((t) => Number.isFinite(t.value)),
    );
    // The confidence-interval and "value at nps+1" tables sit inside the tally
    // block and are full of number pairs; none may become a bin.
    check(
        'outp: diagnostic tables excluded from bins',
        (t7?.bins?.length ?? 0) === 1,
        `F7 bins: ${t7?.bins?.length}`,
    );
}

// --------------------------------------------------------------------- mctal
{
    const r = mcnp.parseMcnpText(read('sample.mctal'), 'sample.mctal');
    check('mctal: recognised', mctal.looksLikeMctal(read('sample.mctal')));
    check('mctal: two tallies', r.tallies.length === 2, `got ${r.tallies.length}`);
    const t4 = r.tallies.find((t) => t.id === '4');
    close('mctal: tally 4 value from TFC bin', t4?.value, 1.26947e-1, 1e-8);
    check('mctal: tally 4 bins', t4?.bins?.length === 6, `got ${t4?.bins?.length}`);
    close('mctal: tally 4 first bin', t4?.bins?.[0]?.value, 4.32106e-3, 1e-9);
    check('mctal: spectrum from energy bins', r.spectra.length === 1, `got ${r.spectra.length}`);
    check('mctal: history from tfc rows', t4?.history?.x.length === 4, `got ${t4?.history?.x.length}`);
    close('mctal: kcode keff last cycle', r.keff?.final?.mean, 1.31231, 1e-9);
    check('mctal: kcode cycles', r.keff?.mean.length === 5, `got ${r.keff?.mean.length}`);
    check('mctal: histories in metadata', r.metadata?.histories === 2000000, `got ${r.metadata?.histories}`);
}

// -------------------------------------------------------------------- OpenMC
{
    const sp = path.join(FIX, 'openmc_statepoint.30.h5');
    const r = await openmc.parseOpenmcStatepoint(sp);
    check('statepoint: read without falling back', !r.metadata?.parseError, r.metadata?.parseError);
    close('statepoint: combined keff', r.keff?.final?.mean, 1.3722300263744938, 1e-12);
    close('statepoint: combined keff std', r.keff?.final?.std, 0.010372654783378793, 1e-12);
    check('statepoint: 30 generations', r.keff?.mean.length === 30, `got ${r.keff?.mean.length}`);
    check('statepoint: 10 inactive', r.keff?.inactive === 10, `got ${r.keff?.inactive}`);
    check('statepoint: three tallies', r.tallies.length === 3, `got ${r.tallies.length}`);

    // Values below are what OpenMC's own Python API reports for this file.
    const spectrum = r.tallies.find((t) => t.label.includes('fuel spectrum'));
    close('statepoint: flux bin 1 mean', spectrum?.bins?.[0]?.value, 1.87803769, 1e-7);
    close('statepoint: flux bin 1 rel err', spectrum?.bins?.[0]?.error, 0.01098847, 1e-7);
    close('statepoint: flux bin 3 mean', spectrum?.bins?.[2]?.value, 4.38857139, 1e-7);
    const rates = r.tallies.find((t) => t.label.includes('fuel rates'));
    check('statepoint: nuclide-major score order', rates?.bins?.length === 6, `got ${rates?.bins?.length}`);
    close('statepoint: U235 fission', rates?.bins?.[0]?.value, 0.52795133, 1e-7);
    close('statepoint: U235 nu-fission', rates?.bins?.[2]?.value, 1.28333347, 1e-7);
    close('statepoint: U238 fission', rates?.bins?.[3]?.value, 0.02906996, 1e-7);
    check(
        'statepoint: U238 bins labelled U238',
        (rates?.bins?.[3]?.label ?? '').includes('U238'),
        rates?.bins?.[3]?.label,
    );
    check('statepoint: mesh tally emitted', r.meshTallies.length === 1, `got ${r.meshTallies.length}`);
    const mesh = r.meshTallies[0];
    check('statepoint: mesh dimensions', mesh?.nx === 4 && mesh?.ny === 4 && mesh?.nz === 1);
    check('statepoint: mesh values', mesh?.values.length === 16, `got ${mesh?.values.length}`);
    close('statepoint: mesh centre value', Math.max(...(mesh?.values ?? [0])), 0.11035748, 1e-7);
    close('statepoint: mesh bounds', mesh?.bounds?.xmin, -0.63, 1e-9);
    check('statepoint: energy spectrum emitted', r.spectra.length === 1, `got ${r.spectra.length}`);
    check('statepoint: spectrum has 4 points', r.spectra[0]?.E.length === 4, `got ${r.spectra[0]?.E.length}`);

    const tallies = openmc.parseOpenmcTalliesOut(read('openmc_tallies.out'), 'openmc_tallies.out');
    check('tallies.out: three tallies', tallies.tallies.length === 3, `got ${tallies.tallies.length}`);
    close('tallies.out: flux bin 1', tallies.tallies[0]?.bins?.[0]?.value, 1.87804, 1e-5);
    close('tallies.out: std dev converted to rel err', tallies.tallies[0]?.bins?.[0]?.error, 0.0109885, 1e-6);
    check(
        'tallies.out: nuclide context kept',
        (tallies.tallies[1]?.bins?.[3]?.label ?? '').includes('U238'),
        tallies.tallies[1]?.bins?.[3]?.label,
    );

    const log = openmc.parseOpenmcStdout(read('openmc_run.log'), 'openmc_run.log');
    close('log: combined keff', log.keff?.final?.mean, 1.37223, 1e-9);
    check('log: 30 batch rows', log.keff?.mean.length === 30, `got ${log.keff?.mean.length}`);
    check('log: inactive inferred', log.keff?.inactive === 10, `got ${log.keff?.inactive}`);
    check('log: version', log.metadata?.code === 'OpenMC 0.15.3', `got ${log.metadata?.code}`);
    check(
        'log: all four estimators kept',
        ['collision', 'track-length', 'absorption', 'combined'].every(
            (k) => log.metadata?.[`k-effective (${k})`] != null,
        ),
    );
}

// ------------------------------------------------------------------- Serpent
{
    const r = serpent.parseSerpentResults(read('sample_res.m'), 'sample_res.m');
    check('res.m: recognised', serpent.looksLikeSerpentRes(read('sample_res.m')));
    close('res.m: IMP_KEFF final', r.keff?.final?.mean, 1.28443, 1e-9);
    check('res.m: two burnup steps', r.keff?.mean.length === 2, `got ${r.keff?.mean.length}`);
    close('res.m: relative error converted to absolute', r.keff?.final?.std, 1.28443 * 0.00101, 1e-9);
    check('res.m: estimator recorded', r.metadata?.keffEstimator === 'IMP_KEFF', `got ${r.metadata?.keffEstimator}`);
    check('res.m: version text', r.metadata?.code === 'Serpent 2.1.32', `got ${r.metadata?.code}`);
    const fiss = r.tallies.find((t) => t.id === 'TOT_FISSRATE');
    close('res.m: TOT_FISSRATE from last step', fiss?.value, 6.7011e-1, 1e-9);
    check('res.m: ANA_KEFF exposed as a result too', !!r.tallies.find((t) => t.id === 'ANA_KEFF'));
    check(
        'res.m: burnup note raised',
        (r.notes ?? []).some((n) => /burnup/i.test(n)),
    );

    const d = serpent.parseSerpentResults(read('sample_det0.m'), 'sample_det0.m');
    check('det.m: recognised', serpent.looksLikeSerpentDet(read('sample_det0.m')));
    const spec = d.tallies.find((t) => t.id === 'FluxSpec');
    check('det.m: detector found', !!spec);
    check('det.m: five bins', spec?.bins?.length === 5, `got ${spec?.bins?.length}`);
    close('det.m: value is column 11', spec?.bins?.[0]?.value, 4.53211e-3, 1e-12);
    close('det.m: error is column 12', spec?.bins?.[0]?.error, 0.012, 1e-12);
    check('det.m: spectrum from the E matrix', d.spectra.length === 1, `got ${d.spectra.length}`);
    close('det.m: Emid converted MeV → eV', d.spectra[0]?.E[0], 0.312505, 1e-6);
    const total = d.tallies.find((t) => t.id === 'TotalFlux');
    close('det.m: single-row detector', total?.value, 3.6e-2, 1e-12);
}

// --------------------------------------------------------------------- SCONE
{
    const r = scone.parseSconeOutput(read('sample_scone.m'), 'sample_scone.m');
    check('scone.m: recognised', scone.looksLikeSconeOutput(read('sample_scone.m')));
    close('scone.m: active keff wins over inactive', r.keff?.final?.mean, 1.30124, 1e-9);
    check('scone.m: population', r.metadata?.population === 5000, `got ${r.metadata?.population}`);
    check('scone.m: active cycles', r.metadata?.activeCycles === 300, `got ${r.metadata?.activeCycles}`);
    const flux = r.tallies.find((t) => t.id === 'active_fluxSpectrum');
    check('scone.m: clerk Res array parsed', flux?.bins?.length === 4, `got ${flux?.bins?.length}`);
    close('scone.m: first bin mean', flux?.bins?.[0]?.value, 4.53211e-3, 1e-12);
    close('scone.m: std dev converted to rel err', flux?.bins?.[0]?.error, 5.4e-5 / 4.53211e-3, 1e-9);
    check('scone.m: energy map spectrum', r.spectra.length === 1, `got ${r.spectra.length}`);
    const power = r.tallies.find((t) => t.id === 'active_pinPower');
    check(
        'scone.m: material map labels bins',
        (power?.bins?.[0]?.label ?? '').includes('fuel'),
        power?.bins?.[0]?.label,
    );

    const c = scone.parseSconeOutput(read('sample_scone_console.txt'), 'console');
    check('scone console: 8 cycles', c.keff?.mean.length === 8, `got ${c.keff?.mean.length}`);
    close('scone console: last keff', c.keff?.final?.mean, 1.30124, 1e-9);
}

// ------------------------------------------------------------------ detection
{
    const id = (f) => detect.identifyOutput(path.join(FIX, f));
    check('detect: mcnp outp', id('mcnp_outp.txt')?.code === 'mcnp', JSON.stringify(id('mcnp_outp.txt')));
    check('detect: mctal', id('sample.mctal')?.kind === 'mctal', JSON.stringify(id('sample.mctal')));
    check('detect: statepoint', id('openmc_statepoint.30.h5')?.kind === 'statepoint');
    // The old detector sent every .out file to the SCONE parser, so OpenMC's
    // tallies.out was read as SCONE output and produced nothing.
    check(
        'detect: openmc tallies.out is not claimed by SCONE',
        id('openmc_tallies.out')?.code === 'openmc',
        JSON.stringify(id('openmc_tallies.out')),
    );
    check('detect: openmc log', id('openmc_run.log')?.code === 'openmc', JSON.stringify(id('openmc_run.log')));
    check('detect: serpent res', id('sample_res.m')?.kind === 'resm', JSON.stringify(id('sample_res.m')));
    check('detect: serpent det', id('sample_det0.m')?.kind === 'detm', JSON.stringify(id('sample_det0.m')));
    check('detect: scone', id('sample_scone.m')?.code === 'scone', JSON.stringify(id('sample_scone.m')));
    const found = detect.detectOutputsInDir(FIX);
    check('detect: scans a directory', found.length >= 7, `got ${found.length}`);
    check('detect: statepoint wins as primary', detect.pickPrimaryOutput(found)?.kind === 'statepoint');
}

// ------------------------------------------------- real MCNP output, if present
{
    const candidates = [
        process.env.OWEN_MCNP_OUTP,
        path.join(
            path.dirname(repo),
            'research-decks',
            'ife-neutron-production',
            'mcnp',
            'outputs',
            '70-30_Base.txt',
        ),
    ].filter((p) => p && fs.existsSync(p));

    if (candidates.length === 0) {
        console.log('note: no real MCNP output found; skipped the live-file checks.');
    } else {
        const file = candidates[0];
        const r = mcnp.parseMcnpText(fs.readFileSync(file, 'utf8'), file);
        check('real outp: six tallies', r.tallies.length === 6, `got ${r.tallies.length}`);
        const byId = Object.fromEntries(r.tallies.map((t) => [t.id, t]));
        // Tally 64 is the total TBR; 14/24/34 are the Li6/Li7/F19 parts, so the
        // parts must add up to the total. A parser that grabbed the wrong number
        // pair fails this even if every value looks plausible on its own.
        const parts = ['14', '24', '34'].reduce((s, id) => s + (byId[id]?.value ?? 0), 0);
        close('real outp: parts sum to the total tally', parts, byId['64']?.value ?? NaN, 1e-13);
        check(
            'real outp: statistical checks read',
            r.tallies.filter((t) => t.checks === 'zero').length === 2,
            `zero tallies: ${r.tallies.filter((t) => t.checks === 'zero').length}`,
        );
        check(
            'real outp: every tally has a TFC history',
            r.tallies.every((t) => (t.history?.x.length ?? 0) > 0),
        );
        check('real outp: nps', r.metadata?.histories === 50000000, `got ${r.metadata?.histories}`);
        console.log(`note: also checked real MCNP output at ${file}`);
    }
}

console.log(`\nresults readers: ${pass} checks passed, ${failures.length} failed`);
if (failures.length) {
    for (const f of failures) console.error(`  FAIL  ${f}`);
    process.exit(1);
}
