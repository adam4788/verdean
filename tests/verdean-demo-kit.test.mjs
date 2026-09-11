import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reset = await readFile(new URL("../demo/verdean-test-kit/Reset Test Kit.command", import.meta.url), "utf8");
const open = await readFile(new URL("../demo/verdean-test-kit/Open Verdean.command", import.meta.url), "utf8");
const guide = await readFile(new URL("../demo/verdean-test-kit/START HERE - VERDEAN TEST GUIDE.html", import.meta.url), "utf8");
const generator = await readFile(new URL("../scripts/prepare-demo-kit.mjs", import.meta.url), "utf8");

test("the prepared kit reset cleans files and returns Chrome to a fresh Verdean landing page", () => {
  assert.match(reset, /rm -rf "\$TEST_FOLDER\/_Verdean"/);
  assert.match(reset, /02a_supplier_invoice\.txt/);
  assert.match(reset, /Open Verdean\.command" --reset/);
  assert.match(open, /\?reset=1/);
  assert.match(guide, /returns Verdean to the disconnected landing page/i);
  assert.match(guide, /No folder connected/);
  assert.match(generator, /HOW VERDEAN WORKS\.html/);
});