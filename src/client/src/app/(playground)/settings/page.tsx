"use client";
import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { useRouter } from "next/navigation";

export default function DefaultSettingsPage() {
  const posthog = usePostHog();
  const router = useRouter();

  useEffect(() => {
    posthog?.capture(CLIENT_EVENTS.SETTINGS_PAGE_VISITED);
    router.replace("/settings/profile");
  }, []);

  return null;
}