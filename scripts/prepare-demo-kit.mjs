import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(project, "demo", "verdean-test-kit");
const kit = resolve(process.env.VERDEAN_TEST_KIT_DIR || join(homedir(), "Desktop", "Verdean Test Kit"));
const baseline = join(kit, "01 - CONNECT THIS FOLDER");
const optional = join(kit, "02 - OPTIONAL DROP-INS");
const assets = join(kit, "assets");
const canonical = join(project, "examples", "example-quote-renewal");
const expected = [
  "01_supplier_quote.txt",
  "02_buyer_email.txt",
  "02a_supplier_invoice.txt",
  "03_call_transcript.txt",
  "04_signed_contract.txt",
];
const commands = ["Open Verdean.command", "Reset Test Kit.command", "Verify Test Kit.command"];

if (basename(kit) !== "Verdean Test Kit") {
  throw new Error(`Refusing to prepare an unexpected directory: ${kit}`);
}

async function removeMetadata(directory) {
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.name === ".DS_Store") await rm(path, { force: true });
    else if (entry.isDirectory()) await removeMetadata(path);
  }
}

await mkdir(baseline, { recursive: true });
await mkdir(optional, { recursive: true });
await mkdir(assets, { recursive: true });

await rm(join(baseline, "_Verdean"), { recursive: true, force: true });
for (const stale of [
  join(baseline, "05_alternate_matching_contract.txt"),
  join(baseline, "06_manual_review_required.md"),
  join(kit, "05_alternate_matching_contract.txt"),
]) await rm(stale, { force: true });

for (const name of ["START HERE - VERDEAN TEST GUIDE.html", ...commands]) {
  await copyFile(join(source, name), join(kit, name));
}
for (const name of ["05_alternate_matching_contract.txt", "05_alternate_matching_contract_scan.png", "06_manual_review_required.md"]) {
  await copyFile(join(source, "02 - OPTIONAL DROP-INS", name), join(optional, name));
}
for (const name of expected) {
  await copyFile(join(canonical, name), join(baseline, name));
  const [sourceBytes, copiedBytes] = await Promise.all([readFile(join(canonical, name)), readFile(join(baseline, name))]);
  if (!sourceBytes.equals(copiedBytes)) throw new Error(`Fixture verification failed: ${name}`);
}

const howItWorks = (await readFile(join(project, "docs", "verdean-how-it-works.html"), "utf8"))
  .replace('href="brand/verdean-document.css"', 'href="assets/verdean-document.css"')
  .replace('src="../public/verdean-horizontal.svg"', 'src="assets/verdean-horizontal.svg"');
await writeFile(join(kit, "HOW VERDEAN WORKS.html"), howItWorks);
await copyFile(join(project, "docs", "brand", "verdean-document.css"), join(assets, "verdean-document.css"));
await copyFile(join(project, "public", "verdean-horizontal.svg"), join(assets, "verdean-horizontal.svg"));

for (const command of commands) await chmod(join(kit, command), 0o755);
await removeMetadata(kit);

console.log(`Prepared the complete Verdean Test Kit at:\n  ${kit}`);
console.log(`Baseline: ${expected.length} canonical files; generated output and optional drop-ins removed.`);
