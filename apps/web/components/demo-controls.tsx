"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { useGuidedWalkthrough } from "@/components/guided-walkthrough";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function DemoControls() {
  const router = useRouter();
  const { restart } = useGuidedWalkthrough();
  const [resetting, setResetting] = useState(false);

  async function resetWorkspace() {
    if (resetting) return;
    setResetting(true);
    try {
      await apiPost("/api/demo/reset");
      restart();
      toast.success("Demo workspace reset");
      router.replace("/");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset the demo");
    } finally {
      setResetting(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="sm" variant="outline" data-testid="demo-controls-button" />}
      >
        <MoreHorizontal />
        <span className="hidden sm:inline">Demo controls</span>
        <span className="sr-only sm:hidden">Demo controls</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={restart}>
          <RotateCcw /> Restart walkthrough
        </DropdownMenuItem>
        <DropdownMenuItem disabled={resetting} onClick={() => void resetWorkspace()}>
          <Trash2 /> {resetting ? "Resetting…" : "Reset workspace"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut({ callbackUrl: "/demo" })}>
          <LogOut /> Leave demo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
