import type { NextAuthConfig } from "next-auth";

const PUBLIC_PATHS = ["/login", "/register"];

export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

      if (auth?.user && isPublic) {
        return Response.redirect(new URL("/", request.nextUrl));
      }
      if (!auth?.user && !isPublic) return false;
      return true;
    },
  },
} satisfies NextAuthConfig;
