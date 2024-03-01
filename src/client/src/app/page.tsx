import Features from "@/components/(landing-page)/components/features";
import Hero from "@/components/(landing-page)/components/hero";
import Navbar from "@/components/(landing-page)/components/navbar";
import WhyDoku from "@/components/(landing-page)/components/whydoku";
import { ArrowRightIcon } from "@heroicons/react/24/solid";
import Image from "next/image";

export default function Home() {
	return (
		<div className="flex flex-col w-full min-h-screen bg-secondary">
			<Navbar />
			<Hero />
			<WhyDoku />
			<Features />
		</div>
	);
}
