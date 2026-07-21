import { ReactNode } from "react";

export type Columns<T extends string, TransformedT> = Partial<
	Record<
		T,
		{
			header: () => ReactNode;
			cell: ({ row, extraFunctions }: { row: TransformedT, extraFunctions: Record<string, any> }) => ReactNode;
			enableHiding?: boolean;
			/** Optional CSS grid track size (e.g. `2.75rem` or `minmax(10rem, 1.4fr)`). */
			width?: string;
		}
	>
>;
