#!/usr/bin/env node
/**
 * Generate PDF technical report for Proposition BKT + Hint Planning Module.
 *
 * Usage:
 *   node scripts/generate-prop-bkt-report-pdf.mjs
 *   node scripts/generate-prop-bkt-report-pdf.mjs --out docs/reports/custom.pdf
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPropBktPlanningReportBuffer } from "../src/agent/propBktPlanningReportPdf.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function parseOutArg() {
    const idx = process.argv.indexOf("--out");
    if (idx !== -1 && process.argv[idx + 1]) {
        return resolve(process.argv[idx + 1]);
    }
    return join(root, "docs", "reports", "Proposition-BKT-Planning-Module-Report.pdf");
}

const outPath = parseOutArg();
mkdirSync(dirname(outPath), { recursive: true });

const buffer = getPropBktPlanningReportBuffer();
writeFileSync(outPath, buffer);

console.log(`Wrote ${buffer.length} bytes to ${outPath}`);
