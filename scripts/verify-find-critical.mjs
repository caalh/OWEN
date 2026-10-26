/**
 * owen.findCritical's search, against the diffusion radius computed here.
 * command owen.findCritical
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('assert');
const { criticalRadius } = require('../out/src/mc/critical.js');

const mat = { sigmaS: 0.8, sigmaA: 0.2, sigmaF: 0.1, nu: 2.2 };
const sigmaT = mat.sigmaS + mat.sigmaA;
const d = 0.7104 / sigmaT;
const L2 = (1 / (3 * sigmaT)) / mat.sigmaA;
const kInf = (mat.nu * mat.sigmaF) / mat.sigmaA;
const B = Math.sqrt((kInf - 1) / L2);
const rDiffusion = Math.PI / B - d;

const found = criticalRadius(mat, { particles: 6000, cycles: 24, inactive: 8, seed: 11 }, { lo: 4, hi: 30, iterations: 10 });
const allowance = 0.03 * rDiffusion + found.bracketCm;
console.log(`  critical R ${found.radiusCm.toFixed(3)} vs diffusion ${rDiffusion.toFixed(3)}`);
assert.ok(Math.abs(found.radiusCm - rDiffusion) <= allowance, `${found.radiusCm} vs ${rDiffusion}`);
console.log('verify:find-critical OK');
