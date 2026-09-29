import type { ComponentType } from "react";
import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  Clock,
  Compass,
  CreditCard,
  Download,
  FileText,
  HeartPulse,
  Kanban,
  Keyboard,
  Lightbulb,
  MessageCircle,
  Mic,
  Monitor,
  Plug,
  Plus,
  Rocket,
  ScrollText,
  Search,
  Send,
  Settings,
  StickyNote,
  Tag,
  Trophy,
  Undo2,
  Upload,
  UserCheck,
  UserCircle,
  UserPlus,
  Users,
  UsersRound,
  XCircle,
  Zap,
} from "lucide-react";

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

/**
 * O conteúdo da ajuda (lib/help/topics.ts) guarda o ícone como TEXTO, não
 * como componente — mesma razão do ICONS de config-search.tsx: o catálogo
 * precisa continuar sendo dado puro, serializável e sem import de React,
 * pra poder ser filtrado e buscado em qualquer lugar.
 */
export const HELP_ICONS: Record<string, IconComponent> = {
  BarChart3,
  CalendarDays,
  CheckSquare,
  Clock,
  Compass,
  CreditCard,
  Download,
  FileText,
  HeartPulse,
  Kanban,
  Keyboard,
  MessageCircle,
  Mic,
  Monitor,
  Plug,
  Plus,
  Rocket,
  ScrollText,
  Search,
  Send,
  Settings,
  StickyNote,
  Tag,
  Trophy,
  Undo2,
  Upload,
  UserCheck,
  UserCircle,
  UserPlus,
  Users,
  UsersRound,
  XCircle,
  Zap,
};

/**
 * Usado como `HELP_ICONS[nome] ?? HELP_FALLBACK_ICON` no lugar de uma função
 * que devolve o componente: uma CHAMADA cujo retorno vira `<Icon />` é lida
 * pelo lint do React como "componente criado durante o render" (o que de
 * fato resetaria estado, se fosse). Busca direta no objeto não tem esse
 * problema — é o mesmo formato do ICONS de config-search.tsx.
 */
export const HELP_FALLBACK_ICON: IconComponent = Lightbulb;
