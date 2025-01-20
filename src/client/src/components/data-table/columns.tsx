import { ReactNode } from "react";

export type Columns<T extends string, TransformedT> = Partial<
	Record<
		T,
		{
			header: () => ReactNode;
			cell: ({ row }: { row: TransformedT }) => ReactNode;
			enableHiding?: boolean;
		}
	>
>;
