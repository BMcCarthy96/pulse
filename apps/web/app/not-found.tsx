import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="space-y-3 text-center">
        <h1 className="text-lg font-semibold">That Pulse page does not exist</h1>
        <Link href="/" className="text-sm underline">
          Return to dashboard
        </Link>
      </div>
    </main>
  );
}
