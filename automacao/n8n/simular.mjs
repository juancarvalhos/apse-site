// Executa os fluxos gerados (workflows/*.json) com Google Sheets e Gmail simulados.
// Serve para validar o fluxo de ponta a ponta sem n8n, sem credenciais e sem enviar nada.
//
//   node automacao/n8n/simular.mjs
//
// É um executor mínimo: implementa só os nós usados aqui (gatilhos, Code,
// Google Sheets read/update/append e Gmail send). Leads são fictícios.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const AQUI = dirname(fileURLToPath(import.meta.url));
const carregar = (f) => JSON.parse(readFileSync(join(AQUI, "workflows", f), "utf8"));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/* ------------------------------------------------------ planilha simulada */

const planilha = {
  Config: [
    { chave: "responsavel_email", valor: "juan@example.com" },
    { chave: "top_n", valor: "5" },
  ],
  Leads: [
    { Nome: "Ana Souza", Empresa: "Nutri Ana", Nicho: "Nutricionista", País: "Brasil", "Contato comercial público": "ana@nutriana.com.br", Instagram: "@nutriana", Site: "", "Última atividade verificada": hojeMenos(5), Verificação: "Verificado", Origem: "Instagram" },
    { Nome: "John Smith", Empresa: "Smith Cleaning", Nicho: "Cleaning", País: "United States", "Contato comercial público": "john@smithcleaning.com", Site: "https://linktr.ee/smithclean", "Última atividade verificada": hojeMenos(10), Verificação: "Verificado", Origem: "Google Maps" },
    { Nome: "Lucía Pérez", Empresa: "Pelu Lucía", Nicho: "Estética", País: "España", "Contato comercial público": "+34 600 123 456", Instagram: "@pelulucia", "Última atividade verificada": hojeMenos(2), Verificação: "Verificado", Origem: "site" },
    { Nome: "Marie Dubois", Empresa: "Cabinet Dubois", Nicho: "Psicóloga", País: "França", "Contato comercial público": "marie@psy-dubois.fr", "Última atividade verificada": hojeMenos(8), Verificação: "Verificado" },
    { Nome: "Carlos Lima", Empresa: "Lima Reformas", Nicho: "Reformas", País: "Portugal", "Contato comercial público": "+351 912 345 678", Site: "https://limareformas.pt", "Última atividade verificada": hojeMenos(300), Verificação: "Pendente" },
    { Nome: "Giulia Rossi", Empresa: "Studio Rossi", Nicho: "Dentista", País: "Itália", "Contato comercial público": "giulia@studiorossi.it", "Última atividade verificada": hojeMenos(20), Verificação: "Verificado" },
    { Nome: "Hans Müller", Empresa: "Physio Müller", Nicho: "Fisioterapia", País: "Alemanha", "Contato comercial público": "hans@physio-mueller.de", "Última atividade verificada": hojeMenos(3), Verificação: "Verificado" },
    { Nome: "Inativo Ltda", Nicho: "Advocacia", "Contato comercial público": "x@inativo.com", Verificação: "Inelegível" },
  ],
  Abordagens: [],
  Interacoes: [],
};
const caixaDeSaida = [];

function hojeMenos(d) {
  return new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
}
const comLinha = (aba) => planilha[aba].map((l, i) => ({ ...l, row_number: i + 2 }));

/* ------------------------------------------------------- executor mínimo */

async function executar(fluxo, gatilho, dadosGatilho = [{}]) {
  const porNome = Object.fromEntries(fluxo.nodes.map((n) => [n.name, n]));
  const saidas = {};
  const ordem = [];

  const $ = (nome) => {
    if (!(nome in saidas)) throw new Error(`Nó referenciado não executou: ${nome}`);
    const itens = saidas[nome];
    return { all: () => itens, first: () => itens[0], itemMatching: (i) => itens[i] };
  };

  async function rodar(nome, entrada) {
    const n = porNome[nome];
    let saida;
    const p = n.parameters;
    switch (n.type) {
      case "n8n-nodes-base.manualTrigger":
      case "n8n-nodes-base.scheduleTrigger":
        saida = [{ json: {} }];
        break;
      case "n8n-nodes-base.gmailTrigger":
        saida = dadosGatilho.map((json) => ({ json }));
        break;
      case "n8n-nodes-base.code": {
        const fn = new AsyncFunction("$input", "$", p.jsCode);
        saida = await fn({ all: () => entrada, first: () => entrada[0] }, $);
        assert.ok(Array.isArray(saida), `${nome} deve devolver array`);
        break;
      }
      case "n8n-nodes-base.googleSheets": {
        const aba = p.sheetName.value;
        assert.ok(aba in planilha, `aba inexistente: ${aba}`);
        if (p.operation === "read") {
          saida = comLinha(aba).map((json) => ({ json }));
        } else if (p.operation === "append") {
          for (const { json } of entrada) planilha[aba].push({ ...json });
          saida = entrada;
        } else if (p.operation === "update") {
          const chave = p.columns.matchingColumns[0];
          for (const { json } of entrada) {
            const idx = chave === "row_number" ? json.row_number - 2 : planilha[aba].findIndex((l) => l[chave] === json[chave]);
            assert.ok(planilha[aba][idx], `${nome}: linha não encontrada para ${chave}=${json[chave]}`);
            const { row_number, ...campos } = json;
            Object.assign(planilha[aba][idx], campos);
          }
          saida = entrada;
        } else throw new Error(`operação não simulada: ${p.operation}`);
        if (!saida.length && n.alwaysOutputData) saida = [{ json: {} }];
        break;
      }
      case "n8n-nodes-base.gmail": {
        saida = entrada.map(({ json }, i) => {
          const avaliar = (expr) => expr.replace(/^=\{\{\s*\$json\.(\w+)\s*\}\}$/, (_, k) => json[k]);
          const msg = { para: avaliar(p.sendTo), assunto: avaliar(p.subject), texto: avaliar(p.message) };
          assert.ok(msg.para && msg.para.includes("@"), `${nome}: destinatário inválido`);
          caixaDeSaida.push(msg);
          return { json: { id: `m${caixaDeSaida.length}`, threadId: `t-${msg.para}`, labelIds: ["SENT"] } };
        });
        break;
      }
      default:
        throw new Error(`nó não simulado: ${n.type}`);
    }
    saidas[nome] = saida;
    ordem.push(`${nome} (${saida.length})`);
    if (!saida.length) return;
    for (const destino of fluxo.connections[nome]?.main?.[0] || []) await rodar(destino.node, saida);
  }

  await rodar(gatilho, []);
  return ordem;
}

/* ----------------------------------------------------------------- roteiro */

const f1 = carregar("01-rotina-diaria.json");
const f2 = carregar("02-enviar-aprovadas.json");
const f3 = carregar("03-respostas.json");

console.log("1) Rotina diária");
console.log("   " + (await executar(f1, "Executar agora")).join(" → "));
const top = planilha.Abordagens.filter((a) => a.tipo === "PRIMEIRO_CONTATO");
assert.equal(top.length, 5, "deve haver 5 abordagens");
assert.equal(caixaDeSaida.length, 1, "só o resumo para o Juan");
assert.equal(caixaDeSaida[0].para, "juan@example.com");
assert.ok(!top.some((a) => /Inativo|Carlos/.test(a.lead)), "inelegível/inativo fora do top");
assert.ok(planilha.Leads.every((l) => l.apse_id && l.apse_etapa && l.apse_proxima_acao));
for (const a of top) console.log(`   · ${a.lead} · ${a.score} pts · ${a.idioma} · ${a.canal}`);

console.log("2) Envio sem aprovação não envia nada");
await executar(f2, "Executar agora");
assert.equal(caixaDeSaida.length, 1);

console.log("3) Juan aprova 1 e-mail (John) e 1 WhatsApp já enviado à mão (Lucía)");
planilha.Abordagens.find((a) => /John/.test(a.lead)).aprovado = "SIM";
planilha.Abordagens.find((a) => /Lucía/.test(a.lead)).aprovado = "sí";
console.log("   " + (await executar(f2, "Executar agora")).join(" → "));
assert.equal(caixaDeSaida.length, 2, "1 e-mail enviado");
assert.equal(caixaDeSaida[1].para, "john@smithcleaning.com");
assert.match(caixaDeSaida[1].texto, /^Hi John,/);
const john = planilha.Leads.find((l) => l.Nome === "John Smith");
const lucia = planilha.Leads.find((l) => l.Nome === "Lucía Pérez");
assert.equal(john.apse_etapa, "CONTATADO");
assert.equal(john.apse_thread_id, "t-john@smithcleaning.com");
assert.equal(lucia.apse_etapa, "CONTATADO");
assert.equal(planilha.Abordagens.find((a) => /Lucía/.test(a.lead)).status, "ENVIADO_MANUAL");

console.log("4) Rodar o envio de novo não reenvia");
await executar(f2, "Executar agora");
assert.equal(caixaDeSaida.length, 2);

console.log("5) John responde perguntando preço; um desconhecido também escreve");
const ordem3 = await executar(f3, "Novo e-mail recebido", [
  { threadId: "t-john@smithcleaning.com", from: { value: [{ address: "john@smithcleaning.com" }] }, subject: "Re: An idea for Smith Cleaning's website", text: "Sounds good. How much would it cost?\n\nOn Thu, Juan wrote:\n> Hi John" },
  { threadId: "x1", from: { value: [{ address: "newsletter@random.com" }] }, subject: "Weekly deals", text: "Buy now" },
]);
console.log("   " + ordem3.join(" → "));
assert.equal(planilha.Interacoes.length, 1, "só o lead conhecido é registrado");
assert.equal(planilha.Interacoes[0].classe, "PRECO");
assert.equal(john.apse_etapa, "NEGOCIACAO");
const sugestao = planilha.Abordagens.find((a) => a.tipo === "RESPOSTA");
assert.ok(sugestao && sugestao.status === "PENDENTE" && /fixed quote/.test(sugestao.mensagem));
assert.equal(caixaDeSaida.length, 3, "alerta de lead quente");
assert.match(caixaDeSaida[2].assunto, /quente/);

console.log("6) Rotina do dia seguinte não duplica quem já está em andamento");
const antes = planilha.Abordagens.length;
await executar(f1, "Executar agora");
const novas = planilha.Abordagens.slice(antes);
assert.ok(!novas.some((a) => /John|Lucía/.test(a.lead)), "John/Lucía não voltam ao top");
console.log(`   ${novas.length} nova(s) abordagem(ns) para leads ainda não abordados`);

console.log("\nSimulação OK. Nenhuma mensagem real foi enviada.");
