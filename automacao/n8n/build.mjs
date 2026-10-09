// Gera os fluxos do n8n (workflows/*.json) embutindo lib/comercial.js nos nós Code.
//
//   node automacao/n8n/build.mjs                       → ID da planilha como placeholder
//   node automacao/n8n/build.mjs --planilha <url|id>   → já aponta para a sua planilha
//
// Os JSON gerados são importados no n8n em Workflows → Import from File.
// Nenhuma credencial vai no arquivo: o n8n pede para escolher ao importar.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const LIB = readFileSync(join(AQUI, "lib/comercial.js"), "utf8");

const arg = process.argv.indexOf("--planilha");
const entrada = arg > 0 ? process.argv[arg + 1] : "";
const PLANILHA = (entrada.match(/\/d\/([\w-]+)/) || [])[1] || entrada || "COLE_AQUI_O_ID_DA_PLANILHA";

/* ------------------------------------------------------------ construtores */

const lib = `const lib = (() => { const module = { exports: {} };\n${LIB}\nreturn module.exports; })();\n`;

let x = 0;
function no(name, type, typeVersion, parameters, extra = {}) {
  const n = { parameters, name, type, typeVersion, position: [0, 0], id: `apse-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-") };
  return Object.assign(n, extra);
}

const doc = { __rl: true, mode: "id", value: PLANILHA };
const aba = (nome) => ({ __rl: true, mode: "name", value: nome });

const ler = (name, sheet) =>
  no(name, "n8n-nodes-base.googleSheets", 4.7, { operation: "read", documentId: doc, sheetName: aba(sheet), options: {} }, { executeOnce: true, alwaysOutputData: true });

const atualizar = (name, sheet, chaveMatch) =>
  no(name, "n8n-nodes-base.googleSheets", 4.7, {
    operation: "update",
    documentId: doc,
    sheetName: aba(sheet),
    columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: [chaveMatch], schema: [] },
    options: { handlingExtraData: "insertInNewColumn" },
  });

const anexar = (name, sheet) =>
  no(name, "n8n-nodes-base.googleSheets", 4.7, {
    operation: "append",
    documentId: doc,
    sheetName: aba(sheet),
    columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: [], schema: [] },
    options: { handlingExtraData: "insertInNewColumn" },
  });

const code = (name, corpo, mode = "runOnceForAllItems") => no(name, "n8n-nodes-base.code", 2, { mode, jsCode: (corpo.includes("lib.") ? lib : "") + corpo });

const gmail = (name, para, assunto, mensagem) =>
  no(name, "n8n-nodes-base.gmail", 2.2, {
    resource: "message",
    operation: "send",
    sendTo: para,
    subject: assunto,
    emailType: "text",
    message: mensagem,
    options: { appendAttribution: false },
  });

const agenda = (name, cron) => no(name, "n8n-nodes-base.scheduleTrigger", 1.2, { rule: { interval: [{ field: "cronExpression", expression: cron }] } });
const manual = () => no("Executar agora", "n8n-nodes-base.manualTrigger", 1, {});
const nota = (name, content, w = 420, h = 300) => no(name, "n8n-nodes-base.stickyNote", 1, { content, width: w, height: h });

// Código comum para ler a aba Config com segurança (ela pode estar vazia).
const CONFIG = `const configLinhas = $('Ler Config').all().map((i) => i.json);\n`;
const LEADS = `const linhasLeads = $('Ler Leads').all().map((i) => i.json).filter((l) => l.row_number);\n`;

function fluxo(nome, nos, ligacoes, layout) {
  // ligacoes: [origem, destino] ou [origem, destino, saídaDaOrigem]
  const connections = {};
  for (const [de, para, saida = 0] of ligacoes) {
    connections[de] ??= { main: [] };
    connections[de].main[saida] ??= [];
    connections[de].main[saida].push({ node: para, type: "main", index: 0 });
  }
  for (const n of nos) if (layout[n.name]) n.position = layout[n.name];
  return {
    name: nome,
    nodes: nos,
    connections,
    active: false,
    settings: { executionOrder: "v1", timezone: "America/Sao_Paulo", saveManualExecutions: true, saveDataErrorExecution: "all", saveDataSuccessExecution: "all" },
    meta: { templateCredsSetupCompleted: false },
    pinData: {},
    tags: [],
  };
}

const grade = (col, lin) => [col * 260, lin * 200];

/* ------------------------------------------------- 1 · rotina diária (08h) */

const f1 = fluxo(
  "Ápse · 1 · Rotina comercial diária",
  [
    nota(
      "Sobre",
      "## Ápse · Rotina comercial diária\nTodo dia útil às 08h (horário de Brasília):\n1. Lê **Config** e **Leads**.\n2. Qualifica cada lead (pontuação explicável: fatos / estimativas / não verificado) e grava nas colunas `apse_*`.\n3. Escolhe os **5 melhores** e cria a mensagem no idioma de cada um na aba **Abordagens** (status PENDENTE).\n4. Cria follow-ups devidos.\n5. Manda o resumo do dia para o seu e-mail.\n\n**Nada é enviado ao lead aqui.** Para aprovar, escreva SIM na coluna `aprovado`.",
      520,
      380
    ),
    agenda("Dias úteis 08h", "0 8 * * 1-5"),
    manual(),
    ler("Ler Config", "Config"),
    ler("Ler Leads", "Leads"),
    code("Qualificar leads", CONFIG + LEADS + "const r = lib.rotinaDiaria(linhasLeads, configLinhas);\nreturn r.atualizacoes.map((json) => ({ json }));"),
    atualizar("Gravar qualificação", "Leads", "row_number"),
    code("Top 5 e follow-ups", CONFIG + LEADS + "const r = lib.rotinaDiaria(linhasLeads, configLinhas);\nreturn r.abordagens.map((json) => ({ json }));"),
    anexar("Registrar abordagens", "Abordagens"),
    code(
      "Montar resumo",
      CONFIG + LEADS + "const r = lib.rotinaDiaria(linhasLeads, configLinhas);\nif (!r.resumo.para) return []; // sem e-mail do responsável na Config\nreturn [{ json: r.resumo }];"
    ),
    gmail("Enviar resumo para mim", "={{ $json.para }}", "={{ $json.assunto }}", "={{ $json.texto }}"),
  ],
  [
    ["Dias úteis 08h", "Ler Config"],
    ["Executar agora", "Ler Config"],
    ["Ler Config", "Ler Leads"],
    ["Ler Leads", "Qualificar leads"],
    ["Qualificar leads", "Gravar qualificação"],
    ["Ler Leads", "Top 5 e follow-ups"],
    ["Top 5 e follow-ups", "Registrar abordagens"],
    ["Ler Leads", "Montar resumo"],
    ["Montar resumo", "Enviar resumo para mim"],
  ],
  {
    Sobre: [-60, -440],
    "Dias úteis 08h": grade(0, 0),
    "Executar agora": grade(0, 1),
    "Ler Config": grade(1, 0.5),
    "Ler Leads": grade(2, 0.5),
    "Qualificar leads": grade(3, -0.5),
    "Gravar qualificação": grade(4, -0.5),
    "Top 5 e follow-ups": grade(3, 0.5),
    "Registrar abordagens": grade(4, 0.5),
    "Montar resumo": grade(3, 1.5),
    "Enviar resumo para mim": grade(4, 1.5),
  }
);

/* ------------------------------------------- 2 · enviar o que foi aprovado */

const f2 = fluxo(
  "Ápse · 2 · Enviar abordagens aprovadas",
  [
    nota(
      "Sobre",
      "## Ápse · Enviar aprovadas\nA cada 30 min, em horário comercial:\n- **E-mail aprovado (SIM)** → envia pelo seu Gmail (limite diário em `max_envios_dia`).\n- **WhatsApp / Instagram aprovado (SIM)** → significa que *você* já colou e enviou a mensagem (use `link_whatsapp`). O fluxo só registra o envio e inicia a contagem do follow-up.\n\nDepois atualiza a etapa do lead para CONTATADO.",
      520,
      320
    ),
    agenda("A cada 30 min (8h–19h)", "*/30 8-19 * * 1-6"),
    manual(),
    ler("Ler Config", "Config"),
    ler("Ler Abordagens", "Abordagens"),
    code("Aprovados", CONFIG + "const ab = $('Ler Abordagens').all().map((i) => i.json).filter((a) => a.abordagem_id);\nreturn lib.aprovadosParaEnvio(ab, configLinhas).map((json) => ({ json }));"),

    code("Só e-mails", "return $input.all().filter((i) => i.json.canal === 'email');"),
    gmail("Enviar e-mail", "={{ $json.para }}", "={{ $json.assunto }}", "={{ $json.mensagem }}"),
    code("Registrar e-mails", "return $input.all().map((item, i) => ({ json: lib.registrarEnvio($('Só e-mails').itemMatching(i).json, item.json) }));"),
    code("Status (e-mail)", "return $input.all().map((i) => ({ json: i.json.abordagem }));"),
    atualizar("Atualizar Abordagens (e-mail)", "Abordagens", "abordagem_id"),
    ler("Ler Leads (e-mail)", "Leads"),
    code(
      "Etapa dos leads (e-mail)",
      "const linhas = $('Ler Leads (e-mail)').all().map((i) => i.json).filter((l) => l.row_number);\nconst regs = $('Registrar e-mails').all().map((i) => lib.atualizacaoDoEnvio(i.json));\nreturn lib.paraLinhas(regs, linhas).map((json) => ({ json }));"
    ),
    atualizar("Atualizar Leads (e-mail)", "Leads", "row_number"),

    code("Registrar manuais", "return $input.all().filter((i) => i.json.canal !== 'email').map((i) => ({ json: lib.registrarEnvio(i.json, null) }));"),
    code("Status (manual)", "return $input.all().map((i) => ({ json: i.json.abordagem }));"),
    atualizar("Atualizar Abordagens (manual)", "Abordagens", "abordagem_id"),
    ler("Ler Leads (manual)", "Leads"),
    code(
      "Etapa dos leads (manual)",
      "const linhas = $('Ler Leads (manual)').all().map((i) => i.json).filter((l) => l.row_number);\nconst regs = $('Registrar manuais').all().map((i) => lib.atualizacaoDoEnvio(i.json));\nreturn lib.paraLinhas(regs, linhas).map((json) => ({ json }));"
    ),
    atualizar("Atualizar Leads (manual)", "Leads", "row_number"),
  ],
  [
    ["A cada 30 min (8h–19h)", "Ler Config"],
    ["Executar agora", "Ler Config"],
    ["Ler Config", "Ler Abordagens"],
    ["Ler Abordagens", "Aprovados"],
    ["Aprovados", "Só e-mails"],
    ["Só e-mails", "Enviar e-mail"],
    ["Enviar e-mail", "Registrar e-mails"],
    ["Registrar e-mails", "Status (e-mail)"],
    ["Status (e-mail)", "Atualizar Abordagens (e-mail)"],
    ["Atualizar Abordagens (e-mail)", "Ler Leads (e-mail)"],
    ["Ler Leads (e-mail)", "Etapa dos leads (e-mail)"],
    ["Etapa dos leads (e-mail)", "Atualizar Leads (e-mail)"],
    ["Aprovados", "Registrar manuais"],
    ["Registrar manuais", "Status (manual)"],
    ["Status (manual)", "Atualizar Abordagens (manual)"],
    ["Atualizar Abordagens (manual)", "Ler Leads (manual)"],
    ["Ler Leads (manual)", "Etapa dos leads (manual)"],
    ["Etapa dos leads (manual)", "Atualizar Leads (manual)"],
  ],
  {
    Sobre: [-60, -400],
    "A cada 30 min (8h–19h)": grade(0, 0),
    "Executar agora": grade(0, 1),
    "Ler Config": grade(1, 0.5),
    "Ler Abordagens": grade(2, 0.5),
    Aprovados: grade(3, 0.5),
    "Só e-mails": grade(4, 0),
    "Enviar e-mail": grade(5, 0),
    "Registrar e-mails": grade(6, 0),
    "Status (e-mail)": grade(7, 0),
    "Atualizar Abordagens (e-mail)": grade(8, 0),
    "Ler Leads (e-mail)": grade(9, 0),
    "Etapa dos leads (e-mail)": grade(10, 0),
    "Atualizar Leads (e-mail)": grade(11, 0),
    "Registrar manuais": grade(4, 1),
    "Status (manual)": grade(5, 1),
    "Atualizar Abordagens (manual)": grade(6, 1),
    "Ler Leads (manual)": grade(7, 1),
    "Etapa dos leads (manual)": grade(8, 1),
    "Atualizar Leads (manual)": grade(9, 1),
  }
);

/* ------------------------------------------- 3 · respostas por e-mail */

const CASADAS = "const respostas = $('Casar com leads').all().map((i) => i.json);\n";
const f3 = fluxo(
  "Ápse · 3 · Respostas e negociações",
  [
    nota(
      "Sobre",
      "## Ápse · Respostas\nA cada 5 min verifica a caixa de entrada do Gmail.\n- Só registra e-mails de **leads conhecidos** (por conversa ou remetente). O resto é ignorado.\n- Classifica a resposta: interesse, preço, reunião, agora não, dúvida ou pedido de remoção.\n- Atualiza a etapa do lead, registra na aba **Interacoes** e deixa uma **resposta sugerida** na aba Abordagens (PENDENTE).\n- Lead quente → alerta no seu e-mail.\n- Pedido de remoção → NAO_CONTATAR, sem resposta automática.",
      520,
      360
    ),
    no("Novo e-mail recebido", "n8n-nodes-base.gmailTrigger", 1.3, {
      pollTimes: { item: [{ mode: "everyX", value: 5, unit: "minutes" }] },
      simple: false,
      filters: { q: "in:inbox -from:me -category:promotions -category:social" },
      options: {},
    }),
    ler("Ler Config", "Config"),
    ler("Ler Leads", "Leads"),
    code(
      "Casar com leads",
      CONFIG + LEADS + "const emails = $('Novo e-mail recebido').all().map((i) => i.json);\nreturn lib.processarRespostas(emails, linhasLeads, configLinhas).map((json) => ({ json }));"
    ),
    code("Interações", CASADAS + "return respostas.map((r) => ({ json: r.interacao }));"),
    anexar("Registrar interações", "Interacoes"),
    code("Respostas sugeridas", CASADAS + "return respostas.filter((r) => r.abordagem).map((r) => ({ json: r.abordagem }));"),
    anexar("Registrar sugestões", "Abordagens"),
    code("Etapas", CASADAS + LEADS + "return lib.paraLinhas(respostas.map((r) => r.lead), linhasLeads).map((json) => ({ json }));"),
    atualizar("Atualizar Leads", "Leads", "row_number"),
    code("Leads quentes", CASADAS + CONFIG + "const a = lib.alertaQuente(respostas, configLinhas);\nreturn a ? [{ json: a }] : [];"),
    gmail("Avisar-me", "={{ $json.para }}", "={{ $json.assunto }}", "={{ $json.texto }}"),
  ],
  [
    ["Novo e-mail recebido", "Ler Config"],
    ["Ler Config", "Ler Leads"],
    ["Ler Leads", "Casar com leads"],
    ["Casar com leads", "Interações"],
    ["Interações", "Registrar interações"],
    ["Casar com leads", "Respostas sugeridas"],
    ["Respostas sugeridas", "Registrar sugestões"],
    ["Casar com leads", "Etapas"],
    ["Etapas", "Atualizar Leads"],
    ["Casar com leads", "Leads quentes"],
    ["Leads quentes", "Avisar-me"],
  ],
  {
    Sobre: [-60, -440],
    "Novo e-mail recebido": grade(0, 0.5),
    "Ler Config": grade(1, 0.5),
    "Ler Leads": grade(2, 0.5),
    "Casar com leads": grade(3, 0.5),
    "Interações": grade(4, -0.5),
    "Registrar interações": grade(5, -0.5),
    "Respostas sugeridas": grade(4, 0.5),
    "Registrar sugestões": grade(5, 0.5),
    Etapas: grade(4, 1.5),
    "Atualizar Leads": grade(5, 1.5),
    "Leads quentes": grade(4, 2.5),
    "Avisar-me": grade(5, 2.5),
  }
);

/* ------------------------------------------------------------------ saída */

// Com a planilha real, grava fora do git (o repositório é público).
const destino = join(AQUI, PLANILHA.startsWith("COLE_AQUI") ? "workflows" : "_local");
mkdirSync(destino, { recursive: true });
for (const [arquivo, f] of [
  ["01-rotina-diaria.json", f1],
  ["02-enviar-aprovadas.json", f2],
  ["03-respostas.json", f3],
]) {
  writeFileSync(join(destino, arquivo), JSON.stringify(f, null, 2) + "\n");
  console.log(`${join(destino, arquivo)}: ${f.nodes.length} nós`);
}
if (PLANILHA.startsWith("COLE_AQUI")) console.log("Planilha não informada: use --planilha <url> ou troque o ID em cada nó Google Sheets.");
