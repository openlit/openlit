"use client";

import { DemoAccountProvider } from "@/contexts/demo-account-context";

export function ClientDemoAccountProvider({ children }: { children: React.ReactNode }) {
  return <DemoAccountProvider>{children}</DemoAccountProvider>;
} 