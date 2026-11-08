import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiPost } from "@/lib/api";
import type { GameState } from "@/lib/types";

// Full wipe: roster, campaign, commander career, memorial wall and graveyard.
export default function ResetEverything() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const wipe = useMutation({
    mutationFn: () => apiPost<GameState>("/campaign/wipe", { confirm: "RESET" }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      setOpen(false);
      setTyped("");
      toast.success("Everything is gone. A fresh squad reports for duty.");
    },
    onError: () => toast.error("Reset failed — try again"),
  });

  return (
    <>
      <Button
        data-testid="reset-everything-btn"
        variant="outline"
        size="sm"
        className="w-full border-[#5C2626] text-[#E24A4A] hover:bg-[#2A1414]"
        onClick={() => setOpen(true)}
      >
        <RotateCcw size={14} className="mr-2" /> START ALL OVER
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }}>
        <DialogContent className="border-[#5C2626] bg-[#1A1D17]" data-testid="reset-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl tracking-wide text-[#E24A4A]">ERASE THE ENTIRE WAR?</DialogTitle>
            <DialogDescription className="font-mono text-xs leading-relaxed text-[#A2B29A]">
              This permanently deletes your soldiers, their ranks and medals, the campaign, your commander rank,
              and the whole Memorial Wall with every grave and flower. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <label className="font-mono text-xs text-[#E3E7DC]">
            Type <span className="text-[#E24A4A]">RESET</span> to confirm
            <Input
              data-testid="reset-confirm-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1.5 font-mono"
              autoFocus
            />
          </label>
          <DialogFooter>
            <Button data-testid="reset-cancel-btn" variant="outline" onClick={() => setOpen(false)}>
              KEEP MY WAR
            </Button>
            <Button
              data-testid="reset-confirm-btn"
              variant="destructive"
              disabled={typed !== "RESET" || wipe.isPending}
              onClick={() => wipe.mutate()}
            >
              {wipe.isPending ? "ERASING…" : "ERASE EVERYTHING"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
