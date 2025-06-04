"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

interface DemoAccountContextType {
  isDemoAccount: boolean;
}

const DemoAccountContext = createContext<DemoAccountContextType>({
  isDemoAccount: true,
});

export function DemoAccountProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const [isDemoAccount, setIsDemoAccount] = useState(() => {
    // Initialize from localStorage if available
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('isDemoAccount');
      return stored ? JSON.parse(stored) : true;
    }
    return true;
  });

  useEffect(() => {
    if (session?.data?.user?.email) {
      const isDemo = session.data.user.email.toLowerCase() === "demo@ragworks.ai";
      setIsDemoAccount(isDemo);
      // Persist to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('isDemoAccount', JSON.stringify(isDemo));
      }
    } else {
      console.log('[DemoAccount Debug] No user email found in session');
    }
  }, [session]);

  return (
    <DemoAccountContext.Provider value={{ isDemoAccount }}>
      {children}
    </DemoAccountContext.Provider>
  );
}

export const useDemoAccount = () => useContext(DemoAccountContext); 