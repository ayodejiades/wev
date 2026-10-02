/**
 * tools/make-thumbnail.ts — renders the 3:2 Devpost picture.
 *
 * `docs/devpost/thumbnail.html` is the source (1800x1200, tokens copied from
 * app/globals.css). Headless Chrome screenshots it; sips writes the jpeg. Output:
 * docs/devpost/thumbnail.png, docs/devpost/thumbnail.jpg and public/thumbnail.png
 * so the deployed site serves the same picture.
 *
 * The numbers on the card are read back out of evidence/ and compared with the ones
 * in the html, so "every number is measured" is enforced here the same way
 * `pnpm claim:verify` enforces it everywhere else. Run `pnpm thumbnail` after editing
 * the html; it needs network on the first render because the webfonts come from Google.
 */
import {execFileSync, spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(join(root, "docs", "devpost", "thumbnail.html"), "utf8");
const htmlPath = join(root, "docs", "devpost", "thumbnail.html");
const pngPath = join(root, "docs", "devpost", "thumbnail.png");
const jpgPath = join(root, "docs", "devpost", "thumbnail.jpg");
const publicPath = join(root, "public", "thumbnail.png");

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const width = 1800;
const height = 1200;

function evidenceNumbers(): {cells: string[]; baseline: string} {
	const calibration = JSON.parse(readFileSync(join(root, "evidence", "calibration.json"), "utf8"));
	const captured = JSON.parse(readFileSync(join(root, "evidence", "captured-runs.json"), "utf8"));
	const heldout = calibration.gate.heldout;
	const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
	return {
		cells: [
			`${captured.correct}/${captured.total}`,
			`${heldout.autoHandled}/${heldout.total}`,
			percent(heldout.accuracyAtCoverage),
		],
		baseline: percent(heldout.baselineAccuracy),
	};
}

if (!existsSync(htmlPath)) {
	console.error(`make-thumbnail: ${htmlPath} is missing`);
	process.exit(1);
}
if (!existsSync(chromePath)) {
	console.error(`make-thumbnail: no Chrome at ${chromePath}`);
	process.exit(1);
}

// The three stat cells are read as rendered text, because the card splits a number
// across elements (`60.0<em>%</em>`) and the raw source never contains "60.0%". A bare
// "5" would match any digit on the page, so the cells are compared whole, in order.
const paintedCells = [...html.matchAll(/<div class="n display">(.*?)<\/div>/g)].map((match) =>
	match[1].replace(/<[^>]*>/g, ""),
);
const {cells, baseline} = evidenceNumbers();
const drift = cells.filter((cell, i) => paintedCells[i] !== cell);
if (paintedCells.length !== cells.length || drift.length > 0) {
	console.error(
		`make-thumbnail: evidence/ says the card should read ${cells.join(" | ")}, but thumbnail.html paints ${paintedCells.join(" | ")}.\n` +
			"  The card must show the measured numbers, not a remembered one. Re-run pnpm capture && pnpm calibrate, then copy the values across.",
	);
	process.exit(1);
}
if (!html.includes(baseline)) {
	console.error(`make-thumbnail: the always-trust baseline (${baseline}) is missing from thumbnail.html`);
	process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "wev-thumbnail-"));
const chrome = spawn(
	chromePath,
	[
		"--headless=new",
		"--disable-gpu",
		"--hide-scrollbars",
		"--force-device-scale-factor=1",
		`--user-data-dir=${profile}`,
		`--window-size=${width},${height}`,
		`--screenshot=${pngPath}`,
		`file://${htmlPath}`,
	],
	{stdio: "ignore"},
);

// Chrome's --screenshot has no "fonts loaded" signal, so give the webfont fetch a
// fixed window, then check the file rather than trusting the exit code.
setTimeout(() => {
	chrome.kill();

	const bytes = existsSync(pngPath) ? statSync(pngPath).size : 0;
	if (bytes < 20_000) {
		console.error(`make-thumbnail: ${pngPath} is ${bytes} bytes — the webfonts did not load`);
		process.exit(1);
	}

	execFileSync("sips", [
		"-s",
		"format",
		"jpeg",
		"-s",
		"formatOptions",
		"92",
		pngPath,
		"--out",
		jpgPath,
	]);
	execFileSync("cp", [pngPath, publicPath]);

	console.log(`make-thumbnail: ${width}x${height} (3:2) -> docs/devpost/thumbnail.png, thumbnail.jpg, public/thumbnail.png`);
}, 6000);