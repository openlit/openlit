"use client";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react";

export default function AutoSignInDemoInstance({ children, demoCreds }: { children: JSX.Element, demoCreds: { email?: string, password?: string; } }) {
  const router = useRouter()
  const [err, setError] = useState<boolean>(false);
  const setErrorLoginDemoAccount = () => {
    setError(true);
    window.localStorage.setItem("failedDemoLogin", "true");
  };

  useEffect(() => {
    const failedDemoLogin = window.localStorage.getItem("failedDemoLogin");
    if (failedDemoLogin !== "true") {
      if (demoCreds.email && demoCreds.password) {
        signIn("login", {
          email: demoCreds.email,
          password: demoCreds.password,
          redirect: false,
        }).then((obj) => {
          if (obj?.status !== 200) {
            setErrorLoginDemoAccount();
          } else {
            router.replace("/dashboard")
          }
        }).catch(() => {
          setErrorLoginDemoAccount();
        });
      }
    } else {
      setError(true);
    }
  }, []);

  if (demoCreds.email && demoCreds.password && !err) return (
    <div className="flex flex-col items-center justify-center h-screen space-y-4 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )

  return children;
}