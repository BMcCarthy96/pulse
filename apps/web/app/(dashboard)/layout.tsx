import { auth, signOut } from "@/auth";
import { SidebarNav } from "@/components/sidebar-nav";
import { GlobalHealthDot } from "@/components/global-health-dot";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { APP_NAME } from "@pulse/shared";
import { DemoResetButton } from "@/components/demo-reset-button";
import { MobileNavigation } from "@/components/mobile-navigation";
import { RecruiterTour } from "@/components/recruiter-tour";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="flex min-h-screen">
      <aside className="bg-card hidden w-56 shrink-0 border-r md:block">
        <div className="border-b px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-indigo-600 text-sm font-bold text-white shadow-sm">
              P
            </span>
            <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            {user?.demoSessionId ? "Isolated recruiter demo" : "Lakeview Health Partners"}
          </p>
        </div>
        <SidebarNav />
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="bg-card flex min-h-14 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
          <div className="flex items-center gap-2">
            <MobileNavigation demo={Boolean(user?.demoSessionId)} />
            <GlobalHealthDot />
            {user?.demoSessionId && (
              <Badge
                variant="outline"
                className="hidden border-teal-200 bg-teal-50 text-teal-800 sm:inline-flex"
              >
                Synthetic workspace
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {user && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <span className="hidden font-medium sm:inline">{user.name}</span>
                  <Badge variant="secondary">{user.role}</Badge>
                </div>
                {user.demoSessionId && <RecruiterTour demoSessionId={user.demoSessionId} />}
                {user.demoSessionId && <DemoResetButton />}
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/recruiter" });
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

        <main id="main-content" className="bg-muted/20 min-w-0 flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
