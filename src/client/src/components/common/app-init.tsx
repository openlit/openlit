"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { fetchAndPopulateCurrentUserStore } from "@/helpers/client/user";
import {
	fetchOrganisationList,
	fetchPendingInvitations,
} from "@/helpers/client/organisation";
import { fetchProjectList } from "@/helpers/client/project";
import { getIsUserFetched } from "@/selectors/user";
import {
	getCurrentOrganisation,
	getOrganisationList,
} from "@/selectors/organisation";
import { useRootStore } from "@/store";
import { onOrganisationChanged } from "@/features/organisation";

export default function AppInit() {
	const isFetched = useRootStore(getIsUserFetched);
	const organisationList = useRootStore(getOrganisationList);
	const currentOrg = useRootStore(getCurrentOrganisation);
	const isOrgLoading = useRootStore(
		(state) => state.organisation.isLoading
	);
	const pathname = usePathname();

	useEffect(() => {
		if (!isFetched) {
			fetchAndPopulateCurrentUserStore();
			fetchOrganisationList();
			fetchPendingInvitations();
		}
	}, [isFetched]);

	useEffect(() => {
		if (currentOrg?.id) {
			onOrganisationChanged(currentOrg.id);
			fetchProjectList(currentOrg.id);
		}
	}, [currentOrg?.id]);

	// Redirect to onboarding if user has no organisations
	useEffect(() => {
		if (
			!isOrgLoading &&
			Array.isArray(organisationList) &&
			organisationList.length === 0 &&
			pathname !== "/onboarding"
		) {
			window.location.href = "/onboarding";
		}
	}, [isOrgLoading, organisationList, pathname]);

	return null;
}
