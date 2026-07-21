// app/dashboard/page.tsx
"use client"

import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-muted/40 p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">Purchase Order Management System</p>
          </div>

          {/* Tombol logout — memanggil signOut dari NextAuth */}
          {/* Setelah , session dihapus dan user di-redirect ke /login */}
          <Button
            variant="outline"
            onClick={() => signOut({ redirectTo: "/login" })}
          >
            Logout
          </Button>
        </div>

        {/* Placeholder konten dashboard */}
        <div className="rounded-lg border bg-card p-6 text-muted-foreground">
          Dashboard content coming soon...
        </div>
      </div>
    </div>
  )
}