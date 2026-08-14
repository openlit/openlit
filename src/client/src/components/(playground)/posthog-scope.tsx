"use client";

import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import { getCurrentOrganisation } from "@/selectors/organisation";
import { getCurrentProject } from "@/selectors/project";
import { useRootStore } from "@/store";

/**
 * Associates subsequent PostHog events with the current organisation and
 * project as Groups. Opaque cuid ids only — never names.
 *
 * This is what makes PostHog "Active Groups" (DAO / WAO / MAO) correct:
 * an organisation counts as active when an identified user fires any
 * client event while grouped to that organisation. Same for projects.
 *
 * MAU stays driven by `posthog.identify(user.id)` elsewhere.
 */
export default function PostHogScope() {
	const posthog = usePostHog();
	const currentOrg = useRootStore(getCurrentOrganisation);
	const currentProject = useRootStore(getCurrentProject);

	useEffect(() => {
		if (!posthog || !currentOrg?.id) return;
		posthog.group("organisation", currentOrg.id);
	}, [posthog, currentOrg?.id]);

	useEffect(() => {
		if (!posthog || !currentProject?.id) return;
		posthog.group("project", currentProject.id);
	}, [posthog, currentProject?.id]);

	return null;
}
