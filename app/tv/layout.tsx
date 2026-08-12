import { Inter } from "next/font/google";
import "../../app/globals.css";
import { ReactNode } from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "TV Dashboard",
};

export default function TvLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${inter.className} h-screen w-screen overflow-hidden bg-[#2D2D2D] text-white`}>
      {children}
    </div>
  );
}
