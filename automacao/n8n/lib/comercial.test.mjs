// Testes da lógica comercial. Rodar: node --test automacao/n8n/lib/
// Todos os leads abaixo são fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const c = require("./comercial.js");

const AGORA = "2026-10-09T12:00:00Z";

// Cabeçalhos no formato da planilha do Codex (pt) e em inglês, para provar o mapeamento.
const linhas = [
  { row_number: 2, Nome: "Ana Souza", Empresa: "Nutri Ana", Nicho: "Nutricionista", País: "Brasil", "Contato comercial público": "ana@nutriana.com.br", Instagram: "https://instagram.com/nutriana/", Site: "", "Última atividade verificada": "2026-10-01", Verificação: "Verificado", Origem: "Instagram (prospecção)" },
  { row_number: 3, Name: "John Smith", Company: "Smith Cleaning", Industry: "Cleaning", Country: "United States", Email: "john@smithcleaning.com", Website: "https://linktr.ee/smithclean", "Last activity": "2026-09-20", Verification: "verified", Source: "Google Maps" },
  { row_number: 4, Nombre: "Lucía Pérez", Empresa: "Pelu Lucía", Nicho: "Estética", País: "España", Teléfono: "+34 600 123 456", Instagram: "@pelulucia", "Última atividade verificada": "2026-10-05", Verificação: "Verificado", Origem: "site" },
  { row_number: 5, Nome: "Carlos Lima", Empresa: "Lima Reformas", Nicho: "Reformas", País: "Portugal", "Contato comercial público": "+351 912 345 678", Site: "https://limareformas.pt", "Última atividade verificada": "2025-12-01", Verificação: "Pendente" },
  { row_number: 6, Nome: "Inativo Ltda", Nicho: "Advocacia", Email: "x@inativo.com", Verificação: "Inelegível" },
  { row_number: 7, Nome: "Marie Dubois", Entreprise: "", Nicho: "Psicóloga", País: "França", Email: "marie@psy-dubois.fr", "Última atividade verificada": "2026-09-30", Verificação: "Verificado" },
  { row_number: 8, Nome: "Ana Souza (dup)", Email: "ANA@nutriana.com.br" },
  { row_number: 9, Nome: "Hans Müller", Nicho: "Fisioterapia", País: "Alemanha", Email: "hans@physio-mueller.de", "Última atividade verificada": "2026-10-02", Verificação: "Verificado", Status: "Não contatar" },
  { row_number: 10 },
];

test("detecta idioma por país, DDI e domínio", () => {
  const cfg = c.lerConfig([]);
  const idioma = (l) => c.detectarIdioma(c.normalizarLead(l), cfg);
  assert.equal(idioma(linhas[0]), "pt");
  assert.equal(idioma(linhas[1]), "en");
  assert.equal(idioma(linhas[2]), "es");
  assert.equal(idioma(linhas[5]), "fr");
  assert.equal(idioma({ Email: "a@b.it" }), "it");
  assert.equal(idioma({ Telefone: "+49 30 1234567" }), "de");
  assert.equal(idioma({ Email: "a@b.com" }), "en"); // padrão global
});

test("contato comercial público vira e-mail ou WhatsApp", () => {
  assert.equal(c.normalizarLead(linhas[0]).email, "ana@nutriana.com.br");
  assert.equal(c.normalizarLead(linhas[3]).whatsapp, "+351 912 345 678");
  assert.equal(c.normalizarLead(linhas[0]).instagram, "@nutriana");
});

test("qualificação separa fatos, estimativas e não verificado", () => {
  const cfg = c.lerConfig([]);
  const lead = c.normalizarLead(linhas[3]);
  const q = c.qualificar(lead, cfg, new Date(AGORA));
  assert.match(q.motivo, /Fatos: /);
  assert.match(q.motivo, /Não verificado: .*pendente/);
  assert.match(q.motivo, /possivelmente inativo/);
  const inel = c.qualificar(c.normalizarLead(linhas[4]), cfg, new Date(AGORA));
  assert.equal(inel.faixa, "X");
  assert.equal(inel.score, 0);
});

test("rotina diária: top 5 sem inelegíveis, duplicados ou opt-out, com abordagens no idioma certo", () => {
  const r = c.rotinaDiaria(linhas, [{ chave: "top_n", valor: "5" }, { chave: "responsavel_email", valor: "juan@example.com" }], AGORA);
  const top = r.abordagens.filter((a) => a.tipo === "PRIMEIRO_CONTATO");
  assert.ok(top.length <= 5 && top.length >= 3, `top=${top.length}`);
  const nomes = top.map((a) => a.lead).join("|");
  assert.doesNotMatch(nomes, /Inativo|dup|Müller/);
  const lucia = top.find((a) => /Lucía/.test(a.lead));
  assert.equal(lucia.idioma, "es");
  assert.equal(lucia.canal, "whatsapp");
  assert.match(lucia.mensagem, /^Hola, Lucía:/);
  assert.match(lucia.link_whatsapp, /^https:\/\/wa\.me\/34600123456\?text=/);
  assert.match(lucia.mensagem, /Gracias por contactar/); // origem quente
  const john = top.find((a) => /John/.test(a.lead));
  assert.equal(john.idioma, "en");
  assert.match(john.mensagem, /remove/); // opt-out em contato frio
  assert.match(john.mensagem, /social media and referrals/); // linktree = sem site próprio
  for (const a of top) {
    assert.equal(a.status, "PENDENTE");
    assert.equal(a.aprovado, "");
    assert.ok(a.justificativa && a.score > 0);
  }
  // Atualizações: uma por linha com dados, duplicado marcado, selecionados aguardando aprovação.
  assert.equal(r.atualizacoes.length, 8);
  assert.equal(r.atualizacoes.find((u) => u.row_number === 8).apse_etapa, "DUPLICADO");
  assert.equal(r.atualizacoes.find((u) => u.row_number === 9).apse_etapa, "NAO_CONTATAR");
  const sel = r.atualizacoes.filter((u) => u.apse_etapa === "AGUARDANDO_APROVACAO");
  assert.equal(sel.length, top.length);
  assert.ok(sel.every((u) => /Abordagens/.test(u.apse_proxima_acao)));
  assert.equal(r.resumo.para, "juan@example.com");
  assert.match(r.resumo.texto, /TOP \d PARA PRIMEIRO CONTATO/);
});

test("rodar de novo não duplica abordagens (lead já aguarda aprovação)", () => {
  const r1 = c.rotinaDiaria(linhas, [], AGORA);
  const linhas2 = linhas.map((l) => {
    const u = r1.atualizacoes.find((x) => x.row_number === l.row_number);
    return u ? { ...l, ...u } : l;
  });
  const r2 = c.rotinaDiaria(linhas2, [], AGORA);
  const ids1 = new Set(r1.abordagens.map((a) => a.apse_id));
  assert.ok(r2.abordagens.every((a) => !ids1.has(a.apse_id)));
  assert.equal(r2.atualizacoes.find((u) => u.row_number === 2).apse_id, r1.atualizacoes.find((u) => u.row_number === 2).apse_id);
});

test("follow-up segue a cadência e respeita o limite", () => {
  const base = { row_number: 2, Nome: "Ana", Email: "ana@x.com.br", apse_id: "L1", apse_etapa: "CONTATADO", apse_idioma: "pt" };
  const r = c.rotinaDiaria([{ ...base, apse_ultimo_contato: "2026-10-05", apse_followups: 0 }], [], AGORA);
  assert.equal(r.abordagens.length, 1);
  assert.equal(r.abordagens[0].tipo, "FOLLOWUP_1");
  assert.equal(r.atualizacoes[0].apse_followup_pendente, "2026-10-09");
  const cedo = c.rotinaDiaria([{ ...base, apse_ultimo_contato: "2026-10-08", apse_followups: 0 }], [], AGORA);
  assert.equal(cedo.abordagens.length, 0);
  const esgotado = c.rotinaDiaria([{ ...base, apse_ultimo_contato: "2026-09-01", apse_followups: 3 }], [], AGORA);
  assert.equal(esgotado.abordagens.length, 0);
  const pendente = c.rotinaDiaria([{ ...base, apse_ultimo_contato: "2026-09-01", apse_followups: 0, apse_followup_pendente: "2026-10-08" }], [], AGORA);
  assert.equal(pendente.abordagens.length, 0);
});

test("negociação parada aparece no resumo", () => {
  const r = c.rotinaDiaria([{ row_number: 2, Nome: "Bia", Email: "bia@x.com", apse_etapa: "PROPOSTA", apse_ultimo_contato: "2026-09-25" }], [], AGORA);
  assert.match(r.resumo.texto, /NEGOCIAÇÕES PARADAS.*: 1/);
  assert.match(r.resumo.texto, /Bia · PROPOSTA · 14 dias/);
});

test("envio: só aprovados e pendentes; limite diário vale só para e-mail", () => {
  const ab = [
    { abordagem_id: "A1", apse_id: "L1", canal: "email", para: "a@x.com", aprovado: "SIM", status: "PENDENTE", tipo: "PRIMEIRO_CONTATO" },
    { abordagem_id: "A2", apse_id: "L2", canal: "email", para: "b@x.com", aprovado: "", status: "PENDENTE" },
    { abordagem_id: "A3", apse_id: "L3", canal: "whatsapp", para: "+34600", aprovado: "sí", status: "PENDENTE", tipo: "PRIMEIRO_CONTATO" },
    { abordagem_id: "A4", apse_id: "L4", canal: "email", para: "d@x.com", aprovado: "yes", status: "ENVIADO" },
    { abordagem_id: "A5", apse_id: "L5", canal: "email", para: "e@x.com", aprovado: "ok", status: "PENDENTE" },
  ];
  const ids = c.aprovadosParaEnvio(ab, [], AGORA).map((a) => a.abordagem_id);
  assert.deepEqual(ids, ["A1", "A3", "A5"]);
  const limitado = c.aprovadosParaEnvio(ab, [{ chave: "max_envios_dia", valor: "1" }], AGORA).map((a) => a.abordagem_id);
  assert.deepEqual(limitado, ["A1", "A3"]);

  const env = c.registrarEnvio({ abordagem_id: "A1", apse_id: "L1", canal: "email", tipo: "PRIMEIRO_CONTATO" }, { id: "m1", threadId: "t1" }, AGORA);
  assert.equal(env.abordagem.status, "ENVIADO");
  assert.equal(env.lead.apse_etapa, "CONTATADO");
  assert.equal(env.lead.apse_thread_id, "t1");
  const man = c.registrarEnvio({ abordagem_id: "A3", apse_id: "L3", canal: "whatsapp", tipo: "PRIMEIRO_CONTATO" }, null, AGORA);
  assert.equal(man.abordagem.status, "ENVIADO_MANUAL");
});

test("classifica respostas em vários idiomas", () => {
  assert.equal(c.classificarResposta("Por favor, me remova da lista"), "OPT_OUT");
  assert.equal(c.classificarResposta("Please unsubscribe me"), "OPT_OUT");
  assert.equal(c.classificarResposta("¿Cuánto cuesta una landing?"), "PRECO");
  assert.equal(c.classificarResposta("Quel est le prix ?"), "PRECO");
  assert.equal(c.classificarResposta("Can we schedule a call on Tuesday?"), "REUNIAO");
  assert.equal(c.classificarResposta("Agora não, talvez mais para frente"), "NAO_AGORA");
  assert.equal(c.classificarResposta("Sounds great, I'm interested"), "INTERESSE");
  assert.equal(c.classificarResposta("Quem é você?"), "DUVIDA");
});

test("respostas: casa por thread ou remetente, ignora desconhecidos, sugere resposta no idioma", () => {
  const leads = [
    { row_number: 2, Nome: "John Smith", Email: "john@smithcleaning.com", apse_id: "L9", apse_etapa: "CONTATADO", apse_idioma: "en", apse_thread_id: "t9" },
    { row_number: 3, Nome: "Lucía", Email: "lucia@pelu.es", apse_id: "L8", apse_etapa: "CONTATADO", apse_idioma: "es" },
  ];
  const emails = [
    { threadId: "t9", from: { value: [{ address: "john@smithcleaning.com" }] }, subject: "Re: An idea", text: "How much would it cost?\n\nOn Mon, Juan wrote:\n> Hi John, remove..." },
    { threadId: "zz", From: "Lucía <LUCIA@pelu.es>", subject: "Re: Una idea", text: "Por favor eliminar mi correo" },
    { threadId: "q1", from: { value: [{ address: "spam@random.com" }] }, subject: "Hi", text: "buy now" },
  ];
  const r = c.processarRespostas(emails, leads, [], AGORA);
  assert.equal(r.length, 2);
  assert.equal(r[0].interacao.classe, "PRECO"); // o "remove" citado no histórico é ignorado
  assert.equal(r[0].lead.apse_etapa, "NEGOCIACAO");
  assert.match(r[0].abordagem.mensagem, /fixed quote/);
  assert.equal(r[0].abordagem.thread_id, "t9");
  assert.equal(r[0].abordagem.status, "PENDENTE");
  assert.equal(r[1].interacao.classe, "OPT_OUT");
  assert.equal(r[1].lead.apse_etapa, "NAO_CONTATAR");
  assert.equal(r[1].abordagem, null);
});

test("todos os idiomas têm os mesmos textos", () => {
  const ref = Object.keys(c.TEXTOS.pt).sort();
  for (const l of Object.keys(c.TEXTOS)) {
    assert.deepEqual(Object.keys(c.TEXTOS[l]).sort(), ref, l);
    assert.equal(c.TEXTOS[l].fu.length, 3, l);
    assert.deepEqual(Object.keys(c.TEXTOS[l].resp).sort(), Object.keys(c.TEXTOS.pt.resp).sort(), l);
  }
});

test("paraLinhas casa por apse_id e devolve row_number; conta follow-ups", () => {
  const linhas = [
    { row_number: 2, Nome: "Ana", Email: "ana@x.com", apse_id: "L1", apse_followups: 1, apse_primeiro_contato: "2026-10-01" },
    { row_number: 3, Nome: "Bia", Email: "bia@x.com" },
  ];
  const idBia = c.normalizarLead(linhas[1]).id;
  const env1 = c.registrarEnvio({ abordagem_id: "A", apse_id: "L1", canal: "email", tipo: "FOLLOWUP_2" }, { threadId: "t" }, AGORA);
  const env2 = c.registrarEnvio({ abordagem_id: "B", apse_id: idBia, canal: "whatsapp", tipo: "PRIMEIRO_CONTATO" }, null, AGORA);
  const r = c.paraLinhas([c.atualizacaoDoEnvio(env1), c.atualizacaoDoEnvio(env2), { apse_id: "inexistente" }], linhas);
  assert.equal(r.length, 2);
  assert.equal(r[0].row_number, 2);
  assert.equal(r[0].apse_followups, 2);
  assert.equal(r[0].apse_primeiro_contato, undefined); // não sobrescreve
  assert.equal(r[1].row_number, 3);
  assert.equal(r[1].apse_primeiro_contato, "2026-10-09");
  assert.ok(Object.keys(r[1]).every((k) => !k.startsWith("_")));
});
