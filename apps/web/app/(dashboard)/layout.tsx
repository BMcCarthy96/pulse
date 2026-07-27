import { auth, signOut } from "@/auth";
import { SidebarNav } from "@/components/sidebar-nav";
import { GlobalHealthDot } from "@/components/global-health-dot";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { APP_NAME } from "@pulse/shared";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-card">
        <div className="border-b px-4 py-4">
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
          <p className="text-muted-foreground text-xs">Lakeview Health Partners</p>
        </div>
        <SidebarNav />
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-card px-4">
          <GlobalHealthDot />
          <div className="flex items-center gap-3">
            {user && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{user.name}</span>
                  <Badge variant="secondary">{user.role}</Badge>
                </div>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/login" });
                  }}
                >
                  <Button type="submit" variant="ghost" size="sm">
                    Sign out
                  </Button>
                </form>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 bg-muted/20 p-6">{children}</main>
      </div>
    </div>
  );
}
