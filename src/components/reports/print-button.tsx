"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The browser's print dialog: "Save as PDF" there makes the PDF (print styles hide the app around the report). */
export function PrintButton() {
  return (
    <Button className="bg-ink hover:bg-ink/90 h-9 rounded-[9px] text-white" onClick={() => window.print()}>
      <Printer className="size-4" /> Print / Save as PDF
    </Button>
  );
}
