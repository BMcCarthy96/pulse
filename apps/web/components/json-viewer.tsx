"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function JsonViewer({ data, label = "JSON" }: { data: unknown; label?: string }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(data, null, 2);

  return (
    <div className="rounded-md border bg-muted/30">
      <div className="flex items-center justify-between border-b px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-muted-foreground flex items-center gap-1 text-xs font-medium"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {label}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
      </div>
      {open && <pre className="max-h-96 overflow-auto p-2 text-xs">{text}</pre>}
    </div>
  );
}
