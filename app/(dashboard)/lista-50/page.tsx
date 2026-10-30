import type { Metadata } from "next";
import { getCurrentMembership } from "@/lib/current-membership";
import { Lista50Form } from "./lista-50-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lista dos 50" };

export default async function Lista50Page() {
  // O nome do vendedor já vem preenchido com quem está logado — é sempre a
  // própria pessoa entregando a lista dela.
  const membership = await getCurrentMembership();

  return <Lista50Form vendedorPadrao={membership?.session.user.name ?? ""} />;
}
