/**
 * Quick NL intent smoke — run: node whatsapp/tests/nl_smoke.mjs
 */
import {
  detectIntent,
  parseAfterHour,
  parseDate,
  parseNightWindow,
  parseTime,
  isChangeOfMind,
} from "../nl.js";

let fail = 0;
function check(name, cond) {
  if (cond) console.log("PASS", name);
  else {
    console.log("FAIL", name);
    fail++;
  }
}

check("depois das 20", parseAfterHour("tem horário depois das 20?") === 20);
check("sabado noite window", parseNightWindow("sábado à noite") === 18);
check("time 20h", parseTime("quero às 20h") === "20:00");
check("8 da noite", parseTime("8 da noite") === "20:00");

const avail = detectIntent("sábado à noite tem horário?", { state: "idle" });
check("saturday night avail", avail.intent === "availability" && avail.afterHour === 18);

const park = detectIntent("tem estacionamento?", { state: "idle" });
check("parking", park.intent === "parking");

const dur = detectIntent("quanto tempo dura o jogo?", { state: "idle" });
check("duration", dur.intent === "duration");

const pix = detectIntent("como pagar no pix?", { state: "idle" });
check("pix", pix.intent === "pix_howto");

const aceita = detectIntent("aceita pix?", { state: "idle" });
check("aceita pix", aceita.intent === "pix_howto");

const end = detectIntent("qual o endereço?", { state: "idle" });
check("endereco", end.intent === "address");

const maps = detectIntent("manda o maps", { state: "idle" });
check("address/maps", maps.intent === "address");

const mind = detectIntent("na verdade amanhã às 21", {
  state: "awaiting_confirm",
  data: { date: "2099-01-01", time: "20:00", name: "X" },
});
check("change of mind", mind.intent === "change_mind");

check("isChangeOfMind", isChangeOfMind("mudei de ideia"));

const resched = detectIntent("quero remarcar", { state: "idle" });
check("reschedule", resched.intent === "reschedule");

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log("\nAll NL smoke checks passed");
