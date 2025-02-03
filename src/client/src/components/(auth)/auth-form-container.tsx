"use client";
import { MoveRightIcon } from "lucide-react";
import { GithubIcon } from "lucide-react";
import { Button } from "../ui/button";
import Link from "next/link";

const Confetti = () => {
	return (
		<>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.15]"
				style={{
					width: "97.6408px",
					height: "97.6408px",
					top: "2.70155%",
					left: "47.1158%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.1]"
				style={{
					width: "56.3488px",
					height: "56.3488px",
					top: "5.21457%",
					left: "26.7941%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.2]"
				style={{
					width: "83.3041px",
					height: "83.3041px",
					top: "78.102%",
					left: "85.553%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.2]"
				style={{
					width: "73.5714px",
					height: "73.5714px",
					top: "54.351%",
					left: "90.7616%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.05]"
				style={{
					width: "86.0302px",
					height: "86.0302px",
					top: "81.7666%",
					left: "24.0279%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.1]"
				style={{
					width: "38.3342px",
					height: "38.3342px",
					top: "28.2189%",
					left: "17.891%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.1]"
				style={{
					width: "101.238px",
					height: "101.238px",
					top: "49.6367%",
					left: "60.0206%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.15]"
				style={{
					width: "92.0699px",
					height: "92.0699px",
					top: "16.2664%",
					left: "13.4283%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.15]"
				style={{
					width: "28.6254px",
					height: "28.6254px",
					top: "47.9082%",
					left: "18.7969%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.1]"
				style={{
					width: "62.0424px",
					height: "62.0424px",
					top: "15.3172%",
					left: "68.8908%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.05]"
				style={{
					width: "37.4925px",
					height: "37.4925px",
					top: "32.3152%",
					left: "71.9833%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.1]"
				style={{
					width: "66.0742px",
					height: "66.0742px",
					top: "11.2482%",
					left: "3.57173%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.2]"
				style={{
					width: "78.706px",
					height: "78.706px",
					top: "11.0894%",
					left: "74.244%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.2]"
				style={{
					width: "49.0052px",
					height: "49.0052px",
					top: "25.1587%",
					left: "52.0703%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.01]"
				style={{
					width: "24.4747px",
					height: "24.4747px",
					top: "81.188%",
					left: "65.8224%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.01]"
				style={{
					width: "102.344px",
					height: "102.344px",
					top: "75.5579%",
					left: "92.4095%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.01]"
				style={{
					width: "29.7934px",
					height: "29.7934px",
					top: "92.546%",
					left: "61.1729%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.2]"
				style={{
					width: "92.9791px",
					height: "92.9791px",
					top: "88.4441%",
					left: "57.8831%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.05]"
				style={{
					width: "55.2333px",
					height: "55.2333px",
					top: "18.6437%",
					left: "32.9982%",
				}}
			/>
			<div
				className="absolute rounded-full bg-primary z-0 opacity-[0.15]"
				style={{
					width: "73.6121px",
					height: "73.6121px",
					top: "90.6981%",
					left: "12.1542%",
				}}
			/>
		</>
	);
};

export default function AuthFormContainer({
	children,
}: {
	children: JSX.Element;
}) {
	return (
		<div className="flex flex-col justify-center p-8 lg:p-16 bg-stone-50 relative">
			<Confetti />
			<div className="flex flex-col w-full max-w-sm mx-auto gap-12 z-10">
				<div className="text-center">
					<h1 className="text-4xl font-bold tracking-tight text-primary">
						Welcome to OpenLIT
					</h1>
					<p className="text-stone-600">
						Open Source Platform for AI Engineering
					</p>
				</div>
				{children}
				<div className="grid grid-cols-2 text-center text-sm">
					<Link
						href={"https://github.com/openlit/openlit"}
						target="_blank"
						className="w-full"
					>
						<Button
							className={`w-full rounded-full gap-2 font-bold bg-stone-900 text-stone-50 hover:bg-stone-900/90 dark:bg-stone-900 dark:text-stone-50 dark:hover:bg-stone-900/90`}
						>
							Github
							<GithubIcon className="ml-2 w-4" />
						</Button>
					</Link>
					<Link
						href="https://docs.openlit.io/latest/introduction"
						target="_blank"
					>
						<Button variant={"ghost"} className="hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-100 dark:hover:text-stone-900">
							<b>Documentation</b>
							<MoveRightIcon className="ml-2 h-5 w-5" />
						</Button>
					</Link>
				</div>
			</div>
		</div>
	);
}
