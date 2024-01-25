import Image from "next/image";
import { redirect } from "next/navigation";
import { authOptions } from "./auth";

export default function Home() {
	return redirect(authOptions?.pages?.signIn || "/login");
}
