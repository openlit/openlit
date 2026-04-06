import AuthFormContainer from "@/components/(auth)/auth-form-container";
import AutoSignInDemoInstance from "../../components/(auth)/auto-signin-demo-instance";
import AuthDetailsCarousel from "@/components/(auth)/auth-details-carousel";
import CustomPostHogProvider from "@/components/(playground)/posthog";

export default function AuthLayout({
	children,
}: {
	children: JSX.Element;
}) {
	const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

	return (
		<CustomPostHogProvider telemetryEnabled={telemetryEnabled}>
			<div className="min-h-screen grid lg:grid-cols-2 bg-white dark:bg-stone-950">
				<AuthDetailsCarousel />
				<AuthFormContainer>
					<AutoSignInDemoInstance demoCreds={{ email: process.env.DEMO_ACCOUNT_EMAIL, password: process.env.DEMO_ACCOUNT_PASSWORD }}>
						{children}
					</AutoSignInDemoInstance>
				</AuthFormContainer>
			</div>
		</CustomPostHogProvider>
	);
}
