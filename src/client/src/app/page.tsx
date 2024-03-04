import Features from "@/components/(landing-page)/components/features";
import Footer from "@/components/(landing-page)/components/footer";
import Hero from "@/components/(landing-page)/components/hero";
import Navbar from "@/components/(landing-page)/components/navbar";
import WhyDoku from "@/components/(landing-page)/components/whydoku";

export default function Home() {
	return (
		<div className="flex flex-col w-full min-h-screen bg-secondary/[0.7]">
			<Navbar />
			<Hero />
			<WhyDoku />
			<Features />
			<Footer />
		</div>
	);
}
