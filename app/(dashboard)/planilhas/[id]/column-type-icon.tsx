import {
  AlignLeft,
  AtSign,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  CircleDollarSign,
  CircleDot,
  Hash,
  IdCard,
  Link2,
  ListChecks,
  Percent,
  Phone,
  Type,
  User,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { SheetColumnType } from "@/lib/sheets/column-types";

const ICONS: Record<SheetColumnType, LucideIcon> = {
  TEXT: Type,
  LONG_TEXT: AlignLeft,
  NUMBER: Hash,
  CURRENCY: CircleDollarSign,
  PERCENT: Percent,
  DATE: Calendar,
  CHECKBOX: CheckSquare,
  SELECT: CircleDot,
  MULTI_SELECT: ListChecks,
  EMAIL: AtSign,
  PHONE: Phone,
  CPF: IdCard,
  CNPJ: Building2,
  URL: Link2,
  USER: UserRound,
  CONTACT: User,
  DEAL: Briefcase,
};

export function ColumnTypeIcon({ type, className }: { type: SheetColumnType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} aria-hidden="true" />;
}
