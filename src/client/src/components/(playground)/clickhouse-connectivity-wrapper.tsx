"use client";
import { useDemoAccount } from "@/contexts/demo-account-context";
import { pingActiveDatabaseConfig } from "@/helpers/client/database-config";
import { getPingDetails } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const ALLOWED_CONNECTIVITY_ALERT = [
	"/dashboard",
	"/requests",
	"/exceptions",
	"/prompt-hub",
	"/vault",
];

export default function ClickhouseConnectivityWrapper() {
	const pingDetails = useRootStore(getPingDetails);
	const pathname = usePathname();

	useEffect(() => {
		if (pingDetails.status === "pending") pingActiveDatabaseConfig();
	}, []);

	if (pingDetails.error && ALLOWED_CONNECTIVITY_ALERT.includes(pathname)) {
		return (
			<div className="p-4 mb-4 text-red-800 border border-red-300 rounded-md bg-red-50 dark:bg-red-950 dark:text-red-400 dark:border-red-800 w-full">
				<div className="flex">
					<div className="flex flex-col grow">
						<h3 className="text-lg font-medium">
							Looks like you&apos;ve found the doorway to the great nothing
						</h3>
						<div className="mb-2 text-sm">
							Sorry about that! Please visit settings page to configure your
							active clickhouse database.
						</div>
						<Link
							href="/settings/database-config"
							className="inline-flex my-2 border rounded md py-2 px-4 text-center bg-primary cursor-pointer text-white hover:bg-stone-950 outline-none self-start text-sm"
						>
							Take me there!
						</Link>
					</div>
					<Image
						alt="Connection failure"
						src="/images/connect.svg"
						className="flex-shrink-0 w-24 h-24 me-2 self-center"
						height="128"
						width="128"
					/>
				</div>
			</div>
		);
	}

	return null;
}
