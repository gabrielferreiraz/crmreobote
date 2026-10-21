import { Archivo, Ms_Madi } from "next/font/google";
import { ReoboteLogo } from "@/components/reobote-logo";

const scriptFont = Ms_Madi({ subsets: ["latin"], weight: "400", display: "swap" });
// Variável com eixo de largura: o nome sai um pouco estreito.
const posterFont = Archivo({ subsets: ["latin"], axes: ["wdth"], display: "swap" });

// Posições fixas (nada de Math.random: o slide renderiza no servidor e no
// navegador e os dois precisam sair idênticos). x/y em % do quadro, size em cqh.
const BOKEH = [
  { x: 8, y: 14, size: 9, c: "255,214,150", o: 0.34 }, { x: 22, y: 38, size: 5, c: "120,225,255", o: 0.4 },
  { x: 4, y: 58, size: 12, c: "90,200,255", o: 0.22 }, { x: 14, y: 80, size: 6, c: "255,214,150", o: 0.3 },
  { x: 90, y: 10, size: 11, c: "255,230,190", o: 0.3 }, { x: 78, y: 30, size: 5, c: "120,225,255", o: 0.4 },
  { x: 95, y: 48, size: 8, c: "255,214,150", o: 0.28 }, { x: 84, y: 66, size: 13, c: "90,200,255", o: 0.2 },
  { x: 70, y: 12, size: 4, c: "255,255,255", o: 0.45 }, { x: 31, y: 9, size: 4, c: "255,255,255", o: 0.4 },
  { x: 60, y: 44, size: 3, c: "255,230,190", o: 0.45 }, { x: 40, y: 56, size: 3, c: "120,225,255", o: 0.4 },
];
const SPARKLES = [
  { x: 17, y: 20, size: 5.5, d: 0 }, { x: 83, y: 18, size: 7, d: 0.9 }, { x: 28, y: 52, size: 3.6, d: 1.7 },
  { x: 74, y: 47, size: 4.4, d: 0.4 }, { x: 9, y: 40, size: 4, d: 2.2 }, { x: 92, y: 36, size: 3.4, d: 1.2 },
  { x: 36, y: 8, size: 3.2, d: 2.8 }, { x: 62, y: 7, size: 4.2, d: 1.5 }, { x: 50, y: 60, size: 3, d: 0.7 },
];
const CONFETTI = [
  { x: 6, y: 8, r: 25, w: 1.4, h: 0.5, c: "#ffd9a0" }, { x: 13, y: 26, r: -40, w: 1.2, h: 0.45, c: "#ffffff" },
  { x: 3, y: 33, r: 70, w: 1.1, h: 0.45, c: "#ff9b72" }, { x: 19, y: 12, r: 10, w: 0.9, h: 0.9, c: "#7fe0ff", round: true },
  { x: 25, y: 28, r: 55, w: 1.3, h: 0.45, c: "#ffd9a0" }, { x: 10, y: 49, r: -20, w: 1.2, h: 0.45, c: "#ffffff" },
  { x: 94, y: 9, r: -30, w: 1.4, h: 0.5, c: "#ffd9a0" }, { x: 87, y: 24, r: 50, w: 1.2, h: 0.45, c: "#ffffff" },
  { x: 97, y: 31, r: -65, w: 1.1, h: 0.45, c: "#ff9b72" }, { x: 81, y: 11, r: 15, w: 0.9, h: 0.9, c: "#7fe0ff", round: true },
  { x: 75, y: 27, r: -50, w: 1.3, h: 0.45, c: "#ffd9a0" }, { x: 90, y: 45, r: 25, w: 1.2, h: 0.45, c: "#ffffff" },
  { x: 44, y: 5, r: 35, w: 1, h: 0.4, c: "#ffd9a0" }, { x: 57, y: 4, r: -35, w: 1, h: 0.4, c: "#ffffff" },
];

/**
 * "Feliz aniversário" como mais uma foto do carrossel de propagandas da TV,
 * no estilo de post de parabéns (template de referência do dono, 10/2026):
 * fundo azul com brilho ciano e um círculo escuro, raios de luz, anéis dourados, bokeh, brilhos e
 * confete, a pessoa nítida no centro, "Parabéns" de assinatura, o nome em
 * caixa alta pesada, frase em duas linhas e a logo.
 *
 * O slide é o próprio contêiner de medida (container-type: size): tudo em
 * cqh/cqw acompanha o quadro de propaganda em qualquer TV.
 */
export function TvBirthdaySlide({ name, photoUrl, backgroundUrl }: { name: string; photoUrl: string; backgroundUrl: string | null }) {
  // Nome longo encolhe pra caber numa linha.
  // Com foto de fundo enviada, o slide é SÓ a foto + pessoa + texto: os
  // enfeites (círculo, raios, anéis, bokeh, confete, brilhos) fazem parte do
  // fundo padrão gerado por código e não entram por cima da foto.
  const custom = !!backgroundUrl;
  const nameSize = `min(7.6cqh, ${Math.round((150 / Math.max(name.length, 1)) * 10) / 10}cqw)`;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#041327]" style={{ containerType: "size" }}>
      {/* Fundo desfocado (como no template) — scale cobre a borda que o blur
          deixa transparente. */}
      {backgroundUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={backgroundUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover"
          style={{ filter: "blur(1.4cqh) saturate(1.15)" }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 55% 60% at 85% 0%, #49d6f7 0%, rgba(73,214,247,0) 70%)," +
              "radial-gradient(ellipse 30% 75% at 8% 38%, rgba(32,170,224,0.85) 0%, rgba(32,170,224,0) 70%)," +
              "radial-gradient(ellipse 70% 55% at 50% 30%, #1586c4 0%, rgba(21,134,196,0) 75%)," +
              "linear-gradient(180deg, #0b5a92 0%, #083563 48%, #05182f 78%, #030c19 100%)",
          }}
        />
      )}

      {!custom && (
        <>
      {/* Círculo escuro atrás da pessoa */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full"
        style={{
          top: "30cqh",
          width: "100cqh",
          height: "100cqh",
          background: "radial-gradient(circle, rgba(3,16,36,0.55) 0%, rgba(3,16,36,0.35) 60%, rgba(3,16,36,0) 71%)",
          boxShadow: "inset 0 0 0 0.35cqh rgba(8,40,80,0.6)",
        }}
      />

      <style>{`
        @keyframes tv-bday-twinkle { 0%,100% { opacity: .25; transform: scale(.7) rotate(0deg); } 50% { opacity: 1; transform: scale(1) rotate(45deg); } }
        @keyframes tv-bday-rays { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes tv-bday-float { 0%,100% { transform: translate(-50%, -50%); } 50% { transform: translate(-50%, calc(-50% - 1.2cqh)); } }
      `}</style>

      {/* Raios de luz girando bem devagar, saindo de trás da pessoa */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          top: "-6cqh",
          width: "150cqh",
          height: "150cqh",
          maskImage: "radial-gradient(circle, black 0%, rgba(0,0,0,0.55) 35%, transparent 68%)",
          WebkitMaskImage: "radial-gradient(circle, black 0%, rgba(0,0,0,0.55) 35%, transparent 68%)",
        }}
      >
        <div
          className="h-full w-full"
          style={{
            background: "repeating-conic-gradient(from 0deg at 50% 38%, rgba(190,240,255,0.2) 0deg 4deg, transparent 4deg 15deg)",
            animation: "tv-bday-rays 240s linear infinite",
          }}
        />
      </div>

      {/* Anéis dourados em volta da pessoa */}
      <svg className="absolute left-1/2 -translate-x-1/2" style={{ top: "2cqh", width: "88cqh", height: "88cqh" }} viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="tv-bday-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff2d6" />
            <stop offset="0.5" stopColor="#f2c27a" />
            <stop offset="1" stopColor="#fff2d6" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="42" r="40" stroke="url(#tv-bday-gold)" strokeWidth="0.35" opacity="0.8" />
        <circle cx="50" cy="42" r="45" stroke="url(#tv-bday-gold)" strokeWidth="0.2" strokeDasharray="0.6 1.6" opacity="0.7" />
        <circle cx="50" cy="42" r="35" stroke="rgba(160,230,255,0.5)" strokeWidth="0.18" />
      </svg>

      {/* Bokeh */}
      {BOKEH.map((b, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: `${b.size}cqh`,
            height: `${b.size}cqh`,
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle, rgba(${b.c},${b.o}) 0%, rgba(${b.c},${b.o * 0.55}) 55%, rgba(${b.c},0) 72%)`,
            filter: "blur(0.25cqh)",
            animation: `tv-bday-float ${7 + (i % 5)}s ease-in-out ${(i % 4) * 0.8}s infinite`,
          }}
        />
      ))}

      {/* Confete */}
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          className="absolute"
          style={{
            left: `${c.x}%`,
            top: `${c.y}%`,
            width: `${c.w}cqh`,
            height: `${c.h}cqh`,
            background: c.c,
            borderRadius: c.round ? "9999px" : "0.12cqh",
            transform: `rotate(${c.r}deg)`,
            opacity: 0.85,
            boxShadow: `0 0 0.8cqh ${c.c}66`,
          }}
        />
      ))}
        </>
      )}

      {!custom && (
        <>
      {/* Faixa de luz horizontal (passa atrás da pessoa) */}
      <div className="absolute inset-x-0" style={{ top: "46cqh", height: "3.2cqh", background: "linear-gradient(90deg, rgba(120,220,255,0) 0%, rgba(120,220,255,0.28) 30%, rgba(120,220,255,0.28) 70%, rgba(120,220,255,0) 100%)", filter: "blur(0.8cqh)" }} />
      <div className="absolute inset-x-0" style={{ top: "47.4cqh", height: "0.25cqh", background: "linear-gradient(90deg, rgba(190,240,255,0) 0%, rgba(190,240,255,0.75) 25%, rgba(190,240,255,0.75) 75%, rgba(190,240,255,0) 100%)" }} />
        </>
      )}

      {/* A pessoa, nítida, sumindo na base */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoUrl}
        alt={name}
        className="absolute left-1/2 h-[66cqh] w-auto max-w-[62cqw] -translate-x-1/2 object-contain object-bottom"
        style={{
          top: "3cqh",
          filter: "drop-shadow(0 1.5cqh 3cqh rgba(0,0,0,0.45))",
          maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
        }}
      />

      {!custom && (
        <>
      {/* Brilhos de quatro pontas que piscam */}
      {SPARKLES.map((sp, i) => (
        <svg
          key={i}
          className="absolute"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{
            left: `${sp.x}%`,
            top: `${sp.y}%`,
            width: `${sp.size}cqh`,
            height: `${sp.size}cqh`,
            marginLeft: `-${sp.size / 2}cqh`,
            marginTop: `-${sp.size / 2}cqh`,
            filter: "drop-shadow(0 0 0.7cqh rgba(255,236,200,0.9))",
            animation: `tv-bday-twinkle ${3.2 + (i % 3) * 0.6}s ease-in-out ${sp.d}s infinite`,
          }}
        >
          <path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill="#fff6e0" />
        </svg>
      ))}
        </>
      )}

      {/* Base escura onde mora o texto */}
      <div
        className="absolute inset-x-0 bottom-0 h-[52cqh]"
        style={{
          background: custom
            ? "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.4) 45%, rgba(0,0,0,0) 100%)"
            : "linear-gradient(to top, #030c19 0%, rgba(3,12,25,0.92) 38%, rgba(4,19,39,0.55) 70%, rgba(4,19,39,0) 100%)",
        }}
      />

      {/* Texto */}
      <div className="absolute inset-x-0 flex flex-col items-center px-[4cqw] text-center text-white" style={{ top: "48cqh" }}>
        {/* Branco SÓLIDO + text-shadow, de propósito. Antes era texto transparente
            com degradê recortado no texto (background-clip: text) E
            `filter: drop-shadow` no mesmo elemento: no PC saía branco, mas em
            navegador de TV (camada com transição de opacidade + filtro + recorte)
            o preenchimento do recorte se perdia e sobrava só a sombra — o
            "Parabéns" aparecia PRETO. O nome logo abaixo, que é cor sólida,
            sempre saiu branco nas duas telas. */}
        <p
          className={`${scriptFont.className} leading-none`}
          style={{
            fontSize: "18cqh",
            color: "#ffffff",
            textShadow: "0 0.4cqh 1.2cqh rgba(0,0,0,0.45)",
            paddingInline: "2cqh",
          }}
        >
          Parabéns
        </p>
        <p
          className={`${posterFont.className} uppercase`}
          style={{ fontSize: nameSize, fontWeight: 900, fontStretch: "88%", lineHeight: 1, marginTop: "-0.5cqh", letterSpacing: "-0.005em" }}
        >
          {name}
        </p>
        <div className="flex items-center" style={{ gap: "1.4cqh", marginTop: "1.8cqh" }} aria-hidden="true">
          <span style={{ width: "14cqh", height: "0.2cqh", background: "linear-gradient(90deg, transparent, #f2c27a)" }} />
          <span style={{ width: "1.1cqh", height: "1.1cqh", background: "#f6d9a2", transform: "rotate(45deg)", boxShadow: "0 0 1cqh rgba(246,217,162,0.8)" }} />
          <span style={{ width: "14cqh", height: "0.2cqh", background: "linear-gradient(270deg, transparent, #f2c27a)" }} />
        </div>
        <p
          className="uppercase"
          style={{ fontSize: "2.2cqh", lineHeight: 1.45, letterSpacing: "0.05em", marginTop: "1.6cqh", maxWidth: "62cqh", color: "rgba(255,255,255,0.88)" }}
        >
          Que o seu novo ciclo seja repleto de saúde, alegria e muitas conquistas.
        </p>
        <ReoboteLogo className="w-auto" style={{ height: "9cqh", marginTop: "2.6cqh" }} />
      </div>

    </div>
  );
}
