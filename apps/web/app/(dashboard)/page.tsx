import { auth } from "@/auth";

export default async function OverviewPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <div>
      <h1 className="text-xl font-semibold">Overview</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Signed in as {user?.name} ({user?.role})
      </p>
    </div>
  );
}
