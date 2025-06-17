"use client";

import { SessionProvider } from "next-auth/react";
import { DemoAccountProvider } from "@/contexts/demo-account-context";
import type { ReactNode } from "react";
import type { Session } from "next-auth";

type ProvidersProps = {
  children: ReactNode;
};

const AuthProvider = ({ children }: ProvidersProps) => {
  return (
    <SessionProvider session={null as Session | null}>
      {children}
    </SessionProvider>
  );
};

const Providers = ({ children }: ProvidersProps) => {
  return (
    <AuthProvider>
      <DemoAccountProvider>
        {children}
      </DemoAccountProvider>
    </AuthProvider>
  );
};

export default Providers; 