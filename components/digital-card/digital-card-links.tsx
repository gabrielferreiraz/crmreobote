"use client";

import { Globe, Link2, ExternalLink } from "lucide-react";

type Link = { id: string; type: string; label: string; url: string };

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  );
}

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 8H6v4h3v12h5V12h3.642L18 8h-4V6.333C14 5.374 14.5 5 15.5 5H18V0h-3.808C10.592 0 9 1.583 9 4.615V8z"/>
    </svg>
  );
}

function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
    </svg>
  );
}

function ReoboteEmblemIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 2466 886" fill="currentColor">
      <path d="M2452.4 5.6A36 36 0 0 1 2466 29a93 93 0 0 1-2.3 23.3l-2 10.9-1.3 8-7.6 42.8-19.7 112-5.8 33.2-.6 3.3-8.5 48.5-.6 3.1-5.8 33-2 11.5-.5 2.8q-3 16.6-5.8 33.3l-2.7 15.5-3.6 20.6-.5 3a42 42 0 0 1-17.2 29.6c-8.5 5.2-17.7 6-27.4 4-15.6-4.8-22.4-18.6-30.4-31.7l-7-11-27.2-42.2-15.6-24.3-23-35.7-4-6.4c-4-6.3-4-6.3-8.2-12.5l-2.2-3.2-2-3c-1.5-2.4-1.5-2.4-1.5-4.4a339 339 0 0 0-21.8 19q-4.4 4.2-9.2 8.3l-7.5 6.7a650 650 0 0 1-18.5 16.5l-11 9.7-9.6 8.6q-3 3-6.3 5.6-4.9 4.2-9.6 8.6a650 650 0 0 1-18.5 16.5l-18 16-9 8-14 12.5a1161 1161 0 0 1-23 20.5l-18 16-9 8-14 12.5a1161 1161 0 0 1-23 20.5l-18 16-9 8-14 12.5a1161 1161 0 0 1-23 20.5l-11 9.7-9.6 8.6q-3 3-6.3 5.6-4.9 4.2-9.6 8.6a650 650 0 0 1-18.5 16.5l-18 16-9 8-14 12.5a1161 1161 0 0 1-23 20.5l-18 16-9 8-14 12.5a1161 1161 0 0 1-23 20.5l-18 16a664 664 0 0 1-17.9 15.9l-7.6 7c-12 11-23.7 19-40.5 18.8-14.5-1-23.8-8.6-34-18.2l-4-3.6q-8.4-7.3-16.6-14.7l-13.3-11.9-9.7-8.6q-3-3-6.3-5.6l-12.4-11.2-15.7-13.9-9-8-16.6-14.8-13.3-11.9-9.7-8.6q-3-3-6.4-5.7l-16.6-14.8-13.3-11.9-9.8-8.8-2.3-2-2-1.9c-2-1.4-2-1.4-4.3-.6a54 54 0 0 0-9.1 7 305 305 0 0 1-14.7 12 409 409 0 0 0-15.3 12.6l-11.8 9.7-10.7 8.6-2.1 1.7-38 31-38 31-38.1 31.1-11.4 9.3L1223 788l-38 31-32.8 26.8-2.6 2-5.3 4.5c-13.4 11-24.1 19.7-42 20h-2.5l-8.5.2-6 .2q-28.6.6-57.3.7l-15 .2-25.8.2-38.6.4-129.1 1.2h-4.1l-16.3.2q-22.8 0-45.6.4h-2l-66 .6h-2.2l-34.7.3-137.5 1.3-34.6.3h-2.2l-65.9.7h-2l-45.6.4-16.4.2h-4L55 882.3H42.5A46 46 0 0 1 11.3 870 45 45 0 0 1-.2 836.8c.6-11.2 6-21.5 14.2-29.2 10.6-8.3 21.2-9.9 34.3-10l14-.1 11.3-.2 27.7-.3 13.4-.1 172.8-1.6 68.4-.6h2l24.7-.3 37.5-.3h4.2l98.7-1h6.5l100.8-1h2.2l24.2-.2h13.1l99-1h2l43.6-.4 20.4-.2h2l228.3-2c15.2.9 15.2.9 28.5-4.5l2.5-2.2 2.9-2.6 8-6.4 4.1-3.4 2-1.7 34-27.7 38-31 38-31 38-31 11.4-9.3L1305 611l38-31 38-31 30-24.6c12.5-10.4 23.3-17.2 39.9-16.7 13.8 1.3 23.3 9.1 33.1 18.3l4 3.4 12.3 11.2 15.7 13.9 9 8 16.6 14.8 13.3 11.9 9.7 8.6q3 3 6.3 5.6l12.4 11.2 15.7 13.9 9 8 16.6 14.8 20.4 18.2 5 4.5 2.2 2 2.1 1.9 1.8 1.6q3.3 2.5 6.9 4.5l2.1-2a860 860 0 0 1 21.9-19.5l18-16 9-8 14-12.5a1161 1161 0 0 1 23-20.5l18-16 9-8 14-12.5a1161 1161 0 0 1 23-20.5l18-16 9-8 14-12.5a1161 1161 0 0 1 23-20.5l11-9.7 9.6-8.6q3-3 6.3-5.6 4.9-4.2 9.6-8.6a650 650 0 0 1 18.5-16.5l18-16 9-8 14-12.5a1161 1161 0 0 1 23-20.5l18-16 9-8 14-12.5a1161 1161 0 0 1 23-20.5l18-16 9-8 14-12.5a1161 1161 0 0 1 23-20.5l18-16a580 580 0 0 1 17-14.8l1.7-1.4c1.4-1.3 1.4-1.3 2.3-3.3l-2.5-.7a91 91 0 0 1-13.8-6.5l-7.4-3.8-5-2.6a2712 2712 0 0 1-46.8-24.4l-41.4-21.6-22.8-11.8c-10.9-5.6-20.4-11.5-24.7-23.7-2-9.6-2-20.4 3.4-28.9a42 42 0 0 1 27.4-16.8l3.2-.8 10.7-2.7 5.8-1.4 86-20.8q51.2-12.2 102.2-24.7l29-7 3.5-1 77.4-18.7 5-1.2 2.5-.6 34.7-8.4 16.8-4.2c15-3.8 30.4-7.4 44.2 2M2389 78l-3.6.9-230.8 56-4 .9-21.6 5.2a24 24 0 0 0 7.4 5.3l2.7 1.4 2.9 1.4 6 3 3.1 1.5 12 6.2a2658 2658 0 0 0 47.8 24.9l2.3 1.2 4 2.1c1.8 1 1.8 1 4.3 2.7 3.4 1.7 6.5 1.7 10.2 1.8 12.4.5 23.4 3.9 32.1 13.3a47 47 0 0 1 10.5 27.5 24 24 0 0 0 5.3 12.2l4.6 6.9q5 7.5 9.8 15.1l27 42c10.4 16.3 10.4 16.3 21 32.5h2l13.6-77.2 5.7-32.4 1.2-7 3-17.5 8.3-47 .5-3.2 6.7-37.8 2.6-14.2 1.9-10.7 1-6 .6-2.8c1-4.2 1-4.2-.1-8.2" />
    </svg>
  );
}

const BRAND_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; colorClass: string }
> = {
  INSTAGRAM: { icon: InstagramIcon, colorClass: "text-pink-400 group-hover:text-pink-300" },
  LINKEDIN: { icon: LinkedinIcon, colorClass: "text-sky-400 group-hover:text-sky-300" },
  FACEBOOK: { icon: FacebookIcon, colorClass: "text-blue-400 group-hover:text-blue-300" },
  YOUTUBE: { icon: YoutubeIcon, colorClass: "text-red-400 group-hover:text-red-300" },
  WEBSITE: { icon: ReoboteEmblemIcon, colorClass: "text-[#00aeee] group-hover:text-cyan-300" },
};

const TRACKED_EVENT_BY_TYPE: Record<string, string> = {
  INSTAGRAM: "INSTAGRAM_CLICK",
  LINKEDIN: "LINKEDIN_CLICK",
};

export function DigitalCardLinks({ links, onTrack, light = false }: { links: Link[]; onTrack: (eventType: string) => void; light?: boolean }) {
  if (links.length === 0) return null;

  return (
    <div className="space-y-2">
      {links.map((link) => {
        const brand = BRAND_CONFIG[link.type];
        const Icon = brand ? brand.icon : Link2;
        const colorClass = brand
          ? brand.colorClass
          : light
          ? "text-slate-600 group-hover:text-slate-900"
          : "text-white/60 group-hover:text-white";

        return (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onTrack(TRACKED_EVENT_BY_TYPE[link.type] ?? "LINK_CLICK")}
            className={`group flex items-center gap-3.5 rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-md transition-all hover:scale-[1.02] active:scale-[0.98] ${
              light
                ? "border-sky-300/40 bg-white/70 shadow-sky-950/5 hover:border-[#00aeee]/50 hover:bg-white"
                : "border-white/5 bg-gradient-to-r from-white/[0.05] to-transparent hover:border-[#00aeee]/30 hover:from-[#00aeee]/10 hover:to-transparent"
            }`}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                light
                  ? "bg-sky-100/70 shadow-inner ring-1 ring-sky-300/40 group-hover:ring-[#00aeee]/60"
                  : "bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] ring-1 ring-white/10 group-hover:ring-[#00aeee]/40"
              }`}
            >
              <Icon className={`h-4 w-4 drop-shadow-md transition-colors ${colorClass}`} />
            </div>
            <span
              className={`min-w-0 flex-1 truncate text-left text-base font-semibold tracking-wide transition-colors ${
                light ? "text-slate-800 group-hover:text-slate-950" : "text-white/90 group-hover:text-white"
              }`}
            >
              {link.label}
            </span>
            <ExternalLink
              className={`h-4 w-4 shrink-0 transition-colors ${
                light ? "text-slate-400 group-hover:text-[#00aeee]" : "text-white/20 group-hover:text-[#00aeee]/80"
              }`}
              strokeWidth={2}
            />
          </a>
        );
      })}
    </div>
  );
}

