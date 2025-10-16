"use client";
import ManageKeys from "@/components/(playground)/api-keys/manage";

export default function APIKeys() {
	return (
		<div className="flex w-full flex-1 overflow-hidden">
			<div className="flex flex-col grow w-full rounded overflow-hidden p-2 text-sm text-stone-900 dark:text-stone-300 gap-3 px-6 py-4 ">
				<p>
					Welcome to the API Key Management page. Here, you can view, generate,
					and manage API keys for seamless integration with our services. Please
					note that we do not display your secret API keys again after you
					generate them.
				</p>
				<ul className="list-disc list-inside ">
					<li>
						<span className="font-medium">Keep Your Keys Secure:</span> Treat
						your API keys like passwords. Do not share them publicly or expose
						them in places where unauthorized individuals may access them.
					</li>
					<li>
						<span className="font-medium">Rotate Keys Regularly:</span> For
						enhanced security, consider rotating your keys periodically.
					</li>
					<li>
						<span className="font-medium">Revoke Unused Keys:</span> If a key is
						no longer needed or compromised, revoke it immediately.
					</li>
				</ul>
				<ManageKeys />
			</div>
		</div>
	);
}
