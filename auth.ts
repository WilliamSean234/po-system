import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Tentukan halaman custom untuk auth
  // Tanpa ini, NextAuth pakai halaman default di /api/auth/signin
  pages: {
    signIn: "/login", // Redirect ke /login jika belum authenticated
  },

  callbacks: {
    // `authorized` dipanggil setiap kali middleware dicek
    // Jika return false/undefined → user di-redirect ke halaman signIn
    // Jika return true → request dilanjutkan ke halaman tujuan
    authorized({ auth }) {
      return !!auth?.user; // true jika user sudah login, false jika belum
    },
  },

  providers: [
    // Credentials provider: login pakai email + password
    // Cocok untuk MVP karena tidak butuh OAuth setup
    Credentials({
      async authorize(credentials) {
        console.log("🔍 Mencoba login dengan:", credentials.email);

        // Cari user di database berdasarkan email
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        console.log("👤 Result findUnique:", user); // ← tambah ini

        // Jika user tidak ditemukan, tolak login
        if (!user) return null;

        console.log("🔑 Hash di DB:", user.password); // ← dan ini
        console.log("🔑 Password input:", credentials.password); // ← dan ini

        console.log("👤 User ditemukan:", user);
        console.log("📧 Email yang dicari:", credentials.email);

        // Bandingkan password yang diinput dengan hash di database
        // bcrypt.compare aman karena tidak bisa di-reverse
        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password,
        );

        console.log("✅ bcrypt result:", valid); // ← dan ini
        
        // Jika password salah, tolak login
        if (!valid) return null;
        console.log("🔑 Password valid:", valid);

        // Jika valid, kembalikan data user yang akan disimpan di session
        // Hanya kirim data yang diperlukan, jangan kirim password
        return {
          id: user.id,
          email: user.email,
          role: user.role, // Untuk keperluan role-based access control
          tenantId: user.tenantId, // Untuk filter data per tenant (multi-tenant)
        };
      },
    }),
  ],
});
