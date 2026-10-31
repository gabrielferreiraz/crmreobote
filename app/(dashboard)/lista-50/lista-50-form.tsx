"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Compass,
  Flame,
  Lightbulb,
  Plus,
  PlusCircle,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import type { Lista50Progress } from "@/lib/lista-50";
import { Lista50SupervisorPanel } from "./lista-50-supervisor-panel";
import { Lista50AdminToggle } from "./lista-50-admin-toggle";
import { Lista50DuplicateModal, type Lista50DuplicateInfo } from "./lista-50-duplicate-modal";

/**
 * Lista dos 50 — a campanha "Novembro Black": o consultor entrega 50 nomes do
 * círculo dele por semana. É a meta/desafio dele — vira negócio de verdade no
 * pipeline (etapa "Black November"), tenha ou não batido os 50 naquela
 * semana. Os 20 leads/dia que a Reobote distribui NÃO dependem de bater essa
 * meta (decisão do Dono, 2026-10-31): são incondicionais, só não é isto que a
 * página precisa anunciar — o que ela mostra é o desafio em si.
 *
 * A tela tem visual próprio (preto e amarelo), fora do tema do CRM: é material
 * de campanha, não uma tela de cadastro comum, e é assim que a Reobote já
 * divulga internamente. Por isso as cores vão em valores literais em vez dos
 * tokens do app.
 */

const TOTAL_GOAL = 50;
const LINHAS_INICIAIS = 10;

const CIRCULOS = ["Círculo", "Família", "Trabalho", "Esporte", "Igreja", "Outro"] as const;
const INTERESSES = ["Indefinido", "Alto", "Médio", "Baixo"] as const;
const TEMPERATURAS = ["Morno", "Quente", "Frio"] as const;

type Linha = {
  /** Chave estável: o índice muda quando uma linha do meio é removida. */
  id: number;
  nome: string;
  whatsapp: string;
  circulo: string;
  interesse: string;
  temperatura: string;
  observacao: string;
};

function novaLinha(id: number): Linha {
  return { id, nome: "", whatsapp: "", circulo: CIRCULOS[0], interesse: INTERESSES[0], temperatura: TEMPERATURAS[0], observacao: "" };
}

/** (67) 99999-9999 — só dígitos por baixo, o formato é de exibição. */
function mascararTelefone(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 11);
  if (digitos.length > 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length > 6) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  if (digitos.length > 2) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
  return digitos;
}

/** Vale como lead: nome de verdade e um celular com DDD. */
function linhaValida(linha: Linha): boolean {
  return linha.nome.trim().length >= 2 && linha.whatsapp.replace(/\D/g, "").length >= 10;
}

const NOMES_EXEMPLO = [
  "João do Futebol", "Ana da Célula", "Primo Marcos", "Carlos Oficina", "Mariana Vizinha",
  "Lucas Padel", "Dr. Roberto", "Tia Solange", "Renato Faculdade", "Patricia Academia",
  "Gustavo Cliente", "Fernando Barber", "Camila Inglês", "Sérgio Condomínio", "Beatriz Pátio",
];
const OBS_EXEMPLO = [
  "Quer trocar de carro", "Pediu orçamento mês passado", "Tem interesse na Black",
  "Mudar de plano", "Investidor em potencial", "Amigo próximo", "Atender via WhatsApp",
];

const LUGARES = [
  { n: "01", titulo: "Agenda do celular de A a Z.", texto: "Role contato por contato. Só aqui costumam sair 30 nomes." },
  { n: "02", titulo: "Família estendida.", texto: "Pais, irmãos, tios, primos, cunhados e sogros." },
  { n: "03", titulo: "Vizinhos e condomínio.", texto: "Grupo do prédio, da rua, síndico e porteiros." },
  { n: "04", titulo: "Pais da escola dos filhos.", texto: "Grupo de WhatsApp da turma, festas de aniversário, transporte escolar." },
  { n: "05", titulo: "Ex-colegas de trabalho.", texto: "Todos os empregos anteriores, inclusive chefes antigos." },
  { n: "06", titulo: "Turma de escola e faculdade.", texto: "Grupos de formatura e de reencontro." },
  { n: "07", titulo: "Quem te atende.", texto: "Barbeiro, cabeleireira, mecânico, dentista, diarista, eletricista." },
  { n: "08", titulo: "Comércio do bairro.", texto: "Donos de padaria, mercado, farmácia, açougue, loja de roupa." },
  { n: "09", titulo: "Grupos de WhatsApp.", texto: "Abra cada grupo que você participa e veja os participantes." },
  { n: "10", titulo: "Instagram e Facebook.", texto: "Quem curte e comenta seus posts já gosta de você." },
  { n: "11", titulo: "Motoristas de aplicativo e taxistas.", texto: "Carro é ferramenta de trabalho e precisa ser trocado." },
  { n: "12", titulo: "Agro e produtor rural.", texto: "Caminhonete, caminhão, máquina: carta de pesados." },
  { n: "13", titulo: "Empresários e MEIs.", texto: "Precisam de veículo de trabalho, sala ou galpão." },
  { n: "14", titulo: "Quem paga aluguel.", texto: "Amigos inquilinos: a parcela pode virar casa própria." },
  { n: "15", titulo: "Noivos, recém-casados e quem vai ter filho.", texto: "Casa maior ou carro maior está nos planos." },
  { n: "16", titulo: "Servidores públicos e profissionais de saúde.", texto: "Renda estável e bom perfil para planejar." },
  { n: "17", titulo: "Clubes e associações.", texto: "Rotary, Lions, maçonaria, associação de bairro, sindicato." },
  { n: "18", titulo: "Outros esportes e hobbies.", texto: "Corrida, ciclismo, pescaria, jiu-jitsu, beach tennis, carro antigo." },
  { n: "19", titulo: "Parceiros que indicam.", texto: "Corretores de imóveis, despachantes, vendedores de loja de carro e de moto." },
];

const DICAS = ["Futebol", "Padel", "Tênis", "Célula da igreja", "Academia", "Clientes antigos: peça indicação"];

type EnvioResultado = { created: number; skipped: number; errors: { nome: string; error: string }[] };

export function Lista50Form({
  vendedorPadrao,
  enabled,
  weeklyGoal,
  ownWeek,
  progress,
  canManageCampaign,
}: {
  vendedorPadrao: string;
  enabled: boolean;
  weeklyGoal: number;
  ownWeek: { weekNumber: number; count: number } | null;
  progress: Lista50Progress | null;
  canManageCampaign: boolean;
}) {
  const [vendedor, setVendedor] = useState(vendedorPadrao);
  const [linhas, setLinhas] = useState<Linha[]>(() => Array.from({ length: LINHAS_INICIAIS }, (_, i) => novaLinha(i + 1)));
  const [proximoId, setProximoId] = useState(LINHAS_INICIAIS + 1);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<EnvioResultado | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Contagem REAL (negócios já criados no banco) desta semana — separada do
  // `validas.length` abaixo, que é só o rascunho ainda não entregue.
  const [semana, setSemana] = useState(ownWeek?.weekNumber ?? 1);
  const [entregues, setEntregues] = useState(ownWeek?.count ?? 0);
  // Aviso de duplicidade (ver lista-50-duplicate-modal.tsx) — só abre quando
  // o backend de fato aponta duplicata; nunca interrompe quem está digitando.
  const [duplicado, setDuplicado] = useState<{ linhaId: number; info: Lista50DuplicateInfo } | null>(null);
  // Números (só dígitos) já checados nesta sessão — evita repetir a mesma
  // consulta a cada blur se a pessoa só clicou pra fora e voltou sem mudar nada.
  const checados = useRef<Set<string>>(new Set());

  async function checarDuplicidade(linhaId: number, digitos: string) {
    if (digitos.length < 10 || checados.current.has(digitos)) return;
    checados.current.add(digitos);
    try {
      const resposta = await fetch(`/api/lista-50/check-duplicate?whatsapp=${encodeURIComponent(digitos)}`);
      if (!resposta.ok) return;
      const dados = await resposta.json();
      if (dados?.duplicate) setDuplicado({ linhaId, info: dados as Lista50DuplicateInfo });
    } catch {
      // Silencioso de propósito — essa checagem nunca pode travar/avisar
      // errado por causa de uma falha de rede passageira.
    }
  }

  const validas = useMemo(() => linhas.filter(linhaValida), [linhas]);
  const concluido = validas.length >= TOTAL_GOAL;
  const faltam = Math.max(0, TOTAL_GOAL - validas.length);
  const porcentagem = Math.min(100, Math.round((validas.length / TOTAL_GOAL) * 100));

  function adicionar(quantidade = 1) {
    setLinhas((atuais) => [...atuais, ...Array.from({ length: quantidade }, (_, i) => novaLinha(proximoId + i))]);
    setProximoId((id) => id + quantidade);
  }

  function remover(id: number) {
    setLinhas((atuais) => atuais.filter((linha) => linha.id !== id));
  }

  function alterar(id: number, campo: keyof Omit<Linha, "id">, valor: string) {
    setLinhas((atuais) => atuais.map((linha) => (linha.id === id ? { ...linha, [campo]: valor } : linha)));
    setEnviado(null);
  }

  function preencherExemplo() {
    setLinhas((atuais) => {
      const base = atuais.length >= NOMES_EXEMPLO.length
        ? atuais
        : [...atuais, ...Array.from({ length: NOMES_EXEMPLO.length - atuais.length }, (_, i) => novaLinha(proximoId + i))];
      return base.map((linha, index) =>
        linha.nome || index >= NOMES_EXEMPLO.length
          ? linha
          : {
            ...linha,
            nome: NOMES_EXEMPLO[index],
            whatsapp: mascararTelefone(`67 9${String(10_000_000 + index * 1_234_567).slice(0, 8)}`),
            observacao: OBS_EXEMPLO[index % OBS_EXEMPLO.length],
            circulo: CIRCULOS[(index % (CIRCULOS.length - 1)) + 1],
            temperatura: index % 2 === 0 ? TEMPERATURAS[1] : TEMPERATURAS[0],
          },
      );
    });
    setProximoId((id) => Math.max(id, NOMES_EXEMPLO.length + 1));
  }

  function limparTudo() {
    setLinhas(Array.from({ length: LINHAS_INICIAIS }, (_, i) => novaLinha(proximoId + i)));
    setProximoId((id) => id + LINHAS_INICIAIS);
    setEnviado(null);
  }

  /**
   * Entrega da lista: valida na tela e manda pro servidor, que cria um
   * Contato + Deal na etapa "Black November" pra cada linha válida (ver
   * lib/lista-50.ts e POST /api/lista-50/entregar). Sucesso limpa a tabela
   * (a lista foi "entregue") e soma na contagem real da semana.
   */
  async function entregar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEnviado(null);

    if (!vendedor.trim()) {
      setErro("Informe o seu nome antes de entregar a lista.");
      return;
    }
    if (validas.length === 0) {
      setErro("Preencha pelo menos um contato com nome e WhatsApp válido.");
      return;
    }

    const duplicados = new Set<string>();
    const vistos = new Set<string>();
    for (const linha of validas) {
      const chave = linha.whatsapp.replace(/\D/g, "");
      if (vistos.has(chave)) duplicados.add(linha.nome.trim());
      vistos.add(chave);
    }
    if (duplicados.size > 0) {
      setErro(`WhatsApp repetido na lista: ${[...duplicados].join(", ")}.`);
      return;
    }

    setErro(null);
    setEnviando(true);
    try {
      const resposta = await fetch("/api/lista-50/entregar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leads: validas.map((l) => ({
            nome: l.nome.trim(),
            whatsapp: l.whatsapp,
            circulo: l.circulo,
            interesse: l.interesse,
            temperatura: l.temperatura,
            observacao: l.observacao.trim() || undefined,
          })),
        }),
      });
      const dados = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        setErro(dados?.error ?? "Não foi possível entregar a lista agora. Tente novamente.");
        return;
      }

      setSemana(dados.weekNumber);
      setEntregues((atual) => atual + dados.created);
      setEnviado({ created: dados.created, skipped: dados.skipped, errors: dados.errors ?? [] });
      setLinhas(Array.from({ length: LINHAS_INICIAIS }, (_, i) => novaLinha(i + 1)));
      setProximoId(LINHAS_INICIAIS + 1);
    } catch {
      setErro("Falha de conexão — tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  // Campanha sazonal desligada (ver lib/lista-50.ts) — a página fica de pé
  // (mesma identidade visual), mas sem formulário: não há pra onde mandar os
  // leads agora. Só o Dono vê o controle pra religar.
  if (!enabled) {
    return (
      <div className="-mx-4 -my-4 flex min-h-screen flex-col items-center justify-center bg-[#0a0a0c] px-4 py-16 text-center font-sans text-gray-200 sm:-mx-6 lg:-mx-8">
        <h1 className="mb-2 text-3xl font-black uppercase tracking-tight text-white md:text-5xl">
          Lista dos <span className="text-[#ffcc00] [text-shadow:0_0_12px_rgba(255,204,0,0.5)]">50</span>
        </h1>
        <p className="mb-8 max-w-md text-sm text-gray-400">
          A campanha Novembro Black não está no ar agora. Ela é sazonal — volta quando a próxima temporada começar.
        </p>
        {canManageCampaign && (
          <div className="w-full max-w-sm">
            <Lista50AdminToggle enabled={false} />
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={entregar} className="-mx-4 -my-4 min-h-screen bg-[#0a0a0c] font-sans text-gray-200 sm:-mx-6 lg:-mx-8">
      <style>{`
        @keyframes lista50-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        /* Marcador de texto passando por baixo da frase, uma vez, ao entrar na
           página — só a LARGURA do traço anda (0% → 100%, da esquerda pra
           direita); a altura fica fixa nos dois extremos, então o traço nunca
           "cresce" verticalmente, só revela da esquerda pra direita, como uma
           caneta marca-texto de verdade. */
        @keyframes lista50-highlight { from { background-size: 0% 0.62em; } to { background-size: 100% 0.62em; } }
      `}</style>

      {/* Fita de alerta rolando no topo. O texto vai duplicado e a animação
          anda metade da largura: ao reiniciar, a segunda cópia está onde a
          primeira começou, então o laço não tem emenda visível. */}
      <div className="flex items-center overflow-hidden border-y-2 border-black bg-[#ffcc00] py-1 text-black">
        <div
          className="flex shrink-0 gap-8 whitespace-nowrap px-4 text-xs font-black uppercase tracking-[2px]"
          style={{ animation: "lista50-marquee 20s linear infinite" }}
        >
          {[0, 1].map((copia) => (
            <span key={copia} className="flex gap-8" aria-hidden={copia === 1}>
              <span>O maior acelerador de vendas da Black Friday</span>
              <span>•</span>
              <span>Você insere 50 nomes do seu círculo social</span>
              <span>•</span>
              <span>50 nomes com WhatsApp válido</span>
              <span>•</span>
              <span>Novembro Black: todo dia como se fosse o último</span>
              <span>•</span>
            </span>
          ))}
        </div>
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-block h-3 w-3 animate-ping rounded-full bg-[#ffcc00]" />
            <span className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#ffcc00] md:text-sm">
              Novembro Black
            </span>
          </div>
          {/* A frase ganhou linha própria, bem maior que o resto do cabeçalho
              (pedido explícito: mais ênfase) — mesmo brilho amarelo do "50"
              logo abaixo, pra ler como o grito de guerra da campanha, não
              como legenda miúda do "Novembro Black". */}
          <p className="mb-2 text-2xl font-black uppercase italic tracking-tight text-[#ffcc00] [text-shadow:0_0_16px_rgba(255,204,0,0.55)] md:text-4xl">
            {/* Passada de marca-texto azul, uma vez, assim que a página abre
                (pedido explícito) — fundo em gradiente que não se repete,
                animando só a largura (ver keyframes lista50-highlight acima);
                `both` segura o traço 100% revelado no final, nunca volta a
                sumir. */}
            <span
              className="bg-no-repeat"
              style={{
                backgroundImage: "linear-gradient(90deg, rgba(37,99,235,0.75), rgba(59,130,246,0.55))",
                backgroundPosition: "0 78%",
                backgroundSize: "0% 0.62em",
                animation: "lista50-highlight 1.8s cubic-bezier(0.19, 1, 0.22, 1) 0.5s both",
              }}
            >
              Todo dia como se fosse o último
            </span>
          </p>
          <h1 className="text-4xl font-black uppercase tracking-tight text-white md:text-6xl">
            Lista dos <span className="text-5xl text-[#ffcc00] [text-shadow:0_0_12px_rgba(255,204,0,0.5)] md:text-7xl">50</span>
          </h1>
          <p className="mt-2 text-xs font-bold uppercase tracking-wider text-gray-500">Semana {semana} de Novembro</p>
        </header>

        {canManageCampaign && (
          <div className="mb-4">
            <Lista50AdminToggle enabled={enabled} />
          </div>
        )}

        {/* Regra da troca */}
        <section className="relative mb-8 overflow-hidden rounded-2xl border border-[#262933] bg-[#121318] p-6 shadow-2xl md:p-8">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ffcc00] via-yellow-500 to-transparent" />
          <div className="rounded-xl border border-gray-800/80 bg-[#0a0a0c]/60 p-5">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">Sua parte</span>
            <h2 className="mb-2 text-xl font-bold text-white">Você entrega 50 nomes</h2>
            <p className="text-sm text-gray-400">Do seu círculo de relacionamento, no CRM, toda semana.</p>
          </div>

          <ul className="mt-6 grid grid-cols-1 gap-3 border-t border-gray-800/80 pt-6 text-xs font-medium sm:grid-cols-2 lg:grid-cols-4 md:text-sm">
            {["50 nomes com WhatsApp válido", "Pessoas reais que você conhece", "Sem repetir nome de outro vendedor", "Vira negócio direto no seu pipeline"].map((item) => (
              <li key={item} className="flex items-center gap-2 text-gray-300">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#ffcc00]" strokeWidth={2.5} />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-gray-800/80 bg-[#0a0a0c]/60 p-4">
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Essa semana você já entregou</span>
              <span className="text-2xl font-black text-[#ffcc00]">
                {entregues} <span className="text-base font-bold text-gray-500">/ {weeklyGoal}</span>
              </span>
            </div>
            {entregues >= weeklyGoal && (
              <span className="rounded border border-green-500/40 bg-green-500/20 px-2.5 py-1 text-xs font-bold text-green-400">
                Meta da semana batida! 🎉
              </span>
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <main className="space-y-6 lg:col-span-8">
            <div className="rounded-2xl border border-[#262933] bg-[#121318] p-6 shadow-xl">
              <div className="mb-6">
                <label htmlFor="lista50-vendedor" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Seu nome (vendedor)
                </label>
                <input
                  id="lista50-vendedor"
                  value={vendedor}
                  onChange={(e) => setVendedor(e.target.value)}
                  placeholder="Ex.: Carlos Souza"
                  className="w-full rounded-lg border border-[#2e3340] bg-[#181a20] px-4 py-2.5 text-sm text-gray-100 outline-none focus:border-[#ffcc00] focus:ring-2 focus:ring-[#ffcc00]/20 md:max-w-sm"
                />
              </div>

              {/* Progresso */}
              <div className="mb-6 rounded-xl border border-gray-800 bg-[#0a0a0c]/80 p-4">
                <div className="mb-2 flex items-end justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-white">Seus 50 nomes</h2>
                    <p className="mt-0.5 text-xs text-gray-400">Preencha nome e WhatsApp válido para validar cada lead.</p>
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-black text-[#ffcc00]">{validas.length}</span>
                    <span className="text-xl font-bold text-gray-500"> / {TOTAL_GOAL}</span>
                  </div>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full border border-gray-700 bg-gray-800 p-0.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-yellow-600 via-[#ffcc00] to-yellow-300 transition-all duration-300"
                    style={{ width: `${porcentagem}%` }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  {concluido ? (
                    <span className="rounded border border-green-500/40 bg-green-500/20 px-2.5 py-1 font-bold text-green-400">
                      Lista completa! Pronta para entregar
                    </span>
                  ) : (
                    <span className="font-bold text-[#ffcc00]">Faltam {faltam} para completar a sua lista</span>
                  )}
                </div>
              </div>

              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">
                  <button type="button" onClick={() => adicionar(5)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:bg-gray-700">
                    <Plus className="mr-1 inline h-3.5 w-3.5" strokeWidth={2.5} />5 linhas
                  </button>
                  <button type="button" onClick={preencherExemplo} className="rounded-lg border border-[#ffcc00]/30 bg-[#ffcc00]/10 px-3 py-1.5 text-xs font-semibold text-[#ffcc00] transition hover:bg-[#ffcc00]/20">
                    <Wand2 className="mr-1 inline h-3.5 w-3.5" strokeWidth={2.5} />
                    Preencher exemplo
                  </button>
                </div>
                <button type="button" onClick={limparTudo} className="text-xs font-medium text-red-400 transition hover:text-red-300">
                  <Trash2 className="mr-1 inline h-3.5 w-3.5" strokeWidth={2} />
                  Limpar tudo
                </button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full min-w-[700px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-gray-800 bg-[#0a0a0c] text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      <th className="w-10 px-3 py-3 text-center">#</th>
                      <th className="min-w-[150px] px-3 py-3">Nome</th>
                      <th className="min-w-[130px] px-3 py-3">WhatsApp</th>
                      <th className="min-w-[110px] px-3 py-3">Círculo</th>
                      <th className="min-w-[110px] px-3 py-3">Interesse</th>
                      <th className="min-w-[110px] px-3 py-3">Temperatura</th>
                      <th className="min-w-[140px] px-3 py-3">Observação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60 text-xs">
                    {linhas.map((linha, index) => (
                      <tr key={linha.id} className="group transition-colors hover:bg-[#0a0a0c]/40">
                        <td className="px-3 py-2 text-center text-[11px] font-bold text-gray-500">{index + 1}</td>
                        <td className="px-2 py-2">
                          <input
                            value={linha.nome}
                            onChange={(e) => alterar(linha.id, "nome", e.target.value)}
                            placeholder="Ex.: João do futebol"
                            aria-label={`Nome do contato ${index + 1}`}
                            className="w-full rounded border border-[#2e3340] bg-[#181a20] px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-[#ffcc00]"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={linha.whatsapp}
                            onChange={(e) => alterar(linha.id, "whatsapp", mascararTelefone(e.target.value))}
                            onBlur={() => checarDuplicidade(linha.id, linha.whatsapp.replace(/\D/g, ""))}
                            placeholder="(00) 00000-0000"
                            inputMode="numeric"
                            aria-label={`WhatsApp do contato ${index + 1}`}
                            className="w-full rounded border border-[#2e3340] bg-[#181a20] px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-[#ffcc00]"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Selecao valor={linha.circulo} opcoes={CIRCULOS} rotulo={`Círculo do contato ${index + 1}`} onChange={(v) => alterar(linha.id, "circulo", v)} />
                        </td>
                        <td className="px-2 py-2">
                          <Selecao valor={linha.interesse} opcoes={INTERESSES} rotulo={`Interesse do contato ${index + 1}`} onChange={(v) => alterar(linha.id, "interesse", v)} />
                        </td>
                        <td className="px-2 py-2">
                          <Selecao valor={linha.temperatura} opcoes={TEMPERATURAS} rotulo={`Temperatura do contato ${index + 1}`} onChange={(v) => alterar(linha.id, "temperatura", v)} />
                        </td>
                        <td className="relative px-2 py-2">
                          <input
                            value={linha.observacao}
                            onChange={(e) => alterar(linha.id, "observacao", e.target.value)}
                            placeholder="Ex.: quer trocar de carro"
                            aria-label={`Observação do contato ${index + 1}`}
                            className="w-full rounded border border-[#2e3340] bg-[#181a20] py-1.5 pl-2.5 pr-7 text-xs text-gray-100 outline-none focus:border-[#ffcc00]"
                          />
                          <button
                            type="button"
                            onClick={() => remover(linha.id)}
                            aria-label={`Remover contato ${index + 1}`}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={() => adicionar(1)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-800 py-3 text-xs font-medium text-gray-400 transition hover:border-[#ffcc00]/50 hover:bg-[#ffcc00]/5 hover:text-[#ffcc00]"
              >
                <PlusCircle className="h-4 w-4" strokeWidth={2} />
                Adicionar mais um contato
              </button>

              {erro && (
                <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300">{erro}</p>
              )}
              {enviado !== null && (
                <div className="mt-4 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs font-medium text-green-300">
                  <p>
                    {enviado.created} {enviado.created === 1 ? "negócio criado" : "negócios criados"} no seu pipeline, etapa Black November
                    {enviado.skipped > 0 && ` · ${enviado.skipped} já estavam entregues`}.
                  </p>
                  {enviado.errors.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-red-300">
                      {enviado.errors.map((e) => (
                        <li key={e.nome}>
                          {e.nome}: {e.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={enviando}
                className="mt-4 w-full rounded-xl bg-[#ffcc00] py-3.5 text-sm font-black uppercase tracking-wider text-black transition hover:bg-[#e6b800] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enviando ? "Entregando…" : "Entregar minha Lista dos 50"}
              </button>
            </div>
          </main>

          <aside className="space-y-6 lg:col-span-4">
            <div className="rounded-2xl border border-[#262933] bg-[#121318] p-6 shadow-xl">
              <div className="mb-4 flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-[#ffcc00]" strokeWidth={2} />
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-[#ffcc00]">Comece pelo básico</h2>
              </div>
              <ul className="flex flex-wrap gap-2">
                {DICAS.map((dica, index) => (
                  <li key={dica}>
                    <span
                      className={
                        index === DICAS.length - 1
                          ? "inline-block rounded-full border border-[#ffcc00] bg-[#ffcc00] px-3 py-1.5 text-xs font-bold text-black"
                          : "inline-block rounded-full border border-[#ffcc00]/40 bg-[#0a0a0c] px-3 py-1.5 text-xs font-semibold text-[#ffcc00]"
                      }
                    >
                      {dica}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-[#262933] bg-[#121318] p-6 shadow-xl">
              <div className="mb-6 flex items-center gap-2">
                <Compass className="h-5 w-5 text-[#ffcc00]" strokeWidth={2} />
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-[#ffcc00]">Onde achar nomes</h2>
              </div>
              {/* Com a lista inteira, o card passaria bem da altura do
                  formulário ao lado; rolagem própria mantém as duas colunas
                  na mesma ordem de grandeza. */}
              <ol className="scrollbar-thin max-h-[32rem] space-y-4 overflow-y-auto pr-2 text-xs">
                {LUGARES.map((lugar, index) => (
                  <li key={lugar.n} className={`flex items-start gap-3 ${index < LUGARES.length - 1 ? "border-b border-gray-800/80 pb-3" : ""}`}>
                    <span className="text-base font-black text-[#ffcc00]">{lugar.n}</span>
                    <div>
                      <strong className="mb-0.5 block text-sm text-white">{lugar.titulo}</strong>
                      <p className="text-gray-400">{lugar.texto}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-6 rounded-xl border border-[#ffcc00]/30 bg-[#ffcc00]/10 p-4 text-center">
                <Flame className="mx-auto mb-1 h-5 w-5 text-[#ffcc00]" strokeWidth={2} />
                <h3 className="text-xs font-bold uppercase text-[#ffcc00]">Meta Black Friday</h3>
                <p className="mt-1 text-[11px] text-gray-300">
                  Não deixe nenhum lead para trás. Quem não vende na Black perde o maior pico do ano!
                </p>
              </div>
            </div>
          </aside>
        </div>

        {progress && <Lista50SupervisorPanel progress={progress} />}

        <footer className="mt-12 border-t border-gray-900 pt-6 text-center text-xs text-gray-600">
          Novembro Black • Ferramenta de alta performance de vendas Reobote.
        </footer>
      </div>

      {duplicado && <Lista50DuplicateModal info={duplicado.info} onClose={() => setDuplicado(null)} />}
    </form>
  );
}

function Selecao({
  valor,
  opcoes,
  rotulo,
  onChange,
}: {
  valor: string;
  opcoes: readonly string[];
  rotulo: string;
  onChange: (valor: string) => void;
}) {
  return (
    <select
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      aria-label={rotulo}
      className="w-full rounded border border-[#2e3340] bg-[#181a20] px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-[#ffcc00]"
    >
      {opcoes.map((opcao) => (
        <option key={opcao} value={opcao}>
          {opcao}
        </option>
      ))}
    </select>
  );
}
