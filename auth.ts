import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Wajib untuk localhost HTTP — tanpa ini NextAuth lempar error "Configuration"
  trustHost: true,

  pages: {
    signIn: "/login",
  },

  // Session strategy JWT: data user disimpan di cookie (encrypted),
  // bukan di database — lebih ringan untuk MVP
  session: {
    strategy: "jwt",
  },

  callbacks: {
    // 1. jwt() dipanggil saat login berhasil (authorize() return user)
    //    Data dari authorize() ada di parameter `user`
    //    Kita simpan role & tenantId ke dalam token supaya tidak hilang
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.tenantId = user.tenantId;
      }
      return token;
    },

    // 2. session() dipanggil setiap kali session dibaca (misal: auth() di API route)
    //    Kita pindahkan data dari token ke session.user
    //    Inilah kenapa session.user.tenantId bisa diakses di vendor route
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.tenantId = token.tenantId as string;
      }
      return session;
    },

    // authorized() dipanggil oleh middleware untuk cek apakah request boleh lanjut
    authorized({ auth }) {
      return !!auth?.user;
    },
  },

  providers: [
    Credentials({
      async authorize(credentials) {
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password,
        );

        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
        };
      },
    }),
  ],
});