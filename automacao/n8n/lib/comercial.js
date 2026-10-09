/*
 * Ápse · lógica comercial do n8n.
 *
 * Funções puras (sem rede, sem require) para rodar dentro do nó Code do n8n
 * e também em Node, nos testes. O build.mjs embute este arquivo nos fluxos.
 *
 * Tudo aqui é determinístico e explicável: nenhuma chamada de IA paga.
 */

const ETAPAS = [
  "NOVO",
  "QUALIFICADO",
  "AGUARDANDO_APROVACAO",
  "CONTATADO",
  "RESPONDEU",
  "REUNIAO",
  "PROPOSTA",
  "NEGOCIACAO",
  "GANHO",
  "PERDIDO",
  "NAO_CONTATAR",
];

// Etapas em que o fluxo nunca cria abordagem nova.
const ETAPAS_FECHADAS = ["GANHO", "PERDIDO", "NAO_CONTATAR"];
// Etapas em que a conversa está nas mãos do Juan (sem prospecção automática).
const ETAPAS_EM_CONVERSA = ["RESPONDEU", "REUNIAO", "PROPOSTA", "NEGOCIACAO"];

const CONFIG_PADRAO = {
  top_n: 5,
  ticket_minimo: 1500,
  moeda: "BRL",
  idioma_padrao: "en",
  segmentos_alvo:
    "nutricionista,nutrição,nutrition,saúde,health,clínica,clinic,psicólogo,psicologia,psychologist,dentista,dentist,fisioterapia,physio,estética,aesthetic,advogado,advocacia,lawyer,law,arquiteto,arquitetura,architect,consultor,consultoria,consulting,coach,personal trainer,fitness,terapeuta,therapist,médico,doctor,restaurante,restaurant,imobiliária,real estate,limpeza,cleaning,limpieza,jardinagem,jardinería,gardening,landscaping,reforma,renovation,pintura,painting,manutenção,handyman,estética automotiva,auto detailing,salão,salon,beleza,beauty,barbearia,barber,pet,locadora,rental,turismo,tourism,tour",
  paises_prioritarios: "",
  dias_cooldown: 30,
  cadencia_followup_dias: "3,7,14",
  dias_negociacao_parada: 5,
  max_envios_dia: 20,
  responsavel_nome: "Juan Carvalho",
  responsavel_email: "",
  empresa_nome: "Ápse",
  empresa_site: "",
  planilha_url: "",
};

/* ---------------------------------------------------------------- utilidades */

function semAcento(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function chave(s) {
  return semAcento(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function texto(v) {
  return v == null ? "" : String(v).trim();
}

function hash(s) {
  // FNV-1a 32 bits: estável, sem depender de crypto.
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function dataISO(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function parseData(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // Número serial do Google Sheets (dias desde 1899-12-30).
    if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return new Date(v);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // dd/mm/aaaa
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function diasEntre(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function lista(v) {
  return texto(v)
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function emailValido(e) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(texto(e));
}

function soDigitos(t) {
  return texto(t).replace(/\D/g, "");
}

function parseValor(v) {
  if (typeof v === "number") return v;
  const s = texto(v);
  if (!s) return null;
  const km = s.match(/(\d+(?:[.,]\d+)?)\s*(k|mil)\b/i);
  if (km) return parseFloat(km[1].replace(",", ".")) * 1000;
  let d = s.replace(/[^\d.,]/g, "");
  if (!d) return null;
  // "1.500,00" / "1,500.00" / "1500"
  if (/[.,]\d{2}$/.test(d)) d = d.slice(0, -3);
  d = d.replace(/[.,]/g, "");
  const n = parseInt(d, 10);
  return isNaN(n) ? null : n;
}

/* ------------------------------------------------------------------ config */

function lerConfig(linhas) {
  // Aba "Config" com colunas chave | valor. Linhas vazias usam o padrão.
  const cfg = Object.assign({}, CONFIG_PADRAO);
  for (const l of linhas || []) {
    const k = texto(l.chave || l.key || l.Chave);
    const v = l.valor !== undefined ? l.valor : l.value !== undefined ? l.value : l.Valor;
    if (k && texto(v) !== "") cfg[k] = typeof CONFIG_PADRAO[k] === "number" ? Number(v) : texto(v);
  }
  return cfg;
}

/* ------------------------------------------------------- leitura dos leads */

// Cabeçalhos aceitos da planilha existente (pt/en/es), já normalizados por chave().
const ALIASES = {
  nome: ["nome", "name", "nombre", "contato", "contact", "cliente", "responsavel", "firstname", "primeironome"],
  empresa: ["empresa", "company", "negocio", "business", "marca", "brand", "clinica", "companyname", "organizacao"],
  email: ["email", "mail", "correo", "correoelectronico", "emailaddress"],
  whatsapp: ["whatsapp", "telefone", "phone", "celular", "tel", "movil", "telefono", "fone", "mobile", "zap"],
  pais: ["pais", "country", "paisregiao"],
  cidade: ["cidade", "city", "ciudad"],
  idioma: ["idioma", "language", "lang", "lingua"],
  segmento: ["segmento", "nicho", "niche", "industry", "setor", "sector", "area", "profissao", "profession", "ramo"],
  site: ["site", "website", "url", "web", "sitio", "paginaweb"],
  instagram: ["instagram", "ig", "redesocial", "social"],
  origem: ["origem", "source", "fonte", "origen", "canal", "leadsource"],
  mensagem: ["mensagem", "message", "interesse", "necessidade", "pedido", "objetivo", "mensaje", "comentario"],
  orcamento: ["orcamento", "budget", "presupuesto", "verba", "investimento"],
  prazo: ["prazo", "deadline", "timeline", "plazo", "urgencia"],
  status: ["status", "etapa", "estagio", "stage", "situacao", "fase"],
  criado_em: ["data", "date", "criadoem", "createdat", "fecha", "dataentrada"],
  contato_publico: ["contatocomercial", "contatocomercialpublico", "contatopublico", "publiccontact", "contactocomercial", "contatos"],
  ultima_atividade: ["ultimaatividade", "ultimaatividadeverificada", "ultimapublicacao", "ultimopost", "lastpost", "lastactivity", "ultimaactividad"],
  verificacao: ["verificacao", "verificado", "statusverificacao", "verification", "validacao", "elegibilidade", "situacaoverificacao"],
  anuncios: ["anuncios", "ads", "usaanuncios", "metaads", "anuncia"],
};

const MAPA_ALIAS = {};
for (const campo of Object.keys(ALIASES)) for (const a of ALIASES[campo]) MAPA_ALIAS[a] = campo;

function normalizarLead(linha) {
  const lead = { _original: linha };
  for (const col of Object.keys(linha)) {
    if (col === "row_number" || col.startsWith("apse_")) continue;
    const campo = MAPA_ALIAS[chave(col)];
    if (campo && !texto(lead[campo])) lead[campo] = linha[col];
  }
  for (const campo of Object.keys(ALIASES)) lead[campo] = texto(lead[campo]);
  lead.row_number = linha.row_number;
  // "Contato comercial público" pode trazer e-mail ou telefone.
  const cp = lead.contato_publico;
  if (!lead.email) lead.email = (cp.match(/[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}/i) || [""])[0];
  if (!lead.whatsapp && soDigitos(cp.replace(/[^\s@,;]+@[^\s@,;]+/g, "")).length >= 8) lead.whatsapp = cp.replace(/[^\s@,;]+@[^\s@,;]+/g, "").trim();
  lead.email = lead.email.toLowerCase();
  lead.instagram = lead.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "@").replace(/\/$/, "");
  lead.apse = {};
  for (const col of Object.keys(linha)) if (col.startsWith("apse_")) lead.apse[col] = linha[col];
  lead.id = texto(lead.apse.apse_id) || idDoLead(lead);
  return lead;
}

function idDoLead(lead) {
  const base = lead.email || soDigitos(lead.whatsapp) || chave(lead.nome + lead.empresa + lead.site);
  return base ? "L" + hash(base) : "";
}

/* ----------------------------------------------------------------- idioma */

const IDIOMAS = ["pt", "en", "es", "fr", "de", "it"];

const IDIOMA_POR_PAIS = {
  pt: ["brasil", "brazil", "br", "portugal", "pt", "angola", "mocambique", "mozambique", "caboverde"],
  es: ["espanha", "espana", "spain", "es", "mexico", "mx", "argentina", "ar", "colombia", "co", "chile", "cl", "peru", "pe", "uruguai", "uruguay", "uy", "paraguai", "paraguay", "py", "bolivia", "bo", "equador", "ecuador", "ec", "venezuela", "ve", "costarica", "panama", "guatemala", "republicadominicana"],
  en: ["estadosunidos", "eua", "usa", "us", "unitedstates", "reinounido", "uk", "unitedkingdom", "inglaterra", "england", "canada", "ca", "australia", "au", "irlanda", "ireland", "ie", "novazelandia", "newzealand", "nz", "africadosul", "southafrica", "singapura", "singapore", "india"],
  fr: ["franca", "france", "fr", "belgica", "belgique", "belgium", "luxemburgo", "luxembourg", "monaco", "senegal", "marrocos", "maroc", "morocco"],
  de: ["alemanha", "germany", "deutschland", "de", "austria", "osterreich", "at"],
  it: ["italia", "italy", "it"],
};
const MAPA_PAIS = {};
for (const l of Object.keys(IDIOMA_POR_PAIS)) for (const p of IDIOMA_POR_PAIS[l]) MAPA_PAIS[p] = l;

const IDIOMA_POR_DDI = [
  ["351", "pt"], ["244", "pt"], ["258", "pt"], ["55", "pt"],
  ["34", "es"], ["52", "es"], ["54", "es"], ["56", "es"], ["57", "es"], ["51", "es"], ["598", "es"], ["595", "es"], ["591", "es"], ["593", "es"], ["58", "es"],
  ["33", "fr"], ["32", "fr"], ["352", "fr"],
  ["49", "de"], ["43", "de"],
  ["39", "it"],
  ["1", "en"], ["44", "en"], ["61", "en"], ["353", "en"], ["64", "en"], ["27", "en"], ["65", "en"],
];

const IDIOMA_POR_TLD = { br: "pt", pt: "pt", es: "es", mx: "es", ar: "es", co: "es", cl: "es", pe: "es", uy: "es", fr: "fr", be: "fr", de: "de", at: "de", it: "it", uk: "en", us: "en", ca: "en", au: "en", ie: "en", nz: "en" };

function detectarIdioma(lead, cfg) {
  const explicito = chave(lead.idioma).slice(0, 2);
  const nomes = { po: "pt", in: "en", es: "es", sp: "es", fr: "fr", al: "de", ge: "de", de: "de", it: "it", en: "en", pt: "pt" };
  if (explicito && nomes[explicito]) return nomes[explicito];

  const pais = MAPA_PAIS[chave(lead.pais)];
  if (pais) return pais;

  const tel = texto(lead.whatsapp);
  if (tel.startsWith("+") || tel.startsWith("00")) {
    const d = soDigitos(tel).replace(/^00/, "");
    for (const [ddi, l] of IDIOMA_POR_DDI) if (d.startsWith(ddi)) return l;
  }

  const dominio = (lead.email.split("@")[1] || lead.site.replace(/^https?:\/\//, "").split("/")[0] || "").toLowerCase();
  const tld = dominio.split(".").pop();
  if (IDIOMA_POR_TLD[tld]) return IDIOMA_POR_TLD[tld];

  return IDIOMAS.includes(cfg.idioma_padrao) ? cfg.idioma_padrao : "en";
}

/* ----------------------------------------------------------------- etapa */

const ETAPA_POR_STATUS = {
  novo: "NOVO", new: "NOVO", nuevo: "NOVO",
  contatado: "CONTATADO", contacted: "CONTATADO", contactado: "CONTATADO", enviado: "CONTATADO",
  respondeu: "RESPONDEU", replied: "RESPONDEU", respondio: "RESPONDEU",
  reuniao: "REUNIAO", meeting: "REUNIAO", reunion: "REUNIAO", call: "REUNIAO",
  proposta: "PROPOSTA", proposal: "PROPOSTA", propuesta: "PROPOSTA", orcamentoenviado: "PROPOSTA",
  negociacao: "NEGOCIACAO", negotiation: "NEGOCIACAO", negociacion: "NEGOCIACAO",
  ganho: "GANHO", won: "GANHO", fechado: "GANHO", cliente: "GANHO", ganado: "GANHO", closed: "GANHO", closedwon: "GANHO",
  perdido: "PERDIDO", lost: "PERDIDO", closedlost: "PERDIDO", descartado: "PERDIDO",
  naocontatar: "NAO_CONTATAR", donotcontact: "NAO_CONTATAR", optout: "NAO_CONTATAR", nocontactar: "NAO_CONTATAR", descadastrado: "NAO_CONTATAR", unsubscribed: "NAO_CONTATAR",
};

function etapaAtual(lead) {
  const propria = texto(lead.apse.apse_etapa).toUpperCase();
  if (ETAPAS.includes(propria)) return propria;
  return ETAPA_POR_STATUS[chave(lead.status)] || "NOVO";
}

/* ------------------------------------------------------------ qualificação */

const PALAVRAS_INTENCAO = [
  "site", "website", "landing", "pagina", "page", "orcamento", "quote", "presupuesto", "preco", "price", "precio", "valor", "devis", "angebot", "preventivo",
  "urgente", "urgent", "asap", "contratar", "hire", "contratar", "quero", "want", "quiero", "need", "preciso", "necesito", "vendas", "sales", "ventas", "clientes", "clients",
];
const ORIGENS_QUENTES = ["site", "website", "formulario", "form", "radar", "whatsapp", "indicacao", "referral", "referencia", "recomendacao", "inbound", "contato", "contact", "instagramdm", "direct", "dm"];
const ORIGENS_FRIAS = ["lista", "list", "scraping", "googlemaps", "maps", "linkedin", "prospeccao", "outbound", "frio", "cold", "apollo"];

// Cada ponto é marcado como F (fato observado na planilha), E (estimativa) ou N (não verificado).
function qualificar(lead, cfg, agora) {
  agora = agora || new Date();
  const pontos = [];
  const add = (n, tipo, motivo) => pontos.push([n, tipo, motivo]);

  const verif = chave(lead.verificacao);
  const inelegivel = /inelegivel|ineligible|descart|naoelegivel/.test(verif);
  if (/^verificad|^verified|^sim$|^ok$/.test(verif)) add(5, "F", "perfil verificado");
  else if (/pendente|pending|averiguar|confirmar/.test(verif)) add(-10, "N", "perfil pendente de confirmação");

  if (emailValido(lead.email)) add(10, "F", "e-mail comercial público");
  if (soDigitos(lead.whatsapp).length >= 8) add(8, "F", "WhatsApp/telefone público");
  if (!lead.email && !lead.whatsapp && lead.instagram) add(3, "F", "só contato por Instagram");

  const seg = chave(lead.segmento + " " + lead.empresa);
  const alvo = lista(cfg.segmentos_alvo).find((s) => chave(s) && seg.includes(chave(s)));
  if (alvo) add(15, "F", `nicho-alvo (${alvo})`);
  else if (lead.segmento) add(3, "F", "nicho fora do foco atual");

  const site = lead.site.toLowerCase();
  const semSite = !site || /instagram\.com|linktr\.ee|facebook\.com|wa\.me|beacons\.ai|linkin\.bio|taplink|bio\.link/.test(site);
  if (!site) add(15, lead.verificacao ? "F" : "N", "sem site próprio" + (lead.verificacao ? "" : " (conferir bio/Linktree)"));
  else if (semSite) add(15, "F", "usa só link de bio, sem site próprio");
  else add(5, "F", "tem site (avaliar se converte)");

  const ultima = parseData(lead.ultima_atividade);
  if (ultima) {
    const d = diasEntre(ultima, agora);
    if (d <= 30) add(15, "F", `ativo há ${d} dias`);
    else if (d <= 90) add(5, "F", `última atividade há ${d} dias`);
    else if (d > 180) add(-15, "F", `sem atividade há ${d} dias (possivelmente inativo)`);
  } else add(0, "N", "atividade recente não verificada");

  const ads = chave(lead.anuncios);
  if (/^(sim|yes|si|ativo|active|x|true)/.test(ads)) add(5, "E", "anuncia: indica verba de marketing");

  const origem = chave(lead.origem);
  if (origem && ORIGENS_QUENTES.some((o) => origem.includes(o))) add(20, "F", "veio até a Ápse (origem quente)");
  else if (origem && ORIGENS_FRIAS.some((o) => origem.includes(o))) add(0, "F", "prospecção ativa (origem fria)");

  const msg = chave(lead.mensagem);
  if (msg && PALAVRAS_INTENCAO.some((p) => msg.includes(p))) add(10, "F", "mensagem com intenção de compra");

  const valor = parseValor(lead.orcamento);
  if (valor != null) {
    if (valor >= Number(cfg.ticket_minimo)) add(10, "F", "orçamento declarado acima do ticket mínimo");
    else add(-10, "F", "orçamento declarado abaixo do ticket mínimo");
  }

  const prazo = chave(lead.prazo);
  if (/urgente|urgent|asap|imediato|semana|week|30dias|30days|1mes|1month/.test(prazo)) add(5, "F", "prazo curto");

  const prioritarios = lista(cfg.paises_prioritarios).map(chave);
  if (prioritarios.length && prioritarios.includes(chave(lead.pais))) add(5, "E", "país prioritário (moeda forte)");

  const score = inelegivel ? 0 : Math.max(0, Math.min(100, pontos.reduce((s, [n]) => s + n, 0)));
  const faixa = inelegivel ? "X" : score >= 60 ? "A" : score >= 40 ? "B" : "C";
  const grupo = (t) => pontos.filter((p) => p[1] === t).map(([n, , m]) => (n ? `${n > 0 ? "+" : ""}${n} ` : "") + m).join("; ");
  const motivo = [
    inelegivel ? "INELEGÍVEL na planilha" : "",
    grupo("F") && "Fatos: " + grupo("F"),
    grupo("E") && "Estimativas: " + grupo("E"),
    grupo("N") && "Não verificado: " + grupo("N"),
  ].filter(Boolean).join(" | ");
  const pendencias = pontos.filter((p) => p[1] === "N").map((p) => p[2]);
  return { score, faixa, motivo, semSite, inelegivel, pendencias };
}

function proximaAcao(lead, etapa) {
  const canal = emailValido(lead.email) ? "e-mail" : soDigitos(lead.whatsapp).length >= 8 ? "WhatsApp" : lead.instagram ? "Instagram (DM)" : "";
  switch (etapa) {
    case "AGUARDANDO_APROVACAO": return `Revisar e aprovar mensagem na aba Abordagens (${canal})`;
    case "QUALIFICADO": return lead.q.pendencias.length ? "Verificar: " + lead.q.pendencias.join("; ") : "Aguardar vaga no top 5";
    case "CONTATADO": return "Aguardar resposta; follow-up automático pela cadência";
    case "RESPONDEU": return "Responder (sugestão na aba Abordagens)";
    case "REUNIAO": return "Marcar/realizar conversa e registrar necessidade";
    case "PROPOSTA": return "Cobrar retorno da proposta";
    case "NEGOCIACAO": return "Fechar condições e enviar link de pagamento";
    case "GANHO": return "Enviar briefing e iniciar produção";
    case "NAO_CONTATAR": return "Nenhuma (pediu para não ser contatado)";
    case "PERDIDO": return "Registrar motivo da perda";
    default: return lead.q.inelegivel ? "Nenhuma (inelegível)" : canal ? "Completar dados para qualificar" : "Encontrar contato comercial público";
  }
}

/* ------------------------------------------------------------- abordagens */

function primeiroNome(nome) {
  return texto(nome).split(/\s+/)[0] || "";
}

// Textos por idioma. {nome}, {empresa}, {site}, {segmento}, {assinatura} são preenchidos.
const TEXTOS = {
  pt: {
    oi: (n) => (n ? `Olá, ${n}, tudo bem?` : "Olá, tudo bem?"),
    abertura_quente: "Obrigado pelo contato com a Ápse.",
    abertura_fria: "Sou o Juan, da Ápse, um estúdio que cria sites e landing pages para profissionais e pequenos negócios.",
    dor_sem_site: (l) => `Vi que ${l.empresa || "o seu trabalho"} ainda depende de redes sociais e indicações para ser encontrado. Um site próprio, rápido e pensado para gerar contato costuma ser o passo que transforma quem procura em quem agenda.`,
    dor_com_site: (l) => `Dei uma olhada em ${l.site} e vejo espaço para transformar mais visitas em contatos: mensagem mais clara logo no início, prova de resultado e um caminho direto para o WhatsApp.`,
    oferta_lp: "Para profissionais, a gente costuma começar com uma landing page objetiva, que apresenta o serviço e leva direto para o agendamento.",
    oferta_site: "Para negócios, a gente monta um site comercial enxuto, com portfólio, prova social e um caminho claro até o orçamento.",
    cta: "Faz sentido conversarmos 15 minutos esta semana? Se preferir, me responda com o principal objetivo e eu já te digo o formato que eu recomendaria.",
    optout: "Se não fizer sentido agora, é só responder \"remover\" que eu não volto a escrever.",
    assunto: (l) => (l.empresa ? `Ideia para o site da ${l.empresa}` : "Uma ideia para o seu site"),
    fu: [
      "Passando para saber se você viu minha mensagem anterior. Posso te mandar 2 ou 3 exemplos de projetos parecidos com o seu?",
      "Sei que a rotina é corrida. Se ajudar, te mando uma proposta de estrutura de página (sem compromisso) para você avaliar no seu tempo.",
      "Vou encerrar por aqui para não lotar sua caixa. Se em algum momento quiser tirar o site do papel, é só responder esta mensagem.",
    ],
    resp: {
      INTERESSE: "Que bom! Para eu preparar algo certeiro, me conta: qual é o principal objetivo do site e você tem algum prazo em mente? Se preferir, podemos falar 15 minutos por chamada.",
      PRECO: "Claro! O valor depende do formato (landing page ou site completo) e do conteúdo. Me conta o objetivo, quantas páginas imagina e o prazo, que eu te envio uma proposta fechada.",
      REUNIAO: "Perfeito, vamos marcar. Quais dias e horários funcionam melhor para você nesta semana ou na próxima?",
      NAO_AGORA: "Combinado, entendo totalmente. Posso te procurar daqui a alguns meses para ver se o momento mudou?",
      DUVIDA: "Obrigado pela resposta! Fico à disposição para tirar qualquer dúvida. Quer que eu te mande exemplos de projetos parecidos?",
    },
    assinatura: (c) => `${c.responsavel_nome}\n${c.empresa_nome}${c.empresa_site ? " · " + c.empresa_site : ""}`,
  },
  en: {
    oi: (n) => (n ? `Hi ${n},` : "Hi there,"),
    abertura_quente: "Thanks for reaching out to Ápse.",
    abertura_fria: "I'm Juan from Ápse, a studio that builds websites and landing pages for independent professionals and small businesses.",
    dor_sem_site: (l) => `I noticed ${l.empresa || "your business"} still relies on social media and referrals to be found. A fast website of your own, built to generate enquiries, is often what turns people who are looking into people who book.`,
    dor_com_site: (l) => `I had a look at ${l.site} and I see room to turn more visits into enquiries: a clearer message above the fold, proof of results and a direct path to contact you.`,
    oferta_lp: "For professionals we usually start with a focused landing page that presents the service and leads straight to booking.",
    oferta_site: "For businesses we build a lean commercial website with portfolio, social proof and a clear path to a quote.",
    cta: "Would a 15-minute call this week make sense? Or just reply with your main goal and I'll tell you which format I'd recommend.",
    optout: "If this isn't relevant, just reply \"remove\" and I won't write again.",
    assunto: (l) => (l.empresa ? `An idea for ${l.empresa}'s website` : "An idea for your website"),
    fu: [
      "Just checking whether you saw my previous message. Would it help if I sent 2 or 3 examples of similar projects?",
      "I know things get busy. If useful, I can send you a no-commitment page outline to review whenever suits you.",
      "I'll stop here so I don't crowd your inbox. Whenever you want to get the website moving, just reply to this email.",
    ],
    resp: {
      INTERESSE: "Great to hear! So I can prepare something specific: what's the main goal for the website, and do you have a timeline in mind? Happy to jump on a 15-minute call if easier.",
      PRECO: "Of course. Pricing depends on the format (landing page or full website) and the content. Tell me the goal, roughly how many pages and your timeline, and I'll send a fixed quote.",
      REUNIAO: "Perfect, let's set it up. Which days and times work best for you this week or next?",
      NAO_AGORA: "Understood, no problem at all. Would it be OK if I checked back in a few months?",
      DUVIDA: "Thanks for getting back to me! Happy to answer any questions. Would examples of similar projects help?",
    },
    assinatura: (c) => `${c.responsavel_nome}\n${c.empresa_nome}${c.empresa_site ? " · " + c.empresa_site : ""}`,
  },
  es: {
    oi: (n) => (n ? `Hola, ${n}:` : "Hola:"),
    abertura_quente: "Gracias por contactar con Ápse.",
    abertura_fria: "Soy Juan, de Ápse, un estudio que crea sitios web y landing pages para profesionales y pequeños negocios.",
    dor_sem_site: (l) => `Vi que ${l.empresa || "tu negocio"} todavía depende de las redes sociales y las recomendaciones para que lo encuentren. Un sitio propio, rápido y pensado para generar contactos suele ser el paso que convierte a quien busca en quien reserva.`,
    dor_com_site: (l) => `Revisé ${l.site} y veo margen para convertir más visitas en contactos: un mensaje más claro desde el inicio, pruebas de resultados y un camino directo para escribirte.`,
    oferta_lp: "Con profesionales solemos empezar con una landing page concreta, que presenta el servicio y lleva directo a la reserva.",
    oferta_site: "Para negocios armamos un sitio comercial ágil, con portafolio, prueba social y un camino claro hasta el presupuesto.",
    cta: "¿Te parece si hablamos 15 minutos esta semana? Si prefieres, respóndeme con tu objetivo principal y te digo qué formato te recomendaría.",
    optout: "Si no es el momento, responde \"eliminar\" y no volveré a escribirte.",
    assunto: (l) => (l.empresa ? `Una idea para el sitio web de ${l.empresa}` : "Una idea para tu sitio web"),
    fu: [
      "Te escribo para saber si viste mi mensaje anterior. ¿Te envío 2 o 3 ejemplos de proyectos parecidos al tuyo?",
      "Sé que el día a día es intenso. Si te sirve, te mando una propuesta de estructura de página, sin compromiso, para que la revises con calma.",
      "Lo dejo aquí para no llenar tu bandeja. Cuando quieras poner en marcha el sitio, solo responde a este correo.",
    ],
    resp: {
      INTERESSE: "¡Qué bien! Para preparar algo a medida, cuéntame: ¿cuál es el objetivo principal del sitio y tienes algún plazo? Si prefieres, hablamos 15 minutos por llamada.",
      PRECO: "Claro. El precio depende del formato (landing page o sitio completo) y del contenido. Cuéntame el objetivo, cuántas páginas imaginas y el plazo, y te envío un presupuesto cerrado.",
      REUNIAO: "Perfecto, agendemos. ¿Qué días y horarios te vienen mejor esta semana o la próxima?",
      NAO_AGORA: "Entendido, sin problema. ¿Te parece si vuelvo a escribirte en unos meses?",
      DUVIDA: "¡Gracias por responder! Quedo atento a cualquier duda. ¿Te envío ejemplos de proyectos parecidos?",
    },
    assinatura: (c) => `${c.responsavel_nome}\n${c.empresa_nome}${c.empresa_site ? " · " + c.empresa_site : ""}`,
  },
  fr: {
    oi: (n) => (n ? `Bonjour ${n},` : "Bonjour,"),
    abertura_quente: "Merci d'avoir contacté Ápse.",
    abertura_fria: "Je suis Juan, du studio Ápse : nous créons des sites et des landing pages pour les indépendants et les petites entreprises.",
    dor_sem_site: (l) => `J'ai remarqué que ${l.empresa || "votre activité"} dépend encore des réseaux sociaux et du bouche-à-oreille pour être trouvée. Un site à vous, rapide et pensé pour générer des demandes, est souvent ce qui transforme les visiteurs en clients.`,
    dor_com_site: (l) => `J'ai regardé ${l.site} et je vois de quoi convertir davantage de visites en demandes : un message plus clair dès l'arrivée, des preuves de résultats et un chemin direct pour vous contacter.`,
    oferta_lp: "Pour les indépendants, nous commençons souvent par une landing page ciblée qui présente le service et mène directement à la prise de rendez-vous.",
    oferta_site: "Pour les entreprises, nous réalisons un site vitrine efficace, avec portfolio, avis clients et un parcours clair jusqu'au devis.",
    cta: "Un échange de 15 minutes cette semaine vous conviendrait-il ? Sinon, répondez-moi avec votre objectif principal et je vous dirai quel format je recommande.",
    optout: "Si ce n'est pas pertinent, répondez simplement « retirer » et je ne vous écrirai plus.",
    assunto: (l) => (l.empresa ? `Une idée pour le site de ${l.empresa}` : "Une idée pour votre site"),
    fu: [
      "Je me permets de revenir vers vous : avez-vous vu mon précédent message ? Je peux vous envoyer 2 ou 3 exemples de projets similaires.",
      "Je sais que le quotidien est chargé. Si cela vous aide, je vous envoie une proposition de structure de page, sans engagement.",
      "Je m'arrête ici pour ne pas encombrer votre boîte. Quand vous voudrez lancer le site, il suffit de répondre à ce message.",
    ],
    resp: {
      INTERESSE: "Avec plaisir ! Pour préparer une proposition précise : quel est l'objectif principal du site et avez-vous un délai en tête ? Nous pouvons aussi en parler 15 minutes par téléphone.",
      PRECO: "Bien sûr. Le prix dépend du format (landing page ou site complet) et du contenu. Indiquez-moi l'objectif, le nombre de pages envisagé et le délai, et je vous envoie un devis ferme.",
      REUNIAO: "Parfait, organisons cela. Quels jours et horaires vous conviennent cette semaine ou la suivante ?",
      NAO_AGORA: "Entendu, aucun souci. Puis-je revenir vers vous dans quelques mois ?",
      DUVIDA: "Merci pour votre réponse ! Je reste disponible pour toute question. Voulez-vous des exemples de projets similaires ?",
    },
    assinatura: (c) => `${c.responsavel_nome}\n${c.empresa_nome}${c.empresa_site ? " · " + c.empresa_site : ""}`,
  },
  de: {
    oi: (n) => (n ? `Hallo ${n},` : "Hallo,"),
    abertura_quente: "Danke für Ihre Nachricht an Ápse.",
    abertura_fria: "Ich bin Juan vom Studio Ápse. Wir erstellen Websites und Landingpages für Selbstständige und kleine Unternehmen.",
    dor_sem_site: (l) => `Mir ist aufgefallen, dass ${l.empresa || "Ihr Unternehmen"} noch vor allem über soziale Netzwerke und Empfehlungen gefunden wird. Eine eigene, schnelle Website, die auf Anfragen ausgelegt ist, macht aus Suchenden oft Kunden.`,
    dor_com_site: (l) => `Ich habe mir ${l.site} angesehen und sehe Potenzial, mehr Besuche in Anfragen zu verwandeln: eine klarere Botschaft gleich zu Beginn, Ergebnisse als Beleg und ein direkter Weg zum Kontakt.`,
    oferta_lp: "Bei Selbstständigen starten wir meist mit einer fokussierten Landingpage, die das Angebot vorstellt und direkt zur Terminbuchung führt.",
    oferta_site: "Für Unternehmen bauen wir eine schlanke Unternehmenswebsite mit Referenzen, Kundenstimmen und einem klaren Weg zum Angebot.",
    cta: "Hätten Sie diese Woche 15 Minuten für ein kurzes Gespräch? Oder antworten Sie einfach mit Ihrem wichtigsten Ziel, dann sage ich Ihnen, welches Format ich empfehlen würde.",
    optout: "Falls das gerade nicht passt, antworten Sie einfach mit „entfernen“ und ich schreibe nicht erneut.",
    assunto: (l) => (l.empresa ? `Eine Idee für die Website von ${l.empresa}` : "Eine Idee für Ihre Website"),
    fu: [
      "Ich wollte kurz nachfragen, ob Sie meine letzte Nachricht gesehen haben. Soll ich Ihnen 2 oder 3 Beispiele ähnlicher Projekte schicken?",
      "Ich weiß, der Alltag ist voll. Wenn es hilft, schicke ich Ihnen unverbindlich einen Entwurf für die Seitenstruktur.",
      "Ich höre hier auf, um Ihr Postfach nicht zu füllen. Wenn Sie die Website angehen möchten, antworten Sie einfach auf diese E-Mail.",
    ],
    resp: {
      INTERESSE: "Das freut mich! Damit ich etwas Passendes vorbereiten kann: Was ist das wichtigste Ziel der Website, und gibt es einen Zeitrahmen? Gern auch in einem 15-minütigen Gespräch.",
      PRECO: "Gern. Der Preis hängt vom Format (Landingpage oder komplette Website) und vom Inhalt ab. Nennen Sie mir Ziel, ungefähre Seitenzahl und Zeitrahmen, dann schicke ich ein Festpreisangebot.",
      REUNIAO: "Perfekt, lassen Sie uns einen Termin finden. Welche Tage und Uhrzeiten passen Ihnen diese oder nächste Woche?",
      NAO_AGORA: "Verstanden, kein Problem. Darf ich mich in ein paar Monaten noch einmal melden?",
      DUVIDA: "Danke für Ihre Antwort! Bei Fragen bin ich gern für Sie da. Möchten Sie Beispiele ähnlicher Projekte sehen?",
    },
    assinatura: (c) => `${c.responsavel_nome}\n${c.empresa_nome}${c.empresa_site ? " · " + c.empresa_site : ""}`,
  },
  it: {
    oi: (n) => (n ? `Ciao ${n},` : "Buongiorno,"),
    abertura_quente: "Grazie per aver contattato Ápse.",
    abertura_fria: "Sono Juan dello studio Ápse: creiamo siti e landing page per professionisti e piccole imprese.",
    dor_sem_site: (l) => `Ho notato che ${l.empresa || "la tua attività"} dipende ancora dai social e dal passaparola per farsi trovare. Un sito tuo, veloce e pensato per generare contatti, spesso è ciò che trasforma chi cerca in chi prenota.`,
    dor_com_site: (l) => `Ho dato un'occhiata a ${l.site} e vedo margine per trasformare più visite in contatti: un messaggio più chiaro in apertura, prove di risultati e un percorso diretto per scriverti.`,
    oferta_lp: "Con i professionisti di solito partiamo da una landing page mirata, che presenta il servizio e porta dritto alla prenotazione.",
    oferta_site: "Per le aziende realizziamo un sito commerciale snello, con portfolio, recensioni e un percorso chiaro fino al preventivo.",
    cta: "Ti andrebbe una chiamata di 15 minuti questa settimana? Oppure rispondimi con il tuo obiettivo principale e ti dico quale formato consiglierei.",
    optout: "Se non è di interesse, rispondi semplicemente \"rimuovi\" e non ti scriverò più.",
    assunto: (l) => (l.empresa ? `Un'idea per il sito di ${l.empresa}` : "Un'idea per il tuo sito"),
    fu: [
      "Ti scrivo per sapere se hai visto il mio messaggio precedente. Vuoi che ti mandi 2 o 3 esempi di progetti simili?",
      "So che le giornate sono piene. Se può aiutare, ti mando una proposta di struttura della pagina, senza impegno.",
      "Mi fermo qui per non intasare la tua casella. Quando vorrai avviare il sito, basta rispondere a questa email.",
    ],
    resp: {
      INTERESSE: "Ottimo! Per preparare qualcosa di mirato: qual è l'obiettivo principale del sito e hai già una tempistica? Se preferisci, ne parliamo in una chiamata di 15 minuti.",
      PRECO: "Certo. Il prezzo dipende dal formato (landing page o sito completo) e dai contenuti. Dimmi l'obiettivo, quante pagine immagini e la tempistica, e ti invio un preventivo definitivo.",
      REUNIAO: "Perfetto, fissiamo. Quali giorni e orari ti vanno meglio questa settimana o la prossima?",
      NAO_AGORA: "Capito, nessun problema. Posso ricontattarti tra qualche mese?",
      DUVIDA: "Grazie per la risposta! Resto a disposizione per qualsiasi domanda. Vuoi qualche esempio di progetti simili?",
    },
    assinatura: (c) => `${c.responsavel_nome}\n${c.empresa_nome}${c.empresa_site ? " · " + c.empresa_site : ""}`,
  },
};

function ehProfissional(lead) {
  // Pessoa física/profissional liberal → landing page; empresa → site comercial.
  const s = chave(lead.segmento);
  return /nutri|psic|dent|fisio|medic|doctor|coach|personal|terapeut|therap|advog|lawyer|nutrition|estetic|aesthetic/.test(s);
}

function wa(lead, mensagem) {
  const n = soDigitos(lead.whatsapp).replace(/^00/, "");
  return n.length >= 8 ? `https://wa.me/${n}?text=${encodeURIComponent(mensagem)}` : "";
}

function montarPrimeiroContato(lead, q, idioma, cfg, origemQuente) {
  const t = TEXTOS[idioma];
  const corpo = [
    t.oi(primeiroNome(lead.nome)),
    origemQuente ? t.abertura_quente : t.abertura_fria,
    q.semSite ? t.dor_sem_site(lead) : t.dor_com_site(lead),
    ehProfissional(lead) ? t.oferta_lp : t.oferta_site,
    t.cta,
    t.assinatura(cfg),
    origemQuente ? "" : t.optout,
  ].filter(Boolean).join("\n\n");
  return { assunto: t.assunto(lead), corpo };
}

function montarFollowup(lead, idioma, n, cfg) {
  const t = TEXTOS[idioma];
  const corpo = [t.oi(primeiroNome(lead.nome)), t.fu[n], t.assinatura(cfg), t.optout].join("\n\n");
  return { assunto: "Re: " + t.assunto(lead), corpo };
}

function canalDe(lead) {
  if (emailValido(lead.email)) return "email";
  if (soDigitos(lead.whatsapp).length >= 8) return "whatsapp";
  if (lead.instagram) return "instagram";
  return "";
}

function novaAbordagem(lead, tipo, idioma, msg, extra, agora) {
  const canal = canalDe(lead);
  return Object.assign(
    {
      abordagem_id: "A" + hash(lead.id + tipo + agora.toISOString()),
      criado_em: dataISO(agora),
      apse_id: lead.id,
      lead: [lead.nome, lead.empresa].filter(Boolean).join(" · "),
      pais: lead.pais,
      nicho: lead.segmento,
      instagram: lead.instagram,
      site: lead.site,
      ultima_atividade: lead.ultima_atividade,
      tipo,
      idioma,
      canal,
      para: canal === "email" ? lead.email : canal === "whatsapp" ? lead.whatsapp : lead.instagram,
      assunto: msg.assunto,
      mensagem: msg.corpo,
      link_whatsapp: wa(lead, msg.corpo),
      thread_id: texto(lead.apse.apse_thread_id),
      aprovado: "",
      status: "PENDENTE",
      enviado_em: "",
    },
    extra || {}
  );
}

/* --------------------------------------------------- rotina diária (fluxo 1) */

/**
 * Processa todas as linhas da aba Leads.
 * Devolve: atualizacoes (uma por linha, para gravar de volta nas colunas apse_*),
 * abordagens (novas linhas para a aba Abordagens) e resumo (texto do e-mail diário).
 */
function rotinaDiaria(linhas, configLinhas, agoraISO) {
  const cfg = lerConfig(configLinhas);
  const agora = agoraISO ? new Date(agoraISO) : new Date();
  const hoje = dataISO(agora);
  const cadencia = lista(cfg.cadencia_followup_dias).map(Number).filter((n) => n > 0);

  const vistos = new Set();
  const leads = [];
  for (const linha of linhas) {
    const lead = normalizarLead(linha);
    if (!lead.id) continue; // linha vazia
    lead.duplicado = vistos.has(lead.id);
    vistos.add(lead.id);
    lead.etapa = etapaAtual(lead);
    lead.idiomaDetectado = detectarIdioma(lead, cfg);
    lead.q = qualificar(lead, cfg, agora);
    const origem = chave(lead.origem);
    lead.origemQuente = !!origem && ORIGENS_QUENTES.some((o) => origem.includes(o));
    leads.push(lead);
  }

  const abordagens = [];
  const followups = [];
  const negociacoesParadas = [];

  // Follow-ups de quem foi contatado e não respondeu.
  for (const lead of leads) {
    if (lead.duplicado || lead.etapa !== "CONTATADO") continue;
    const ultimo = parseData(lead.apse.apse_ultimo_contato);
    if (!ultimo) continue;
    const feitos = Number(lead.apse.apse_followups || 0);
    if (feitos >= cadencia.length) continue;
    if (texto(lead.apse.apse_followup_pendente)) continue;
    const primeiro = parseData(lead.apse.apse_primeiro_contato) || ultimo;
    if (diasEntre(primeiro, agora) >= cadencia[feitos]) {
      const idioma = texto(lead.apse.apse_idioma) || lead.idiomaDetectado;
      const msg = montarFollowup(lead, IDIOMAS.includes(idioma) ? idioma : "en", feitos, cfg);
      const a = novaAbordagem(lead, `FOLLOWUP_${feitos + 1}`, idioma, msg, {}, agora);
      abordagens.push(a);
      followups.push(lead);
      lead.followupCriado = true;
    }
  }

  // Negociações sem movimento.
  for (const lead of leads) {
    if (!["REUNIAO", "PROPOSTA", "NEGOCIACAO", "RESPONDEU"].includes(lead.etapa)) continue;
    const ultimo = parseData(lead.apse.apse_ultimo_contato) || parseData(lead.apse.apse_atualizado_em);
    if (ultimo && diasEntre(ultimo, agora) >= Number(cfg.dias_negociacao_parada)) negociacoesParadas.push([lead, diasEntre(ultimo, agora)]);
  }

  // Top N para primeiro contato.
  const elegiveis = leads.filter((l) => {
    if (l.duplicado) return false;
    if (!["NOVO", "QUALIFICADO"].includes(l.etapa)) return false;
    if (!canalDe(l)) return false;
    const ultimo = parseData(l.apse.apse_ultimo_contato);
    if (ultimo && diasEntre(ultimo, agora) < Number(cfg.dias_cooldown)) return false;
    return l.q.faixa === "A" || l.q.faixa === "B";
  });
  elegiveis.sort((a, b) => b.q.score - a.q.score || (a.row_number || 0) - (b.row_number || 0));
  const top = elegiveis.slice(0, Number(cfg.top_n));
  for (const lead of top) {
    const msg = montarPrimeiroContato(lead, lead.q, lead.idiomaDetectado, cfg, lead.origemQuente);
    abordagens.push(novaAbordagem(lead, "PRIMEIRO_CONTATO", lead.idiomaDetectado, msg, { score: lead.q.score, justificativa: lead.q.motivo }, agora));
    lead.selecionado = true;
  }

  const atualizacoes = leads.map((lead) => {
    let etapa = lead.etapa;
    if (lead.selecionado) etapa = "AGUARDANDO_APROVACAO";
    else if (etapa === "NOVO" && (lead.q.faixa === "A" || lead.q.faixa === "B")) etapa = "QUALIFICADO";
    const u = {
      row_number: lead.row_number,
      apse_id: lead.id,
      apse_score: lead.q.score,
      apse_faixa: lead.q.faixa,
      apse_motivo: lead.q.motivo,
      apse_idioma: texto(lead.apse.apse_idioma) || lead.idiomaDetectado,
      apse_etapa: lead.duplicado ? "DUPLICADO" : etapa,
      apse_proxima_acao: lead.duplicado ? "Remover linha duplicada" : proximaAcao(lead, etapa),
      apse_atualizado_em: hoje,
    };
    if (lead.followupCriado) u.apse_followup_pendente = hoje;
    return u;
  });

  const aguardando = leads.filter((l) => l.etapa === "AGUARDANDO_APROVACAO").length;
  const resumo = montarResumo({ cfg, hoje, top, followups, negociacoesParadas, aguardando, total: leads.length });

  return { cfg, atualizacoes, abordagens, resumo };
}

function montarResumo({ cfg, hoje, top, followups, negociacoesParadas, aguardando, total }) {
  const l = [];
  l.push(`Rotina comercial Ápse · ${hoje}`);
  l.push(`${total} leads analisados.`);
  l.push("");
  l.push(`TOP ${top.length} PARA PRIMEIRO CONTATO (aguardando sua aprovação):`);
  if (!top.length) l.push("  nenhum lead elegível hoje.");
  top.forEach((x, i) =>
    l.push(
      `  ${i + 1}. ${[x.nome, x.empresa].filter(Boolean).join(" · ")} · ${x.q.score} pts (${x.q.faixa}) · ${x.idiomaDetectado} · ${x.pais || "país n/d"} · ${x.segmento || "nicho n/d"}\n` +
        `     ${[x.instagram, x.site].filter(Boolean).join(" · ") || "sem links"}${x.ultima_atividade ? " · última atividade " + x.ultima_atividade : ""}\n` +
        `     ${x.q.motivo}`
    )
  );
  l.push("");
  l.push(`FOLLOW-UPS CRIADOS: ${followups.length}`);
  followups.forEach((x) => l.push(`  · ${[x.nome, x.empresa].filter(Boolean).join(" · ")}`));
  l.push("");
  l.push(`CONVERSAS/NEGOCIAÇÕES PARADAS há ${cfg.dias_negociacao_parada}+ dias: ${negociacoesParadas.length}`);
  negociacoesParadas.forEach(([x, d]) => l.push(`  · ${[x.nome, x.empresa].filter(Boolean).join(" · ")} · ${x.etapa} · ${d} dias`));
  if (aguardando) {
    l.push("");
    l.push(`Ainda há ${aguardando} abordagem(ns) de dias anteriores aguardando aprovação.`);
  }
  l.push("");
  l.push('Para aprovar: na aba Abordagens, revise o texto e escreva SIM na coluna "aprovado". Nada é enviado sem isso.');
  if (cfg.planilha_url) l.push(cfg.planilha_url);
  const assunto = `Ápse · ${top.length} leads prioritários, ${followups.length} follow-ups, ${negociacoesParadas.length} negociações paradas`;
  return { para: cfg.responsavel_email, assunto, texto: l.join("\n") };
}

/* ---------------------------------------------------- envio aprovado (fluxo 2) */

const SIM = ["sim", "s", "yes", "y", "si", "oui", "ja", "x", "ok", "true", "aprovado", "approved"];

function aprovadosParaEnvio(abordagens, configLinhas, agoraISO) {
  const cfg = lerConfig(configLinhas);
  const agora = agoraISO ? new Date(agoraISO) : new Date();
  const hoje = dataISO(agora);
  const enviadosHoje = abordagens.filter((a) => texto(a.status) === "ENVIADO" && dataISO(parseData(a.enviado_em) || 0) === hoje).length;
  const limite = Math.max(0, Number(cfg.max_envios_dia) - enviadosHoje);
  return abordagens
    .filter((a) => texto(a.status) === "PENDENTE" && SIM.includes(chave(a.aprovado)))
    .filter((a) => (a.canal === "email" ? emailValido(a.para) : true))
    // O limite diário vale só para e-mails enviados pelo n8n; os manuais já foram enviados pelo Juan.
    .filter((a, _i, arr) => a.canal !== "email" || arr.filter((x) => x.canal === "email").indexOf(a) < limite)
    .map((a) => ({
      abordagem_id: a.abordagem_id,
      apse_id: a.apse_id,
      canal: a.canal,
      para: texto(a.para),
      assunto: texto(a.assunto),
      mensagem: texto(a.mensagem),
      thread_id: texto(a.thread_id),
      tipo: texto(a.tipo),
      idioma: texto(a.idioma),
    }));
}

function registrarEnvio(aprovado, resultado, agoraISO) {
  const agora = agoraISO ? new Date(agoraISO) : new Date();
  const manual = aprovado.canal !== "email";
  const threadId = (resultado && resultado.threadId) || aprovado.thread_id || "";
  return {
    abordagem: {
      abordagem_id: aprovado.abordagem_id,
      status: manual ? "ENVIADO_MANUAL" : "ENVIADO",
      enviado_em: agora.toISOString(),
      thread_id: threadId,
    },
    lead: {
      apse_id: aprovado.apse_id,
      apse_etapa: aprovado.tipo === "RESPOSTA" ? "RESPONDEU" : "CONTATADO",
      apse_ultimo_contato: dataISO(agora),
      apse_thread_id: threadId,
      apse_followup_pendente: "",
    },
    primeiroContato: aprovado.tipo === "PRIMEIRO_CONTATO",
    followup: /^FOLLOWUP_/.test(aprovado.tipo) ? Number(aprovado.tipo.split("_")[1]) : null,
  };
}

/* -------------------------------------------------------- respostas (fluxo 3) */

const SINAIS = {
  OPT_OUT: ["remov", "unsubscribe", "descadastrar", "naotenhointeresse", "nomeinteresa", "notinterested", "eliminar", "stopemailing", "retirer", "desinscrire", "entfernen", "abmelden", "rimuovi", "cancellami", "naoquero", "pareme", "parem"],
  REUNIAO: ["reuniao", "meeting", "call", "chamada", "ligacao", "agenda", "agendar", "horario", "reunion", "llamada", "rendezvous", "appel", "termin", "chiamata", "zoom", "meet"],
  PRECO: ["preco", "price", "pricing", "valor", "quanto", "howmuch", "cost", "custo", "orcamento", "quote", "precio", "cuanto", "presupuesto", "prix", "devis", "tarif", "preis", "kosten", "angebot", "prezzo", "preventivo", "quanto costa"],
  NAO_AGORA: ["agoranao", "maisparafrente", "notnow", "later", "nextyear", "proximoano", "ahorano", "masadelante", "pasmaintenant", "plustard", "nichtjetzt", "spater", "nonora", "piuavanti", "semorcamento", "nobudget"],
  INTERESSE: ["interesse", "interested", "interesa", "interessa", "interessiert", "interesse", "gostei", "quero", "vamos", "sim", "yes", "claro", "sure", "letsdo", "megusta", "dacordo", "volentieri", "gerne", "perfeito", "otimo", "great"],
};

function classificarResposta(textoEmail) {
  const t = chave(textoEmail).slice(0, 2000);
  for (const classe of ["OPT_OUT", "REUNIAO", "PRECO", "NAO_AGORA", "INTERESSE"]) {
    if (SINAIS[classe].some((p) => t.includes(chave(p)))) return classe;
  }
  return "DUVIDA";
}

const ETAPA_POR_CLASSE = { OPT_OUT: "NAO_CONTATAR", REUNIAO: "REUNIAO", PRECO: "NEGOCIACAO", NAO_AGORA: "PERDIDO", INTERESSE: "RESPONDEU", DUVIDA: "RESPONDEU" };

function enderecoRemetente(email) {
  const f = email.from;
  if (f && f.value && f.value[0]) return texto(f.value[0].address).toLowerCase();
  const s = texto(email.From || (typeof f === "string" ? f : f && f.text));
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

function textoResposta(email) {
  // Só a parte nova: corta o histórico citado ("Em ... escreveu:", "On ... wrote:", "> ").
  const bruto = texto(email.text || email.snippet || "");
  const corte = bruto.search(/\n\s*(>|On .+wrote:|Em .+escreveu:|El .+escribió:|Le .+a écrit :|Am .+schrieb|Il .+ha scritto:|-----Original)/);
  return (corte > 0 ? bruto.slice(0, corte) : bruto).trim();
}

/**
 * Casa e-mails recebidos com leads conhecidos (por thread ou remetente).
 * E-mails de quem não é lead são ignorados (não registramos dados de terceiros).
 */
function processarRespostas(emails, linhasLeads, configLinhas, agoraISO) {
  const cfg = lerConfig(configLinhas);
  const agora = agoraISO ? new Date(agoraISO) : new Date();
  const leads = linhasLeads.map(normalizarLead).filter((l) => l.id);
  const porThread = {};
  const porEmail = {};
  for (const l of leads) {
    if (texto(l.apse.apse_thread_id)) porThread[texto(l.apse.apse_thread_id)] = l;
    if (l.email) porEmail[l.email] = l;
  }

  const saida = [];
  for (const email of emails) {
    const de = enderecoRemetente(email);
    if (cfg.responsavel_email && de === cfg.responsavel_email.toLowerCase()) continue;
    const lead = porThread[texto(email.threadId)] || porEmail[de];
    if (!lead) continue;

    const corpo = textoResposta(email);
    const classe = classificarResposta(texto(email.subject || email.Subject) + "\n" + corpo);
    const etapaAntes = etapaAtual(lead);
    // Não rebaixa uma negociação avançada por causa de uma resposta genérica.
    const ordem = (e) => ETAPAS.indexOf(e);
    let etapa = ETAPA_POR_CLASSE[classe];
    if (!["NAO_CONTATAR", "PERDIDO"].includes(etapa) && ordem(etapaAntes) > ordem(etapa) && !ETAPAS_FECHADAS.includes(etapaAntes)) etapa = etapaAntes;

    const idioma = IDIOMAS.includes(texto(lead.apse.apse_idioma)) ? texto(lead.apse.apse_idioma) : detectarIdioma(lead, cfg);
    let sugestao = null;
    if (classe !== "OPT_OUT") {
      const t = TEXTOS[idioma];
      const msg = {
        assunto: /^re:/i.test(texto(email.subject)) ? texto(email.subject) : "Re: " + (texto(email.subject) || t.assunto(lead)),
        corpo: [t.oi(primeiroNome(lead.nome)), t.resp[classe], t.assinatura(cfg)].join("\n\n"),
      };
      sugestao = novaAbordagem(Object.assign({}, lead, { apse: Object.assign({}, lead.apse, { apse_thread_id: texto(email.threadId) }) }), "RESPOSTA", idioma, msg, { classe }, agora);
    }

    saida.push({
      interacao: {
        data: agora.toISOString(),
        apse_id: lead.id,
        lead: [lead.nome, lead.empresa].filter(Boolean).join(" · "),
        direcao: "RECEBIDO",
        canal: "email",
        classe,
        etapa_antes: etapaAntes,
        etapa_depois: etapa,
        resumo: corpo.slice(0, 500),
        thread_id: texto(email.threadId),
      },
      lead: {
        apse_id: lead.id,
        apse_etapa: etapa,
        apse_ultima_resposta: dataISO(agora),
        apse_ultimo_contato: dataISO(agora),
        apse_thread_id: texto(email.threadId) || texto(lead.apse.apse_thread_id),
        apse_followup_pendente: "",
      },
      abordagem: sugestao,
    });
  }
  return saida;
}

/* ------------------------------------------- id do lead → linha da planilha */

/**
 * Converte atualizações indexadas por apse_id em atualizações por row_number.
 * O n8n só consegue casar colunas entre A e Z; row_number funciona sempre,
 * mesmo quando a planilha original já tem muitas colunas.
 */
function paraLinhas(atualizacoes, linhasLeads) {
  const porId = {};
  for (const linha of linhasLeads) {
    const id = texto(linha.apse_id) || normalizarLead(linha).id;
    if (id && !porId[id]) porId[id] = linha;
  }
  const saida = [];
  for (const u of atualizacoes) {
    const linha = porId[u.apse_id];
    if (!linha) continue;
    const r = { row_number: linha.row_number };
    for (const k of Object.keys(u)) if (!k.startsWith("_")) r[k] = u[k];
    if (u._primeiroContato && !texto(linha.apse_primeiro_contato)) r.apse_primeiro_contato = u.apse_ultimo_contato;
    if (u._followup) r.apse_followups = Math.max(Number(linha.apse_followups || 0), u._followup);
    saida.push(r);
  }
  return saida;
}

function atualizacaoDoEnvio(registro) {
  return Object.assign({}, registro.lead, { _primeiroContato: registro.primeiroContato, _followup: registro.followup });
}

const QUENTES = ["PRECO", "REUNIAO", "INTERESSE"];

function alertaQuente(respostas, configLinhas) {
  const cfg = lerConfig(configLinhas);
  const quentes = respostas.filter((r) => QUENTES.includes(r.interacao.classe));
  if (!quentes.length || !cfg.responsavel_email) return null;
  const linhas = quentes.map((r) => `· ${r.interacao.lead} · ${r.interacao.classe} · etapa ${r.interacao.etapa_depois}\n  "${r.interacao.resumo.slice(0, 200)}"`);
  return {
    para: cfg.responsavel_email,
    assunto: `Ápse · ${quentes.length} lead(s) quente(s) respondeu(ram)`,
    texto: ["Respostas com intenção de compra:", "", ...linhas, "", "Há uma resposta sugerida na aba Abordagens aguardando sua aprovação.", cfg.planilha_url].filter((x) => x !== "").join("\n"),
  };
}

module.exports = {
  paraLinhas,
  atualizacaoDoEnvio,
  alertaQuente,
  ETAPAS,
  CONFIG_PADRAO,
  lerConfig,
  normalizarLead,
  proximaAcao,
  detectarIdioma,
  qualificar,
  classificarResposta,
  rotinaDiaria,
  aprovadosParaEnvio,
  registrarEnvio,
  processarRespostas,
  textoResposta,
  parseValor,
  parseData,
  TEXTOS,
};
