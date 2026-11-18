"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The browser's print dialog: "Save as PDF" there makes the PDF (print styles hide the app around the report). */
export function PrintButton() {
  return (
    <Button size="sm" variant="secondary" className="h-8" onClick={() => window.print()}>
      <Printer className="size-4" /> Print / Save as PDF
    </Button>
  );
}
