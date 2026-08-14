"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { APP_NAME } from "@pulse/shared";
import { SidebarNav } from "@/components/sidebar-nav";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function MobileNavigation({ demo = false }: { demo?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="icon-sm" variant="ghost" className="md:hidden" />}>
        <Menu />
        <span className="sr-only">Open navigation</span>
      </SheetTrigger>
      <SheetContent side="left" className="w-72" aria-label="Main navigation">
        <SheetHeader>
          <SheetTitle>{APP_NAME}</SheetTitle>
          <SheetDescription>
            {demo ? "Isolated recruiter demo" : "Lakeview Health Partners"}
          </SheetDescription>
        </SheetHeader>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
