"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  onOpenChange,
  variant = "default",
  contentClassName,
  confirmButtonProps,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => boolean | void | Promise<boolean | void>;
  onOpenChange?: (open: boolean) => void;
  variant?: "default" | "destructive";
  contentClassName?: string;
  confirmButtonProps?: Omit<
    React.ComponentProps<typeof Button>,
    "children" | "disabled" | "onClick" | "variant"
  > & { "data-walkthrough"?: string };
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  function updateOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={updateOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription render={<div />}>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => updateOpen(false)}>
            Cancel
          </Button>
          <Button
            {...confirmButtonProps}
            variant={variant === "destructive" ? "destructive" : "default"}
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                const result = await onConfirm();
                if (result !== false) updateOpen(false);
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
