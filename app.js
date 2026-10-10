// framework PLS
// formula
// limiar

const BANNED_LIST = [
  "Alrund's Epiphany",
  "Divide by Zero",
  "The Meathook Massacre",
  "Fable of the Mirror-Breaker",
  "Reckoner Bankbuster",
  "Invoke Despair",
  "Heartfire Hero",
  "Monstrous Rage",
  "Hopeless Nightmare",
  "Cori-Steel Cutter",
  "Abuelo's Awakening",
  "This Town Ain't Big Enough",
  "Up the Beanstalk",
  "Screaming Nemesis",
  "Vivi Ornitier",
  "Proft's Eidetic Memory",
  "Badgermole Cub",
  "Stormchaser's Talent",
  "Gran-Gran"
];

const FALLBACK_LIMIAR = 7.0;
let calibracao = { limiar: null, media: null, desvio: null, resultados: [] };
let ultimoSingle = null;
let ultimoLote = [];

const $ = (id) => document.getElementById(id);

// util
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function norm(s) { return (s || "").toLowerCase().replace(/[’‘]/g, "'"); }
function parseStat(v) {
  if (v === null || v === undefined) return 0;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}
function getAlpha(cmc) {
  const c = Number(cmc) || 0;
  if (c <= 1) return 1.5;
  if (c === 2) return 1.3;
  if (c === 3) return 1.1;
  if (c === 4) return 1.0;
  if (c === 5) return 0.9;
  if (c === 6) return 0.7;
  return 0.4;
}
function getWeights() {
  let wPT = parseFloat($("wPT").value); if (isNaN(wPT) || wPT < 0) wPT = 0.20;
  let wIM = parseFloat($("wIM").value); if (isNaN(wIM) || wIM < 0) wIM = 0.45;
  let wVG = parseFloat($("wVG").value); if (isNaN(wVG) || wVG < 0) wVG = 0.35;
  return { wPT, wIM, wVG };
}
function getLimiar() {
  if (!$("useAuto").checked) return parseFloat($("manualLimiar").value) || FALLBACK_LIMIAR;
  if (calibracao.limiar !== null) return calibracao.limiar;
  return parseFloat($("manualLimiar").value) || FALLBACK_LIMIAR;
}

// normalizacao
function getOracle(card) {
  if (card.oracle_text) return card.oracle_text;
  if (Array.isArray(card.card_faces)) return card.card_faces.map(f => f.oracle_text || "").join("\n");
  return "";
}
function getKeywords(card) {
  if (Array.isArray(card.keywords) && card.keywords.length) return card.keywords.map(k => norm(k));
  if (Array.isArray(card.card_faces)) {
    const out = [];
    card.card_faces.forEach(f => { (f.keywords || []).forEach(k => out.push(norm(k))); });
    return out;
  }
  return [];
}
function getPT(card) {
  let p = card.power, t = card.toughness;
  if ((p === undefined) && Array.isArray(card.card_faces) && card.card_faces[0]) {
    p = card.card_faces[0].power; t = card.card_faces[0].toughness;
  }
  return { P: parseStat(p), T: parseStat(t) };
}
function getImage(card) {
  if (card.image_uris) return card.image_uris.small || card.image_uris.normal;
  if (Array.isArray(card.card_faces) && card.card_faces[0] && card.card_faces[0].image_uris)
    return card.card_faces[0].image_uris.small;
  return "";
}
function isCreature(card) { return norm(card.type_line || "").includes("creature"); }
function isExcluded(card) {
  const tl = norm(card.type_line || "");
  if (tl.includes("land")) return "Terrenos utilitários são casos especiais tratados individualmente (TCC Quadro 3).";
  if (tl.includes("battle")) return "Batalhas excluídas: pool pequeno, sem calibragem estatística (TCC Quadro 3).";
  return null;
}

// eixos
function calcPT(card, cmc) {
  if (!isCreature(card)) return 0;
  const { P, T } = getPT(card);
  const div = cmc > 0 ? cmc : 1;
  return (P + T) / div;
}

// IM
function calcIM(card, oracle, keywords) {
  let score = 0;
  const hits = [];
  const add = (label, pts) => { score += pts; hits.push({ label, pts }); };

  if (keywords.includes("haste")) add("Haste", 2.5);
  if (keywords.includes("flash")) add("Flash", 2.5);
  if (oracle.includes("destroy target nonland permanent")) add('o:"destroy target nonland permanent"', 3.5);
  else if (oracle.includes("destroy target creature")) add('o:"destroy target creature"', 3.0);
  if (oracle.includes("destroy all creatures")) add('o:"destroy all creatures"', 4.0);
  if (oracle.includes("exile target")) add('o:"exile target"', 3.5);
  if (oracle.includes("search your library")) add('o:"search your library"', 4.0);
  if (oracle.includes("counter target spell")) add('o:"counter target spell"', 3.0);
  if (oracle.includes("create") && oracle.includes("token") && oracle.includes("enter the battlefield")) add("ETB cria ficha", 1.5);
  else if (oracle.includes("create") && oracle.includes("token") && !oracle.includes("whenever")) add("Cria ficha (IM)", 1.5);
  if (oracle.includes("can't be blocked")) add('o:"can\'t be blocked"', 2.5);
  if (oracle.includes("each opponent loses")) add('o:"each opponent loses"', 1.5);
  if (oracle.includes("you gain") && oracle.includes("life") && !oracle.includes("deathtouch") && !oracle.includes("lifelink")) add("Ganho de vida", 0.5);
  if (oracle.includes("can't block") && !oracle.includes("can't be blocked")) add('o:"can\'t block"', 0.5);
  if (oracle.includes("each creature you control gets")) add("Bônus global de time", 2.5);
  if (oracle.includes("deals damage") && oracle.includes("each opponent")) add("Dano direto global", 1.5);
  if (keywords.includes("proliferate")) add("Proliferate", 1.0);
  if (keywords.includes("connive")) add("Connive", 1.5);
  if (keywords.includes("convoke")) add("Convoke", 1.0);

  if (norm(card.type_line || "").includes("instant")) add("Bônus velocidade (instant)", 0.5);
  return { score, hits };
}

// VG
function calcVG(card, oracle, keywords, P, T) {
  let score = 0;
  const hits = [];
  const add = (label, pts) => { score += pts; hits.push({ label, pts }); };
  const cap = (v, m) => Math.min(v, m);

  if (keywords.includes("flying")) add("Flying 1.0+P×0.2", cap(1.0 + P * 0.2, 2.5));
  if (keywords.includes("trample")) add("Trample 0.5+P×0.4", cap(0.5 + P * 0.4, 2.5));
  if (keywords.includes("deathtouch")) add("Deathtouch 2.5−P×0.4", Math.max(2.5 - P * 0.4, 0));
  if (keywords.includes("lifelink")) add("Lifelink 0.5+P×0.25", cap(0.5 + P * 0.25, 2.5));
  if (keywords.includes("double strike")) add("Double Strike 1.0+P×0.6", cap(1.0 + P * 0.6, 5.0));
  else if (keywords.includes("first strike")) add("First Strike 0.5+P×0.3", cap(0.5 + P * 0.3, 2.5));
  if (keywords.includes("menace")) add("Menace 0.5+P×0.3", cap(0.5 + P * 0.3, 2.5));
  if (keywords.includes("vigilance")) add("Vigilance 0.5+T×0.2", cap(0.5 + T * 0.2, 2.5));
  if (keywords.includes("hexproof")) add("Hexproof", 3.0);
  if (keywords.includes("ward") || oracle.includes("ward ")) add("Ward", 1.5);
  if (keywords.includes("reach")) add("Reach 0.3+T×0.1", cap(0.3 + T * 0.1, 1.0));
  if (keywords.includes("indestructible")) add("Indestructible", 3.5);
  if (oracle.includes("draw") && oracle.includes("card") && !oracle.includes("whenever")) add("Compra de carta", 2.0);
  if (/scry \d/.test(oracle)) add("Scry", 0.5);
  if (keywords.includes("surveil")) add("Surveil", 1.0);
  if (oracle.includes("at the beginning of your upkeep")) add("Gatilho de upkeep", 2.0);
  if (oracle.includes("whenever") && oracle.includes("draw a card")) add("Motor de compra (whenever draw)", 2.5);
  else if (oracle.includes("whenever") && oracle.includes("create") && oracle.includes("token")) add("Geração recorrente de fichas", 2.0);
  if (oracle.includes("return") && oracle.includes("from your graveyard")) add("Recursão de cemitério", 2.5);
  if (oracle.includes("put") && oracle.includes("+1/+1 counter")) add("Contador +1/+1", 1.0);
  if (keywords.includes("flashback")) add("Flashback", 2.0);
  if (oracle.includes("search") && oracle.includes("land") && oracle.includes("battlefield")) add("Busca terreno p/ campo", 2.0);

  return { score, hits };
}

// IC
const STOPWORDS = new Set(("the,a,an,of,to,and,or,you,your,it,its,is,are,was,were,be,as,at,by,for,from,in,on,into,that,this,these,those,with,when,whenever,each,all,target,up,do,does,if,then,than,not,no,can,may,control,until,end,turn,card,cards,battlefield,graveyard,library,hand,life,damage,counter,token,tap,untap,add,put,get,gain,lose,loses,draw,deals,create,destroy,exile,search,return,cast").split(","));
function calcIC(oracleRaw, allHits) {
  const semLembrete = (oracleRaw || "").replace(/\(.*?\)/gs, " ");
  const total = (norm(semLembrete).match(/[a-z0-9]+/g) || []).filter(w => !STOPWORDS.has(w));
  if (total.length === 0) return 1.0;
  const vocab = new Set();
  allHits.forEach(h => {
    (norm(h.label).match(/[a-z0-9]+/g) || []).forEach(w => { if (!STOPWORDS.has(w)) vocab.add(w); });
  });
  let cobertas = 0;
  total.forEach(w => { if (vocab.has(w)) cobertas++; });
  const cobertura = cobertas / total.length;
  return cobertura;
}

function faixaIC(ic) {
  if (ic >= 0.8) return "confiável";
  if (ic >= 0.5) return "parcial";
  return "baixa confiança — revisar manual";
}

// PLS
function calcPLS(card, weights) {
  const cmc = Number(card.cmc) || 0;
  const alpha = getAlpha(cmc);
  const oracleRaw = getOracle(card);
  const oracle = norm(oracleRaw);
  const keywords = getKeywords(card);
  const { P, T } = getPT(card);
  const criatura = isCreature(card);

  const pt = calcPT(card, cmc);
  const im = calcIM(card, oracle, keywords);
  const vg = calcVG(card, oracle, keywords, P, T);
  const allHits = im.hits.concat(vg.hits);
  const ic = calcIC(oracleRaw, allHits);

  let pls;
  if (criatura) {
    const s = weights.wPT + weights.wIM + weights.wVG || 1;
    pls = alpha * ((weights.wPT / s) * pt + (weights.wIM / s) * im.score + (weights.wVG / s) * vg.score);
  } else {
    const s = weights.wIM + weights.wVG || 1;
    pls = alpha * ((weights.wIM / s) * im.score + (weights.wVG / s) * vg.score);
  }
  return { cmc, alpha, pt, im: im.score, vg: vg.score, imHits: im.hits, vgHits: vg.hits, ic, pls, P, T, criatura };
}

function classify(pls, limiar) {
  if (pls >= limiar) return { txt: "Fora da curva (potencialmente desbalanceada)", cls: "bad" };
  if (pls >= limiar * 0.85) return { txt: "Atenção", cls: "warn" };
  return { txt: "Aceitável", cls: "ok" };
}

// Scryfall
async function fetchExact(name) {
  const url = "https://api.scryfall.com/cards/named?exact=" + encodeURIComponent(name.trim());
  const r = await fetch(url);
  if (r.status === 404) throw new Error("Carta não encontrada: " + name);
  if (!r.ok) throw new Error("Erro Scryfall (" + r.status + ") para: " + name);
  return r.json();
}
async function autocomplete(q) {
  if (!q || q.length < 3) return [];
  const r = await fetch("https://api.scryfall.com/cards/autocomplete?q=" + encodeURIComponent(q));
  if (!r.ok) return [];
  const j = await r.json();
  return j.data || [];
}

// render
function refreshLimiarLabel() {
  const l = getLimiar();
  $("limiarAtual").textContent = l.toFixed(2);
  $("alertaAtual").textContent = (l * 0.85).toFixed(2);
}
function cardHTML(card, calc) {
  const limiar = getLimiar();
  const st = classify(calc.pls, limiar);
  const img = getImage(card);
  const hits = calc.imHits.concat(calc.vgHits);
  const hitsHTML = hits.length
    ? "<ul class='hits'>" + hits.map(h => "<li>" + h.label + " → +" + h.pts.toFixed(2) + "</li>").join("") + "</ul>"
    : "<p class='hint'>Nenhum padrão detectado (IC pode ficar baixo).</p>";
  return "<div class='card'>"
    + "<div class='card top'>"
    + (img ? "<img src='" + img + "' alt=''>" : "")
    + "<div><h3>" + card.name + "</h3>"
    + "<p class='hint'>" + (card.type_line || "") + " | CMC " + calc.cmc + " | " + (calc.criatura ? calc.P + "/" + calc.T : "não-criatura") + "</p>"
    + "<p>PLS: <strong>" + calc.pls.toFixed(2) + "</strong> <span class='badge " + st.cls + "'>" + st.txt + "</span></p>"
    + "<p>IC: <strong>" + calc.ic.toFixed(2) + "</strong> (" + faixaIC(calc.ic) + ")</p>"
    + "</div></div>"
    + "<ul class='eixos'>"
    + "<li>α_cm = " + calc.alpha + "</li>"
    + "<li>PT = " + calc.pt.toFixed(2) + (calc.criatura ? " ((P+T)/cmc)" : " (N/A p/ não-criatura, peso renormalizado)") + "</li>"
    + "<li>IM = " + calc.im.toFixed(2) + "</li>"
    + "<li>VG = " + calc.vg.toFixed(2) + "</li>"
    + "</ul>"
    + "<details><summary>Ver padrões detectados (" + hits.length + ")</summary>" + hitsHTML + "</details>"
    + "</div>";
}

async function analisarSingle(nome) {
  const box = $("resultado");
  box.innerHTML = "<p>Buscando...</p>";
  try {
    const card = await fetchExact(nome);
    const excl = isExcluded(card);
    const calc = calcPLS(card, getWeights());
    ultimoSingle = { card, calc };
    refreshLimiarLabel();
    if (excl) box.innerHTML = "<p class='badge warn'>Excluída: " + excl + "</p>" + cardHTML(card, calc);
    else box.innerHTML = cardHTML(card, calc);
  } catch (e) {
    box.innerHTML = "<p class='badge bad'>Erro: " + e.message + "</p>";
  }
}

async function analisarLote() {
  const nomes = $("listaCartas").value.split("\n").map(s => s.trim()).filter(Boolean);
  const tbody = document.querySelector("#tabLote tbody");
  if (!nomes.length) { tbody.innerHTML = "<tr><td colspan='9'>Cole uma lista primeiro.</td></tr>"; return; }
  tbody.innerHTML = "<tr><td colspan='9'>Analisando " + nomes.length + " cartas (100ms entre chamadas)...</td></tr>";
  ultimoLote = [];
  for (const n of nomes) {
    try {
      const card = await fetchExact(n);
      const calc = calcPLS(card, getWeights());
      ultimoLote.push({ nome: card.name, cmc: calc.cmc, pt: calc.pt, im: calc.im, vg: calc.vg, pls: calc.pls, ic: calc.ic, card });
    } catch (e) {
      ultimoLote.push({ nome: n + " (erro)", cmc: "-", pt: 0, im: 0, vg: 0, pls: NaN, ic: 0, erro: true });
    }
    await sleep(110);
  }
  ultimoLote.sort((a, b) => (b.pls || -1) - (a.pls || -1));
  const vals = ultimoLote.filter(x => !x.erro).map(x => x.pls);
  const media = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const vari = vals.reduce((a, b) => a + (b - media) * (b - media), 0) / (vals.length || 1);
  const sd = Math.sqrt(vari);
  const ref = media + 2 * sd;
  $("loteResumo").textContent = "Lote: média " + media.toFixed(2) + " | σ " + sd.toFixed(2) + " | referência média+2σ = " + ref.toFixed(2);
  const limiar = getLimiar();
  tbody.innerHTML = ultimoLote.map((r, i) => {
    if (r.erro) return "<tr><td>" + (i + 1) + "</td><td>" + r.nome + "</td><td colspan='7'>não encontrada</td></tr>";
    const st = classify(r.pls, limiar);
    return "<tr><td>" + (i + 1) + "</td><td>" + r.nome + "</td><td>" + r.cmc + "</td><td>"
      + r.pt.toFixed(2) + "</td><td>" + r.im.toFixed(2) + "</td><td>" + r.vg.toFixed(2)
      + "</td><td><strong>" + r.pls.toFixed(2) + "</strong></td><td>" + r.ic.toFixed(2)
      + "</td><td><span class='badge " + st.cls + "'>" + st.txt + "</span></td></tr>";
  }).join("");
}

// calibracao
async function calibrar() {
  $("calStatus").textContent = "Calibrando... 0/" + BANNED_LIST.length;
  $("btnCalibrar").disabled = true;
  const w = getWeights();
  const rows = [];
  const plsList = [];
  try {
    for (let i = 0; i < BANNED_LIST.length; i++) {
      const nome = BANNED_LIST[i];
      try {
        const card = await fetchExact(nome);
        const c = calcPLS(card, w);
        rows.push({ nome: card.name, cmc: c.cmc, tipo: card.type_line, pls: c.pls });
        plsList.push(c.pls);
      } catch (e) {
        rows.push({ nome, cmc: "-", tipo: "erro: " + e.message, pls: NaN });
      }
      $("calStatus").textContent = "Calibrando... " + (i + 1) + "/" + BANNED_LIST.length;
      await sleep(110);
    }
    const validos = plsList.filter(Number.isFinite);
    const media = validos.reduce((a, b) => a + b, 0) / validos.length;
    const vari = validos.reduce((a, b) => a + (b - media) * (b - media), 0) / validos.length;
    const sd = Math.sqrt(vari);
    calibracao = { limiar: media, media, desvio: sd, resultados: rows };
    try { localStorage.setItem("pls_cal_v2", JSON.stringify(calibracao)); } catch (e) {}
    renderCalibracao();
    $("calStatus").textContent = "Calibrado com " + validos.length + "/" + BANNED_LIST.length + " cartas.";
  } finally {
    $("btnCalibrar").disabled = false;
  }
}
function renderCalibracao() {
  const tb = document.querySelector("#tabBanidas tbody");
  if (!calibracao.resultados.length) return;
  tb.innerHTML = calibracao.resultados.map(r =>
    "<tr><td>" + r.nome + "</td><td>" + r.cmc + "</td><td>" + (r.tipo || "") + "</td><td>"
    + (isFinite(r.pls) ? r.pls.toFixed(2) : "—") + "</td></tr>").join("");
  $("calResumo").textContent = "Média " + calibracao.media.toFixed(2) + " | σ " + calibracao.desvio.toFixed(2)
    + " | Limiar (média pura) = " + calibracao.limiar.toFixed(2);
  refreshLimiarLabel();
}

// carta manual
const KEYWORDS_AUTO = ["double strike", "first strike", "deathtouch", "indestructible", "proliferate", "hexproof", "lifelink", "vigilance", "trample", "convoke", "connive", "surveil", "flashback", "flying", "menace", "haste", "flash", "reach", "ward"];
function detectKeywords(texto) {
  const t = norm(texto);
  const found = [];
  KEYWORDS_AUTO.forEach(k => { if (t.includes(k)) found.push(k); });
  return found;
}
function analisarCustom() {
  const box = $("resultadoManual");
  const nome = $("mNome").value.trim() || "Carta personalizada (designer)";
  const cmc = Math.max(0, parseInt($("mCmc").value, 10) || 0);
  const tipo = $("mTipo").value;
  const P = parseStat($("mPoder").value);
  const T = parseStat($("mRes").value);
  const texto = $("mTexto").value || "";
  const kw = detectKeywords(texto);
  const card = {
    name: nome,
    cmc: cmc,
    type_line: tipo === "Creature" ? "Creature (custom)" : tipo + " (custom)",
    power: String(P),
    toughness: String(T),
    oracle_text: texto,
    keywords: kw.map(k => k.charAt(0).toUpperCase() + k.slice(1))
  };
  const calc = calcPLS({ ...card, keywords: kw }, getWeights());
  refreshLimiarLabel();
  const kwTxt = kw.length ? kw.join(", ") : "nenhuma detectada";
  box.innerHTML = "<p class='hint'>Keywords auto-detectadas: <strong>" + kwTxt + "</strong></p>" + cardHTML(card, calc);
}

// eventos
document.addEventListener("DOMContentLoaded", () => {
  try {
    const saved = JSON.parse(localStorage.getItem("pls_cal_v2") || "null");
    if (saved && saved.limiar) { calibracao = saved; renderCalibracao(); $("calStatus").textContent = "Limiar restaurado do cache. Recalibre se mudar os pesos."; }
  } catch (e) {}
  refreshLimiarLabel();

  $("btnBuscar").addEventListener("click", () => analisarSingle($("nomeCarta").value));
  $("nomeCarta").addEventListener("keydown", (e) => { if (e.key === "Enter") analisarSingle($("nomeCarta").value); });
  $("nomeCarta").addEventListener("input", async (e) => {
    const lista = await autocomplete(e.target.value);
    $("sugestoes").innerHTML = lista.map(n => "<option value='" + n.replace(/'/g, "&#39;") + "'>").join("");
  });
  document.querySelectorAll("[data-test]").forEach(b =>
    b.addEventListener("click", () => { $("nomeCarta").value = b.dataset.test; analisarSingle(b.dataset.test); }));
  $("btnLote").addEventListener("click", analisarLote);
  $("btnManual").addEventListener("click", analisarCustom);
  $("btnCalibrar").addEventListener("click", calibrar);
  $("btnRecalc").addEventListener("click", () => {
    refreshLimiarLabel();
    if (ultimoSingle) $("resultado").innerHTML = cardHTML(ultimoSingle.card, calcPLS(ultimoSingle.card, getWeights()));
    if (ultimoLote.length) analisarLote();
    if (calibracao.resultados.length) calibrar();
  });
  ["wPT", "wIM", "wVG", "manualLimiar", "useAuto"].forEach(id =>
    $(id).addEventListener("change", refreshLimiarLabel));

  calibrar();
});
