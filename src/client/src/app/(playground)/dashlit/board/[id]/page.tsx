"use client";

import Dashboard from "../../board-creator";

// import Layout from "./layout";
// import DashboardOrganism from "./dashboard-organism";
// import Dashboard from "./dashboard-organism/dashboard";

export default function DashboardPage() {
	return (
		<div className="flex flex-col items-center w-full justify-between h-full">
			<h1>Custom Dashboard</h1>
			{/* <Layout /> */}
			<div className="flex flex-col items-center w-full justify-between h-full">
				<div
					// ref={this.onMeasureRef}
					className="flex flex-col items-center w-full justify-between h-full"
				>
					<div className="w-full h-full overflow-y-auto">
						{/* <DashboardOrganism
							layout={[
								{
									x: 0,
									y: 0,
									w: 2,
									h: 4,
									i: "0",
								},
								{
									x: 2,
									y: 0,
									w: 2,
									h: 3,
									i: "1",
								},
								{
									x: 4,
									y: 0,
									w: 2,
									h: 3,
									i: "2",
								},
								{
									x: 6,
									y: 0,
									w: 2,
									h: 5,
									i: "3",
								},
							]}
							isEditable={true}
						/> */}
						<Dashboard />
					</div>
				</div>
			</div>
		</div>
	);
}
