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

const BRAND_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; colorClass: string }
> = {
  INSTAGRAM: { icon: InstagramIcon, colorClass: "text-pink-400 group-hover:text-pink-300" },
  LINKEDIN: { icon: LinkedinIcon, colorClass: "text-sky-400 group-hover:text-sky-300" },
  FACEBOOK: { icon: FacebookIcon, colorClass: "text-blue-400 group-hover:text-blue-300" },
  YOUTUBE: { icon: YoutubeIcon, colorClass: "text-red-400 group-hover:text-red-300" },
  WEBSITE: { icon: Globe, colorClass: "text-cyan-400 group-hover:text-cyan-300" },
};

const TRACKED_EVENT_BY_TYPE: Record<string, string> = {
  INSTAGRAM: "INSTAGRAM_CLICK",
  LINKEDIN: "LINKEDIN_CLICK",
};

export function DigitalCardLinks({ links, onTrack }: { links: Link[]; onTrack: (eventType: string) => void }) {
  if (links.length === 0) return null;

  return (
    <div className="space-y-2">
      {links.map((link) => {
        const brand = BRAND_CONFIG[link.type];
        const Icon = brand ? brand.icon : Link2;
        const colorClass = brand ? brand.colorClass : "text-white/60 group-hover:text-white";

        return (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onTrack(TRACKED_EVENT_BY_TYPE[link.type] ?? "LINK_CLICK")}
            className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 shadow-sm backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.08] hover:scale-[1.01] active:scale-[0.99]"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white/10 backdrop-blur-md">
              <Icon className={`h-4 w-4 transition-colors ${colorClass}`} />
            </div>
            <span className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-white">{link.label}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/30 transition-colors group-hover:text-white/70" strokeWidth={2} />
          </a>
        );
      })}
    </div>
  );
}

