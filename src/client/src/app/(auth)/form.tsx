export function Form({
	action,
	children,
}: {
	action: any;
	children: React.ReactNode;
}) {
	return (
		<form
			action={action}
			className="flex flex-col space-y-4 px-4 py-8 sm:px-16"
		>
			<div>
				<label
					htmlFor="email"
					className="block text-xs dark:text-gray-200 uppercase"
				>
					Email Address
				</label>
				<input
					id="email"
					name="email"
					type="email"
					placeholder="user@acme.com"
					autoComplete="email"
					required
					className="mt-1 block w-full appearance-none border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-black focus:outline-none focus:ring-black sm:text-sm"
				/>
			</div>
			<div>
				<label
					htmlFor="password"
					className="block text-xs dark:text-gray-200 uppercase"
				>
					Password
				</label>
				<input
					id="password"
					name="password"
					type="password"
					required
					className="mt-1 block w-full appearance-none border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-black focus:outline-none focus:ring-black sm:text-sm"
				/>
			</div>
			{children}
		</form>
	);
}
