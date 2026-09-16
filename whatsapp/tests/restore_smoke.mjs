/**
 * Cycle 18 — Mongo session restore helpers (no Mongo required).
 * Run: node whatsapp/tests/restore_smoke.mjs
 */
import { isRegisteredCreds } from "../mongoAuthState.js";

let fail = 0;
function check(name, cond) {
  if (cond) console.log("PASS", name);
  else {
    console.log("FAIL", name);
    fail++;
  }
}

check("null", isRegisteredCreds(null) === false);
check("empty", isRegisteredCreds({}) === false);
check("registered false", isRegisteredCreds({ registered: false }) === false);
check("registered true", isRegisteredCreds({ registered: true }) === true);
check("me.id", isRegisteredCreds({ me: { id: "5511999999999:1@s.whatsapp.net" } }) === true);
check("me.lid", isRegisteredCreds({ registered: false, me: { lid: "123@lid" } }) === true);
check("unrelated", isRegisteredCreds({ noiseKey: {} }) === false);

if (fail) {
  console.error(`\n${fail} restore smoke check(s) failed`);
  process.exit(1);
}
console.log("\nAll restore smoke checks passed");
